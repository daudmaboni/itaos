// Live updates without pull-to-refresh (24 Nov 2026).
//
// One shared realtime channel per business listens for changes to chats, orders, promises/tasks and products.
// Any page that loads data calls useLive(ws.id, reload) and gets a quiet reload when something changes:
//  - throttled to at most one reload every 4 s, however many rows change at once;
//  - never while the app is in the background; it catches up the moment it comes back into view;
//  - a light check every 60 s while visible, in case the realtime connection dropped.
// Pages keep what's on screen while the fresh data loads, so nothing blanks or jumps.
import { useEffect, useRef } from "react";
import { supabase } from "./lib";

const TABLES = ["conversations", "orders", "follow_up_tasks", "products"] as const;
const GAP = 4000;
const POLL = 60_000;

type Hub = { subs: Set<() => void>; chs: ReturnType<typeof supabase.channel>[]; timer?: number; dirty: boolean; poll: number; vis: () => void };
const hubs = new Map<string, Hub>();

function fire(h: Hub) {
  if (document.visibilityState !== "visible") { h.dirty = true; return; }
  if (h.timer !== undefined) return;
  h.timer = window.setTimeout(() => { h.timer = undefined; h.dirty = false; h.subs.forEach((f) => { try { f(); } catch { /* a page's reload failing never stops the others */ } }); }, GAP);
}

function hubFor(wsId: string): Hub {
  let h = hubs.get(wsId);
  if (h) return h;
  const hub = { subs: new Set(), dirty: false } as unknown as Hub;
  // One channel per table: if a table isn't switched on for realtime yet (migration 0084), only that one stays quiet.
  hub.chs = TABLES.map((t) => supabase.channel(`live-${t}-${wsId}-${Math.random().toString(36).slice(2, 10)}`)
    .on("postgres_changes" as any, { event: "*", schema: "public", table: t, filter: `workspace_id=eq.${wsId}` }, () => fire(hub))
    .subscribe());
  // Back in view (switched apps, phone unlocked): reload once, now.
  hub.vis = () => { if (document.visibilityState === "visible") { hub.dirty = true; fire(hub); } };
  document.addEventListener("visibilitychange", hub.vis);
  window.addEventListener("online", hub.vis);
  hub.poll = window.setInterval(() => { if (document.visibilityState === "visible") fire(hub); }, POLL);
  hubs.set(wsId, hub);
  return hub;
}

function release(wsId: string, h: Hub) {
  if (h.subs.size) return;
  window.clearTimeout(h.timer); window.clearInterval(h.poll);
  document.removeEventListener("visibilitychange", h.vis);
  window.removeEventListener("online", h.vis);
  h.chs.forEach((c) => supabase.removeChannel(c));
  hubs.delete(wsId);
}

/** Calls `reload` quietly whenever this business's data changes (see top of file). */
export function useLive(wsId: string | null | undefined, reload: () => void) {
  const ref = useRef(reload); ref.current = reload;
  useEffect(() => {
    if (!wsId) return;
    const h = hubFor(wsId);
    const f = () => ref.current();
    h.subs.add(f);
    return () => { h.subs.delete(f); release(wsId, h); };
  }, [wsId]);
}
