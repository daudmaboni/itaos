// Central, deterministic metric definitions for itaOS. Pure functions: no network, no AI.
// Every figure carries its provenance so the UI can say where a number came from.
//
// Cohort rules
//  - A chat belongs to the period in which it STARTED (workspace timezone).
//  - "Sales from this period's chats" = paid orders linked to those chats, paid within the
//    workspace conversion window after the chat started (an attributed/matched estimate).
//  - "Revenue recorded in period" = paid orders whose paid_at falls in the period, whatever the chat.
//  - Ad spend, impressions, clicks and Meta-reported conversations are platform figures by day.
//  - Cost per sale divides ad spend by attributed sales from ad chats only, and only when both exist.
//  - Profit (contribution) is shown only when the inputs it needs exist: the fx rate when currencies
//    differ, and a cost for every paid order (typed / from products, or the workspace default cost,
//    which marks the figure "estimated"). Imported expenses never stand in for missing order costs.

import type { AdPerf, Order, Outcome, Workspace } from "./lib";
import { localDay, median, gotPrice } from "./lib";

export type Provenance = "platform" | "observed" | "inferred" | "confirmed" | "imported" | "matched" | "derived";

export type Period = { from: string; to: string; days: number; label: string };

export type DailyInsight = { day: string; spend: number; currency: string | null; impressions?: number; clicks?: number; messaging_conversations?: number };
export type Expense = { day: string; amount: number; currency: string; category: string };

export type Metric = { value: number | null; provenance: Provenance; n?: number; d?: number; note?: string };

export type FunnelMetrics = {
  period: Period;
  adCurrency: string;
  spend: Metric; impressions: Metric; clicks: Metric; platformConversations: Metric;
  chats: Metric; adChats: Metric; organicChats: Metric; unknownChats: Metric;
  replied: Metric; priced: Metric; paymentSignals: Metric; unconfirmedSignals: Metric;
  attributedSales: Metric; attributedAdSales: Metric; attributedRevenue: Metric; attributedAdRevenue: Metric; adCustomerRevenue: Metric; adCustomerOrders: Metric; returnOnAdSpendAllAdCustomers: Metric;
  ordersPaid: Metric; revenue: Metric; revenueManual: Metric; revenueImported: Metric; ordersUnlinked: Metric;
  replyRate: Metric; priceRate: Metric; signalRate: Metric; saleRate: Metric; adSaleRate: Metric;
  costPerPlatformConversation: Metric; costPerAdChat: Metric; costPerQualifiedInquiry: Metric; costPerAttributedSale: Metric;
  returnOnAdSpend: Metric; contribution: Metric;
  medianFirstReply: Metric; over1h: Metric; noReply: Metric; silentAfterPrice: Metric; warmNoFollowUp: Metric; kitoRead: Metric;
  coverage: { knownSourceShare: number | null; kitoReadShare: number | null; chatsWithoutMessages: number; fxNeeded: boolean; fxSet: boolean; unitCostSet: boolean; expensesCount: number; ordersMissingCost: number; ordersEstimatedCost: number; orderCosts: number };
};

export const DEFINITIONS: Record<string, { en: string; sw: string }> = {
  spend: { en: "Ad spend reported by Meta for the ads in this period.", sw: "Matumizi ya matangazo kama Meta inavyoripoti kwa kipindi hiki." },
  platformConversations: { en: "Messaging conversations started, as reported by Meta Ads Manager.", sw: "Mazungumzo yaliyoanza kama Meta Ads Manager inavyoripoti." },
  chats: { en: "WhatsApp chats whose first message is in this period (observed by itaOS).", sw: "Chats za WhatsApp zilizoanza kipindi hiki (zimeonekana na itaOS)." },
  adChats: { en: "Chats that carried a Meta ad referral (matched, not proof the ad caused anything).", sw: "Chats zilizokuja na referral ya tangazo (zimeunganishwa, si uthibitisho)." },
  replied: { en: "Chats where the business sent at least one message.", sw: "Chats ambazo biashara ilijibu angalau mara moja." },
  priced: { en: "Chats where a price was shared (rule-based detection).", sw: "Chats ambazo bei ilitolewa (kanuni za maneno)." },
  paymentSignals: { en: "Chats with an inferred payment signal from words, screenshots or Kito. Not confirmed sales.", sw: "Chats zenye dalili ya malipo (maneno, picha au Kito). Si mauzo yaliyothibitishwa." },
  attributedSales: { en: "Chats from this period with a confirmed paid order inside the conversion window.", sw: "Chats za kipindi hiki zenye oda iliyolipwa ndani ya dirisha la uthibitisho." },
  revenue: { en: "Net revenue (amount − discount − refunds) of paid orders recorded in this period.", sw: "Mapato halisi (kiasi − punguzo − marejesho) ya oda zilizolipwa kipindi hiki." },
  costPerPlatformConversation: { en: "Ad spend ÷ Meta-reported conversations.", sw: "Matumizi ÷ mazungumzo yaliyoripotiwa na Meta." },
  costPerAdChat: { en: "Ad spend ÷ WhatsApp chats with an ad referral.", sw: "Matumizi ÷ chats za WhatsApp zenye referral ya tangazo." },
  costPerQualifiedInquiry: { en: "Ad spend ÷ ad chats where a price was shared.", sw: "Matumizi ÷ chats za matangazo zilizopewa bei." },
  costPerAttributedSale: { en: "Ad spend ÷ sales paid in this period by customers whose chat came from an ad (whenever the chat started). A matched estimate.", sw: "Matumizi ÷ mauzo yaliyolipwa kipindi hiki na wateja waliotoka kwenye tangazo (chat ilipoanza popote). Ni makadirio." },
  returnOnAdSpend: { en: "Attributed revenue from ad chats ÷ ad spend (converted with your exchange rate).", sw: "Mapato yaliyounganishwa na matangazo ÷ matumizi (kwa kiwango chako cha kubadilisha)." },
  contribution: { en: "Profit = revenue − ad spend − what each order cost you (product + delivery) − imported expenses. Shown when every order in the period has a cost; orders without their own cost use your default cost, and then it says \"estimated\". With no paid orders it is the ad spend, shown as a loss. Rent, salaries and other running costs are not taken out unless you import them as expenses.", sw: "Faida = mapato − matangazo − gharama ya kila oda (bidhaa + usafiri) − matumizi yaliyoingizwa. Inaonyeshwa kila oda ikiwa na gharama; oda zisizo na gharama yake zinatumia gharama ya kawaida, na hapo inasema \"makadirio\". Kama hakuna oda zilizolipwa, ni matumizi ya matangazo yakionyeshwa kama hasara. Kodi, mishahara na gharama nyingine za uendeshaji hazitolewi isipokuwa uziingize kama matumizi." },
};

const m = (value: number | null, provenance: Provenance, extra: Partial<Metric> = {}): Metric => ({ value, provenance, ...extra });
const ratio = (n: number, d: number, provenance: Provenance): Metric => (d > 0 ? m(n / d, provenance, { n, d }) : m(null, provenance, { n, d, note: "no denominator" }));

export function periodEnding(today: string, days: number, label: string): Period {
  const end = new Date(today + "T00:00:00Z");
  const start = new Date(end.getTime() - (days - 1) * 864e5);
  return { from: start.toISOString().slice(0, 10), to: today, days, label };
}
export function comparisonOf(p: Period): Period {
  const end = new Date(new Date(p.from + "T00:00:00Z").getTime() - 864e5);
  return periodEnding(end.toISOString().slice(0, 10), p.days, "previous");
}
const inPeriod = (day: string, p: Period) => day >= p.from && day <= p.to;

export type Inputs = {
  ws: Pick<Workspace, "currency" | "timezone" | "fx_rate" | "unit_cost" | "conversion_window_days" | "follow_up_hours">;
  period: Period;
  conversations: Outcome[];   // any range; filtered here by started_at
  ads: AdPerf[];              // ad_performance for exactly this period
  daily: DailyInsight[];      // any range; filtered here by day
  orders: Order[];            // any range; filtered here by paid_at
  expenses: Expense[];        // any range; filtered here by day
  now?: number;
};

export function computeFunnel(i: Inputs): FunnelMetrics {
  const tz = i.ws.timezone || "Africa/Dar_es_Salaam";
  const now = i.now ?? Date.now();
  const p = i.period;
  const win = (i.ws.conversion_window_days ?? 30) * 864e5;

  const daily = i.daily.filter((d) => inPeriod(d.day, p));
  const adCurrency = daily.find((d) => d.currency)?.currency ?? i.ws.currency;
  const spend = daily.reduce((s, d) => s + Number(d.spend || 0), 0);
  const impressions = daily.reduce((s, d) => s + Number(d.impressions || 0), 0);
  const clicks = daily.reduce((s, d) => s + Number(d.clicks || 0), 0);
  const platformConv = daily.reduce((s, d) => s + Number(d.messaging_conversations || 0), 0);

  const convs = i.conversations.filter((c) => c.started_at && inPeriod(localDay(c.started_at, tz), p));
  const adChats = convs.filter((c) => c.source === "ad");
  const organic = convs.filter((c) => c.source === "organic");
  const unknown = convs.filter((c) => c.source === "unknown");
  const confirmed = (c: Outcome) => Number(c.paid_orders) > 0;
  const attributed = (c: Outcome) => confirmed(c) && !!c.first_paid_at && !!c.started_at && Date.parse(c.first_paid_at) <= Date.parse(c.started_at) + win;
  const signal = (c: Outcome) => !(c.override_by && (c.outcome_override === "open" || c.outcome_override === "lost"))
    && (!!c.payment_signal || c.kito_outcome === "sold" || c.outcome_override === "sold");
  const replied = convs.filter((c) => c.first_response_sec != null);
  const priced = convs.filter(gotPrice);
  const signals = convs.filter(signal);
  const unconfirmed = convs.filter((c) => signal(c) && !confirmed(c));
  const attributedChats = convs.filter(attributed);
  const attributedAd = adChats.filter(attributed);
  const attributedRevenue = attributedChats.reduce((s, c) => s + Number(c.sale_amount ?? 0), 0);
  const attributedAdRevenue = attributedAd.reduce((s, c) => s + Number(c.sale_amount ?? 0), 0);

  const paid = i.orders.filter((o) => o.status === "paid" && o.paid_at && inPeriod(localDay(o.paid_at, tz), p));
  const net = (list: Order[]) => list.reduce((s, o) => s + (Number(o.amount) - Number(o.discount) - Number(o.refund_amount)), 0);
  const revenue = net(paid);
  const revenueManual = net(paid.filter((o) => o.provenance === "manual"));
  const revenueImported = net(paid.filter((o) => o.provenance === "csv_import" || o.provenance === "provider"));
  const unlinked = paid.filter((o) => !o.conversation_id).length;
  // Paid this period by customers whose chat came from an ad, whenever that chat started (e.g. clicked in October, paid in November).
  const adCustomerPaid = paid.filter((o) => o.conv_source === "ad");
  const adCustomerRevenue = net(adCustomerPaid);

  const frt = convs.map((c) => c.first_response_sec).filter((x): x is number => x != null);
  const warm = convs.filter((c) => (c.kito_temp ? c.kito_temp !== "cold" : c.warm) && c.outcome !== "sold");
  const warmNoFollow = warm.filter((c) => !c.followed_up && !(c.last_out_at && now - Date.parse(c.last_out_at) < i.ws.follow_up_hours * 3600e3));
  const kitoRead = convs.filter((c) => c.kito_checked_at).length;

  const fxNeeded = adCurrency !== i.ws.currency;
  const fx = fxNeeded ? (i.ws.fx_rate ? Number(i.ws.fx_rate) : null) : 1;
  const spendInWs = fx != null ? spend * fx : null;
  const expenses = i.expenses.filter((e) => inPeriod(e.day, p) && e.currency === i.ws.currency);
  const expensesTotal = expenses.reduce((s, e) => s + Number(e.amount), 0);
  // Order costs: typed on each order when the payment is confirmed. The old workspace-wide
  // "cost per order" (unit_cost) still fills in for orders recorded before that existed.
  const unitCost = i.ws.unit_cost != null ? Number(i.ws.unit_cost) : null;
  const costOf = (o: Order) => (o.cost != null ? Number(o.cost) : unitCost);
  const missingCost = paid.filter((o) => costOf(o) == null).length;
  const estimatedCost = paid.filter((o) => o.cost == null && unitCost != null).length;   // counted at the default cost
  const orderCosts = paid.reduce((s, o) => s + (costOf(o) ?? 0), 0);
  // Profit is shown only when every paid order has a cost (its own, or the workspace default).
  // Imported expenses are subtracted on top; they never stand in for missing order costs.
  const costsKnown = paid.length > 0 && missingCost === 0;
  // No paid orders: nothing is missing, so profit is just what went out (ad spend + imported expenses),
  // shown as a loss rather than a dash.
  const contribution = spendInWs != null && costsKnown
    ? m(revenue - spendInWs - orderCosts - expensesTotal, "derived", { n: paid.length - estimatedCost, d: paid.length, note: estimatedCost ? "estimated" : "order costs" })
    : spendInWs != null && paid.length === 0
      ? m(revenue - spendInWs - expensesTotal, "derived", { n: 0, d: 0, note: "no paid orders in period" })
      : m(null, "derived", { n: paid.length - missingCost, d: paid.length, note: spendInWs == null ? "needs exchange rate" : "needs order costs" });

  return {
    period: p, adCurrency,
    spend: m(spend, "platform"), impressions: m(impressions, "platform"), clicks: m(clicks, "platform"), platformConversations: m(platformConv, "platform"),
    chats: m(convs.length, "observed"), adChats: m(adChats.length, "matched"), organicChats: m(organic.length, "observed"), unknownChats: m(unknown.length, "observed"),
    replied: m(replied.length, "observed"), priced: m(priced.length, "inferred"), paymentSignals: m(signals.length, "inferred"), unconfirmedSignals: m(unconfirmed.length, "inferred"),
    attributedSales: m(attributedChats.length, "matched"), attributedAdSales: m(attributedAd.length, "matched"), attributedRevenue: m(attributedRevenue, "matched"), attributedAdRevenue: m(attributedAdRevenue, "matched"),
    ordersPaid: m(paid.length, "confirmed"), revenue: m(revenue, "confirmed"), revenueManual: m(revenueManual, "confirmed"), revenueImported: m(revenueImported, "imported"), ordersUnlinked: m(unlinked, "confirmed"),
    replyRate: ratio(replied.length, convs.length, "observed"), priceRate: ratio(priced.length, convs.length, "inferred"),
    signalRate: ratio(signals.length, convs.length, "inferred"), saleRate: ratio(attributedChats.length, convs.length, "matched"), adSaleRate: ratio(attributedAd.length, adChats.length, "matched"),
    costPerPlatformConversation: spend > 0 ? ratio(spend, platformConv, "platform") : m(null, "platform", { note: "no spend" }),
    costPerAdChat: spend > 0 ? ratio(spend, adChats.length, "matched") : m(null, "matched", { note: "no spend" }),
    costPerQualifiedInquiry: spend > 0 ? ratio(spend, adChats.filter((c) => c.price_shared).length, "matched") : m(null, "matched", { note: "no spend" }),
    // Counted by the day the money came in, like ROAS: a chat that started yesterday and paid today counts today.
    costPerAttributedSale: spend > 0 ? ratio(spend, adCustomerPaid.length, "matched") : m(null, "matched", { note: "no spend" }),
    returnOnAdSpend: spend > 0 && fx != null ? m(attributedAdRevenue / (spend * fx), "matched", { n: attributedAdRevenue, d: spend * fx }) : m(null, "matched", { note: spend > 0 ? "needs exchange rate" : "no spend" }),
    adCustomerRevenue: m(adCustomerRevenue, "matched"), adCustomerOrders: m(adCustomerPaid.length, "matched"),
    returnOnAdSpendAllAdCustomers: spend > 0 && fx != null ? m(adCustomerRevenue / (spend * fx), "matched", { n: adCustomerRevenue, d: spend * fx }) : m(null, "matched", { note: spend > 0 ? "needs exchange rate" : "no spend" }),
    contribution,
    medianFirstReply: m(median(frt), "observed", { n: frt.length }), over1h: m(frt.filter((x) => x > 3600).length, "observed"),
    noReply: m(convs.filter((c) => c.stage === "no_reply").length, "observed"),
    silentAfterPrice: m(convs.filter((c) => c.stage === "silent_after_price" && c.outcome !== "sold").length, "inferred"),
    warmNoFollowUp: m(warmNoFollow.length, "inferred", { n: warm.length }),
    kitoRead: m(kitoRead, "inferred"),
    coverage: {
      knownSourceShare: convs.length ? (convs.length - unknown.length) / convs.length : null,
      kitoReadShare: convs.length ? kitoRead / convs.length : null,
      chatsWithoutMessages: convs.filter((c) => !c.last_message_at).length,
      fxNeeded, fxSet: !!i.ws.fx_rate, unitCostSet: unitCost != null, expensesCount: expenses.length, ordersMissingCost: missingCost, ordersEstimatedCost: estimatedCost, orderCosts,
    },
  };
}

/** Change between two metrics as a fraction of the comparison value; null when not comparable. */
export function delta(cur: Metric, prev: Metric): number | null {
  if (cur.value == null || prev.value == null || prev.value === 0) return null;
  return (cur.value - prev.value) / Math.abs(prev.value);
}
