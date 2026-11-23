import { describe, it, expect } from "vitest";
import { mergeToday, type QueueItem } from "../src/today";
import type { Outcome, Task } from "../src/lib";

// Same idea as Promises.dueBucket, in UTC for the test.
const bucket = (t: Task, n: number) => { const at = t.due_at; if (!at) return "undated" as const; const d = at.slice(0, 10), td = new Date(n).toISOString().slice(0, 10); return d < td ? "overdue" as const : d === td ? "today" as const : "upcoming" as const; };

const now = Date.parse("2026-11-22T12:00:00Z");
const o = (id: string, x: Partial<Outcome> = {}) => ({ id, contact_id: "c" + id, kito_temp: "warm", ...x } as unknown as Outcome);
const task = (conv: string, x: Partial<Task>) => ({ id: "t" + conv, conversation_id: conv, status: "open", source: "kito_promise", due_at: null, snoozed_until: null, ...x } as Task);
const reorder = (conv: string) => ({ conversation_id: conv, state: "todo" } as any);

describe("Today list", () => {
  it("orders by urgency and shows each customer once", () => {
    const queue: QueueItem[] = [{ r: o("a"), reason: "reply", temp: "warm", age: 3600e3 }];
    const items = mergeToday({
      now, queue, bucket,
      promises: [task("b", { due_at: "2026-11-21T09:00:00Z" }), task("a", { due_at: "2026-11-21T09:00:00Z" })],
      quiet: [{ r: o("c", { kito_temp: "cold" }), quietFor: 2 * 864e5 }, { r: o("d", { kito_temp: "hot" }), quietFor: 864e5 }],
      reorders: [reorder("e")],
    });
    expect(items.map((i) => i.id)).toEqual(["a", "b", "d", "e", "c"]);
    expect(items[0].kind).toBe("reply");   // a is waiting for a reply: that wins over its promise
  });
  it("leaves out promises that are not due yet and follow-up-only queue items", () => {
    const items = mergeToday({
      now, bucket, queue: [{ r: o("x"), reason: "follow_up", temp: "warm", age: 1 }],
      promises: [task("p", { due_at: "2026-11-30T09:00:00Z" }), task("q", { status: "proposed" })], quiet: [], reorders: [],
    });
    expect(items.map((i) => i.id)).toEqual(["q"]);
  });
});

describe("Today list: payment checks", () => {
  const pay = (conv: string, severity: "red" | "amber" | "ok", verdict: "ok" | "fake" | null = null) => ({ conversation_id: conv, severity, verdict, flags: [] } as any);
  it("puts suspicious payments first, red before amber, and skips decided or clean ones", () => {
    const items = mergeToday({
      now, bucket, promises: [], quiet: [], reorders: [],
      queue: [{ r: o("a"), reason: "reply", temp: "warm", age: 1 }],
      payments: [pay("x", "amber"), pay("y", "red"), pay("z", "red", "ok"), pay("w", "ok")],
    });
    expect(items.map((i) => i.id)).toEqual(["y", "x", "a"]);
    expect(items[0].kind).toBe("payment");
  });
  it("a customer with a payment to check shows once, as the payment", () => {
    const items = mergeToday({ now, bucket, promises: [], quiet: [], reorders: [], queue: [{ r: o("a"), reason: "reply", temp: "warm", age: 1 }], payments: [pay("a", "amber")] });
    expect(items.map((i) => i.kind)).toEqual(["payment"]);
  });
});
