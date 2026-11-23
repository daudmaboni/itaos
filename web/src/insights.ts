// The green Insight card on Home (23 Nov 2026): a few short facts from this period's numbers, one per slide.
// Pure so it can be tested; the card (Insight.tsx) only shows what this returns.

export type InsightIn = {
  revenue: number | null; revenueD: number | null;          // this period, and change vs the period before (0.12 = +12%)
  profit: number | null; spend: number | null;               // same currency as revenue for profit; spend in the ad currency
  roas: number | null;                                       // money back per 1 spent on ads
  costPerChat: number | null; chats: number | null;          // Meta chats and what one cost
  paidOrders: number | null; adOrders: number | null;        // all paid orders, and those from ad customers
  money: (n: number) => string; adMoney: (n: number) => string;
};
export type Insight = { key: string; big: string; line: string; note: string; tone: "good" | "bad" | "plain" };
type T = (en: string, sw: string) => string;

const pct = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(Math.round(x * 100))}%`;

export function buildInsights(x: InsightIn, T: T): Insight[] {
  const out: Insight[] = [];
  if (x.revenueD != null && Number.isFinite(x.revenueD) && Math.abs(x.revenueD) >= 0.01 && x.revenue != null) {
    const up = x.revenueD > 0;
    out.push({ key: "rev", big: pct(x.revenueD), tone: up ? "good" : "bad",
      line: up ? T("More money came in than in the period before.", "Pesa zaidi zimeingia kuliko kipindi kilichopita.")
        : T("Less money came in than in the period before.", "Pesa kidogo zimeingia kuliko kipindi kilichopita."),
      note: T(`${x.money(x.revenue)} came in this period.`, `${x.money(x.revenue)} zimeingia kipindi hiki.`) });
  }
  if (x.profit != null && x.revenue != null && x.revenue > 0) {
    const kept = x.profit / x.revenue;
    out.push({ key: "kept", big: `${Math.round(kept * 100)}%`, tone: kept > 0 ? "good" : "bad",
      line: kept > 0 ? T("Kept as profit from every shilling that came in.", "Faida uliyobaki nayo kwa kila shilingi iliyoingia.")
        : T("Lost on every shilling that came in, after ads and product costs.", "Imepotea kwa kila shilingi iliyoingia, baada ya matangazo na bidhaa."),
      note: T(`Profit this period: ${x.money(x.profit)}.`, `Faida kipindi hiki: ${x.money(x.profit)}.`) });
  }
  if (x.roas != null && Number.isFinite(x.roas) && x.spend != null && x.spend > 0) {
    out.push({ key: "roas", big: `${x.roas.toFixed(1)}×`, tone: x.roas >= 1 ? "good" : "bad",
      line: T("Came back for every shilling spent on ads.", "Zimerudi kwa kila shilingi ya matangazo."),
      note: x.roas >= 1 ? T(`Ads cost ${x.adMoney(x.spend)} and brought more than that back.`, `Matangazo yaligharimu ${x.adMoney(x.spend)} na yakarudisha zaidi.`)
        : T(`Ads cost ${x.adMoney(x.spend)} and brought less than that back.`, `Matangazo yaligharimu ${x.adMoney(x.spend)} na yakarudisha kidogo.`) });
  }
  if (x.chats != null && x.chats > 0 && x.adOrders != null) {
    const rate = x.adOrders / x.chats;
    out.push({ key: "close", big: `${rate > 0 && rate < 0.01 ? (rate * 100).toFixed(1) : Math.round(rate * 100)}%`, tone: "plain",
      line: T("Chats from ads that ended in a paid order.", "Chats za matangazo zilizoishia kwenye oda iliyolipwa."),
      note: T(`${x.adOrders} paid out of ${x.chats.toLocaleString("en")} chats.`, `${x.adOrders} wamelipa kati ya chats ${x.chats.toLocaleString("en")}.`) });
  }
  if (x.costPerChat != null && x.costPerChat > 0) {
    out.push({ key: "cpc", big: x.adMoney(x.costPerChat), tone: "plain",
      line: T("The cost of one chat from your ads.", "Gharama ya chat moja kutoka matangazo."),
      note: T("Lower is better: same money, more customers talking to you.", "Chini ni bora: pesa ileile, wateja wengi zaidi wanaongea nawe.") });
  }
  return out;
}
