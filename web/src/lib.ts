import { createClient } from "@supabase/supabase-js";

// Read these before the client starts: it removes the tokens from the address bar when it signs in.
const startHash = typeof location === "undefined" ? "" : location.hash + "&" + location.search;
/** Opened from a "reset password" email. */
export const PASSWORD_RECOVERY = /type=recovery/.test(startHash);
/** Opened from an email link that has expired or was already used. */
export const AUTH_LINK_ERROR = /[#&?]error=|error_code=|error_description=/.test(startHash);

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

export async function callFn<T = any>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try { const j = await (error as any).context?.json?.(); if (j?.error) msg = j.error; } catch { /* keep generic */ }
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

export type Role = "owner" | "admin" | "analyst" | "viewer";
export type Workspace = { id: string; name: string; currency: string; language: "sw" | "en"; unit_cost: number | null; fx_rate: number | null; fx_auto?: boolean; fx_updated_at?: string | null; fx_source?: string | null; fx_base?: string | null;
  timezone: string; follow_up_hours: number; conversion_window_days: number; send_enabled?: boolean; display_currency?: "TZS" | "USD" | null; role?: Role;
  rule_ad_texts?: string[]; rule_loc_question?: string[]; rule_loc_reply?: string[]; rule_paid_texts?: string[];
  // 0059: everything per business
  rule_delivered_texts?: string[]; rule_owner_tick?: boolean; rules_reviewed_at?: string | null;
  brand_color?: string | null; brand_accent?: string | null; brand_town?: string | null; pay_method?: string | null };
export const WS_COLUMNS = "id,name,currency,language,unit_cost,fx_rate,fx_auto,fx_updated_at,fx_source,fx_base,timezone,follow_up_hours,conversion_window_days,send_enabled,display_currency,rule_ad_texts,rule_loc_question,rule_loc_reply,rule_paid_texts,rule_delivered_texts,rule_owner_tick,rules_reviewed_at,brand_color,brand_accent,brand_town,pay_method";
// brand_logo is not loaded with the workspace (it can be ~100 KB): receipts and Settings fetch it when needed.
export const canEdit = (ws: Workspace) => ws.role == null || ws.role !== "viewer";
export const canManage = (ws: Workspace) => ws.role === "owner" || ws.role === "admin";

export type Outcome = {
  id: string; contact_name: string | null; contact_id: string; started_at: string | null; last_message_at: string | null;
  source: string; source_label: string | null; ad_id: string | null; ad_signal?: "meta_tag" | "greeting_card" | "ad_text" | "location_reply" | "owner" | null; first_response_sec: number | null; price_asked: boolean; price_shared: boolean;
  replied_after_price: boolean; payment_signal: boolean; payment_amount: number | null; objections: string[];
  followed_up: boolean; warm: boolean; stage: string | null; auto_outcome: string | null; outcome_override: string | null;
  label: string | null; kito_outcome: string | null; kito_label: string | null; kito_amount: number | null; kito_objections: string[] | null; kito_tags: string[] | null; kito_temp: "hot" | "warm" | "cold" | null; kito_blocker: string | null; last_dir: "in" | "out" | null; kito_summary: string | null; kito_next: string | null; kito_confidence: string | null; kito_checked_at: string | null; kito_error: string | null; outcome: string | null; sale_amount: number | null; sale_provenance: string | null;
  kito_evidence: string[] | null; override_by: string | null; override_at: string | null; override_note: string | null;
  paid_orders: number; first_paid_at: string | null; last_paid_at: string | null; last_out_at: string | null; pay_instructions: boolean;
  not_customer?: boolean; kito_party?: "customer" | "delivery" | "supplier" | "staff" | "personal" | "other" | null; party_decided?: boolean; not_customer_note?: string | null;
  assigned_to?: string | null;   // team member who owns this chat (0033)
};

export type Order = {
  id: string; workspace_id: string; conversation_id: string | null; ad_id: string | null; amount: number; discount: number; refund_amount: number; currency: string;
  status: "pending" | "paid" | "refunded" | "cancelled"; fulfillment_status: "not_applicable" | "not_shipped" | "shipped" | "delivered" | "returned";
  product: string | null; notes: string | null; occurred_at: string; paid_at: string | null; provenance: "manual" | "csv_import" | "provider" | "inferred";
  inferred_from: string | null; external_ref: string | null; created_by: string | null; updated_by: string | null; created_at: string; updated_at: string;
  receipt_no?: string | null;  // our own receipt number (Kumbukumbu Na.), e.g. KH-000123 — given by the database when paid
  payment_ref?: string | null; // the payment's transaction code (M-Pesa etc.) read from the chat
  cost?: number | null;       // what this order cost the business (product + delivery), typed when confirming
  conv_source?: string | null; // source of the linked chat (any start date), joined in by the dashboard
  assigned_to?: string | null; delivery_issue?: string | null; delivery_issue_at?: string | null; delivery_resolved_at?: string | null; // 0033
};
export const orderNet = (o: Pick<Order, "amount" | "discount" | "refund_amount">) => Number(o.amount) - Number(o.discount) - Number(o.refund_amount);

export type Task = {
  id: string; conversation_id: string; title: string; draft: string | null; due_at: string | null; status: "proposed" | "open" | "snoozed" | "done" | "dismissed";
  assigned_to: string | null; snoozed_until: string | null; source: "manual" | "queue" | "kito_promise"; draft_source: "kito" | "manual" | "edited" | null;
  draft_edited_at: string | null; created_by: string | null; created_at: string; updated_at: string; completed_at: string | null;
  // Ahadi (customer promises Kito found; migration 0046)
  kind?: "pay" | "call" | "collect" | "come_back" | "other" | null; promise_text?: string | null; when_text?: string | null;
  promise_at?: string | null; needs_date?: boolean; result?: "paid" | "called" | "no_answer" | "postponed" | "not_interested" | "other" | null;
};

export type AdPerf = {
  ad_id: string; ad_name: string | null; campaign_name: string | null; spend: number; impressions: number; clicks: number; platform_conversations: number;
  chats: number; replied: number; priced: number; payment_signals: number; sold: number; revenue: number; cost_per_sale: number | null;
  /** Meta delivery status (ACTIVE, PAUSED, CAMPAIGN_PAUSED, ...), when the ads sync has stored it. */
  status?: string | null;
};

export const fmt = (n: number | null | undefined) => (n == null || !isFinite(n) ? "–" : Math.round(n).toLocaleString("en-US"));
export const tzs = (n: number | null | undefined) => (n == null || !isFinite(n) ? "–" : "TZS " + fmt(n));
export const pct = (n: number | null | undefined) => (n == null || !isFinite(n) ? "–" : Math.round(n * 100) + "%");
export const dur = (sec: number | null | undefined) =>
  sec == null ? "–" : sec < 3600 ? Math.max(1, Math.round(sec / 60)) + " min" : (sec / 3600).toFixed(1) + " h";
export const median = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const daysAgo = (n: number, tz?: string) => localDay(new Date(Date.now() - n * 864e5), tz);
/** Calendar day (YYYY-MM-DD) of an instant in the workspace timezone. */
export const localDay = (d: Date | string | number, tz = "Africa/Dar_es_Salaam") => {
  const date = typeof d === "string" || typeof d === "number" ? new Date(d) : d;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch { return date.toISOString().slice(0, 10); }
};
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "–");
export const ago = (iso: string | null | undefined) => {
  if (!iso) return "–";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

// Bilingual labels for stored codes
export const L = {
  en: {
    stage: { no_reply: "No reply", before_price: "Left before price", silent_after_price: "Silent after price", after_price_talk: "Stopped after price talk", paid: "Paid" } as Record<string, string>,
    obj: { price: "Price too high", think: "\"I'll think about it\"", money: "No money now", trust: "Trust / safety", delivery: "Location / delivery" } as Record<string, string>,
    outcome: { sold: "Sold", lost: "Lost", open: "Open" } as Record<string, string>,
    tag: { buyer: "Buyer", repeat_buyer: "Repeat buyer", price_sensitive: "Price-sensitive", needs_trust: "Needs trust", far_location: "Far location", pays_on_delivery: "Pays on delivery", slow_decider: "Slow decider", not_serious: "Not serious" } as Record<string, string>,
    temp: { hot: "Hot", warm: "Warm", cold: "Cold" } as Record<string, string>,
    blocker: { price: "Price", think: "Still deciding", money: "No money now", trust: "Needs proof / trust", delivery: "Distance / delivery", business_slow: "We replied late" } as Record<string, string>,
    label: { new: "New", talking: "Talking", priced: "Price given", awaiting_payment: "Awaiting payment", paid: "Paid", shipped: "Shipped", received: "Received", using: "Using product" } as Record<string, string>,
    provenance: { manual: "Confirmed by you", csv_import: "Imported (CSV)", provider: "From provider", inferred: "Inferred" } as Record<string, string>,
    orderStatus: { pending: "Pending", paid: "Paid", refunded: "Refunded", cancelled: "Cancelled" } as Record<string, string>,
    fulfillment: { not_applicable: "–", not_shipped: "Not shipped", shipped: "Shipped", delivered: "Delivered", returned: "Returned" } as Record<string, string>,
  },
  sw: {
    stage: { no_reply: "Hakujibiwa", before_price: "Aliondoka kabla ya bei", silent_after_price: "Kimya baada ya bei", after_price_talk: "Aliacha baada ya bei", paid: "Amelipa" } as Record<string, string>,
    obj: { price: "Bei ni kubwa", think: "\"Nitafikiria\"", money: "Hana pesa sasa", trust: "Wasiwasi / usalama", delivery: "Mahali / usafirishaji" } as Record<string, string>,
    outcome: { sold: "Ameuziwa", lost: "Amepotea", open: "Bado wazi" } as Record<string, string>,
    tag: { buyer: "Mnunuzi", repeat_buyer: "Mnunuzi wa kurudia", price_sensitive: "Anajali bei", needs_trust: "Anahitaji uhakika", far_location: "Yuko mbali", pays_on_delivery: "Analipa akipokea", slow_decider: "Anachelewa kuamua", not_serious: "Hayuko makini" } as Record<string, string>,
    temp: { hot: "Moto", warm: "Vuguvugu", cold: "Baridi" } as Record<string, string>,
    blocker: { price: "Bei", think: "Bado anafikiria", money: "Hana pesa sasa", trust: "Anahitaji uhakika", delivery: "Umbali / usafirishaji", business_slow: "Tulichelewa kujibu" } as Record<string, string>,
    label: { new: "Mpya", talking: "Mazungumzo", priced: "Amepewa bei", awaiting_payment: "Anasubiri malipo", paid: "Amelipa", shipped: "Ametumiwa mzigo", received: "Amepokea", using: "Anatumia dawa" } as Record<string, string>,
    provenance: { manual: "Umethibitisha wewe", csv_import: "Imeingizwa (CSV)", provider: "Kutoka mfumo", inferred: "Makisio" } as Record<string, string>,
    orderStatus: { pending: "Inasubiri", paid: "Imelipwa", refunded: "Imerudishwa pesa", cancelled: "Imefutwa" } as Record<string, string>,
    fulfillment: { not_applicable: "–", not_shipped: "Haijatumwa", shipped: "Imetumwa", delivered: "Imefika", returned: "Imerudishwa" } as Record<string, string>,
  },
};

/** Bare number in a currency's usual precision: whole shillings, cents for dollars. */
export const amt = (n: number | null | undefined, cur: string) =>
  n == null || !isFinite(n) ? "–" : cur === "TZS" || cur === "KES" || cur === "UGX"
    ? Math.round(n).toLocaleString("en-US")
    : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Number with its currency code, e.g. "USD 456.20" or "TZS 170,000". */
export const money = (n: number | null | undefined, cur: string) => (n == null || !isFinite(n) ? "–" : cur + " " + amt(n, cur));

/** The one currency the dashboard shows money in (Settings → Currency), and a converter into it.
 *  fx_rate is "1 USD = fx_rate TZS". Amounts in a currency we can't convert stay as they are. */
export function displayCurrency(ws: Pick<Workspace, "currency" | "display_currency">) { return ws.display_currency ?? ws.currency; }
export function converter(ws: Pick<Workspace, "currency" | "display_currency" | "fx_rate">) {
  const to = displayCurrency(ws);
  const rate = ws.fx_rate ? Number(ws.fx_rate) : null;
  return (n: number | null | undefined, from: string): number | null => {
    if (n == null || !isFinite(n)) return null;
    if (from === to) return n;
    if (!rate) return null;
    if (from === "USD" && to === "TZS") return n * rate;
    if (from === "TZS" && to === "USD") return n / rate;
    return null;
  };
}

/** Money typed into a box, with thousands commas: "175000" → "175,000", "2600.5" stays "2,600.5". Keeps up to 2 decimals. */
export function withCommas(s: string): string {
  const t = s.replace(/[^\d.]/g, "");
  if (t === "") return "";
  const [int, ...rest] = t.split(".");
  const i = int.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return rest.length ? `${i || "0"}.${rest.join("").slice(0, 2)}` : i;
}
/** Free text that may hold prices ("155,000 – 200,000 delivery included"): every number of 4+ digits gets commas. */
export const commaRuns = (s: string) =>
  s.replace(/\d+(?:,\d+)*/g, (m) => { const d = m.replace(/,/g, ""); return d.length >= 4 ? d.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : m; });
/** A number shown in a money box, e.g. a saved price 175000 → "175,000". */
export const moneyText = (n: number | string | null | undefined) => (n == null || n === "" ? "" : withCommas(String(n)));
/** onChange for a money box: formats as you type and keeps the cursor where you were typing. */
export function moneyInput(set: (v: string) => void, format: (s: string) => string = withCommas) {
  return (e: { target: HTMLInputElement }) => {
    const el = e.target, raw = el.value, pos = el.selectionStart ?? raw.length;
    const keep = format === withCommas ? /[\d.]/ : /[^,]/;
    const before = [...raw.slice(0, pos)].filter((c) => keep.test(c)).length;
    const out = format(raw);
    set(out);
    requestAnimationFrame(() => {
      if (document.activeElement !== el) return;
      let i = 0, n = 0;
      while (i < out.length && n < before) { if (keep.test(out[i])) n++; i++; }
      try { el.setSelectionRange(i, i); } catch { /* some input types don't support it */ }
    });
  };
}
