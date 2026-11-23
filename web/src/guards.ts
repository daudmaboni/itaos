// Pure rules and words for the three guards (migration 0079): Fake payment guard, Why people didn't buy,
// Staff leak guard. Kept free of React and Supabase so they can be tested.

export type Flag = "reused" | "receiver" | "wallet" | "amount" | "date" | "edited";
export type PayItem = {
  message_id: string; conversation_id: string; contact_name: string | null; sent_at: string; amount: number | null; txn_code: string | null;
  provider: string | null; paid_to: string | null; paid_at_text: string | null; confidence: string | null; notes: string | null;
  flags: Flag[]; severity: "red" | "amber" | "ok"; expected: number | null; other_conversation_id: string | null;
  verdict: "ok" | "fake" | null; reviewed_at: string | null;
};
export type PayRes = {
  days: number; receivers: string[]; checked: number; to_check: number; to_check_red: number; fakes: number; fakes_amount: number;
  statement: { from: string | null; to: string | null } | null; suggest: { paid_to: string; n: number }[]; items: PayItem[];
};

type TT = (en: string, sw: string) => string;

/** One plain sentence per flag. */
export function flagText(f: Flag, it: PayItem, T: TT, M: (n: number | null | undefined) => string): string {
  switch (f) {
    case "reused": return T("This payment code is already on another customer's screenshot or sale. The same receipt sent twice.", "Namba hii ya muamala iko tayari kwenye picha au mauzo ya mteja mwingine. Risiti ileile imetumwa mara mbili.");
    case "receiver": return T(`Paid to “${it.paid_to ?? "?"}”, which is not one of your payment numbers.`, `Imelipwa kwa “${it.paid_to ?? "?"}”, ambayo si namba yako ya malipo.`);
    case "wallet": return T("Your M-Pesa statement covers this time but has no such payment.", "Taarifa yako ya M-Pesa inafunika muda huu lakini haina malipo haya.");
    case "amount": return T(`The screenshots add up to ${M(it.amount)}, less than the ${M(it.expected)} agreed.`, `Picha zinafikia ${M(it.amount)}, chini ya ${M(it.expected)} mlizokubaliana.`);
    case "date": return T(`The date on it (${it.paid_at_text ?? "?"}) doesn't match the day it was sent. It may be an old receipt.`, `Tarehe iliyo juu yake (${it.paid_at_text ?? "?"}) hailingani na siku ilipotumwa. Huenda ni risiti ya zamani.`);
    case "edited": return T("Kito saw signs the picture may have been edited.", "Kito ameona dalili kwamba picha huenda imehaririwa.");
  }
}

export const flagShort = (f: Flag, T: TT) => ({
  reused: T("Code used before", "Muamala umeshatumika"), receiver: T("Wrong receiver", "Mpokeaji mwingine"),
  wallet: T("Not in your M-Pesa", "Haipo kwenye M-Pesa yako"), amount: T("Amount too low", "Kiasi pungufu"),
  date: T("Old date", "Tarehe ya zamani"), edited: T("May be edited", "Huenda imehaririwa"),
}[f]);

/**
 * Payment numbers to suggest from what customers' screenshots show: the number in each receiver (Lipa namba,
 * till, phone), deduplicated, most common first, skipping masked ones (****0266) and ones already listed.
 */
export function receiverSuggestions(seen: { paid_to: string; n: number }[], listed: string[]): { num: string; label: string; n: number }[] {
  const norm = (s: string) => s.replace(/\D/g, "").replace(/^255/, "").replace(/^0+/, "");
  const have = new Set(listed.map(norm).filter((x) => x.length >= 5));
  const by = new Map<string, { num: string; label: string; n: number }>();
  for (const s of seen) {
    if (/\*{2,}/.test(s.paid_to)) continue;
    const m = s.paid_to.match(/(?:\+?255|0)?\d[\d ]{4,12}\d/g);
    if (!m) continue;
    const raw = m.map((x) => x.replace(/\s/g, "")).sort((a, b) => b.length - a.length)[0]!;
    const k = norm(raw);
    if (k.length < 5 || have.has(k)) continue;
    const label = s.paid_to.replace(m[0]!, "").replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
    const cur = by.get(k);
    if (cur) cur.n += s.n;
    else by.set(k, { num: raw, label, n: s.n });
  }
  return [...by.values()].sort((a, b) => b.n - a.n);
}

// ---------- Why people didn't buy ----------
export type Reason = "no_reply" | "business_slow" | "quiet_before_price" | "quiet_after_price" | "price" | "money" | "think" | "trust" | "delivery" | "not_serious" | "unknown";
export type LostRes = {
  days: number; chats: number; lost: number; sold: number; avg_sale: number | null; close_rate: number | null;
  reasons: { reason: Reason; n: number; after_price: number; from_ads: number; prev: number; examples: { id: string; name: string | null; summary: string | null; at: string }[] | null; ids: string[] | null }[];
  by_ad: { ad_id: string; name: string | null; lost: number; top: Reason; top_n: number }[];
};

export function reasonLabel(r: Reason, T: TT): string {
  return {
    no_reply: T("Never got an answer", "Hawakujibiwa kabisa"),
    business_slow: T("Our reply took over an hour", "Tulichelewa kujibu (zaidi ya saa 1)"),
    quiet_before_price: T("Went quiet before the price", "Walinyamaza kabla ya bei"),
    quiet_after_price: T("Went quiet after the price", "Walinyamaza baada ya bei"),
    price: T("Price too high", "Bei kubwa"),
    money: T("No money right now", "Hawana pesa sasa"),
    think: T("Still thinking", "Bado wanafikiria"),
    trust: T("Needed proof it works", "Walihitaji uhakika"),
    delivery: T("Distance or delivery", "Umbali au usafirishaji"),
    not_serious: T("Just asking", "Waliuliza tu"),
    unknown: T("No reason given", "Hakuna sababu"),
  }[r];
}

/** What to do about each reason: one or two practical sentences. */
export function reasonAdvice(r: Reason, T: TT): string {
  return {
    no_reply: T("These customers wrote and nobody answered. Answer them from Today now, and turn on phone alerts so new ones don't wait.",
      "Wateja hawa waliandika na hakuna aliyejibu. Wajibu kutoka Leo sasa, na washa arifa za simu ili wapya wasisubiri."),
    business_slow: T("A reply after an hour loses most ad customers. Answer within 15 minutes: share the work with someone, or keep a ready first reply with the price and a photo.",
      "Jibu baada ya saa moja linapoteza wateja wengi wa matangazo. Jibu ndani ya dakika 15: gawana kazi na mtu, au weka jibu la kwanza tayari lenye bei na picha."),
    quiet_before_price: T("They asked, then left before hearing the price. Put the price and what they get in your first reply, and end it with a question.",
      "Waliuliza, kisha wakaondoka kabla ya kusikia bei. Weka bei na wanachopata kwenye jibu la kwanza, na umalizie kwa swali."),
    quiet_after_price: T("They heard the price and went quiet. Follow up once from Actions → After price, with a short customer result or a voice note.",
      "Walisikia bei wakanyamaza. Fuatilia mara moja kutoka Vitendo → Baada ya bei, kwa matokeo mafupi ya mteja au ujumbe wa sauti."),
    price: T("Show the result before the price, offer a smaller pack, or let them pay in two parts.",
      "Onyesha matokeo kabla ya bei, toa pakiti ndogo, au waruhusu kulipa mara mbili."),
    money: T("Ask when they get paid and save it as a promise. Today reminds you on that day.",
      "Uliza lini watapata pesa na uhifadhi kama ahadi. Leo itakukumbusha siku hiyo."),
    think: T("Send one short testimonial or before-and-after story within a day, then ask one easy question.",
      "Tuma ushuhuda mmoja mfupi au hadithi ya kabla na baada ndani ya siku moja, kisha uliza swali moja rahisi."),
    trust: T("Share real customer results, your registration, and photos of parcels going out. Offer pay-on-delivery where you can.",
      "Shiriki matokeo ya wateja halisi, usajili wako, na picha za mizigo ikitoka. Toa malipo baada ya kupokea pale unapoweza."),
    delivery: T("Say the delivery cost and days for their region up front, and name the bus company you use.",
      "Taja gharama na siku za usafiri kwa mkoa wao mapema, na utaje kampuni ya basi unayotumia."),
    not_serious: T("Don't spend time here. If many come from one ad, that ad is reaching the wrong people.",
      "Usipoteze muda hapa. Kama wengi wanatoka tangazo moja, tangazo hilo linafikia watu wasio sahihi."),
    unknown: T("They left without saying why. One follow-up after the price brings some back.",
      "Waliondoka bila kusema kwa nini. Ufuatiliaji mmoja baada ya bei unarudisha baadhi."),
  }[r];
}

/**
 * Rough value of winning back 1 in 10 of a reason's customers: n × 10% × average sale. Only when there is an
 * average sale to go on; rounded so it reads as an estimate.
 */
export function worth(n: number, avgSale: number | null): number | null {
  if (!avgSale || avgSale <= 0 || n <= 0) return null;
  const v = Math.round(n * 0.1) * avgSale;
  if (v <= 0) return null;
  const step = v >= 1e6 ? 1e5 : v >= 1e5 ? 1e4 : 1e3;   // an estimate: 13,097,370 → 13,100,000
  return Math.round(v / step) * step;
}

/** Show "was N" only when the earlier period was read by Kito about as fully as this one. */
export function trendOk(res: LostRes): boolean {
  const prev = res.reasons.reduce((s, r) => s + r.prev, 0);
  return res.lost > 0 && prev >= res.lost * 0.5;
}

// ---------- Staff leak guard ----------
export type LeakRes = {
  days: number; receivers_set: boolean; team: number; phone_messages: number;
  numbers: { flag: "pay_number" | "personal_number"; num: string; n: number; chats: number; first_at: string; last_at: string; conv_ids: string[]; sample: string; senders: string[] | null; verdict: "ok" | "leak" | null }[];
  paid_elsewhere: { paid_to: string; n: number; amount: number | null; conv_ids: string[]; last_at: string }[];
  unrecorded: number; unrecorded_amount: number;
  unrecorded_items: { id: string; name: string | null; at: string; amount: number | null; why: "kito" | "words" | "screenshot"; assigned: string | null }[];
  people: { id: string; name: string; role: string; assigned: number; bought: number; sent: number; reply_min: number | null; flags: number }[];
};

/** 0652729457 → 0652 729 457; leaves tills and short numbers as they are. */
export function prettyNum(n: string): string {
  const d = n.replace(/\D/g, "");
  if (/^[67]\d{8}$/.test(d)) return `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  return d;
}

/** How many open (not yet decided) problems the leak guard shows. */
export function openLeaks(r: LeakRes): number {
  return r.numbers.filter((x) => !x.verdict).length + r.paid_elsewhere.length + r.unrecorded;
}
