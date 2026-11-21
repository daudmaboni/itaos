// Connection health (migration 0060): finds Meta Ads / Conversions API / WhatsApp connections that stopped working,
// so the owner and Pondi hear about it on their phones instead of finding out days later.
//
// Checks, per connection:
//  - meta_ads:  a live call to Meta with the stored token. Token rejected (expired, revoked, password changed, app
//               removed) → "ads_token". Ad account disabled / unpaid / under review / closed → "ads_account".
//               Meta being down (5xx, timeouts) is ignored for that run so alerts don't flap.
//  - meta_capi: the connection was marked "error" by the capi function (token rejected) → "capi".
//  - whatsapp:  marked "error" → "wa_error". Or, for a number that is normally busy (≥100 webhook events in 7 days),
//               no event at all for 3× its longest quiet gap of the last 14 days (between 4 and 12 hours) → "wa_silent".
//               Numbers never linked (no event yet) are skipped.
//
// One open alert per connection (connection_alerts). New problem → notify. Still broken → remind once a day.
// Fixed → close the alert and send "working again".
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const graphBase = () => `https://graph.facebook.com/${Deno.env.get("META_GRAPH_VERSION") ?? "v25.0"}`;
const H = 3600_000;
const REMIND_MS = 22 * H;   // cron runs every 2 h; 22 h keeps reminders at about one a day
const BUSY_EVENTS_7D = 100;

export type Kind = "ads_token" | "ads_account" | "capi" | "wa_silent" | "wa_error";
export type Problem = { kind: Kind; problem: string; hours?: number; usual?: number };
type Conn = { id: string; workspace_id: string; provider: string; external_id: string; label: string | null; status: string; last_sync_at: string | null; last_error: string | null; token_secret_id: string | null };

const AD_STATES: Record<number, string> = { 2: "disabled", 3: "unpaid (billing problem)", 7: "under risk review", 101: "closed" };

/** Decides whether a WhatsApp number has gone quiet for longer than is normal for it. Exported for tests. */
export function waSilence(events7d: number, maxGapS: number, lastEvent: string | null, now = Date.now()): { hours: number; usual: number; limit: number } | null {
  if (!lastEvent || events7d < BUSY_EVENTS_7D) return null;
  const limit = Math.min(12 * H, Math.max(4 * H, 3 * maxGapS * 1000));
  const quiet = now - Date.parse(lastEvent);
  if (quiet <= limit) return null;
  return { hours: Math.floor(quiet / H), usual: Math.max(1, Math.round(maxGapS / 3600)), limit: limit / H };
}

/** Meta error → is the token itself the problem (vs. Meta having a bad moment)? Exported for tests. */
export function tokenProblem(status: number, err: { code?: number; error_subcode?: number; message?: string } | undefined): boolean {
  if (!err) return false;
  if (err.code === 190 || err.code === 102) return true;                    // invalid / expired / revoked token
  if (err.code === 200 || err.code === 10 || (err.code ?? 0) >= 200 && (err.code ?? 0) < 300) return true;   // permission removed
  if (err.code === 100 && status === 400) return true;                      // ad account no longer reachable with this token
  return false;
}

async function checkAds(db: SupabaseClient, c: Conn): Promise<Problem | null | "skip"> {
  if (!c.token_secret_id) return { kind: "ads_token", problem: "no Meta token is stored" };
  const { data: token } = await db.rpc("svc_read_token", { p_secret_id: c.token_secret_id });
  if (!token) return { kind: "ads_token", problem: "the Meta token is missing" };
  let res: Response;
  try {
    res = await fetch(`${graphBase()}/${c.external_id}?fields=account_status,name`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  } catch { return "skip"; }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    if (tokenProblem(res.status, body.error)) return { kind: "ads_token", problem: `Meta refused the token: ${String(body.error?.message ?? "access denied").slice(0, 140)}` };
    return "skip";
  }
  const st = AD_STATES[Number(body.account_status)];
  if (st) return { kind: "ads_account", problem: `the ad account is ${st} on Meta` };
  // Token works again: clear an old token error left by ads-sync so the Connections page turns green.
  if (c.status === "error" && /code 190|token/i.test(c.last_error ?? "")) await db.from("connections").update({ status: "active", last_error: null }).eq("id", c.id);
  return null;
}

async function checkWa(db: SupabaseClient, c: Conn): Promise<Problem | null | "skip"> {
  if (!c.last_sync_at) return "skip";   // never linked yet (e.g. Dualhook set up but number not connected)
  if (c.status === "error") return { kind: "wa_error", problem: c.last_error ? `WhatsApp reported: ${c.last_error.slice(0, 140)}` : "the WhatsApp connection reports an error" };
  const { data, error } = await db.rpc("svc_wa_traffic", { p_ws: c.workspace_id });
  if (error) return "skip";
  const t = (Array.isArray(data) ? data[0] : data) as { events_7d: number; max_gap_s: number; last_event: string | null } | null;
  const s = t && waSilence(Number(t.events_7d), Number(t.max_gap_s), t.last_event);
  return s ? { kind: "wa_silent", problem: `no WhatsApp activity for ${s.hours} hours`, hours: s.hours, usual: s.usual } : null;
}

export async function checkConnection(db: SupabaseClient, c: Conn): Promise<Problem | null | "skip"> {
  if (c.provider === "meta_ads") return checkAds(db, c);
  if (c.provider === "whatsapp") return checkWa(db, c);
  if (c.provider === "meta_capi") return c.status === "error" ? { kind: "capi", problem: c.last_error ? `Meta refused: ${c.last_error.slice(0, 140)}` : "Meta refused the Conversions API token" } : null;
  return "skip";
}

/** Notification text for the owner (their language) and for Pondi staff (English, with the business name). Exported for tests. */
export function message(p: Problem | null, wasKind: Kind | null, name: string, sw: boolean, staff: boolean): { title: string; body: string; url: string } {
  const T = (en: string, s: string) => (sw && !staff ? s : en);
  const who = staff ? `${name}: ` : "";
  const url = staff ? "/app/admin" : "/app#connect";
  if (!p) {
    const what = wasKind?.startsWith("ads") ? "Meta Ads" : wasKind === "capi" ? T("Sending sales to Meta", "Kutuma mauzo kwa Meta") : "WhatsApp";
    return { title: `✅ ${who}${what} ${T("is working again", "inafanya kazi tena")}`, body: T("itaOS is receiving everything normally again.", "itaOS inapokea kila kitu kama kawaida tena."), url };
  }
  switch (p.kind) {
    case "ads_token": return { title: `⚠️ ${who}${T("Meta Ads disconnected", "Meta Ads imetenganishwa")}`,
      body: T(`itaOS can't read your ad account any more (${p.problem}). Spend and cost per sale have stopped updating. Open Connections and reconnect Meta Ads.`,
              `itaOS haiwezi kusoma akaunti yako ya matangazo tena. Matumizi na gharama kwa mauzo havisasishwi. Fungua Connections uunganishe Meta Ads upya.`), url };
    case "ads_account": return { title: `⚠️ ${who}${T("Problem with your ad account", "Tatizo kwenye akaunti ya matangazo")}`,
      body: T(`Meta says ${p.problem.replace(/^the /, "your ")}. Your ads may have stopped running. Check Ads Manager.`,
              `Meta inasema akaunti ya matangazo ina tatizo. Huenda matangazo yamesimama. Angalia Ads Manager.`), url };
    case "capi": return { title: `⚠️ ${who}${T("Sales aren't reaching Meta", "Mauzo hayafiki Meta")}`,
      body: T(`itaOS can't send your recorded sales to Facebook (${p.problem}), so your ads stop learning who buys. Message Pondi to fix it.`,
              `itaOS haiwezi kutuma mauzo yako kwa Facebook, kwa hiyo matangazo yanaacha kujifunza nani ananunua. Wasiliana na Pondi.`), url };
    case "wa_error":
    case "wa_silent": {
      const quiet = p.kind === "wa_silent"
        ? T(`No WhatsApp messages have reached itaOS for ${p.hours} hours (usually never more than ${p.usual}).`, `Hakuna ujumbe wa WhatsApp uliofika itaOS kwa saa ${p.hours} (kwa kawaida si zaidi ya saa ${p.usual}).`)
        : T(`WhatsApp stopped sending to itaOS (${p.problem}).`, `WhatsApp imeacha kutuma kwa itaOS.`);
      return { title: `⚠️ ${who}${T("WhatsApp may be disconnected", "WhatsApp huenda imetenganishwa")}`,
        body: quiet + " " + T("Your phone still works, but new chats aren't being saved or linked to ads. Message Pondi.", "Simu yako bado inafanya kazi, lakini chats mpya hazihifadhiwi wala kuunganishwa na matangazo. Wasiliana na Pondi."), url };
    }
  }
}

/** Runs all checks and returns what to send. `send` delivers one note to a list of subscriptions. */
export async function runHealth(
  db: SupabaseClient,
  send: (subs: any[], note: { title: string; body: string; url: string; tag: string }) => Promise<number>,
) {
  const now = new Date();
  const { data: conns } = await db.from("connections").select("id,workspace_id,provider,external_id,label,status,last_sync_at,last_error,token_secret_id");
  const { data: open } = await db.from("connection_alerts").select("id,connection_id,kind,alerted_at").is("resolved_at", null);
  const openBy = new Map(((open ?? []) as any[]).map((a) => [a.connection_id, a]));
  const { data: staffRows } = await db.from("platform_admins").select("user_id");
  const staffIds = new Set(((staffRows ?? []) as any[]).map((r) => r.user_id));
  const staffSubs = staffIds.size ? (((await db.from("push_subscriptions").select("endpoint,p256dh,auth,fail_count,user_id").in("user_id", [...staffIds])).data ?? []) as any[]) : [];
  const dedupe = (xs: any[]) => [...new Map(xs.map((s) => [s.endpoint, s])).values()];
  const staffOnce = dedupe(staffSubs);

  const results: any[] = [];
  let sent = 0;
  for (const c of (conns ?? []) as Conn[]) {
    const r = await checkConnection(db, c).catch(() => "skip" as const);
    const was = openBy.get(c.id);
    if (r === "skip") { results.push({ id: c.id, provider: c.provider, skipped: true }); continue; }

    let notify: { p: Problem | null; wasKind: Kind | null; tag: string } | null = null;
    if (r && !was) {
      const { data: row } = await db.from("connection_alerts").insert({ connection_id: c.id, workspace_id: c.workspace_id, kind: r.kind, problem: r.problem, alerted_at: now.toISOString() }).select("id").single();
      if (row) notify = { p: r, wasKind: null, tag: "health-" + c.id };
    } else if (r && was && (was.kind !== r.kind || !was.alerted_at || now.getTime() - Date.parse(was.alerted_at) > REMIND_MS)) {
      await db.from("connection_alerts").update({ kind: r.kind, problem: r.problem, alerted_at: now.toISOString() }).eq("id", was.id);
      notify = { p: r, wasKind: was.kind, tag: "health-" + c.id };
    } else if (r && was) {
      await db.from("connection_alerts").update({ problem: r.problem }).eq("id", was.id);   // keep the latest wording, no ring
    } else if (!r && was) {
      await db.from("connection_alerts").update({ resolved_at: now.toISOString() }).eq("id", was.id);
      notify = { p: null, wasKind: was.kind, tag: "health-" + c.id };
    }
    results.push({ id: c.id, provider: c.provider, problem: r ? r.kind : null, notified: !!notify });
    if (!notify) continue;

    const [{ data: w }, { data: mem }] = await Promise.all([
      db.from("workspaces").select("name,language").eq("id", c.workspace_id).maybeSingle(),
      db.from("memberships").select("user_id").eq("workspace_id", c.workspace_id).in("role", ["owner", "admin"]),
    ]);
    const managers = ((mem ?? []) as any[]).map((m) => m.user_id).filter((u) => !staffIds.has(u));
    const ownerSubs = managers.length
      ? (((await db.from("push_subscriptions").select("endpoint,p256dh,auth,fail_count").eq("workspace_id", c.workspace_id).in("user_id", managers)).data ?? []) as any[])
      : [];
    const sw = (w as any)?.language === "sw";
    const name = (w as any)?.name ?? "A business";
    if (ownerSubs.length) sent += await send(dedupe(ownerSubs), { ...message(notify.p, notify.wasKind, name, sw, false), tag: notify.tag });
    if (staffOnce.length) sent += await send(staffOnce, { ...message(notify.p, notify.wasKind, name, false, true), tag: notify.tag });
  }
  return { ok: true, checked: results.length, sent, results };
}
