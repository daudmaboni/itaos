// Chats stay up to date from the moment the app opens (26 Nov 2026).
//
// Before: the live connection and Kito's catch-up only started when the Chats page was opened, so Chats
// showed the list from last time and then updated. Now one live connection runs for the whole app:
//  - On open (and whenever the app comes back to the screen) the Chats list is fetched and saved.
//  - A new WhatsApp message or a recorded sale:
//      Chats open   → the page reloads its list in place ("itaos:chats-changed").
//      Chats closed → the saved list is refreshed quietly, so the next tap on Chats is already current.
//  - Kito reads new messages ~20 s after they land, and catches up on unread chats once at open.
import { supabase, callFn, type Workspace } from "./lib";
import { refreshChats } from "./chatsCache";

type Ch = ReturnType<typeof supabase.channel>;
let wsNow: Workspace | null = null;
let ch: Ch | null = null;
let pageOpen = 0;
let live = false;
let missed = false;
let timer: number | undefined, kitoTimer: number | undefined;
let last = 0;
const caughtUp = new Set<string>();

export const isChatsLive = () => live;

/** The Chats page calls this while it is on screen (it then reloads its own list on each change). */
export function chatsPageOpen(on: boolean) { pageOpen = Math.max(0, pageOpen + (on ? 1 : -1)); }

/** Something changed: tell the open Chats page, or refresh the saved list behind it. */
function changed() {
  if (!wsNow) return;
  if (pageOpen) window.dispatchEvent(new Event("itaos:chats-changed"));
  else void refreshChats(wsNow);
}

/** At most one reload every 5 s: a newly connected number backfills thousands of rows at once.
 *  A phone that has the app in the background catches up once, when it is shown again. */
function bump() {
  if (document.visibilityState !== "visible") { missed = true; return; }
  if (timer) return;
  const wait = Math.max(800, 5000 - (Date.now() - last));
  timer = window.setTimeout(() => { timer = undefined; last = Date.now(); changed(); window.dispatchEvent(new Event("itaos:live")); }, wait);
}

function onVisible() {
  if (document.visibilityState !== "visible" || !wsNow) return;
  // Coming back to the app: catch up on anything missed while it was hidden or the connection slept.
  if (missed || !live) { missed = false; bump(); }
}

/** Kito's catch-up at open: label chats that never were, then read chats with unread messages. */
async function catchUp(ws: Workspace) {
  if (caughtUp.has(ws.id)) return;
  caughtUp.add(ws.id);
  try {
    const { data } = await supabase.from("conversations").select("id,label,last_message_at,kito_checked_at").eq("workspace_id", ws.id).limit(1000);
    const all = data ?? [];
    if (all.some((c) => c.label == null && c.last_message_at)) { await callFn("chat-import", { workspace_id: ws.id, action: "reanalyze" }); changed(); }
    if (all.some((c) => c.last_message_at && (!c.kito_checked_at || Date.parse(c.last_message_at) > Date.parse(c.kito_checked_at)))) {
      let total = 0;
      for (let i = 0; i < 10; i++) {
        // background: Kito skips chats still mid-conversation (they're read once they go quiet).
        const r = await callFn<{ checked: number; remaining: number }>("kito", { workspace_id: ws.id, background: true });
        total += r.checked;
        if (!r.remaining || !r.checked) break;
      }
      if (total) changed();
    }
  } catch { /* the 15-minute background run will pick it up */ }
}

/** Start (or keep) the sync for this business. Safe to call on every render. */
export function startChatsSync(ws: Workspace) {
  if (wsNow?.id === ws.id && ch) { wsNow = ws; return; }
  stopChatsSync();
  wsNow = ws;
  void refreshChats(ws);   // right away: Chats is current before anyone taps it
  void catchUp(ws);
  ch = supabase.channel(`chats-sync-${ws.id}-${Math.random().toString(36).slice(2, 10)}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `workspace_id=eq.${ws.id}` }, (p: any) => {
      // A chat changes whenever a message lands (its summary is recomputed), so this covers new messages too.
      // The messages table itself is not streamed: backfills write thousands of rows at once.
      bump();
      // Let Kito read the new message shortly after it lands — only when the chat has news Kito hasn't read
      // (Kito's own label updates also change the chat; those must not wake it again).
      const c = p?.new;
      if (!c?.last_message_at || (c.kito_checked_at && Date.parse(c.last_message_at) <= Date.parse(c.kito_checked_at))) return;
      window.clearTimeout(kitoTimer);
      kitoTimer = window.setTimeout(() => { callFn("kito", { workspace_id: ws.id }).then(changed).catch(() => {}); }, 20000);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `workspace_id=eq.${ws.id}` }, bump)
    .subscribe((status) => {
      const was = live;
      live = status === "SUBSCRIBED";
      if (live !== was) window.dispatchEvent(new Event("itaos:chats-live"));
      if (live && !was && last) bump();   // reconnected after a drop: fetch what came in meanwhile
    });
  document.addEventListener("visibilitychange", onVisible);
}

export function stopChatsSync() {
  window.clearTimeout(timer); window.clearTimeout(kitoTimer); timer = undefined;
  document.removeEventListener("visibilitychange", onVisible);
  if (ch) { void supabase.removeChannel(ch); ch = null; }
  if (live) { live = false; window.dispatchEvent(new Event("itaos:chats-live")); }
  wsNow = null; missed = false;
}
