// Chats list cache (23 Nov 2026). The last list shown is kept in memory AND on the phone (localStorage), so
// opening Chats shows it at once even after the phone closed the app or a new version was installed; the
// fresh list loads quietly behind it and updates in place. Cleared on sign-out (customer names and numbers).
// preloadChats() fills it in the background from Home, so the very first tap on Chats is ready too.
import { supabase, Workspace, Outcome, Task, localDay } from "./lib";
import { RangeSel, resolveRange, addDays, loadRange } from "./ranges";
import { fromLocalInput } from "./Orders";
import type { Source, Run, Lite } from "./chatParts";

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
  snap = null; views.clear();
  try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith(LS)) localStorage.removeItem(k); } } catch { /* blocked */ }
}

/** The date range Chats will open with (same rule as the page). */
export function chatsRange(): RangeSel | null {
  try { return localStorage.getItem("itaos:chats:alldates") === "1" ? null : ((r) => (r && r.key === "all" ? null : r))(loadRange("chats", null as any)); } catch { return null; }
}

let preloading = false;
/** Load the "All" chats list in the background when nothing is saved yet, so the first tap on Chats is instant. */
export async function preloadChats(ws: Workspace) {
  if (preloading || getSnap(ws.id)) return;
  preloading = true;
  try {
    const tz = ws.timezone || "Africa/Dar_es_Salaam";
    const range = chatsRange();
    const period = range ? resolveRange(range, localDay(new Date(), tz)) : null;
    let q = supabase.from("conversation_outcomes").select("*").eq("workspace_id", ws.id).eq("not_customer", false)
      .order("last_message_at", { ascending: false, nullsFirst: false }).limit(PAGE);
    if (period) q = q.gte("last_message_at", fromLocalInput(period.from + "T00:00")).lt("last_message_at", fromLocalInput(addDays(period.to, 1) + "T00:00"));
    const [c, a, t, counts, runs] = await Promise.all([
      q,
      supabase.from("ads").select("ad_id,name").eq("workspace_id", ws.id),
      supabase.from("follow_up_tasks").select("*").eq("workspace_id", ws.id).in("status", ["open", "snoozed"]),
      supabase.rpc("chat_counts", { p_ws: ws.id, p_src: "any" }),
      supabase.from("kito_runs").select("id,trigger,ran_at,checked,failed,remaining,note").eq("workspace_id", ws.id).order("ran_at", { ascending: false }).limit(20),
    ]);
    if (c.error || getSnap(ws.id)) return;   // Chats opened meanwhile and saved its own list
    const rows = (c.data as Outcome[]) ?? [];
    const cids = [...new Set(rows.map((r) => r.contact_id))];
    const { data: cts } = cids.length ? await supabase.from("contacts").select("id,wa_id").eq("workspace_id", ws.id).in("id", cids) : { data: [] };
    if (getSnap(ws.id)) return;
    const phones = Object.fromEntries((cts ?? []).map((x: any) => [x.id, x.wa_id]));
    const key = viewKeyOf(ws.id, "all", null, "any", PAGE, "", period?.from, period?.to);
    views.set(key, { rows, phones, paidOn: null, boughtInRange: null });
    setSnap({
      ws: ws.id, key, filter: "all", src: "any", rows, lite: [], counts: counts.error ? null : (counts.data as Record<string, number>), phones,
      adNames: Object.fromEntries((a.data ?? []).map((x: any) => [x.ad_id, x.name])),
      tasks: Object.fromEntries(((t.data ?? []) as Task[]).map((task) => [task.conversation_id, task])),
      runs: (runs.data as Run[]) ?? [], paidOn: null, boughtInRange: null,
    }, true);
  } catch { /* offline: Chats loads normally */ } finally { preloading = false; }
}
