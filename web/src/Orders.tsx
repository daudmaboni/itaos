// Orders for one chat: record, correct, reverse. Every change is audited by the database.
import { errText } from "./errText";
import { askConfirm } from "./confirmAsk";
import ReceiptPrint from "./ReceiptPrint";
import { useEffect, useState } from "react";
import { supabase, Workspace, Order, Outcome, L, amt, when, orderNet, canEdit, moneyInput, moneyText } from "./lib";
import { AssignSelect } from "./team";
import { useProducts, ProductPicker, itemsCost, itemsLabel, type Item } from "./Products";

type Ev = { id: number; action: string; actor: string | null; at: string; before: any; after: any };

/** The owner answered "money did not come in" (or "didn't buy"): stop treating the chat as a payment to check. */
export const signalDismissed = (r: Pick<Outcome, "override_by" | "outcome_override">) =>
  !!r.override_by && (r.outcome_override === "open" || r.outcome_override === "lost");

/** "Says they paid — check your money": only when Kito read the chat and judged the customer really paid
 *  (or you marked them ✅ in the contact name). Word rules alone never decide: a hit only makes Kito read
 *  that chat first (see kitoChecking). */
export function inferredFrom(r: Outcome): "kito" | "name_mark" | null {
  if (signalDismissed(r)) return null;
  if (r.kito_outcome === "sold" && r.kito_confidence !== "low") return "kito";
  if (r.outcome_override === "sold") return "name_mark";
  return null;
}

/** The word rules saw payment-like words that Kito hasn't judged yet (never read, or new messages since). */
export const kitoChecking = (r: Pick<Outcome, "payment_signal" | "kito_checked_at" | "last_message_at" | "kito_outcome"> & Partial<Outcome>) =>
  !!r.payment_signal && !(r.override_by && (r.outcome_override === "open" || r.outcome_override === "lost")) && Number(r.paid_orders ?? 0) === 0
  && (!r.kito_checked_at || (!!r.last_message_at && Date.parse(r.last_message_at) > Date.parse(r.kito_checked_at)));

/** When the customer paid, read from the chat (database function payment_moment): their receipt or
 *  M-Pesa SMS, "nimetuma", your "Tuma majina ya mpokeaji", or the first usage instructions — never the
 *  moment you press the button. Returned as local "YYYY-MM-DDTHH:mm" for a datetime input. */
export type PayMoment = { at: string; kind: "payment_message" | "kayatox" | "receipt" | "owner_tick" | "customer_said_paid" | "business_confirmed" | "goods_received" | "last_message"; snippet: string };
export function usePaymentMoment(conversationId: string) {
  const [pm, setPm] = useState<PayMoment | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    supabase.rpc("payment_moment", { p_conv: conversationId }).then(({ data, error }) => {
      if (!live) return;
      const row = !error && Array.isArray(data) ? (data[0] as PayMoment | undefined) : undefined;
      setPm(row ?? null);
    });
    return () => { live = false; };
  }, [conversationId]);
  return pm;
}
/** ISO time → "YYYY-MM-DDTHH:mm" in East Africa time (what a datetime-local input shows). */
export const toLocalInput = (iso: string) => new Date(Date.parse(iso) + 3 * 3600e3).toISOString().slice(0, 16);
/** "YYYY-MM-DDTHH:mm" in East Africa time → ISO. */
export const fromLocalInput = (v: string) => new Date(v + ":00+03:00").toISOString();
export function momentWhy(kind: PayMoment["kind"], T: (en: string, sw: string) => string) {
  // "payment_message" = one of the business's own "customer has paid" texts (Settings → Rules & rates). "kayatox" is its old name.
  return kind === "payment_message" || kind === "kayatox" ? T("your after-payment message (Settings → Rules), sent the day they paid", "ujumbe wako wa baada ya malipo (Mipangilio → Kanuni), uliotumwa siku aliyolipa")
    : kind === "owner_tick" ? T("your price ✅ message", "ujumbe wako wa bei ✅")
    : kind === "receipt" ? T("the customer's receipt / M-Pesa message", "risiti / ujumbe wa M-Pesa wa mteja")
    : kind === "customer_said_paid" ? T("a payment message in the chat (no after-payment message, screenshot or ✅ found)", "ujumbe wa malipo kwenye chat (hakuna ujumbe wa baada ya malipo, picha ya malipo wala ✅)")
    : kind === "business_confirmed" ? T("your message right after payment", "ujumbe wako baada ya malipo")
    : kind === "goods_received" ? T("your after-delivery message (Settings → Rules), sent the day they paid", "ujumbe wako wa baada ya kupata bidhaa (Mipangilio → Kanuni), uliotumwa siku aliyolipa")
    : T("the customer's last message (no payment message found)", "ujumbe wa mwisho wa mteja (hakuna ujumbe wa malipo)");
}

export function OrderForm({ ws, r, onDone, onCancel }: { ws: Workspace; r: Outcome; onDone: () => void; onCancel: () => void }) {
  const lang = ws.language; const T = (en: string, sw: string) => (lang === "sw" ? sw : en);
  const [amount, setAmount] = useState(String(r.kito_amount ?? r.payment_amount ?? ""));
  const [discount, setDiscount] = useState("");
  const pm = usePaymentMoment(r.id);
  const [date, setDate] = useState("");
  useEffect(() => { if (!date && pm !== undefined) setDate(toLocalInput(pm?.at ?? r.last_message_at ?? new Date().toISOString())); }, [pm]);
  const [cost, setCost] = useState("");
  const [product, setProduct] = useState("");
  const { products } = useProducts(ws.id);
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => { const c = itemsCost(items); if (c != null) setCost(moneyText(c)); if (items.length) setProduct(itemsLabel(items)); }, [items]);
  const [status, setStatus] = useState<Order["status"]>("paid");
  const [fulfil, setFulfil] = useState<Order["fulfillment_status"]>("not_applicable");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const a = Number(amount.replace(/[^\d.]/g, "")), d = discount ? Number(discount.replace(/[^\d.]/g, "")) : 0;
    if (!(a >= 0) || !isFinite(a)) return setErr(T("Enter the amount.", "Weka kiasi."));
    if (!(d >= 0) || d > a) return setErr(T("Discount must be between 0 and the amount.", "Punguzo liwe kati ya 0 na kiasi."));
    if (!date || Date.parse(fromLocalInput(date)) > Date.now() + 864e5) return setErr(T("Enter a valid date.", "Weka tarehe sahihi."));
    const c = cost.trim() ? Number(cost.replace(/[^\d.]/g, "")) : null;
    if (c != null && !(c >= 0)) return setErr(T("Cost must be a number.", "Gharama iwe namba."));
    setBusy(true); setErr("");
    const occurred = fromLocalInput(date);
    if (status === "paid") {   // same payment twice (same chat, same amount, within an hour) is refused
      const t = Date.parse(occurred);
      const { data: twin } = await supabase.from("orders").select("id").eq("workspace_id", ws.id).eq("conversation_id", r.id).eq("status", "paid").eq("amount", a)
        .gte("paid_at", new Date(t - 3600e3).toISOString()).lte("paid_at", new Date(t + 3600e3).toISOString()).limit(1);
      if (twin?.length) { setBusy(false); return setErr(T("This payment is already saved for this customer.", "Malipo haya tayari yamehifadhiwa kwa mteja huyu.")); }
    }
    const { data: user } = await supabase.auth.getUser();
    const { error } = await supabase.from("orders").insert({
      workspace_id: ws.id, conversation_id: r.id, amount: a, discount: d, currency: ws.currency, status, fulfillment_status: fulfil,
      product: product.trim() || null, notes: notes.trim() || null, occurred_at: occurred, paid_at: status === "paid" ? occurred : null,
      provenance: "manual", inferred_from: inferredFrom(r), created_by: user.user?.id, cost: c, items,
    });
    setBusy(false);
    if (error) setErr(errText(error)); else onDone();
  }
  return (
    <form className="card" style={{ background: "var(--paper)", gap: 8 }} onSubmit={save}>
      <b>{T("Record an order for this chat", "Rekodi oda ya chat hii")}</b>
      {inferredFrom(r) && <span className="small muted">{T("A payment was inferred from the chat. Recording it here is what makes it a confirmed sale.", "Malipo yalikisiwa kutoka chat. Kuyarekodi hapa ndiko kunayafanya kuwa mauzo yaliyothibitishwa.")}</span>}
      {products && products.some((p) => p.active) && <ProductPicker ws={ws} products={products} items={items} onChange={setItems} T={T} />}
      <div className="map">
        <label>{T("Amount", "Kiasi")} ({ws.currency})<input inputMode="decimal" required value={amount} onChange={moneyInput(setAmount)} /></label>
        <label>{T("Discount", "Punguzo")}<input inputMode="decimal" value={discount} onChange={moneyInput(setDiscount)} placeholder="0" /></label>
        <label>{T("Paid on", "Alilipa lini")}<input type="datetime-local" required value={date} onChange={(e) => setDate(e.target.value)} />{pm && <span className="small muted">{T("From", "Kutoka")} {momentWhy(pm.kind, T)}</span>}</label>
        <label>{T("Cost of this order", "Gharama ya oda hii")} ({ws.currency})<input inputMode="decimal" value={cost} onChange={moneyInput(setCost)} placeholder={T("product + delivery", "bidhaa + usafiri")} /></label>
        <label>{T("Status", "Hali")}<select value={status} onChange={(e) => setStatus(e.target.value as any)}>{(["paid", "pending", "refunded", "cancelled"] as const).map((s) => <option key={s} value={s}>{L[lang].orderStatus[s]}</option>)}</select></label>
        <label>{T("Delivery", "Usafirishaji")}<select value={fulfil} onChange={(e) => setFulfil(e.target.value as any)}>{(["not_applicable", "not_shipped", "shipped", "delivered", "returned"] as const).map((s) => <option key={s} value={s}>{L[lang].fulfillment[s]}</option>)}</select></label>
        <label>{T("Product (optional)", "Bidhaa (si lazima)")}<input value={product} onChange={(e) => setProduct(e.target.value)} /></label>
        <label style={{ gridColumn: "1 / -1" }}>{T("Note (optional)", "Maelezo (si lazima)")}<input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      </div>
      {err && <span className="err small">{err}</span>}
      <div className="row"><button className="primary small" disabled={busy}>{busy ? "…" : T("Save order", "Hifadhi oda")}</button><button type="button" className="small" onClick={onCancel}>{T("Cancel", "Ghairi")}</button></div>
    </form>
  );
}

export function OrderList({ ws, conversationId, onChange }: { ws: Workspace; conversationId: string; onChange: () => void }) {
  const lang = ws.language; const T = (en: string, sw: string) => (lang === "sw" ? sw : en);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [events, setEvents] = useState<Record<string, Ev[]>>({});
  const [printId, setPrintId] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  const editor = canEdit(ws);
  const { products } = useProducts(ws.id);
  const [sending, setSending] = useState<string | null>(null);   // order whose sent products are being picked
  const [sendItems, setSendItems] = useState<Item[]>([]);
  async function markSent(o: Order) {
    const c = itemsCost(sendItems);
    await update(o, { items: sendItems, product: itemsLabel(sendItems), fulfillment_status: "shipped", ...(o.cost == null && c != null ? { cost: c } : {}) } as Partial<Order>);
    setSending(null); setSendItems([]);
  }
  /** Print: if products are picked but not saved yet, save them on the order first so the receipt lists them. */
  async function printReceipt(o: Order) {
    const saved = ((o as any).items as Item[] | null) ?? [];
    if (editor && sending === o.id && sendItems.length && !saved.length) {
      setBusy(o.id); setErr("");
      const { error } = await supabase.from("orders").update({ items: sendItems, product: itemsLabel(sendItems) }).eq("id", o.id).eq("workspace_id", ws.id);
      setBusy("");
      if (error) return setErr(errText(error));
      setTick((t) => t + 1);
    }
    setPrintId(o.id);
  }
  useEffect(() => {
    supabase.from("orders").select("*").eq("workspace_id", ws.id).eq("conversation_id", conversationId).order("occurred_at", { ascending: false })
      .then(({ data, error }) => { if (error) setErr(errText(error)); setOrders((data as Order[]) ?? []); });
  }, [ws.id, conversationId, tick]);
  async function update(o: Order, patch: Partial<Order>) {
    setBusy(o.id); setErr("");
    const { error } = await supabase.from("orders").update(patch).eq("id", o.id).eq("workspace_id", ws.id);
    setBusy("");
    if (error) setErr(errText(error)); else { setTick((t) => t + 1); onChange(); }
  }
  async function toggleHistory(o: Order) {
    if (events[o.id]) { const e = { ...events }; delete e[o.id]; setEvents(e); return; }
    const { data } = await supabase.from("order_events").select("id,action,actor,at,before,after").eq("order_id", o.id).order("at", { ascending: false }).limit(30);
    setEvents({ ...events, [o.id]: (data as Ev[]) ?? [] });
  }
  if (!orders) return <span className="small muted">…</span>;
  if (!orders.length) return <span className="small muted">{T("No orders recorded for this chat.", "Hakuna oda zilizorekodiwa kwa chat hii.")}</span>;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {printId && <ReceiptPrint ws={ws} orderId={printId} onClose={() => setPrintId(null)} />}
      {err && <span className="err small">{err}</span>}
      {orders.map((o) => (
        <div key={o.id} className="evidence">
          <div className="row between">
            <span><b>{amt(orderNet(o), o.currency)} {o.currency}</b> <span className={"pill " + (o.status === "paid" ? "sold" : o.status === "pending" ? "open" : "lost")}>{L[lang].orderStatus[o.status]}</span> <span className="chip">{L[lang].provenance[o.provenance]}{o.inferred_from ? ` · ${T("confirmed from", "kutoka")} ${o.inferred_from === "kito" ? "Kito" : o.inferred_from === "rules" ? T("rules", "kanuni") : o.inferred_from === "tick" ? T("your ✅ message", "ujumbe wako wa ✅") : "✅"}` : ""}</span>{o.fulfillment_status !== "not_applicable" && <span className="chip">{L[lang].fulfillment[o.fulfillment_status]}</span>}</span>
            <span className="small muted">{o.receipt_no ? <b>{o.receipt_no} · </b> : null}{o.paid_at ? T("paid", "imelipwa") + " " + when(o.paid_at) : when(o.occurred_at)}{o.payment_ref ? ` · ${T("txn", "muamala")} ${o.payment_ref}` : ""}{o.product ? ` · ${o.product}` : ""}{o.external_ref && !o.external_ref.startsWith("auto:") ? ` · ref ${o.external_ref}` : ""}</span>
          </div>
          {(Number(o.discount) > 0 || Number(o.refund_amount) > 0) && <span className="small muted">{T("gross", "jumla")} {amt(Number(o.amount), o.currency)}{Number(o.discount) > 0 ? ` − ${T("discount", "punguzo")} ${amt(Number(o.discount), o.currency)}` : ""}{Number(o.refund_amount) > 0 ? ` − ${T("refund", "marejesho")} ${amt(Number(o.refund_amount), o.currency)}` : ""}</span>}
          {o.status === "paid" && <span className="small muted">{o.cost != null ? `${T("Cost", "Gharama")} ${amt(Number(o.cost), o.currency)} · ${T("profit before ads", "faida kabla ya matangazo")} ${amt(orderNet(o) - Number(o.cost), o.currency)}` : T("No cost typed yet — add it to see profit.", "Gharama bado haijaandikwa — iongeze uone faida.")}</span>}
          {o.delivery_issue && <span className={"small" + (o.delivery_resolved_at ? " muted" : " warnt")}>{o.delivery_resolved_at ? "✓ " : "⚠ "}{T("Delivery issue", "Tatizo la usafirishaji")}: {o.delivery_issue}{o.delivery_resolved_at ? ` · ${T("resolved", "imetatuliwa")} ${when(o.delivery_resolved_at)}` : ""}</span>}
          {o.notes && <span className={"small" + (o.notes.includes("⚠") ? " warnt" : "")}>{o.notes.replace(/\s*\[(wamsg|phone):[^\]]*\]/g, "")}</span>}
          <span className="small muted">{T("last change", "badiliko la mwisho")} {when(o.updated_at)} · <button className="small" style={{ padding: 0, border: 0, background: "none", color: "var(--accent)" }} onClick={() => toggleHistory(o)}>{events[o.id] ? T("hide history", "ficha historia") : T("history", "historia")}</button></span>
          {events[o.id] && <div className="small muted" style={{ display: "grid", gap: 2 }}>{events[o.id].map((e) => <span key={e.id}>{when(e.at)} · {e.action}{e.action === "update" && e.before && e.after ? ": " + Object.keys(e.after).filter((k) => JSON.stringify(e.before[k]) !== JSON.stringify(e.after[k]) && !["updated_at", "updated_by"].includes(k)).map((k) => `${k} ${JSON.stringify(e.before[k])} → ${JSON.stringify(e.after[k])}`).join(", ") : ""}{e.actor ? "" : T(" (server)", " (mfumo)")}</span>)}</div>}
          {editor && o.status === "paid" && o.fulfillment_status === "not_shipped" && (sending === o.id
            ? <div style={{ display: "grid", gap: 6 }}>
                <b className="small">{T("Which products did you send?", "Umetuma bidhaa zipi?")}</b>
                {products && <ProductPicker ws={ws} products={products} items={sendItems} onChange={setSendItems} T={T} />}
                <div className="row" style={{ gap: 6 }}>
                  <button className="small primary" disabled={busy === o.id || !sendItems.length} onClick={() => markSent(o)}>{T("Save — sent", "Hifadhi — imetumwa")}</button>
                  <button className="small" onClick={() => { setSending(null); setSendItems([]); }}>{T("Cancel", "Ghairi")}</button>
                </div>
              </div>
            : <span className="small warnt">📦 {T("Paid, not sent yet.", "Amelipa, bado hajatumiwa.")} {products && products.some((p) => p.active)
                ? <button className="small" disabled={busy === o.id} onClick={() => { setSending(o.id); setSendItems(((o as any).items as Item[] | null) ?? []); }}>{T("Pick products sent", "Chagua bidhaa zilizotumwa")}</button>
                : <button className="small" disabled={busy === o.id} onClick={() => update(o, { fulfillment_status: "shipped" })}>{T("Mark sent", "Weka imetumwa")}</button>}</span>)}
          {o.status === "paid" && o.receipt_no && <div><button className="small primary" disabled={busy === o.id} onClick={() => printReceipt(o)}>{T("Print receipt", "Chapisha risiti")} · {o.receipt_no}</button></div>}
          {editor && (
            <div className="row" style={{ gap: 6 }}>
              {o.status !== "paid" && <button className="small" disabled={busy === o.id} onClick={() => update(o, { status: "paid", paid_at: new Date().toISOString() })}>{T("Mark paid", "Weka imelipwa")}</button>}
              {o.status === "paid" && <button className="small" disabled={busy === o.id} onClick={() => { const v = prompt(T("What did this order cost you? (product + delivery)", "Oda hii ilikugharimu kiasi gani? (bidhaa + usafiri)"), o.cost != null ? moneyText(o.cost) : ""); if (v == null) return; const n = v.trim() === "" ? null : Number(v.replace(/[^\d.]/g, "")); if (n == null || n >= 0) update(o, { cost: n }); }}>{o.cost != null ? T("Change cost", "Badili gharama") : T("Add cost", "Ongeza gharama")}</button>}
              {o.status === "paid" && <button className="small" disabled={busy === o.id} onClick={() => { const v = prompt(T("Paid on (YYYY-MM-DD HH:MM, East Africa time)", "Alilipa lini (YYYY-MM-DD HH:MM)"), o.paid_at ? toLocalInput(o.paid_at).replace("T", " ") : ""); if (!v) return; const m = v.trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/); if (!m) return; const iso = fromLocalInput(`${m[1]}T${(m[2] ?? "12").padStart(2, "0")}:${m[3] ?? "00"}`); if (Date.parse(iso) <= Date.now() + 864e5) update(o, { paid_at: iso, occurred_at: iso }); }}>{T("Change date", "Badili tarehe")}</button>}
              {o.status === "paid" && <button className="small" disabled={busy === o.id} onClick={() => { const v = prompt(T("Refund amount", "Kiasi cha marejesho"), moneyText(orderNet(o))); const n = v == null ? NaN : Number(v.replace(/[^\d.]/g, "")); if (n >= 0 && n <= orderNet(o)) update(o, { status: "refunded", refund_amount: Number(o.refund_amount) + n }); }}>{T("Refund", "Rudisha pesa")}</button>}
              {o.status !== "cancelled" && <button className="small" disabled={busy === o.id} onClick={async () => { if (await askConfirm({
                title: T("Cancel this order?", "Ghairi oda hii?"),
                body: T("It stays in the history as cancelled.", "Itabaki kwenye historia kama iliyoghairiwa."),
                yes: T("Cancel order", "Ghairi oda"), no: T("Keep order", "Acha oda"), danger: true,
              })) void update(o, { status: "cancelled" }); }}>{T("Cancel order", "Ghairi oda")}</button>}
              <select value={o.fulfillment_status} disabled={busy === o.id} onChange={(e) => update(o, { fulfillment_status: e.target.value as any })} style={{ padding: "3px 8px" }}>{(["not_applicable", "not_shipped", "shipped", "delivered", "returned"] as const).map((s) => <option key={s} value={s}>{L[lang].fulfillment[s]}</option>)}</select>
              {o.status === "paid" && "delivery_issue" in o && (o.delivery_issue && !o.delivery_resolved_at
                ? <button className="small" disabled={busy === o.id} onClick={() => update(o, { delivery_resolved_at: new Date().toISOString() })}>{T("Issue resolved", "Tatizo limetatuliwa")}</button>
                : <button className="small" disabled={busy === o.id} onClick={() => { const v = prompt(T("What went wrong with the delivery? (e.g. customer not reachable, wrong item, damaged)", "Nini kimeharibika kwenye usafirishaji? (mf. mteja hapatikani, bidhaa si sahihi, imeharibika)"), ""); if (v && v.trim()) update(o, { delivery_issue: v.trim().slice(0, 500) }); }}>{T("Delivery issue…", "Tatizo la usafirishaji…")}</button>)}
              {"assigned_to" in o && <AssignSelect ws={ws} value={o.assigned_to} label={false} busy={busy === o.id} onChange={(u) => update(o, { assigned_to: u })} />}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
