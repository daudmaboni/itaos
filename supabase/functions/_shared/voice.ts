// How Kito's WhatsApp drafts must sound (26 Nov 2026): like the owner texting a customer, not like AI.
// Shared by kito (draft_reply) and reorder. Rules adapted from the humanizer skill for short chat messages,
// plus the customer's-language rule: the draft the owner sends is in the language the customer writes in.

export const VOICE_RULES = `How the message must sound (very important, the owner will send it as their own):
- Write like the owner texting on WhatsApp from their phone. Copy how the business already writes in this chat (BIASHARA lines): their greeting, spelling, word choice, length, emoji habit. If they write "Karibu sana" or "Sawa boss", you may too.
- Short. 1 to 3 sentences, under about 45 words. One clear question or next step at the end, not two.
- Say the thing directly. No run-up ("Asante kwa kuwasiliana nasi", "Tunashukuru kwa ujumbe wako", "Thank you for reaching out", "I hope this message finds you well").
- No formal or advert words: not "mpendwa mteja", "ndugu mteja wetu", "tunakuhakikishia", "huduma bora", "bidhaa zetu bora", "valued customer", "we are committed", "premium", "amazing".
- No "not X but Y" contrasts, no lists of three for effect, no slogans, no exclamation marks stacked (one at most), at most one emoji and only if the business uses emojis.
- No dashes (— or –), no bullet points, no bold, no quotation marks around the message, no sign-off with the business name.
- Natural Tanzanian Kiswahili the way people really text in Dar (sheng-light, mixing a common English word like "order" or "delivery" is fine). Never stiff, translated-sounding Kiswahili.
- Do not repeat back what the customer said. Answer it.`;

/** The language the customer writes in, from their own messages (used when the model doesn't say). */
export function customerLang(msgs: { direction: string; body?: string | null }[]): "sw" | "en" {
  const theirs = msgs.filter((m) => m.direction === "in" && m.body).map((m) => String(m.body)).join(" ").toLowerCase();
  const sw = (theirs.match(/\b(habari|bei|naomba|nataka|ngapi|asante|sawa|mnapatikana|wapi|dawa|nina|una|kwa|na|ya|ni|je|gani|shilingi|mzigo|nitumie|mambo|poa|nimetuma|kesho|leo|nipo|niko|vipi)\b/g) ?? []).length;
  const en = (theirs.match(/\b(the|is|how|much|price|want|please|where|you|can|deliver|thanks|hello|what|do|have|i|my|it|this|send)\b/g) ?? []).length;
  return en > sw * 1.5 ? "en" : "sw";
}

/** Last clean-up of a draft: AI punctuation out, whitespace tidy. Never changes the words otherwise. */
export function tidy(s: unknown, max = 1200): string {
  return String(s ?? "")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s--\s/g, ", ")
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^["']|["']$/g, "")
    .replace(/!{2,}/g, "!")
    .replace(/,\s*,/g, ",")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, max);
}
