import { describe, it, expect } from "vitest";
import { planAdMoney, isRunning, adsManagerUrl, type AdMoneyAd, type AdMoneyRes } from "../src/adMoney";

const FX = 2650; // 1 USD = 2650 TZS; everything shown in TZS
const A = (n: number) => n * FX;
const W = (n: number) => n;

const ad = (o: Partial<AdMoneyAd>): AdMoneyAd => ({
  ad_id: "1", name: "Ad", adset: null, campaign: null, account: "act_99", status: "ACTIVE",
  spend: 0, spend7: 0, meta_chats: 0, first_spend_day: "2026-11-10", last_spend_day: "2026-11-22",
  chats: 0, chats_exact: 0, priced: 0, sales: 0, sales_exact: 0, revenue: 0, ...o,
});
const res = (ads: AdMoneyAd[], o: Partial<AdMoneyRes> = {}): AdMoneyRes => {
  const sales = ads.reduce((s, a) => s + a.sales, 0), rev = ads.reduce((s, a) => s + a.revenue, 0);
  return {
    from: "2026-11-09", to: "2026-11-22", days: 14, currency: "TZS", unit_cost: 10000, fx_rate: FX, ad_currency: "USD",
    totals: {
      spend: ads.reduce((s, a) => s + a.spend, 0), meta_chats: 0, ad_chats: ads.reduce((s, a) => s + a.chats, 0), shared_chats: 0, unmatched_chats: 0,
      ad_sales: sales, ad_revenue: rev, shared_sales: 0, unmatched_sales: 0, all_sales: sales, all_revenue: rev,
    },
    ads, ...o,
  };
};

describe("ad money manager", () => {
  it("Kayani today: one profitable ad → keep or add money, and start a second ad", () => {
    const p = planAdMoney(res([ad({ spend: 217.6, spend7: 217.6, chats: 435, sales: 6.8, revenue: 1_200_000 })]), A, W);
    expect(p.running).toBe(1);
    expect(p.breakEven).toBeCloseTo(1_200_000 / 6.8 - 10000, 0);
    expect(["keep", "scale"]).toContain(p.lines[0].verdict);
    expect(p.advice.map((a) => a.k)).toContain("second_ad");
  });

  it("an ad that spent more than one sale is worth with no paid sale → stop, money moves to the winner", () => {
    const win = ad({ ad_id: "w", name: "Winner", spend: 100, spend7: 100, chats: 300, sales: 10, revenue: 2_000_000 });
    const lose = ad({ ad_id: "l", name: "Loser", spend: 90, spend7: 70, chats: 150, sales: 0, revenue: 0 });
    const p = planAdMoney(res([win, lose]), A, W);
    expect(p.lines.find((l) => l.ad.ad_id === "l")!.verdict).toBe("stop");
    expect(p.lines.find((l) => l.ad.ad_id === "w")!.verdict).toBe("scale");
    const mv = p.advice[0];
    expect(mv.k).toBe("move");
    if (mv.k === "move") { expect(mv.from.ad.ad_id).toBe("l"); expect(mv.to.ad.ad_id).toBe("w"); expect(mv.perDay).toBeCloseTo((70 / 7) * FX); }
  });

  it("a new ad that has spent little is 'too early', not stopped", () => {
    const old = ad({ ad_id: "o", spend: 100, chats: 300, sales: 10, revenue: 2_000_000 });
    const fresh = ad({ ad_id: "n", spend: 3, chats: 6, sales: 0 });
    const p = planAdMoney(res([old, fresh]), A, W);
    expect(p.lines.find((l) => l.ad.ad_id === "n")!.verdict).toBe("early");
  });

  it("one lucky sale on a tiny ad does not make it a winner", () => {
    const base = ad({ ad_id: "b", spend: 200, chats: 600, sales: 10, revenue: 2_000_000 });
    const lucky = ad({ ad_id: "x", spend: 4, chats: 5, sales: 1, revenue: 200_000 });
    const p = planAdMoney(res([base, lucky]), A, W);
    expect(p.lines.find((l) => l.ad.ad_id === "x")!.verdict).not.toBe("scale");
  });

  it("an ad whose sales cost more than they bring is stopped", () => {
    const good = ad({ ad_id: "g", spend: 100, chats: 400, sales: 8, revenue: 1_600_000 });
    const bad = ad({ ad_id: "b", spend: 300, chats: 400, sales: 2, revenue: 400_000 });   // ~$150/sale ≈ 397k TZS > ~190k
    const p = planAdMoney(res([good, bad]), A, W);
    expect(p.lines.find((l) => l.ad.ad_id === "b")!.verdict).toBe("stop");
  });

  it("stopped ads get no verdict and no advice", () => {
    const p = planAdMoney(res([ad({ status: "ARCHIVED", spend: 50, chats: 100, sales: 1, revenue: 200_000 })]), A, W);
    expect(p.lines[0].verdict).toBe("off");
    expect(p.advice[0].k).toBe("none_running");
  });

  it("without a product cost the full sale price is the break-even, and it says so", () => {
    const p = planAdMoney(res([ad({ spend: 50, chats: 100, sales: 2, revenue: 400_000 })], { unit_cost: null }), A, W);
    expect(p.costKnown).toBe(false);
    expect(p.breakEven).toBe(200_000);
  });

  it("can't convert ad money → no money verdicts", () => {
    const p = planAdMoney(res([ad({ spend: 50, chats: 100, sales: 2, revenue: 400_000 })]), () => null, W);
    expect(p.lines[0].verdict).toBe("early");
  });

  it("running and link helpers", () => {
    expect(isRunning({ status: "CAMPAIGN_PAUSED", last_spend_day: "2026-11-22" }, "2026-11-22")).toBe(false);
    expect(isRunning({ status: null, last_spend_day: "2026-11-21" }, "2026-11-22")).toBe(true);
    expect(isRunning({ status: null, last_spend_day: "2026-11-19" }, "2026-11-22")).toBe(false);
    expect(adsManagerUrl({ ad_id: "5", account: "act_77" })).toContain("act=77");
  });
});
