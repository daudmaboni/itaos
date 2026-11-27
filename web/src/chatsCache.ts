// Chats list cache (23 Nov 2026). The last list shown is kept in memory AND on the phone (localStorage), so
// opening Chats shows it at once even after the phone closed the app or a new version was installed; the
// fresh list loads quietly behind it and updates in place. Cleared on sign-out (customer names and numbers).
// refreshChats() keeps it fresh in the background from the moment the app opens (chatsSync.ts), so Chats is
// already up to date when it is opened, not only after.
import { supabase, Workspace, Outcome, Task, localDay } from "./lib";
import { RangeSel, resolveRange, addDays, loadRange } from "./ranges";
import { fromLocalInput } from "./Orders";
import { type Source, type Run, type Lite } from "./chatParts";

export const PAGE = 100;
export type Filter = "follow" | "lost" | "open" | "sold" | "signals" | "all" | "not" | "ids";
export type Snap = {
  ws: string; key: string; filter: Filter; src: Source;
  rows: Outcome[]; lite: Lite[]; counts: Record<string, number> | null; phones: Record<string, string>;
  adNames: Record<string, string>; tasks: Record<string, Task>; runs: Run[];
  paidOn: Record<string, string> | null; boughtInRange: number | null;
};
export type ViewMem = { rows: Outcome[]; phones: Record<string, string>; paidOn: Record<string, string> | null; boughtInRange: number | null };

const LS = "itaos:chats-snap:";
let snap: Snap | null = null;
/** Every list looked at while the app is open (tab, source, search, dates). */
export const views = new Map<string, ViewMem>();

export function viewKeyOf(ws: string, filter: Filter, ids: string[] | null, src: Source, limit: number, search: string, from?: string, to?: string) {
  return JSON.stringify([ws, filter, ids, src, limit, search, from, to]);
}

/** The saved list for this business: memory first, then the copy on the phone. */
export function getSnap(ws: string): Snap | null {
  if (snap && snap.ws === ws) return snap;
  try {
    const raw = localStorage.getItem(LS + ws);
    if (!raw) return null;
    const s = JSON.parse(raw) as Snap;
    if (s && s.ws === ws && Array.isArray(s.rows)) { snap = s; views.set(s.key, { rows: s.rows, phones: s.phones, paidOn: s.paidOn, boughtInRange: s.boughtInRange }); return s; }
  } catch { /* bad copy or storage blocked */ }
  return null;
}

/** Keep the list on screen. Only plain first pages are written to the phone (no search, normal page size),
 *  so the next open matches them exactly; Kito's long notes are kept, the rest of the app state isn't. */
export function setSnap(s: Snap, persist: boolean) {
  snap = s;
  if (!persist) return;
  try { localStorage.setItem(LS + s.ws, JSON.stringify(s)); }
  catch { try { localStorage.removeItem(LS + s.ws); } catch { /* full or blocked */ } }
}

export function clearChatsCache() {
  snap = null; views.clear(); freshAt.clear();
  try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith(LS)) localStorage.removeItem(k); } } catch { /* blocked */ }
}

/** The date range Chats will open with (same rule as the page). */
export function chatsRange(): RangeSel | null {
  try { return localStorage.getItem("itaos:chats:alldates") === "1" ? null : ((r) => (r && r.key === "all" ? null : r))(loadRange("chats", null as any)); } catch { return null; }
}

/** The list's filters (tab, source, chosen ids, dates), shared by the Chats page and the background sync
 *  so both ask the database for exactly the same list. */
export function narrowChats<Q>(qq: Q, o: { filter: Filter; ids: string[] | null; src: Source; period: { from: string; to: string } | null }): Q {
  const { filter, ids, src, period } = o;
  const byPaid = filter === "sold";
  let x: any = qq;
  if (filter !== "ids" && src === "import") x = x.eq("phone_number_id", "import");
  else if (filter !== "ids" && src === "live") x = x.neq("phone_number_id", "import");
  if (filter === "ids" && ids) x = x.in("id", ids);
  if (filter !== "ids" && period && !byPaid) x = x.gte("last_message_at", fromLocalInput(period.from + "T00:00")).lt("last_message_at", fromLocalInput(addDays(period.to, 1) + "T00:00"));
  if (filter === "not") x = x.eq("not_customer", true);
  else if (filter !== "ids") x = x.eq("not_customer", false);
  if (filter === "ids" || filter === "not" || filter === "all") { /* nothing more */ }
  else if (filter === "sold") x = x.gt("paid_orders", 0);   // Bought = a sale you recorded, nothing else
  else if (filter === "follow") x = x.neq("outcome", "sold").or("kito_temp.in.(hot,warm),and(kito_temp.is.null,warm.eq.true)");
  else if (filter === "signals") x = x.eq("paid_orders", 0).or("and(kito_outcome.eq.sold,or(kito_confidence.is.null,kito_confidence.neq.low)),outcome_override.eq.sold").or("override_by.is.null,outcome_override.eq.sold");
  else x = x.eq("outcome", filter);
  return x as Q;
}

/** Follow up: newest message first, same order as WhatsApp (27 Nov 2026). It used to put every "hot" chat on
 *  top, which pinned 2-day-old chats above live ones and dropped a hot customer the moment they wrote again
 *  (a new message makes Kito's tag stale until it re-reads). The "Very interested" badge still shows heat. */
export function sortFollow(list: Outcome[]): Outcome[] {
  return [...list].sort((x, y) => Date.parse(y.last_message_at ?? "") - Date.parse(x.last_message_at ?? ""));
}

const freshAt = new Map<string, number>();
/** The saved list for this view was fetched in the background less than a minute ago. */
export const isFresh = (key: string) => Date.now() - (freshAt.get(key) ?? 0) < 60_000;

let running: Promise<void> | null = null;
let again = false;
/** Fetch the chats list the Chats page will open with (same tab and dates as last time) and save it, so Chats
 *  is already up to date before it is opened. Called when the app opens and on every live change while Chats
 *  is closed (chatsSync.ts). Never throws. */
export function refreshChats(ws: Workspace): Promise<void> {
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      const saved = getSnap(ws.id);
      const filter: Filter = saved && saved.filter !== "ids" ? saved.filter : "all";
      const tz = ws.timezone || "Africa/Dar_es_Salaam";
      const range = chatsRange();
      const period = range ? resolveRange(range, localDay(new Date(), tz)) : null;
      if (filter === "sold" && period) return;   // "Bought on these days" needs the payments list: Chats loads it itself
      const q = narrowChats(supabase.from("conversation_outcomes").select("*").eq("workspace_id", ws.id)
        .order(filter === "sold" ? "last_paid_at" : "last_message_at", { ascending: false, nullsFirst: false }).limit(PAGE),
        { filter, ids: null, src: "any", period });
      const [c, a, t, counts, runs] = await Promise.all([
        q,
        supabase.from("ads").select("ad_id,name").eq("workspace_id", ws.id),
        supabase.from("follow_up_tasks").select("*").eq("workspace_id", ws.id).in("status", ["open", "snoozed"]),
        supabase.rpc("chat_counts", { p_ws: ws.id, p_src: "any" }),
        supabase.from("kito_runs").select("id,trigger,ran_at,checked,failed,remaining,note").eq("workspace_id", ws.id).order("ran_at", { ascending: false }).limit(20),
      ]);
      if (c.error) return;
      let rows = (c.data as Outcome[]) ?? [];
      if (filter === "follow") rows = sortFollow(rows);
      const cids = [...new Set(rows.map((r) => r.contact_id))];
      const { data: cts } = cids.length ? await supabase.from("contacts").select("id,wa_id").eq("workspace_id", ws.id).in("id", cids) : { data: [] };
      const phones = Object.fromEntries((cts ?? []).map((x: any) => [x.id, x.wa_id]));
      const key = viewKeyOf(ws.id, filter, null, "any", PAGE, "", period?.from, period?.to);
      views.set(key, { rows, phones, paidOn: null, boughtInRange: null });
      freshAt.set(key, Date.now());
      setSnap({
        ws: ws.id, key, filter, src: "any", rows, lite: [], counts: counts.error ? (saved?.counts ?? null) : (counts.data as Record<string, number>), phones,
        adNames: Object.fromEntries((a.data ?? []).map((x: any) => [x.ad_id, x.name])),
        tasks: Object.fromEntries(((t.data ?? []) as Task[]).map((task) => [task.conversation_id, task])),
        runs: (runs.data as Run[]) ?? [], paidOn: null, boughtInRange: null,
      }, true);
    } catch { /* offline: Chats loads normally */ }
  })().finally(() => {
    running = null;
    if (again) { again = false; void refreshChats(ws); }
  });
  return running;
}

/** Old name, kept for callers: now always refreshes. */
export const preloadChats = refreshChats;
