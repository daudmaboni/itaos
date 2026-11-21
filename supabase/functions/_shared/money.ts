// Payment / fulfilment words shared by the word rules (signals.ts) and Kito's "money moment" check.
// Kiswahili + English. Keep them here so both always agree.

// Customer words. Only strong ones: "nimetuma" / "nimekutumia" alone can mean a photo or a location,
// so those count only after you sent payment details (see analyze in signals.ts).
export const paidCustomer = /(\[picha ya malipo\]|nimelipa|nimelipia|nimeshalipia|nimeshalipa|nimeweka (pesa|hela)|nimetuma (pesa|hela|malipo|kiasi)|nimeshatuma (pesa|hela|malipo)|i have paid|i'?ve paid|sent the money)/i;
export const paidCustomerAfterPay = /(nimetuma|nimeshatuma|nimesend|nimekutumia|tayari nimetuma|check (sms|message)|angalia (sms|ujumbe|meseji))/i;
// An M-Pesa / Tigo / Airtel SMS the customer pasted: "XYZ123ABCD Imethibitishwa. Umelipa Tsh155,000…"
export const mpesaSms = /(\b[A-Z0-9]{10}\b\s+(confirmed|imethibitishwa)|umelipa\s+tsh|umetuma\s+tsh|tsh\s*[\d,.]+\s+(sent to|paid to|imetumwa))/i;
export const paidBusiness = /(tumepokea (malipo|pesa|tsh|tzs|sh)|malipo yamepokelewa|tumepokea\b.*\d|payment received|received your payment|asante kwa malipo|mzigo unatoka|order (is )?confirmed)/i;
// Fulfilment language (how sales really look in chat: goods sent, picked up, usage explained)
export const shipped = /((kwenda|kuja|uende|njoo) kuchukua (mzigo|dawa)|mzigo (wako )?(umefika|umetumwa|umeshatumwa|uko njiani|umeondoka|umeshafika|tayari)|tumetuma (mzigo|dawa)|tumeshatuma|your (order|parcel) (has been )?(sent|shipped|dispatched)|out for delivery)/i;
// "Goods delivered" messages (usage instructions and the like) are each business's own wording:
// Settings → How itaOS reads your chats (workspaces.rule_delivered_texts). Nothing product-specific is built in.
const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
/** A business message contains one of that business's "customer has the goods" texts. */
export function deliveredHit(text: string | null | undefined, texts: string[] = []): boolean {
  const t = norm(text ?? "");
  return !!t && texts.some((p) => { const q = norm(p ?? ""); return q.length >= 4 && t.includes(q); });
}

/**
 * A "money moment": a message that may mean a sale just happened, so Kito reads the chat now instead
 * of waiting for it to go quiet. Generous on purpose: a false alarm costs one extra read; a miss only
 * delays the label until the next quiet-window read.
 *  in:  the customer says they paid / sent money, pastes an M-Pesa SMS, or a receipt photo was read
 *       ("[picha ya malipo]"). A customer photo that couldn't be read (no "[picha]" line) counts too.
 *  out: the business confirms payment, ships, or sends one of its own "paid" or "goods delivered" texts.
 */
export function isMoneyMoment(text: string | null | undefined, direction: "in" | "out", paidTexts: string[] = [], type = "text", deliveredTexts: string[] = []): boolean {
  const t = text ?? "";
  if (direction === "in") {
    if ((type === "image" || type === "document") && (t.includes("[picha ya malipo]") || !t.includes("[picha]"))) return true;
    return !!t && (paidCustomer.test(t) || paidCustomerAfterPay.test(t) || mpesaSms.test(t) || /muamala/i.test(t));
  }
  if (!t) return false;
  if (paidBusiness.test(t) || shipped.test(t) || deliveredHit(t, deliveredTexts)) return true;
  const low = t.toLowerCase();
  return paidTexts.some((p) => !!p && p.trim().length >= 4 && low.includes(p.trim().toLowerCase()));
}
