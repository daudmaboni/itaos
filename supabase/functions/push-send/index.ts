// Push notifications to the itaOS phone app (PWA).
//
// Three callers:
//  - The messages_push database trigger (migration 0039), right after a customer's WhatsApp message is saved (x-cron-secret header):
//      { conversation_ids: [...] } → one notification per chat to every device that turned
//      notifications on for that business. Only for messages from the last 10 minutes, so
//      replayed or backfilled events never ring phones about old chats.
//  - The promises-due-15m cron job (migration 0046): { due_tasks: true } → "promise due" notifications.
//  - The briefing-daily cron job (migration 0051): { briefing: true } → one morning summary per business.
//  - The connection-health-2h cron job (migration 0060): { health: true } → alerts when Meta Ads, the Conversions API
//    or WhatsApp stop working (health.ts), to the business's owners/admins and Pondi staff.
//  - A signed-in member from Settings → Phone app: { test: true, workspace_id } → a test to
//    that member's own devices.
//
// Needs the VAPID_PRIVATE_KEY secret (the public key is in web/src/pwa.ts).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";
import { runHealth } from "./health.ts";

const VAPID_PUBLIC = "BKxMcuarzjl5x6fGfsPnmySAi2XKYUl7gj5oD21thQtHPyJXHOm-dIRtjOTbsuuL_yj1DN_QJ58btb7QKMjj2no";
const FRESH_MS = 10 * 60_000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Sub = { endpoint: string; p256dh: string; auth: string; fail_count: number };
type Note = { title: string; body: string; url: string; tag: string };

function preview(type: string, body: string | null, sw: boolean) {
  const T = (en: string, s: string) => (sw ? s : en);
  switch (type) {
    case "image": return "📷 " + (body && body !== "[image]" ? body : T("Photo", "Picha"));
    case "audio": return "🎤 " + T("Voice note", "Ujumbe wa sauti");
    case "video": return "🎥 " + (body && body !== "[video]" ? body : T("Video", "Video"));
    case "document": return "📄 " + (body && body !== "[document]" ? body : T("File", "Faili"));
    case "location": return "📍 " + T("Location", "Mahali");
    case "sticker": return T("Sticker", "Stika");
    default: { const t = (body ?? "").replace(/\s+/g, " ").trim(); return t.length > 140 ? t.slice(0, 139) + "…" : t || T("New message", "Ujumbe mpya"); }
  }
}

async function deliver(db: ReturnType<typeof createClient>, subs: Sub[], note: Note) {
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(note), { TTL: 3600, urgency: "high", topic: note.tag.slice(0, 32) });
      sent++;
      await db.from("push_subscriptions").update({ last_ok_at: new Date().toISOString(), fail_count: 0 }).eq("endpoint", s.endpoint);
    } catch (e: any) {
      const code = e?.statusCode ?? 0;
      // 404/410: the phone dropped this subscription (app removed, permission revoked). Forget it.
      if (code === 404 || code === 410 || s.fail_count >= 20) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      else await db.from("push_subscriptions").update({ fail_count: s.fail_count + 1 }).eq("endpoint", s.endpoint);
      console.error("push failed", code, String(e?.body ?? e?.message ?? e).slice(0, 160));
    }
  }));
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const priv = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!priv) return json({ error: "Notifications aren't set up on the server yet (VAPID_PRIVATE_KEY missing)." }, 503);
  webpush.setVapidDetails("mailto:hello@ponditech.com", VAPID_PUBLIC, priv);

  const body = await req.json().catch(() => ({}));
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const cronSecret = Deno.env.get("CRON_SECRET");
  const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;

  if (body.test) {
    const ws = String(body.workspace_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(ws)) return json({ error: "workspace_id required" }, 400);
    const uc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false }, global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: u } = await uc.auth.getUser();
    if (!u?.user) return json({ error: "Sign in first." }, 401);
    const { data: subs } = await db.from("push_subscriptions").select("endpoint,p256dh,auth,fail_count").eq("user_id", u.user.id).eq("workspace_id", ws);
    if (!subs?.length) return json({ error: "No device has notifications on yet. Turn them on first." }, 400);
    const { data: w } = await db.from("workspaces").select("language").eq("id", ws).maybeSingle();
    const sw = w?.language === "sw";
    const sent = await deliver(db, subs as Sub[], { title: "itaOS", body: sw ? "Arifa zinafanya kazi ✅ Utapata ujumbe hapa mteja akiandika." : "Notifications work ✅ You'll see it here when a customer writes.", url: "/app#chats", tag: "test" });
    return sent ? json({ ok: true, sent }) : json({ error: "The test couldn't be delivered. Turn notifications off and on again." }, 502);
  }

  if (!isCron) return json({ error: "forbidden" }, 403);

  if (body.health) return json(await runHealth(db, (subs, note) => deliver(db, subs as Sub[], note)));

  // Due reminders (cron every 15 min, migration 0046): open tasks whose time came in the last day and
  // haven't rung yet. Each task rings once per due time; moving the time or snoozing re-arms it.
  if (body.due_tasks) {
    const now = new Date();
    const since = new Date(now.getTime() - 864e5).toISOString();
    const cols = "id,workspace_id,conversation_id,title,kind,promise_text,when_text,due_at,snoozed_until";
    const [a, b] = await Promise.all([
      db.from("follow_up_tasks").select(cols).eq("status", "open").is("notified_at", null).gte("due_at", since).lte("due_at", now.toISOString()).limit(200),
      db.from("follow_up_tasks").select(cols).eq("status", "snoozed").is("notified_at", null).gte("snoozed_until", since).lte("snoozed_until", now.toISOString()).limit(200),
    ]);
    const tasks = [...(a.data ?? []), ...(b.data ?? [])] as any[];
    let rung = 0;
    const subsBy = new Map<string, Sub[]>();
    const langBy = new Map<string, string>();
    for (const t of tasks) {
      if (!subsBy.has(t.workspace_id)) {
        const [{ data: subs }, { data: w }] = await Promise.all([
          db.from("push_subscriptions").select("endpoint,p256dh,auth,fail_count").eq("workspace_id", t.workspace_id),
          db.from("workspaces").select("language").eq("id", t.workspace_id).maybeSingle(),
        ]);
        subsBy.set(t.workspace_id, (subs ?? []) as Sub[]);
        langBy.set(t.workspace_id, w?.language ?? "sw");
      }
      const subs = subsBy.get(t.workspace_id)!;
      if (subs.length) {
        const sw = langBy.get(t.workspace_id) === "sw";
        const { data: conv } = await db.from("conversations").select("contacts(name,wa_id)").eq("id", t.conversation_id).maybeSingle();
        const c = (conv as any)?.contacts ?? {};
        const who = c.name || (c.wa_id ? "+" + String(c.wa_id).replace(/\D/g, "") : (sw ? "Mteja" : "Customer"));
        const said = t.promise_text ? ` · “${String(t.promise_text).slice(0, 90)}”` : "";
        rung += await deliver(db, subs, {
          title: (t.kind ? (sw ? "Ahadi imefika: " : "Promise due: ") : (sw ? "Kazi imefika: " : "Task due: ") ) + who,
          body: `${t.title}${said}`, url: "/app#actions", tag: "task-" + t.id,
        });
      }
      await db.from("follow_up_tasks").update({ notified_at: now.toISOString() }).eq("id", t.id).is("notified_at", null);
    }
    return json({ ok: true, due: tasks.length, sent: rung });
  }
  // Morning briefing (cron once a day, migration 0051): one notification per business with what needs doing today.
  // Sent only when something is waiting. The tag carries the date, so a repeated run replaces it instead of ringing twice.
  if (body.briefing) {
    const { data: allSubs } = await db.from("push_subscriptions").select("workspace_id,endpoint,p256dh,auth,fail_count");
    const byWs = new Map<string, Sub[]>();
    for (const s of (allSubs ?? []) as any[]) { if (!byWs.has(s.workspace_id)) byWs.set(s.workspace_id, []); byWs.get(s.workspace_id)!.push(s); }
    let sent = 0; const out: Record<string, unknown> = {};
    for (const [ws, subs] of byWs) {
      const { data: w } = await db.from("workspaces").select("language,timezone").eq("id", ws).maybeSingle();
      const sw = w?.language === "sw";
      const tz = w?.timezone || "Africa/Dar_es_Salaam";
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());   // YYYY-MM-DD, business time
      const endOfToday = new Date(Date.now() + 864e5).toISOString();   // generous: anything due by about this time tomorrow morning
      const threeDays = new Date(Date.now() - 3 * 864e5).toISOString();
      const [due, snz, proposed, hot, signals] = await Promise.all([
        db.from("follow_up_tasks").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("status", "open").lte("due_at", endOfToday),
        db.from("follow_up_tasks").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("status", "snoozed").lte("snoozed_until", endOfToday),
        db.from("follow_up_tasks").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("status", "proposed").eq("source", "kito_promise"),
        db.from("conversation_outcomes").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("not_customer", false)
          .eq("kito_temp", "hot").eq("last_dir", "in").eq("paid_orders", 0).gte("last_message_at", threeDays),
        db.from("conversation_outcomes").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("not_customer", false).eq("paid_orders", 0)
          .or("and(kito_outcome.eq.sold,or(kito_confidence.is.null,kito_confidence.neq.low)),outcome_override.eq.sold").or("override_by.is.null,outcome_override.eq.sold"),
      ]);
      const n = { due: (due.count ?? 0) + (snz.count ?? 0), proposed: proposed.count ?? 0, hot: hot.count ?? 0, signals: signals.count ?? 0 };
      out[ws] = n;
      const parts = [
        n.due ? (sw ? `${n.due} ahadi/kazi za leo` : `${n.due} promise${n.due === 1 ? "" : "s"}/task${n.due === 1 ? "" : "s"} due`) : "",
        n.hot ? (sw ? `wateja ${n.hot} wa moto wanasubiri jibu` : `${n.hot} hot chat${n.hot === 1 ? "" : "s"} waiting for a reply`) : "",
        n.signals ? (sw ? `malipo ${n.signals} ya kuhakiki` : `${n.signals} payment${n.signals === 1 ? "" : "s"} to check`) : "",
        n.proposed ? (sw ? `ahadi ${n.proposed} mpya za kuthibitisha` : `${n.proposed} new promise${n.proposed === 1 ? "" : "s"} to confirm`) : "",
      ].filter(Boolean);
      if (!parts.length) continue;   // nothing waiting: no notification
      sent += await deliver(db, subs, {
        title: sw ? "Habari za asubuhi ☀️ Leo kwenye itaOS" : "Good morning ☀️ Today in itaOS",
        body: parts.join(" · "), url: n.due || n.proposed ? "/app#actions" : "/app#chats", tag: "briefing-" + day,
      });
    }
    return json({ ok: true, sent, counts: out });
  }

  const ids: string[] = [...new Set((body.conversation_ids ?? []).map(String))].filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 20);
  let sent = 0;
  for (const id of ids) {
    const { data: conv } = await db.from("conversations").select("id,workspace_id,contacts(name,wa_id)").eq("id", id).maybeSingle();
    if (!conv) continue;
    const { data: last } = await db.from("messages").select("direction,type,body,sent_at").eq("conversation_id", id).order("sent_at", { ascending: false }).limit(1);
    const m = last?.[0];
    if (!m || m.direction !== "in" || Date.now() - Date.parse(m.sent_at) > FRESH_MS) continue;
    const { data: subs } = await db.from("push_subscriptions").select("endpoint,p256dh,auth,fail_count").eq("workspace_id", conv.workspace_id);
    if (!subs?.length) continue;
    const { data: w } = await db.from("workspaces").select("language").eq("id", conv.workspace_id).maybeSingle();
    const c = (conv as any).contacts ?? {};
    const who = c.name || (c.wa_id ? "+" + String(c.wa_id).replace(/\D/g, "") : "WhatsApp");
    sent += await deliver(db, subs as Sub[], { title: who, body: preview(m.type, m.body, w?.language === "sw"), url: "/app#chats/open=" + id, tag: "chat-" + id });
  }
  return json({ ok: true, sent });
});
