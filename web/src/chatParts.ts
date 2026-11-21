// Shared pieces of the Chats page: message types and small helpers (moved out of Chats.tsx, unchanged).
import { supabase, Outcome, when, money } from "./lib";
import { type ProductMatch } from "./Products";
import { inferredFrom, kitoChecking } from "./Orders";

export type Source = "any" | "live" | "import";
export type Run = { id: number; trigger: "auto" | "manual"; ran_at: string; checked: number; failed: number; remaining: number; note: string | null };
export type Receipt = { is_receipt: boolean; amount: number | null; currency: string | null; txn_code: string | null; provider: string | null; paid_to: string | null; sender: string | null; paid_at: string | null; confidence: string; notes: string | null };
export type Msg = { id: string; direction: "in" | "out"; sent_at: string; body: string | null; origin: string; type: string;
  /** WhatsApp's delivery report, kept for messages sent from itaOS (wa-webhook) */
  status?: "sent" | "delivered" | "read" | "failed" | null; status_error?: { code?: number | null; title?: string; details?: string } | null;
  media: { path?: string; mime?: string; receipt?: Receipt | null; error?: string; product_match?: ProductMatch | null } | null };
export type Lite = { id: string; outcome: string | null; kito_temp: string | null; warm: boolean; paid_orders: number; payment_signal: boolean; kito_outcome: string | null; kito_confidence?: string | null; outcome_override: string | null; override_by: string | null; phone_number_id: string };
export type Tr = (en: string, sw: string) => string;

/** Group heading for a chat's last message, in the workspace time zone. */
export function timeGroup(iso: string | null, tz: string, T: Tr, now = new Date()): string {
  if (!iso) return T("Older", "Zamani");
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const a = Date.parse(day(new Date(iso)) + "T00:00:00Z"), b = Date.parse(day(now) + "T00:00:00Z");
  const days = Math.round((b - a) / 864e5);
  if (days <= 0) return T("Today", "Leo");
  if (days === 1) return T("Yesterday", "Jana");
  if (days < 7) return T("Earlier this week", "Wiki hii");
  if (days < 30) return T("Earlier this month", "Mwezi huu");
  return T("Older", "Zamani");
}

/** On Android, open the chat in WhatsApp Business (falls back to wa.me if it isn't installed). */
export function waLink(phone: string) {
  const web = `https://wa.me/${phone}`;
  if (typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent))
    return `intent://send/?phone=${phone}#Intent;scheme=whatsapp;package=com.whatsapp.w4b;S.browser_fallback_url=${encodeURIComponent(web)};end`;
  return web;
}

/** "3 min ago" / "dakika 3 zilizopita" */
export function agoT(iso: string | null, T: Tr) {
  if (!iso) return "";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return T("just now", "sasa hivi");
  if (m < 60) return T(`${m} min ago`, `dakika ${m} zilizopita`);
  if (m < 48 * 60) { const h = Math.round(m / 60); return T(`${h} h ago`, `saa ${h} zilizopita`); }
  const d = Math.round(m / 1440); return T(`${d} days ago`, `siku ${d} zilizopita`);
}

export type Status = { key: string; text: string; tone: "good" | "warn" | "bad" | "info" | "muted"; icon: string };
/** Where this customer stands, in one plain sentence. Order matters: the most useful truth wins. */
export function statusOf(r: Outcome, T: Tr, currency: string): Status {
  // Marked "not a customer" (you, staff, delivery, supplier…): out of labelling for good, whatever the chat says.
  if (r.not_customer) return { key: "not_customer", icon: "⊘", tone: "muted", text: T("Not a customer", "Si mteja") };
  if (Number(r.paid_orders) > 0) return { key: "bought", icon: "✓", tone: "good", text: T("Bought", "Amenunua") + (r.sale_amount != null ? ` · ${money(Number(r.sale_amount), currency)}` : "") };
  if (inferredFrom(r)) return { key: "check", icon: "!", tone: "warn", text: T("Says they paid — check your money came in", "Anasema amelipa — hakikisha pesa imeingia") };
  if (kitoChecking(r)) return { key: "kito_check", icon: "…", tone: "info", text: T("Kito is reading this chat for a payment", "Kito anasoma chat hii kuona malipo") };
  if (r.outcome === "lost") return { key: "lost", icon: "×", tone: "muted", text: T("Didn't buy", "Hakununua") };
  if (r.last_dir === "in" && !r.last_in_closing) return { key: "waiting", icon: "●", tone: "bad", text: T("Waiting for your reply", "Anasubiri umjibu") };
  if (r.pay_instructions) return { key: "paynum", icon: "●", tone: "info", text: T("Has your payment number, hasn't paid yet", "Ana namba ya malipo, bado hajalipa") };
  if (r.price_shared) return { key: "priced", icon: "●", tone: "info", text: T("Got the price, still deciding", "Amepata bei, bado anaamua") };
  return { key: "new", icon: "●", tone: "info", text: T("Just started talking", "Ndio ameanza kuongea") };
}

/** Kito's reading is older than the chat's last message (the customer wrote again since). */
export const kitoStale = (r: Outcome) => !!r.last_message_at && (r.kito_checked_at
  ? Date.parse(r.last_message_at) > Date.parse(r.kito_checked_at)
  : Date.now() - Date.parse(r.last_message_at) < 3600e3);   // new chat Kito hasn't read yet
export const interest = (r: Outcome): "hot" | "warm" | "cold" | null => (kitoStale(r) ? null : r.kito_temp) ?? (r.warm ? "warm" : null);
export const phoneOf = (waId: string | undefined) => (waId && /^\+?\d{9,15}$/.test(waId) ? waId.replace(/\D/g, "") : null);

export const PARTY: Record<string, [string, string]> = {
  delivery: ["a delivery person (bodaboda, bus, courier)", "msafirishaji (bodaboda, basi, courier)"],
  supplier: ["a supplier", "msambazaji"], staff: ["someone who works with you", "mfanyakazi wako"],
  personal: ["family or a friend", "familia au rafiki"], other: ["not a buyer", "si mnunuzi"],
};
export async function markNotCustomer(r: Outcome, value: boolean, note?: string | null) {
  const { error } = await supabase.rpc("set_not_customer", { p_contact: r.contact_id, p_value: value, p_note: note ?? null });
  if (error) alert(error.message);
}

export const nameOf = (r: Outcome, T: Tr) => (r.contact_name ?? "").replace(/✅/g, "").trim() || T("Customer", "Mteja");
export const fromOf = (r: Outcome, T: Tr, adName?: string) => r.source === "ad"
  ? (adName || r.source_label ? T(`From the ad "${adName ?? r.source_label}"`, `Kutoka tangazo "${adName ?? r.source_label}"`)
    : r.ad_signal === "greeting_card" ? T("From an ad (opened with your ad greeting)", "Kutoka tangazo (ilianza na salamu ya tangazo)")
    : r.ad_signal === "ad_text" ? T("From an ad (sent the ad's ready-made message)", "Kutoka tangazo (alituma ujumbe tayari wa tangazo)")
    : r.ad_signal === "location_reply" ? T("From an ad (got the location reply you only give people who saw your ad)", "Kutoka tangazo (alipata jibu la mahali unalowapa walioona tangazo lako tu)")
    : r.ad_signal === "owner" ? T("From an ad (you set this)", "Kutoka tangazo (umeweka wewe)")
    : T("From an ad", "Kutoka tangazo"))
  : r.source_label ? T(`From ${r.source_label}`, `Kutoka ${r.source_label}`)
  : r.source === "organic" && r.ad_signal === "owner" ? T("Not from an ad (you set this)", "Si kutoka tangazo (umeweka wewe)")
  : r.source === "organic" ? T("Messaged you directly", "Alikutumia ujumbe moja kwa moja") : T("Source unknown", "Chanzo hakijulikani");
export const prettyPhone = (p: string) => (p.length === 12 && p.startsWith("255") ? `+255 ${p.slice(3, 6)} ${p.slice(6, 9)} ${p.slice(9)}` : "+" + p);

/** Messages WhatsApp never gave us: shown as a small note, not a bubble. */
export function hiddenNote(m: Msg): "media" | "other" | null {
  const b = (m.body ?? "").trim();
  if (m.type === "media_placeholder" || b === "[media_placeholder]") return "media";
  if (m.type === "errors" || b === "[errors]" || m.type === "unsupported") return "other";
  return null;
}

/** WhatsApp gives no text for some messages: show what they are instead of "[errors]". */
export function special(m: Msg): string | null {
  const b = (m.body ?? "").trim();
  if (m.type === "audio" || b === "[voice note]") return "🎤 Voice message · not saved, can't play here";
  if (m.type === "errors" || b === "[errors]" || m.type === "unsupported") return "⚠ Message WhatsApp didn't share (e.g. a poll, view-once or a newer message type)";
  if (m.type === "sticker" || b === "[sticker]") return "🙂 Sticker";
  if (m.type === "video" && b === "[video]") return "🎬 Video";
  if (m.type === "media_placeholder" || b === "[media_placeholder]") return "📎 Photo, voice note or file from an older chat (WhatsApp didn't share it)";
  if (m.type === "image" && b === "[image]") return "🖼 Photo (not saved)";
  if (m.type === "document" && b === "[document]") return "📄 Document (not saved)";
  if (m.type === "location" || b === "[location]") return "📍 Location";
  if (m.type === "contacts" || b === "[contacts]") return "👤 Contact card";
  return null;
}

export function whySource(r: Outcome, T: Tr) {
  if (Number(r.paid_orders) > 0) return T("You recorded a sale for this customer.", "Umerekodi mauzo kwa mteja huyu.");
  if (r.outcome_override) return r.override_by ? T(`You set this yourself${r.override_at ? " on " + when(r.override_at) : ""}.`, `Umeweka hili mwenyewe${r.override_at ? " " + when(r.override_at) : ""}.`) : T("There is a ✅ in the saved contact name.", "Kuna ✅ kwenye jina la mteja.");
  if (r.kito_outcome && (r.kito_confidence === "high" || r.kito_confidence === "medium")) return T("Kito read the chat and decided.", "Kito amesoma chat na kuamua.");
  if (r.auto_outcome === "open" && r.last_message_at && Date.now() - Date.parse(r.last_message_at) > 2 * 864e5) return T("No messages for 2+ days, so it counts as didn't buy.", "Hakuna ujumbe siku 2+, kwa hiyo inahesabiwa hakununua.");
  return T("Based on words in the chat (Kito wasn't sure).", "Kutokana na maneno kwenye chat (Kito hakuwa na uhakika).");
}

export function lostWhy(why: string, T: Tr) {
  const m: Record<string, [string, string]> = {
    price: ["said the price is too high", "alisema bei ni kubwa"], think: ["said they'd think about it", "alisema atafikiria"],
    money: ["no money right now", "hana pesa kwa sasa"], trust: ["wasn't sure to trust it yet", "hakuwa na uhakika bado"],
    delivery: ["too far / delivery problem", "yuko mbali / usafirishaji"], business_slow: ["we replied too late", "tulichelewa kujibu"],
  };
  return m[why] ? T(m[why][0], m[why][1]) : why;
}

/** The price the business last sent in the chat, e.g. "155,000" or "Ni TSh 35,000" → 155000. */
export function lastPriceSent(msgs: Msg[] | null): number | null {
  for (const m of [...(msgs ?? [])].reverse()) {
    if (m.direction !== "out" || !m.body) continue;
    const nums = [...m.body.replace(/(\+?255|0)[67]\d{2}[ -]?\d{3}[ -]?\d{3}/g, "").replace(/\d{7,}/g, "").matchAll(/(\d{1,3}(?:[,.\s]\d{3})+|(?<![\d,.])\d{4,6})(?![\d,.]?\d)/g)]
      .map((x) => Number(x[1].replace(/[,.\s]/g, ""))).filter((n) => n >= 500 && n <= 50_000_000);
    if (nums.length) return nums[nums.length - 1];
  }
  return null;
}
