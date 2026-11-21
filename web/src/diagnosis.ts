// Evidence-backed weekly diagnosis. Deterministic rules over the central metrics; AI is not
// involved. Every finding carries counts, sample size, the records that support it and what is
// missing, and separates what was observed from the hypothesis drawn from it.
import type { Outcome, Order } from "./lib";
import type { FunnelMetrics } from "./metrics";
import { localDay, gotPrice } from "./lib";

export type Confidence = "high" | "medium" | "low";
export type FindingKind = "unanswered" | "slow_reply" | "low_intent" | "price_objection" | "no_follow_up" | "payment_friction" | "unconfirmed_signals" | "fulfillment" | "data_gap" | "healthy";

export type Finding = {
  kind: FindingKind;
  severity: "bad" | "warn" | "info" | "good";
  score: number;                      // for ranking; higher = more urgent
  confidence: Confidence;
  title: { en: string; sw: string };
  observed: { en: string; sw: string }; // facts
  hypothesis: { en: string; sw: string }; // interpretation, clearly labelled
  action: { en: string; sw: string };     // recommended next step
  count: number; sample: number;          // numerator and denominator the finding rests on
  source: string;                         // where the data comes from
  missing: string[];                      // data that would sharpen this
  conversationIds: string[];
  orderIds?: string[];
};

const conf = (sample: number, share: number): Confidence => (sample >= 20 && share >= 0.25 ? "high" : sample >= 8 ? "medium" : "low");
const pctS = (n: number) => `${Math.round(n * 100)}%`;

export function diagnose(mx: FunnelMetrics, convs: Outcome[], orders: Order[], tz: string): Finding[] {
  const p = mx.period;
  const inP = convs.filter((c) => c.started_at && localDay(c.started_at, tz) >= p.from && localDay(c.started_at, tz) <= p.to);
  const N = inP.length;
  const out: Finding[] = [];
  const ids = (list: Outcome[]) => list.slice(0, 50).map((c) => c.id);
  const missingBase = [
    ...(mx.coverage.kitoReadShare != null && mx.coverage.kitoReadShare < 0.7 ? ["Kito has not read every chat yet"] : []),
    ...(mx.coverage.knownSourceShare != null && mx.coverage.knownSourceShare < 0.5 ? ["most chats have no known source (connect WhatsApp for ad referrals)"] : []),
  ];

  // 1. Unanswered chats
  const noReply = inP.filter((c) => c.stage === "no_reply" && c.outcome !== "sold");
  if (N && noReply.length >= Math.max(2, N * 0.1)) {
    const share = noReply.length / N;
    out.push({
      kind: "unanswered", severity: share >= 0.25 ? "bad" : "warn", score: 90 * share + noReply.length, confidence: conf(N, share),
      title: { en: `${noReply.length} chats never got a reply`, sw: `Chats ${noReply.length} hazikujibiwa kabisa` },
      observed: { en: `${noReply.length} of ${N} chats started ${p.from}–${p.to} have no message from the business.`, sw: `Chats ${noReply.length} kati ya ${N} zilizoanza ${p.from}–${p.to} hazina ujumbe wowote kutoka biashara.` },
      hypothesis: { en: "Inquiries are being lost before any conversation happens; the ad is working, the inbox is not.", sw: "Wateja wanapotea kabla mazungumzo hayajaanza; tangazo linafanya kazi, inbox haifanyi." },
      action: { en: "Reply to the open ones today (see Actions) and set a daily inbox slot.", sw: "Jibu zilizo wazi leo (angalia Vitendo) na weka muda wa kila siku wa inbox." },
      count: noReply.length, sample: N, source: "messages (direction) per chat", missing: missingBase, conversationIds: ids(noReply),
    });
  }

  // 2. Slow first reply
  const med = mx.medianFirstReply.value, over1h = mx.over1h.value ?? 0, frtN = mx.medianFirstReply.n ?? 0;
  if (med != null && frtN >= 3 && (med > 1800 || over1h >= Math.max(3, frtN * 0.2))) {
    const slow = inP.filter((c) => (c.first_response_sec ?? 0) > 3600);
    const share = over1h / frtN;
    out.push({
      kind: "slow_reply", severity: med > 3600 ? "bad" : "warn", score: 60 * share + over1h, confidence: conf(frtN, share),
      title: { en: "First replies are slow", sw: "Jibu la kwanza linachelewa" },
      observed: { en: `Median first reply ${Math.round(med / 60)} min across ${frtN} replied chats; ${over1h} waited over an hour.`, sw: `Wastani wa jibu la kwanza dakika ${Math.round(med / 60)} kwenye chats ${frtN}; ${over1h} zilisubiri zaidi ya saa.` },
      hypothesis: { en: "Customers who wait over an hour on WhatsApp usually buy from whoever answers first.", sw: "Mteja anayesubiri zaidi ya saa kwenye WhatsApp mara nyingi hununua kwa anayejibu kwanza." },
      action: { en: "Agree a 15-minute reply target during ad hours; use saved replies for the first message.", sw: "Wekeni lengo la kujibu ndani ya dakika 15 wakati tangazo linaendelea; tumia majibu yaliyohifadhiwa." },
      count: over1h, sample: frtN, source: "first_response_sec per chat", missing: missingBase, conversationIds: ids(slow),
    });
  }

  // 3. Low-intent inquiries (ads bring chats that never ask about buying)
  const adChats = inP.filter((c) => c.source === "ad");
  const lowIntent = adChats.filter((c) => c.outcome !== "sold" && !c.price_asked && !c.price_shared && (c.kito_temp === "cold" || (!c.kito_temp && !c.warm)));
  if (adChats.length >= 8 && lowIntent.length / adChats.length >= 0.4) {
    const share = lowIntent.length / adChats.length;
    out.push({
      kind: "low_intent", severity: "warn", score: 50 * share + lowIntent.length * 0.5, confidence: conf(adChats.length, share),
      title: { en: `${pctS(share)} of ad chats show no buying intent`, sw: `${pctS(share)} ya chats za matangazo hazina nia ya kununua` },
      observed: { en: `${lowIntent.length} of ${adChats.length} ad chats never asked a price and were read as cold.`, sw: `Chats ${lowIntent.length} kati ya ${adChats.length} za matangazo hazikuuliza bei na zilisomwa kama baridi.` },
      hypothesis: { en: "The ad creative or targeting attracts curiosity rather than buyers. Cheap chats are not cheap customers.", sw: "Tangazo linavuta udadisi badala ya wanunuzi. Chat ya bei nafuu si mteja wa bei nafuu." },
      action: { en: "Compare ads by cost per attributed sale, not cost per chat; put the price or offer in the ad.", sw: "Linganisha matangazo kwa gharama kwa mauzo, si kwa chat; weka bei au ofa kwenye tangazo." },
      count: lowIntent.length, sample: adChats.length, source: "ad referral + price_asked + Kito temperature", missing: missingBase, conversationIds: ids(lowIntent),
    });
  }

  // 4. Price objections / silence after price
  const priced = inP.filter(gotPrice);
  // Rules only see typed prices; for a price Kito found (voice note), "went quiet" = we spoke last.
  const silent = priced.filter((c) => c.outcome !== "sold" && (c.stage === "silent_after_price" || (!c.price_shared && c.last_dir === "out")));
  const priceObj = inP.filter((c) => c.outcome !== "sold" && (c.objections?.includes("price") || c.kito_objections?.includes("price") || c.kito_blocker === "price"));
  const priceHit = new Set([...silent, ...priceObj].map((c) => c.id));
  if (priced.length >= 5 && priceHit.size / priced.length >= 0.3) {
    const share = priceHit.size / priced.length;
    out.push({
      kind: "price_objection", severity: share >= 0.5 ? "bad" : "warn", score: 70 * share + priceHit.size * 0.5, confidence: conf(priced.length, share),
      title: { en: `${priceHit.size} customers stopped at the price`, sw: `Wateja ${priceHit.size} walisimama kwenye bei` },
      observed: { en: `Of ${priced.length} chats where you gave the price, ${silent.length} went quiet right after it and ${priceHit.size - silent.length} more said it was too much.`, sw: `Kati ya chats ${priced.length} ulizotoa bei, ${silent.length} zilinyamaza mara baada ya bei na ${priceHit.size - silent.length} nyingine zilisema ni ghali.` },
      hypothesis: { en: "The price lands before the value does, or the offer lacks an entry option.", sw: "Bei inafika kabla ya thamani, au hakuna ofa ya kuanzia." },
      action: { en: "Lead with the result and proof, give the price with a question, and test a smaller starter pack.", sw: "Anza na matokeo na ushahidi, toa bei ukiuliza swali, na jaribu kifurushi kidogo cha kuanzia." },
      count: priceHit.size, sample: priced.length, source: "price_shared, stage, objections (rules + Kito)", missing: missingBase, conversationIds: ids([...silent, ...priceObj]),
    });
  }

  // 5. Warm leads with no follow-up
  const warmNoFollow = inP.filter((c) => c.outcome !== "sold" && (c.kito_temp ? c.kito_temp !== "cold" : c.warm) && !c.followed_up && c.last_dir === "in" && !c.last_in_closing);
  if (warmNoFollow.length >= 3) {
    const warmN = mx.warmNoFollowUp.n ?? warmNoFollow.length;
    const share = warmN ? warmNoFollow.length / warmN : 0;
    out.push({
      kind: "no_follow_up", severity: "bad", score: 80 * share + warmNoFollow.length, confidence: conf(warmN, share),
      title: { en: `${warmNoFollow.length} warm customers are waiting on you`, sw: `Wateja ${warmNoFollow.length} wenye nia wanakusubiri` },
      observed: { en: `${warmNoFollow.length} of ${warmN} warm chats ended with the customer's message and never got a follow-up.`, sw: `Chats ${warmNoFollow.length} kati ya ${warmN} zenye nia ziliishia na ujumbe wa mteja bila ufuatiliaji.` },
      hypothesis: { en: "Sales are being left on the table after interest was shown; one more message often closes.", sw: "Mauzo yanaachwa baada ya mteja kuonyesha nia; ujumbe mmoja zaidi mara nyingi unafunga." },
      action: { en: "Work the follow-up queue in Actions; Kito can draft the message, you decide and send.", sw: "Fuatilia foleni kwenye Vitendo; Kito anaweza kuandika rasimu, wewe unaamua na kutuma." },
      count: warmNoFollow.length, sample: warmN, source: "temperature (Kito or rules), last message direction, follow-up detection", missing: missingBase, conversationIds: ids(warmNoFollow),
    });
  }

  // 6. Payment friction: reached payment instructions, never paid
  const awaiting = inP.filter((c) => (c.kito_label ?? c.label) === "awaiting_payment" && c.outcome !== "sold" && Number(c.paid_orders) === 0);
  const payInstr = inP.filter((c) => c.pay_instructions);
  if (payInstr.length >= 4 && awaiting.length / payInstr.length >= 0.4) {
    const share = awaiting.length / payInstr.length;
    out.push({
      kind: "payment_friction", severity: "warn", score: 65 * share + awaiting.length * 0.5, confidence: conf(payInstr.length, share),
      title: { en: `${awaiting.length} customers got payment details and never paid`, sw: `Wateja ${awaiting.length} walipewa namba ya kulipia na hawakulipa` },
      observed: { en: `You sent your payment number in ${payInstr.length} chats; ${awaiting.length} of them have not paid and have no sale recorded.`, sw: `Ulituma namba ya malipo kwenye chats ${payInstr.length}; ${awaiting.length} kati yake hawajalipa na hakuna mauzo yaliyorekodiwa.` },
      hypothesis: { en: "Payment is the friction point: method, trust, or no reminder after instructions.", sw: "Malipo ndiyo kikwazo: njia, uaminifu, au hakuna ukumbusho baada ya maelekezo." },
      action: { en: "Offer pay-on-delivery where you can, send one reminder 24 h after instructions, confirm receipts fast.", sw: "Toa malipo wakati wa kupokea inapowezekana, tuma ukumbusho mmoja saa 24 baada ya maelekezo, thibitisha risiti haraka." },
      count: awaiting.length, sample: payInstr.length, source: "pay_instructions + label + orders", missing: missingBase, conversationIds: ids(awaiting),
    });
  }

  // 7. Inferred payments not confirmed (data trust)
  const unconfirmed = inP.filter((c) => (c.payment_signal || c.kito_outcome === "sold" || c.outcome_override === "sold") && Number(c.paid_orders) === 0);
  if (unconfirmed.length >= 1) {
    out.push({
      kind: "unconfirmed_signals", severity: unconfirmed.length >= 5 ? "warn" : "info", score: 20 + unconfirmed.length, confidence: "high",
      title: { en: unconfirmed.length === 1 ? "1 payment found but not recorded as a sale" : `${unconfirmed.length} payments found but not recorded as sales`, sw: `Malipo ${unconfirmed.length} yameonekana lakini hayajarekodiwa kama mauzo` },
      observed: { en: `${unconfirmed.length === 1 ? "1 chat looks" : `${unconfirmed.length} chats look`} paid (the customer said so, sent a screenshot, Kito read it, or you sent ✅) but no sale is recorded. Revenue leaves ${unconfirmed.length === 1 ? "it" : "them"} out until you record ${unconfirmed.length === 1 ? "it" : "them"}.`, sw: `Chats ${unconfirmed.length} zinaonekana zimelipwa (mteja alisema, alituma picha, Kito alisoma, au ulituma ✅) lakini mauzo hayajarekodiwa. Mapato hayazihesabu mpaka uzirekodi.` },
      hypothesis: { en: "Real sales are probably under-counted until these are confirmed or corrected.", sw: "Mauzo halisi yanaweza kuwa yamehesabiwa pungufu hadi haya yathibitishwe au yasahihishwe." },
      action: { en: "Open each one in Chats and record the order (or mark it lost).", sw: "Fungua kila moja kwenye Chats na rekodi oda (au weka alama imepotea)." },
      count: unconfirmed.length, sample: N, source: "payment_signal, Kito outcome, ✅ marks vs orders", missing: [], conversationIds: ids(unconfirmed),
    });
  }

  // 8. Fulfilment issues
  const paidInP = orders.filter((o) => o.paid_at && localDay(o.paid_at, tz) >= p.from && localDay(o.paid_at, tz) <= p.to);
  const bad = orders.filter((o) => (o.status === "refunded" || o.fulfillment_status === "returned") && localDay(o.updated_at, tz) >= p.from && localDay(o.updated_at, tz) <= p.to);
  const deliveryObj = inP.filter((c) => c.outcome !== "sold" && (c.objections?.includes("delivery") || c.kito_objections?.includes("delivery") || c.kito_blocker === "delivery"));
  if (bad.length >= 1 || (N >= 8 && deliveryObj.length / N >= 0.2)) {
    const share = N ? deliveryObj.length / N : 0;
    out.push({
      kind: "fulfillment", severity: bad.length >= 2 ? "bad" : "warn", score: 40 * share + bad.length * 15, confidence: bad.length >= 2 ? "medium" : conf(N, share),
      title: { en: bad.length ? `${bad.length} refunds or returns this period` : `${deliveryObj.length} customers blocked by delivery`, sw: bad.length ? `Marejesho ${bad.length} kipindi hiki` : `Wateja ${deliveryObj.length} wamekwama kwenye usafirishaji` },
      observed: { en: `${bad.length} orders refunded/returned; ${deliveryObj.length} of ${N} chats raised delivery or location.`, sw: `Oda ${bad.length} zimerudishwa; chats ${deliveryObj.length} kati ya ${N} ziliuliza usafirishaji au mahali.` },
      hypothesis: { en: "Fulfilment promises or reach do not match what customers expect.", sw: "Ahadi za usafirishaji au maeneo hayalingani na matarajio ya wateja." },
      action: { en: "State delivery areas, cost and time in the first reply; record delivery status on each order.", sw: "Taja maeneo, gharama na muda wa usafirishaji kwenye jibu la kwanza; rekodi hali ya usafirishaji kwa kila oda." },
      count: bad.length + deliveryObj.length, sample: N + paidInP.length, source: "orders status/fulfillment + delivery objections", missing: [], conversationIds: ids(deliveryObj), orderIds: bad.map((o) => o.id),
    });
  }

  // 9. Data gaps that limit the diagnosis
  // Only things the owner can fill in. Kito coverage is not listed: Kito reads chats by itself every
  // 15 minutes, and older chats (before Kito) are read with the simple rules, so there is nothing to do.
  const gaps: [string, string][] = [];
  if (mx.coverage.fxNeeded && !mx.coverage.fxSet) gaps.push(["exchange rate (your ad account and sales use different currencies)", "kiwango cha kubadilisha fedha (tangazo na mauzo yanatumia sarafu tofauti)"]);
  if (mx.coverage.ordersMissingCost > 0 && mx.coverage.expensesCount === 0) gaps.push(["order costs (type them when you confirm a payment in Chats)", "gharama za oda (ziandike unapothibitisha malipo kwenye Chats)"]);
  if (mx.coverage.knownSourceShare != null && mx.coverage.knownSourceShare < 0.5) gaps.push(["where chats came from (ad or not)", "chats zilitoka wapi (tangazo au la)"]);
  if ((mx.spend.value ?? 0) === 0) gaps.push(["ad spend (connect your ad account, or there was no spend this period)", "matumizi ya matangazo (unganisha akaunti ya matangazo, au hakukuwa na matumizi kipindi hiki)"]);
  if (gaps.length) {
    out.push({
      kind: "data_gap", severity: "info", score: 5, confidence: "high",
      title: { en: "Some figures are limited by missing data", sw: "Baadhi ya takwimu zinakosa data" },
      observed: { en: "Missing: " + gaps.map((g) => g[0]).join("; ") + ".", sw: "Inakosekana: " + gaps.map((g) => g[1]).join("; ") + "." },
      hypothesis: { en: "Not a problem in the business, a gap in the data.", sw: "Si tatizo la biashara, ni pengo la data." },
      action: { en: "Fill these in Settings, Connections or by CSV import.", sw: "Jaza kwenye Mipangilio, Connections au uingize CSV." },
      count: gaps.length, sample: 0, source: "workspace settings and coverage", missing: gaps.map((g) => g[0]), conversationIds: [],
    });
  }

  if (!out.some((f) => f.severity === "bad" || f.severity === "warn") && N > 0) {
    out.push({
      kind: "healthy", severity: "good", score: 0, confidence: conf(N, 1),
      title: { en: "No major leak found this period", sw: "Hakuna tatizo kubwa kipindi hiki" },
      observed: { en: `${N} chats, ${mx.attributedSales.value ?? 0} attributed sales, ${mx.ordersPaid.value ?? 0} paid orders.`, sw: `Chats ${N}, mauzo ${mx.attributedSales.value ?? 0} yaliyounganishwa, oda ${mx.ordersPaid.value ?? 0} zilizolipwa.` },
      hypothesis: { en: "Keep the reply speed and follow-ups where they are.", sw: "Endelea na kasi ya kujibu na ufuatiliaji kama ilivyo." },
      action: { en: "Compare ads by cost per attributed sale before changing budgets.", sw: "Linganisha matangazo kwa gharama kwa mauzo kabla ya kubadilisha bajeti." },
      count: N, sample: N, source: "all rules above", missing: missingBase, conversationIds: [],
    });
  }
  return out.sort((a, b) => b.score - a.score);
}
