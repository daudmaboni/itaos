import { describe, it, expect } from "vitest";
import { quietAfterPrice, contactedAfterPrice } from "../src/afterPrice";
import type { Outcome, Task } from "../src/lib";

const now = Date.parse("2026-11-22T00:00:00Z");
const hAgo = (h: number) => new Date(now - h * 3600e3).toISOString();
const row = (p: Partial<Outcome>): Outcome => ({
  id: "c1", contact_id: "k1", contact_name: "Juma", price_shared: true, kito_label: null, last_dir: "out",
  last_out_at: hAgo(30), last_message_at: hAgo(30), paid_orders: 0, outcome: "open", outcome_override: null, kito_temp: "warm",
  ...p,
} as Outcome);
const task = (p: Partial<Task>): Task => ({ id: "t1", conversation_id: "c1", source: "after_price", status: "done", completed_at: hAgo(10), ...p } as Task);

describe("quietAfterPrice", () => {
  it("lists a priced customer quiet for a day", () => expect(quietAfterPrice([row({})], [], now)).toHaveLength(1));
  it("lists a price only Kito found (voice note)", () => expect(quietAfterPrice([row({ price_shared: false, kito_label: "priced" })], [], now)).toHaveLength(1));
  it("skips chats where the customer wrote last", () => expect(quietAfterPrice([row({ last_dir: "in" })], [], now)).toHaveLength(0));
  it("waits a full day", () => expect(quietAfterPrice([row({ last_out_at: hAgo(5) })], [], now)).toHaveLength(0));
  it("drops chats older than two weeks", () => expect(quietAfterPrice([row({ last_out_at: hAgo(15 * 24) })], [], now)).toHaveLength(0));
  it("skips buyers and lost chats", () => {
    expect(quietAfterPrice([row({ paid_orders: 1 })], [], now)).toHaveLength(0);
    expect(quietAfterPrice([row({ outcome_override: "lost" })], [], now)).toHaveLength(0);
  });
  it("skips chats without a price", () => expect(quietAfterPrice([row({ price_shared: false, kito_label: "talking" })], [], now)).toHaveLength(0));
  it("hides for a week after Sent, and while a task is open", () => {
    expect(quietAfterPrice([row({})], [task({})], now)).toHaveLength(0);
    expect(quietAfterPrice([row({})], [task({ completed_at: hAgo(8 * 24) })], now)).toHaveLength(1);
    expect(quietAfterPrice([row({})], [task({ source: "queue", status: "open", completed_at: null })], now)).toHaveLength(0);
  });
  it("puts hot customers first", () => {
    const out = quietAfterPrice([row({ id: "a", kito_temp: "cold" }), row({ id: "b", kito_temp: "hot" })], [], now);
    expect(out.map((x) => x.r.id)).toEqual(["b", "a"]);
  });
});

describe("contactedAfterPrice", () => {
  it("shows a reply after Sent", () => {
    const [c] = contactedAfterPrice([row({ last_dir: "in", last_message_at: hAgo(2) })], [task({})], now);
    expect(c.replied).toBe(true); expect(c.bought).toBe(false);
  });
  it("shows a sale after Sent", () => expect(contactedAfterPrice([row({ paid_orders: 1 })], [task({})], now)[0].bought).toBe(true));
});
