// "Went quiet after the price": customers who got a price, didn't buy, and haven't written since
// our last message for more than a day. The warmest customers a business is losing.
import { gotPrice, type Outcome, type Task } from "./lib";

const H = 3600e3, D = 24 * H;
export const QUIET_AFTER = 24 * H;     // our last message is at least this old
export const LOOK_BACK = 14 * D;       // older chats have gone cold; Reorders / the queue cover the rest
export const SENT_HIDES = 7 * D;       // after "Sent", hide for a week (the reply or sale shows in Contacted)
export const SKIP_HIDES = 14 * D;      // "Not now" hides it for two weeks

export type Quiet = { r: Outcome; quietFor: number };
export type Contacted = { r: Outcome | undefined; t: Task; replied: boolean; bought: boolean };

const ts = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);

export function quietAfterPrice(rows: Outcome[], tasks: Task[], now = Date.now()): Quiet[] {
  const busy = new Set<string>();
  for (const t of tasks) {
    if (t.status === "open" || t.status === "snoozed") busy.add(t.conversation_id);   // someone already owns it
    if (t.source === "after_price" && t.completed_at) {
      const age = now - ts(t.completed_at);
      if (age < (t.status === "done" ? SENT_HIDES : SKIP_HIDES)) busy.add(t.conversation_id);
    }
  }
  const order = { hot: 0, warm: 1, cold: 2 } as Record<string, number>;
  return rows
    .filter((r) => gotPrice(r) && !r.not_customer && r.outcome !== "sold" && Number(r.paid_orders) === 0
      && r.outcome_override !== "lost" && r.last_dir === "out" && !busy.has(r.id))
    .map((r) => ({ r, quietFor: now - ts(r.last_out_at ?? r.last_message_at) }))
    .filter((x) => x.quietFor >= QUIET_AFTER && x.quietFor <= LOOK_BACK)
    .sort((a, b) => (order[a.r.kito_temp ?? "warm"] ?? 1) - (order[b.r.kito_temp ?? "warm"] ?? 1) || a.quietFor - b.quietFor);
}

/** Follow-ups marked Sent in the last two weeks and what happened after. */
export function contactedAfterPrice(rows: Outcome[], tasks: Task[], now = Date.now()): Contacted[] {
  return tasks
    .filter((t) => t.source === "after_price" && t.status === "done" && t.completed_at && now - ts(t.completed_at) < SKIP_HIDES)
    .map((t) => {
      const r = rows.find((x) => x.id === t.conversation_id);
      const bought = !!r && (Number(r.paid_orders) > 0 || r.outcome === "sold");
      const replied = !!r && r.last_dir === "in" && ts(r.last_message_at) > ts(t.completed_at);
      return { r, t, replied: replied || bought, bought };
    })
    .sort((a, b) => ts(b.t.completed_at) - ts(a.t.completed_at));
}
