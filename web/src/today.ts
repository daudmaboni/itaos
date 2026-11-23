// Today list rules (pure, tested): merge the separate follow-up lists, best first, one card per chat.
import type { Outcome, Task } from "./lib";
import type { ReorderRow } from "./Reorders";
import type { PayItem } from "./guards";

export type QueueItem = { r: Outcome; reason: "reply" | "follow_up"; temp: string | null; age: number };

export type Item =
  | { kind: "reply"; id: string; rank: number; q: QueueItem }
  | { kind: "promise"; id: string; rank: number; t: Task }
  | { kind: "after_price"; id: string; rank: number; r: Outcome; quietFor: number }
  | { kind: "reorder"; id: string; rank: number; x: ReorderRow }
  | { kind: "payment"; id: string; rank: number; p: PayItem };

/** Pure: merge the lists, best first, one card per chat. Exported for tests. */
export function mergeToday(o: {
  queue: QueueItem[]; promises: Task[]; quiet: { r: Outcome; quietFor: number }[]; reorders: ReorderRow[]; now?: number;
  /** when a promise is due (Promises.dueBucket), passed in so this file stays free of UI imports */
  bucket: (t: Task, now: number) => "overdue" | "today" | "upcoming" | "undated";
  /** payment screenshots that look wrong and nobody decided yet: checked first, before anything is sent */
  payments?: PayItem[];
}): Item[] {
  const now = o.now ?? Date.now();
  const out: Item[] = [];
  for (const p of o.payments ?? []) if (!p.verdict && p.severity !== "ok") out.push({ kind: "payment", id: p.conversation_id, rank: p.severity === "red" ? -2 : -1, p });
  for (const q of o.queue) if (q.reason === "reply") out.push({ kind: "reply", id: q.r.id, rank: 0, q });
  for (const t of o.promises) {
    if (t.status === "proposed") { out.push({ kind: "promise", id: t.conversation_id, rank: 3, t }); continue; }
    if (t.status !== "open" && t.status !== "snoozed") continue;
    const b = o.bucket(t, now);
    if (b === "overdue") out.push({ kind: "promise", id: t.conversation_id, rank: 1, t });
    else if (b === "today") out.push({ kind: "promise", id: t.conversation_id, rank: 2, t });
  }
  for (const x of o.quiet) {
    const temp = x.r.kito_temp ?? "warm";
    out.push({ kind: "after_price", id: x.r.id, rank: temp === "hot" ? 4 : temp === "warm" ? 5 : 7, r: x.r, quietFor: x.quietFor });
  }
  for (const x of o.reorders) out.push({ kind: "reorder", id: x.conversation_id, rank: 6, x });
  const age = (i: Item) => i.kind === "reply" ? -i.q.age : i.kind === "after_price" ? i.quietFor : 0;
  out.sort((a, b) => a.rank - b.rank || age(a) - age(b));
  const seen = new Set<string>();
  return out.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}

