import { describe, expect, it } from "vitest";
import { buildInsights, type InsightIn } from "../src/insights";
const T = (en: string) => en;
const base: InsightIn = { revenue: 270000, revenueD: -0.39, profit: 198001, spend: 54457, roas: 5.0, costPerChat: 813, chats: 67, paidOrders: 2, adOrders: 2,
  money: (n) => "TZS " + Math.round(n).toLocaleString("en"), adMoney: (n) => "TZS " + Math.round(n).toLocaleString("en") };
describe("buildInsights", () => {
  it("makes one slide per fact it has numbers for", () => {
    const s = buildInsights(base, T);
    expect(s.map((x) => x.key)).toEqual(["rev", "kept", "roas", "close", "cpc"]);
    expect(s[0]).toMatchObject({ big: "−39%", tone: "bad" });
    expect(s[1].big).toBe("73%");
    expect(s[2].big).toBe("5.0×");
    expect(s[3].big).toBe("3%");
  });
  it("skips what it can't say", () => {
    const s = buildInsights({ ...base, revenueD: null, profit: null, roas: null, spend: 0, chats: 0, costPerChat: null }, T);
    expect(s).toEqual([]);
  });
  it("calls a loss a loss", () => {
    const s = buildInsights({ ...base, profit: -1000 }, T);
    expect(s.find((x) => x.key === "kept")).toMatchObject({ tone: "bad" });
  });
});
