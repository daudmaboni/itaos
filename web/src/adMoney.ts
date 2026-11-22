// Ad money manager: turns ad_money() (migration 0075) into a plain verdict per ad and at most three
// "do this today" lines. Pure: no network, no AI, so the same numbers always give the same advice.
//
// Money rules
//  - Break-even cost per sale = what an ad sale brings in on average − product cost per order
//    (Settings → Rates). If the product cost is not set, the full sale price is used and the card says so.
//  - Each ad's cost per paid sale is pulled toward the business's own average until the ad has enough
//    chats to speak for itself (K extra "average" chats). One lucky or unlucky sale can't flip a verdict.
//  - Only running ads get a verdict. Stopped ads are listed for the record.

export type AdMoneyAd = {
  ad_id: string; name: string | null; adset: string | null; campaign: string | null; account: string | null; status: string | null;
  spend: number; spend7: number; meta_chats: number; first_spend_day: string | null; last_spend_day: string | null;
  chats: number; chats_exact: number; priced: number; sales: number; sales_exact: number; revenue: number;
};
export type AdMoneyRes = {
  from: string; to: string; days: number; currency: string; unit_cost: number | null; fx_rate: number | null; ad_currency: string | null;
  totals: {
    spend: number; meta_chats: number; ad_chats: number; shared_chats: number; unmatched_chats: number;
    ad_sales: number; ad_revenue: number; shared_sales: number; unmatched_sales: number; all_sales: number; all_revenue: number;
  };
  ads: AdMoneyAd[];
};

export type Verdict = "scale" | "keep" | "watch" | "stop" | "early" | "off";
export type AdLine = {
  ad: AdMoneyAd; running: boolean; verdict: Verdict;
  spend: number | null;          // shown currency
  perDay: number | null;         // average spend per day over the last 7 days, shown currency
  cps: number | null;            // cost per paid sale (smoothed estimate), shown currency
  cpsActual: number | null;      // spend ÷ sales, only when the ad has ≥ 1 sale
  profit: number | null;         // revenue − spend − product cost, shown currency
  why: Reason;
};
export type Reason =
  | { k: "no_sale"; spend: number }
  | { k: "losing"; cps: number; be: number }
  | { k: "cheap"; cps: number; be: number }
  | { k: "costly"; cps: number; avg: number }
  | { k: "fine"; cps: number; be: number }
  | { k: "too_early"; need: number }
  | { k: "no_data" }
  | { k: "stopped" };
export type Advice =
  | { k: "move"; from: AdLine; to: AdLine; perDay: number }
  | { k: "stop"; ad: AdLine; perDay: number }
  | { k: "scale"; ad: AdLine }
  | { k: "fix"; ad: AdLine }
  | { k: "second_ad"; ad: AdLine }
  | { k: "none_running" }
  | { k: "no_sales_yet" };
export type Plan = {
  lines: AdLine[]; advice: Advice[];
  avgSale: number | null; breakEven: number | null; costKnown: boolean; avgCps: number | null; running: number;
};

/** Extra "average" chats each ad is blended with before it has its own track record. */
export const PRIOR_CHATS = 30;
const RUNNING = new Set(["ACTIVE", "IN_PROCESS", "PENDING_REVIEW", "WITH_ISSUES"]);
const STOPPED = new Set(["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "ARCHIVED", "DELETED", "DISAPPROVED"]);

function dayBefore(day: string, n: number) {
  return new Date(new Date(day + "T00:00:00Z").getTime() - n * 864e5).toISOString().slice(0, 10);
}

export function isRunning(a: Pick<AdMoneyAd, "status" | "last_spend_day">, today: string) {
  const s = (a.status ?? "").toUpperCase();
  if (RUNNING.has(s)) return true;
  if (STOPPED.has(s)) return false;
  return !!a.last_spend_day && a.last_spend_day >= dayBefore(today, 1);   // status unknown: spent today or yesterday
}

/**
 * @param A ad-currency amount → shown currency (null when it can't be converted)
 * @param W business-currency amount (sales, product cost) → shown currency
 */
export function planAdMoney(r: AdMoneyRes, A: (n: number) => number | null, W: (n: number) => number | null): Plan {
  const t = r.totals;
  const avgSaleRaw = t.ad_sales > 0 ? t.ad_revenue / t.ad_sales : t.all_sales > 0 ? t.all_revenue / t.all_sales : null;
  const avgSale = avgSaleRaw != null ? W(avgSaleRaw) : null;
  const unit = r.unit_cost != null ? W(Number(r.unit_cost)) : null;
  const costKnown = unit != null;
  const breakEven = avgSale != null ? Math.max(0, avgSale - (unit ?? 0)) : null;
  const totalSpend = A(t.spend);
  const avgCps = t.ad_sales >= 1 && totalSpend != null ? totalSpend / t.ad_sales : null;
  // The business's own rate of ad chats that end up paying, used to steady small ads.
  const p0 = t.ad_chats > 0 ? t.ad_sales / t.ad_chats : 0;

  const lines: AdLine[] = r.ads
    .filter((a) => Number(a.spend) > 0 || Number(a.sales) > 0)
    .map((a) => {
      const running = isRunning(a, r.to);
      const spend = A(Number(a.spend));
      const perDay = A(Number(a.spend7) / 7);
      const sales = Number(a.sales), chats = Number(a.chats);
      const cpsActual = sales > 0 && spend != null ? spend / sales : null;
      const rate = p0 > 0 ? (sales + PRIOR_CHATS * p0) / (chats + PRIOR_CHATS) : null;
      // Volume from the chats itaOS saw for the ad (or Meta's count when itaOS saw none).
      const volume = chats > 0 ? chats : Number(a.meta_chats);
      const cps = rate && spend != null && volume > 0 ? spend / (volume * rate) : cpsActual;
      const rev = W(Number(a.revenue));
      const profit = spend != null && rev != null ? rev - spend - (unit ?? 0) * sales : null;
      let verdict: Verdict = "keep";
      let why: Reason = { k: "no_data" };
      if (!running) { verdict = "off"; why = { k: "stopped" }; }
      else if (breakEven == null || spend == null) { verdict = "early"; why = { k: "no_data" }; }
      else {
        const target = avgCps ?? breakEven / 2;
        const enough = chats >= PRIOR_CHATS || spend >= breakEven;
        if (sales < 0.5 && spend >= breakEven) { verdict = "stop"; why = { k: "no_sale", spend }; }
        else if (sales < 0.5 && spend < target) { verdict = "early"; why = { k: "too_early", need: target - spend }; }
        else if (cps != null && cps > breakEven && enough) { verdict = "stop"; why = { k: "losing", cps, be: breakEven }; }
        else if (cps != null && sales >= 2 && cps <= breakEven * 0.5 && cps <= target * 1.05) { verdict = "scale"; why = { k: "cheap", cps, be: breakEven }; }
        else if (cps != null && avgCps != null && cps > avgCps * 1.5 && enough) { verdict = "watch"; why = { k: "costly", cps, avg: avgCps }; }
        else if (cps != null) { verdict = "keep"; why = { k: "fine", cps, be: breakEven }; }
        else { verdict = "early"; why = { k: "too_early", need: Math.max(0, target - spend) }; }
      }
      return { ad: a, running, verdict, spend, perDay, cps, cpsActual, profit, why };
    });

  const order: Record<Verdict, number> = { stop: 0, scale: 1, watch: 2, keep: 3, early: 4, off: 5 };
  lines.sort((x, y) => order[x.verdict] - order[y.verdict] || (y.spend ?? 0) - (x.spend ?? 0));

  const live = lines.filter((l) => l.running);
  const advice: Advice[] = [];
  const stops = live.filter((l) => l.verdict === "stop");
  const winners = live.filter((l) => l.verdict === "scale").sort((x, y) => (x.cps ?? Infinity) - (y.cps ?? Infinity));
  const keeps = live.filter((l) => l.verdict === "keep").sort((x, y) => (x.cps ?? Infinity) - (y.cps ?? Infinity));
  if (!live.length) advice.push({ k: "none_running" });
  else if (t.ad_sales === 0 && t.all_sales === 0) advice.push({ k: "no_sales_yet" });
  for (const s of stops) {
    const to = winners[0] ?? keeps[0];
    if (to && (s.perDay ?? 0) > 0) advice.push({ k: "move", from: s, to, perDay: s.perDay ?? 0 });
    else advice.push({ k: "stop", ad: s, perDay: s.perDay ?? 0 });
  }
  if (winners[0] && !stops.length) advice.push({ k: "scale", ad: winners[0] });
  const watch = live.find((l) => l.verdict === "watch");
  if (watch) advice.push({ k: "fix", ad: watch });
  // One ad carries everything: nothing to compare it with.
  if (live.length === 1 && (live[0].verdict === "keep" || live[0].verdict === "scale")) advice.push({ k: "second_ad", ad: live[0] });

  return { lines, advice: advice.slice(0, 3), avgSale, breakEven, costKnown, avgCps, running: live.length };
}

/** Ads Manager page for one ad, so the owner can change it there. */
export function adsManagerUrl(a: Pick<AdMoneyAd, "ad_id" | "account">) {
  const act = (a.account ?? "").replace(/^act_/, "");
  const q = new URLSearchParams({ selected_ad_ids: a.ad_id });
  if (act) q.set("act", act);
  return `https://adsmanager.facebook.com/adsmanager/manage/ads?${q.toString()}`;
}
