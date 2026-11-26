// One live connection per business (26 Nov 2026).
//
// Before, each part of the app opened its own realtime channel on the same tables (chats sync, home numbers,
// badges, Attention, the pop-up island, live pages): 6+ subscriptions per phone, and the database checked
// every new message against the access rules once per subscription. Now there is one channel per business,
// listening to every table the app cares about, and each part registers a callback here.
//
// The channel opens on the first listener and closes when the last one leaves.
import { supabase } from "./lib";

export type LiveTable = "conversations" | "orders" | "follow_up_tasks" | "products";
const TABLES: LiveTable[] = ["conversations", "orders", "follow_up_tasks", "products"];

type Payload = { table: LiveTable; eventType: string; new: any; old: any };
type Cb = (p: Payload) => void;
type Conn = {
  ch: ReturnType<typeof supabase.channel>;
  cbs: Map<LiveTable, Set<Cb>>;
  status: Set<(live: boolean) => void>;
  live: boolean;
  n: number;
};
const conns = new Map<string, Conn>();

function open(wsId: string): Conn {
  let c = conns.get(wsId);
  if (c) return c;
  const conn: Conn = { cbs: new Map(TABLES.map((t) => [t, new Set<Cb>()])), status: new Set(), live: false, n: 0 } as Conn;
  let ch = supabase.channel(`ws-${wsId}-${Math.random().toString(36).slice(2, 10)}`);
  for (const t of TABLES) {
    ch = ch.on("postgres_changes" as any, { event: "*", schema: "public", table: t, filter: `workspace_id=eq.${wsId}` }, (p: any) => {
      const payload: Payload = { table: t, eventType: p?.eventType, new: p?.new, old: p?.old };
      conn.cbs.get(t)!.forEach((f) => { try { f(payload); } catch { /* one listener failing never stops the others */ } });
    });
  }
  conn.ch = ch.subscribe((s) => {
    const live = s === "SUBSCRIBED";
    if (live === conn.live) return;
    conn.live = live;
    conn.status.forEach((f) => { try { f(live); } catch { /* ignore */ } });
  });
  conns.set(wsId, conn);
  return conn;
}

function close(wsId: string, c: Conn) {
  if (c.n > 0) return;
  void supabase.removeChannel(c.ch);
  conns.delete(wsId);
}

/** Call `cb` on every change to these tables for this business. Returns the function that stops listening. */
export function onLive(wsId: string, tables: LiveTable | LiveTable[], cb: Cb): () => void {
  const c = open(wsId);
  const list = Array.isArray(tables) ? tables : [tables];
  list.forEach((t) => c.cbs.get(t)!.add(cb));
  c.n += 1;
  let done = false;
  return () => {
    if (done) return; done = true;
    list.forEach((t) => c.cbs.get(t)!.delete(cb));
    c.n -= 1;
    close(wsId, c);
  };
}

/** Whether the live connection is up, now and whenever it changes. Returns the stop function. */
export function onLiveStatus(wsId: string, cb: (live: boolean) => void): () => void {
  const c = open(wsId);
  c.status.add(cb);
  c.n += 1;
  cb(c.live);
  let done = false;
  return () => { if (done) return; done = true; c.status.delete(cb); c.n -= 1; close(wsId, c); };
}
