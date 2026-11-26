import { describe, it, expect, vi } from "vitest";
// The real modules pull in page code that needs a browser; these tests only need two small helpers.
vi.mock("../src/Orders", () => ({ fromLocalInput: (v: string) => new Date(v + ":00+03:00").toISOString() }));
vi.mock("../src/chatParts", () => ({ interest: (r: any) => r.kito_temp ?? (r.warm ? "warm" : null) }));
import { narrowChats, sortFollow } from "../src/chatsCache";

// Records the filter calls, like a Supabase query builder.
const q = () => { const calls: string[] = []; const b: any = new Proxy({}, { get: (_t, k: string) => k === "calls" ? calls : (...a: any[]) => { calls.push(`${k}(${a.join(",")})`); return b; } }); return b; };

describe("background chats list asks for the same list as the Chats page", () => {
  it("All: real customers only, no date filter", () => {
    expect(narrowChats(q(), { filter: "all", ids: null, src: "any", period: null }).calls).toEqual(["eq(not_customer,false)"]);
  });
  it("Bought: recorded sales only", () => {
    expect(narrowChats(q(), { filter: "sold", ids: null, src: "any", period: null }).calls).toEqual(["eq(not_customer,false)", "gt(paid_orders,0)"]);
  });
  it("Lost tab uses the outcome; a date range adds a window", () => {
    const c = narrowChats(q(), { filter: "lost", ids: null, src: "any", period: { from: "2026-11-01", to: "2026-11-07" } }).calls;
    expect(c[0]).toMatch(/^gte\(last_message_at,/); expect(c[1]).toMatch(/^lt\(last_message_at,/);
    expect(c.slice(2)).toEqual(["eq(not_customer,false)", "eq(outcome,lost)"]);
  });
  it("Follow up puts hot chats first", () => {
    const r = (id: string, temp: string, at: string) => ({ id, kito_temp: temp, last_message_at: at, last_dir: "out" } as any);
    expect(sortFollow([r("a", "warm", "2026-11-26T10:00Z"), r("b", "hot", "2026-11-25T10:00Z")]).map((x) => x.id)).toEqual(["b", "a"]);
  });
});
