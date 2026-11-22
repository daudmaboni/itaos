// The owner's ✅ (only for businesses with workspaces.rule_owner_tick on): a message the business sends that marks a payment as received becomes a
// confirmed paid order automatically, with no click in itaOS. Two forms are recognised:
//
//   1. A price followed by a tick, in the customer's chat: "175,000✅", "Tsh 175,000 ✅", "175000/= ✅".
//   2. A payment word with a tick: "Umelipiwa✅", "Imelipiwa ✅", "Amelipia✅", "Kalipia✅", "Paid✅".
//      Often this is the order sent to the dispatcher ("Juma … 0788 263 445 … Cleanser, sk … Umelipiwa✅").
//      If the message holds a customer's phone number, the sale is put on THAT customer's chat.
//      The amount is the price in the message, else the customer's receipt from the last 3 days,
//      else the last price the business sent that customer in the last 30 days. No amount → no order.
//   In the customer's own chat, either form counts only when the customer sent a payment message or
//   screenshot in the 3 days before the ✅ (so "175,000✅ ndio bei yetu" is not recorded as a sale).
//   Exception: a bare "price ✅" ("TZS 205,000✅", nothing else) always counts, even with no screenshot —
//   the customer paid at the office, in cash, or the owner checked the wallet — so your ✅ is the
//   record. It counts, with a note saying so.
//
// Checks so the same money never counts twice:
//   - one order per ✅ message (its id is kept in the order's notes);
//   - a receipt's transaction code becomes the order reference, so the same receipt can't be
//     confirmed again by hand or by another tick, and a code already used for a sale is skipped;
//   - a paid order of the same amount for the same customer within 3 days is not repeated
//     (e.g. the same order forwarded to two dispatchers).
// The evidence (receipt matched, amount differs, no proof from the customer) goes into the notes.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const TICK = /(?:✅|✔️|✔|☑️)/u;
const PRICE_TICK = /(?:(?:tsh|tzs|shs?|sh\.)\s*\.?\s*)?(\d{1,3}(?:[,.]\d{3})+|\d{4,9})[ \t]*(?:\/=|\/-|tsh|tzs|shs?)?[ \t]*(?:✅|✔️|✔|☑️)/iu;
const PAID_TICK = /(lipiwa|lipia|lipwa|\blipa\b(?!\s*namba)|amelipa|\bpaid\b)[^\n]{0,20}(?:✅|✔️|✔|☑️)|(?:✅|✔️|✔|☑️)\s*(lipiwa|umelipiwa|imelipiwa|amelipia|\bpaid\b)/iu;
const PRICE = /(?:(?:tsh|tzs|shs?|sh\.)\s*\.?\s*([\d][\d,.]{3,})|([\d][\d,.]{3,})\s*(?:\/=|\/-|tsh|tzs)|\b(\d{1,3}(?:[,.]\d{3})+)\b)/i;
const PHONE = /(?:\+?255|\b0)\s?([67]\d{2})[\s-]?(\d{3})[\s-]?(\d{3})\b/g;

const num = (s: string) => { const n = Number(s.replace(/[^\d]/g, "")); return n >= 500 && n < 100_000_000 ? n : null; };

/** Amount in a "175,000✅" style message, or null. */
export function tickAmount(body: string | null | undefined): number | null {
  const m = body?.match(PRICE_TICK);
  return m ? num(m[1]) : null;
}
/** True for "Umelipiwa✅", "Amelipia ✅", "Paid✅" and the like. */
export function isPaidTick(body: string | null | undefined) {
  const m = body?.match(PAID_TICK);
  return !!m && !/usafiri|nauli/i.test(m[0]);   // "Umelipiwa usafiri✅" = only transport was paid
}
/** Tanzanian phone numbers in a message, as WhatsApp ids (255…). */
export function phonesIn(body: string | null | undefined): string[] {
  return [...new Set([...(body ?? "").matchAll(PHONE)].map((m) => "255" + m[1] + m[2] + m[3]))];
}
/** A price in a message (Tsh 175,000 · 175,000/= · 175,000). Phone numbers are ignored. */
export function priceIn(body: string | null | undefined): number | null {
  const m = (body ?? "").replace(PHONE, " ").match(PRICE);
  return m ? num(m[1] || m[2] || m[3] || "") : null;
}

export type TickMsg = { id: string; direction: "in" | "out"; sent_at: string; body: string | null; type: string; media?: any };
export type Tick = { messageId: string; sentAt: string; body: string; amount: number | null; phones: string[]; kind: "price" | "paid" };

/** ✅ messages from the business that confirm a payment. */
export function findTicks(msgs: TickMsg[]): Tick[] {
  const out: Tick[] = [];
  for (const m of msgs) {
    if (m.direction !== "out" || !m.body || !TICK.test(m.body)) continue;
    const priced = tickAmount(m.body.replace(PHONE, " "));
    const paid = isPaidTick(m.body);
    if (priced == null && !paid) continue;
    out.push({ messageId: m.id, sentAt: m.sent_at, body: m.body, amount: priced ?? priceIn(m.body), phones: phonesIn(m.body), kind: priced != null ? "price" : "paid" });
  }
  return out;
}

const DAY = 864e5;

/** Only a price and a tick, nothing else: "TZS 205,000✅", "175,000 ✅", "175000/= ✅". Pure, for tests. */
export function bareTick(body: string | null | undefined): boolean {
  const b = (body ?? "").trim();
  return PRICE_TICK.test(b) && b.replace(PRICE_TICK, "").replace(/[\s.,!:=\-–✅✔️☑️🙏]+/gu, "") === "";
}
/** Did itaOS see any message from the customer in the 3 days before `at`? */
export function sawCustomer(customerMsgs: TickMsg[], at: string): boolean {
  const t = Date.parse(at);
  return customerMsgs.some((x) => x.direction === "in" && Date.parse(x.sent_at) <= t && t - Date.parse(x.sent_at) <= 3 * DAY);
}
const PAID_WORDS = /(\[picha ya malipo\]|nimetuma|nimelipa|nimelipia|nimeshalipia|nimeshalipa|nimeweka (pesa|hela)|nimesend|nimeshatuma|nimekutumia|\bpaid\b|i have paid|i'?ve (sent|paid)|sent the money|muamala)/i;

/** What the customer's own messages before the ✅ show. Pure, for tests. */
export function evidence(customerMsgs: TickMsg[], at: string, amount: number | null, currency: string) {
  const t = Date.parse(at);
  const before = customerMsgs.filter((x) => x.direction === "in" && Date.parse(x.sent_at) <= t && t - Date.parse(x.sent_at) <= 3 * DAY);
  const receipts = before.map((x) => x.media?.receipt).filter((r) => r?.is_receipt);
  const receipt = (amount != null && receipts.find((r) => r.amount && Math.round(r.amount) === amount)) || receipts[receipts.length - 1] || null;
  const txn = receipt?.txn_code ? String(receipt.txn_code).toUpperCase().replace(/\s+/g, "") : null;
  const fmt = (n: number) => `${currency} ${Math.round(n).toLocaleString("en-US")}`;
  const note = receipt
    ? (amount != null && receipt.amount && Math.round(receipt.amount) !== amount
        ? `⚠ Customer's receipt shows ${fmt(receipt.amount)}, not ${fmt(amount)}.`
        : `Customer's receipt matches${receipt.provider || txn ? ` (${[receipt.provider, txn].filter(Boolean).join(", ")})` : ""}.`)
    : before.some((x) => PAID_WORDS.test(x.body ?? "") || x.type === "image" || x.type === "document")
      ? "Customer said they paid before your ✅."
      : "⚠ No payment message or screenshot from the customer in the 3 days before.";
  return { receiptAmount: receipt?.amount ? Math.round(receipt.amount) : null, txn, note };
}

const TRANSPORT_BEFORE = /(usafiri|nauli|boda|\bbus\b|\bbasi\b|delivery)[^\d\n]{0,15}$/i;
const TRANSPORT_AFTER = /^\s*(\/=|tsh|tzs)?\s*(ya|kwa|ni)?\s*(usafiri|nauli|boda|\bbus\b|\bbasi\b|delivery)/i;
/** The price of the goods in a message: the first amount that isn't a transport cost
 *  ("Usafiri 15,000", "10,000 ya bus"). */
export function goodsPriceIn(body: string | null | undefined): number | null {
  const text = (body ?? "").replace(PHONE, " ");
  for (const m of text.matchAll(new RegExp(PRICE.source, "gi"))) {
    const at = m.index ?? 0;
    if (TRANSPORT_BEFORE.test(text.slice(Math.max(0, at - 25), at)) || TRANSPORT_AFTER.test(text.slice(at + m[0].length, at + m[0].length + 25))) continue;
    const n = num(m[1] || m[2] || m[3] || "");
    if (n) return n;
  }
  return null;
}

/** Last price the business sent in the 30 days before `at`. */
export function lastPriceBefore(msgs: TickMsg[], at: string): number | null {
  const t = Date.parse(at);
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.direction !== "out" || Date.parse(m.sent_at) > t) continue;
    if (t - Date.parse(m.sent_at) > 30 * DAY) break;
    const p = goodsPriceIn(m.body);
    if (p) return p;
  }
  return null;
}

/** Write orders for the ✅ messages in one conversation. Safe to run again. Returns orders created. */
export async function confirmTicks(db: SupabaseClient, conversationId: string, msgs: TickMsg[]) {
  const ticks = findTicks(msgs);
  if (!ticks.length) return 0;
  const { data: conv } = await db.from("conversations").select("workspace_id, contact_id, contacts(wa_id, not_customer), workspaces(currency, rule_owner_tick)").eq("id", conversationId).maybeSingle();
  if (!conv) return 0;
  // Per business (Settings → How itaOS reads your chats): only businesses that mark payments with a ✅ use this.
  if (!(conv as any).workspaces?.rule_owner_tick) return 0;
  const ws = conv.workspace_id as string;
  const currency = (conv as any).workspaces?.currency ?? "TZS";
  const ownWa = (conv as any).contacts?.wa_id as string | undefined;
  const ownNotCustomer = !!(conv as any).contacts?.not_customer;   // e.g. the bodaboda: never a sale on their chat
  let created = 0;
  for (const t of ticks) {
    const { data: done } = await db.from("orders").select("id").eq("workspace_id", ws).like("notes", `%[wamsg:${t.messageId}]%`).limit(1);
    if (done?.length) continue;
    // Whose sale is it? Another customer's phone number in the message moves it to their chat.
    // With several numbers ("0788… 0613…"), use the first one that has a chat with you.
    const others = t.phones.filter((p) => p !== ownWa);
    let other = others[0];
    let target: string | null = conversationId, targetMsgs = msgs, who = "";
    if (other) {
      target = null;
      let name: string | null = null;
      for (const ph of others) {
        const { data: c } = await db.from("contacts").select("id,name,not_customer").eq("workspace_id", ws).eq("wa_id", ph).maybeSingle();
        if (c?.not_customer) continue;   // a number marked "not a customer" is never the buyer
        const { data: cv } = c ? await db.from("conversations").select("id").eq("workspace_id", ws).eq("contact_id", c.id).order("last_message_at", { ascending: false }).limit(1) : { data: null };
        if (cv?.[0]?.id) { target = cv[0].id; other = ph; name = c?.name ?? null; break; }
        name ??= c?.name ?? null;
      }
      who = ` for +${other}${name ? ` (${name.replace(/✅/g, "").trim()})` : ""}`;
      if (target) {
        const { data: tm } = await db.from("messages").select("id,direction,sent_at,body,type,media").eq("conversation_id", target).order("sent_at").limit(2000);
        targetMsgs = (tm as TickMsg[]) ?? [];
      } else targetMsgs = [];
    }
    if (!other && ownNotCustomer) continue;
    const ev = evidence(targetMsgs, t.sentAt, t.amount, currency);
    // "Umelipiwa✅" with no number and no price: only trust it in a chat where the customer
    // showed payment (otherwise it is probably a note to staff, and the amount would be a guess).
    // A ✅ in the customer's own chat counts only if the customer sent a payment message or screenshot
    // in the 3 days before ("175,000✅ ndio bei yetu" is a price, not a payment). Forwarded dispatcher
    // messages that name the customer's number keep working without it (pay on delivery, cash).
    if (!other && ev.note.startsWith("⚠ No payment")) {
      // A bare "price ✅" (nothing else in the message) is the owner saying "I have the money" — they paid
      // at the office, in cash, or the owner checked the wallet — so it counts even with no screenshot.
      // Anything with more words around the price ("175,000✅ ndio bei yetu") still needs proof first.
      if (t.kind !== "price" || !bareTick(t.body)) continue;
      ev.note = sawCustomer(targetMsgs, t.sentAt)
        ? "No screenshot from the customer (paid at the office, cash or checked in your wallet?), so it was counted on your ✅ alone."
        : "⚠ itaOS saw no messages from the customer before your ✅ (paid by phone, cash or an older chat?), so it was counted on your ✅ alone.";
    }
    const amount = t.amount ?? ev.receiptAmount ?? (target ? lastPriceBefore(targetMsgs, t.sentAt) : null);
    if (amount == null) continue;   // nothing says how much: left for the owner to confirm
    // Same customer, same amount, within 3 days → already counted.
    const from = new Date(Date.parse(t.sentAt) - 3 * DAY).toISOString(), to = new Date(Date.parse(t.sentAt) + 3 * DAY).toISOString();
    let q = db.from("orders").select("id").eq("workspace_id", ws).eq("status", "paid").eq("amount", amount).gte("paid_at", from).lte("paid_at", to).limit(1);
    q = target ? q.eq("conversation_id", target) : q.like("notes", `%[phone:${other}]%`);
    const { data: dup } = await q;
    if (dup?.length) continue;
    const ref = ev.txn ? "txn:" + ev.txn : null;
    if (ref) {
      const { data: used } = await db.from("orders").select("id").eq("workspace_id", ws).eq("external_ref", ref).limit(1);
      if (used?.length) continue;   // that receipt already paid for a sale
    }
    const quote = t.body.replace(/\s+/g, " ").trim();
    const { error } = await db.from("orders").insert({
      workspace_id: ws, conversation_id: target, amount, discount: 0, currency,
      status: "paid", fulfillment_status: "not_shipped", occurred_at: t.sentAt, paid_at: t.sentAt,
      provenance: "manual", inferred_from: "tick", external_ref: ref,
      notes: `Auto-confirmed from your ✅ message${who}: "${quote.length > 70 ? quote.slice(0, 67) + "…" : quote}". ${t.amount == null ? (ev.receiptAmount ? "Amount from the customer's receipt. " : "Amount is the last price you sent them. ") : ""}${ev.note} [wamsg:${t.messageId}]${other ? ` [phone:${other}]` : ""}`,
    });
    if (error && error.code !== "23505") throw new Error("could not record ✅ payment: " + error.message);
    if (!error) created++;
  }
  return created;
}
