// Conversation signal detection (Kiswahili + English). Same rules as the Phase 0 engine.
import { paidCustomer, paidCustomerAfterPay, mpesaSms, paidBusiness, shipped, deliveredHit } from "./money.ts";
export type Msg = { direction: "in" | "out"; sent_at: string; body: string | null; type: string };

const SIG = {
  askPrice: /(\bbei\b|ngapi|gharama|price|how much|\bcost\b|shilingi ngapi|sh ngapi)/i,
  priceAmount: /((tsh|tzs|sh\.?|shs|shilingi)\s*\.?\s*[\d][\d,. ]{2,}|[\d][\d,.]{2,}\s*(\/=|tsh|tzs|shilingi)|\b\d{1,3}[,.]\d{3}\b|\belfu\s+\w+)/i,
  // Customer words. Only strong ones: "nimetuma" / "nimekutumia" alone can mean a photo or a location,
  // so those count only after you sent payment details (see analyze).
  paidCustomer,
  paidCustomerAfterPay,
  // An M-Pesa / Tigo / Airtel SMS the customer pasted: "XYZ123ABCD Imethibitishwa. Umelipa Tsh155,000…"
  mpesaSms,
  paidBusiness,
  payInstr: /(lipa namba|till|paybill|akaunti|m-?pesa|tigo ?pesa|airtel ?money|halopesa|nalipa vipi|how do i pay)/i,
  // Fulfilment language (how sales really look in chat: goods sent or picked up)
  shipped,
  // "I received the goods" — must name what was received. Not "nianze kutumia?", "naomba maelekezo", "nimechukua namba yako".
  received: /(nime(pokea|upata|ipata|zipata|pata|chukua|shachukua|shapokea)\s+(\w+\s+){0,2}(mzigo|dawa|parcel|package|oda|order|kifurushi|bidhaa)|(mzigo|dawa|kifurushi)\s+(\w+\s+){0,2}(nimeupokea|nimeipokea|nimezipokea|nimepokea|nimeupata|nimeipata|nimezipata|imefika|umefika|zimefika)|dawa nimeacha|sijazifungua|i (have )?(received|got) (the|my) (order|parcel|package|medicine))/i,
  media: /(<media omitted>|<attached:|\[image\]|\[document\]|\[video\]|picha imeondolewa|image omitted|document omitted)/i,
  phone: /(\+?255|0)[67]\d{2}[\s-]?\d{3}[\s-]?\d{3}/,
  obj: {
    price: /(ghali|bei kubwa|punguza|discount|expensive|too much|bei ya mwisho|nafuu)/i,
    think: /(nitafikiria|nitakujulisha|nitarudi|ngoja kwanza|baadae|baadaye|nitawaambia|i'?ll think|let me think|get back to you)/i,
    money: /(sina (hela|pesa)|mwisho wa mwezi|mshahara|nikipata (hela|pesa)|no money|when i get paid)/i,
    trust: /(madhara|side effects?|inafanya kazi kweli|ni original|feki|fake|scam|nina wasiwasi|uhakika|ina usalama|presha|kisukari)/i,
    delivery: /(mko wapi|mnapatikana wapi|mnafikisha|mikoani|mkoani|delivery|usafiri|nje ya dar)/i,
  } as Record<string, RegExp>,
};

export function extractAmount(text: string): number {
  const m = text.match(/(?:tsh|tzs|sh\.?|shs)\s*\.?\s*([\d][\d,. ]{2,})|([\d][\d,.]{2,})\s*(?:\/=|tsh|tzs)|\b(\d{1,3}[,.]\d{3}(?:[,.]\d{3})?)\b/i);
  if (!m) return 0;
  const s = (m[1] || m[2] || m[3] || "").trim().replace(/[.,]\d{2}$/, "").replace(/[^\d]/g, "");
  const n = +s;
  return n >= 1000 && n < 100_000_000 ? n : 0;
}

const H = 3600e3;

/** Each business's own wording (workspaces.rule_* columns). Missing = nothing business-specific. */
export type Rules = { delivered?: string[] };

export function analyze(msgs: Msg[], now = Date.now(), rules: Rules = {}) {
  const t = (m: Msg) => Date.parse(m.sent_at);
  const out = {
    first_response_sec: null as number | null,
    price_asked: false, price_shared: false, price_shared_at: null as string | null,
    replied_after_price: false, pay_instructions: false, payment_signal: false,
    payment_amount: null as number | null, objections: [] as string[], followed_up: false,
    warm: false, stage: null as string | null, auto_outcome: "open", label: "new",
  };
  if (!msgs.length) return out;
  const firstIn = msgs.find((m) => m.direction === "in");
  if (firstIn) {
    const fr = msgs.find((m) => m.direction === "out" && t(m) >= t(firstIn));
    if (fr) out.first_response_sec = Math.round((t(fr) - t(firstIn)) / 1000);
  }
  let lastPrice = 0, lastInT: number | null = null, priceT: number | null = null;
  let payInstrT: number | null = null, proof = false, details = false, shipped = false, usage = false, received = false;
  for (const m of msgs) {
    const b = m.body || "";
    if (m.direction === "in") {
      if (SIG.askPrice.test(b)) out.price_asked = true;
      for (const k in SIG.obj) if (SIG.obj[k].test(b) && !out.objections.includes(k)) out.objections.push(k);
      // Questions ("nimepokea dawa lini?") and long forwarded messages (news, scams, chain texts) never count.
      const plain = b.length <= 400 && !/\?\s*$/.test(b.trim()) && !/^\s*(\*|forwarded)/i.test(b);
      if (plain && SIG.received.test(b)) received = true;
      if (payInstrT != null && t(m) - payInstrT < 72 * H) {
        if (SIG.media.test(b) || m.type === "image" || m.type === "document") proof = true;   // likely payment screenshot
        if (SIG.phone.test(b)) details = true;                                                 // delivery details sent
      }
      const afterPay = payInstrT != null && t(m) - payInstrT < 7 * 24 * H;
      if (SIG.mpesaSms.test(b) || (plain && (SIG.paidCustomer.test(b) || (afterPay && SIG.paidCustomerAfterPay.test(b))))) {
        out.payment_signal = true; out.payment_amount = extractAmount(b) || out.payment_amount || lastPrice || null;
      }
      if (priceT != null && t(m) > priceT) out.replied_after_price = true;
      lastInT = t(m);
    } else {
      if (SIG.priceAmount.test(b)) {
        if (!out.price_shared) { out.price_shared_at = m.sent_at; priceT = t(m); }
        out.price_shared = true; lastPrice = extractAmount(b) || lastPrice;
      }
      if (SIG.payInstr.test(b)) payInstrT = t(m);
      if (SIG.shipped.test(b)) shipped = true;
      if (deliveredHit(b, rules.delivered)) usage = true;   // the business's own "goods delivered" texts
      if (SIG.paidBusiness.test(b)) { out.payment_signal = true; out.payment_amount = extractAmount(b) || out.payment_amount || lastPrice || null; }
      if (lastInT != null && t(m) - lastInT >= 12 * H) out.followed_up = true;
    }
    if (SIG.payInstr.test(b)) out.pay_instructions = true;
  }
  // A sale without the word "paid": goods shipped or received, usage explained after payment steps,
  // or a screenshot plus delivery details right after payment instructions.
  if (!out.payment_signal && (received || shipped || (usage && (proof || details || payInstrT != null)) || (proof && details))) {
    out.payment_signal = true; out.payment_amount = out.payment_amount || lastPrice || null;
  }
  const last = msgs[msgs.length - 1];
  const hasOut = msgs.some((m) => m.direction === "out");
  if (out.payment_signal) { out.auto_outcome = "sold"; out.stage = "paid"; }
  else {
    out.auto_outcome = now - t(last) < 48 * H ? "open" : "lost";
    out.stage = !hasOut ? "no_reply" : !out.price_shared ? "before_price" : !out.replied_after_price ? "silent_after_price" : "after_price_talk";
  }
  out.label = out.payment_signal
    ? (usage ? "using" : received ? "received" : shipped ? "shipped" : "paid")
    : payInstrT != null || out.pay_instructions ? "awaiting_payment" : out.price_shared ? "priced" : hasOut ? "talking" : "new";
  out.warm = !out.payment_signal && (out.price_asked || out.pay_instructions || out.objections.length > 0);
  return out;
}
