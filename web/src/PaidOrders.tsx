// "Who paid": the paid orders behind the Revenue card, for the dashboard's date range and filters.
// Each row is one sale with everything known about the customer and how the sale came about.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { supabase, Workspace, Order, Outcome, L, amt, money, localDay, orderNet } from "./lib";
import type { Period } from "./metrics";
import ReceiptPrint from "./ReceiptPrint";
import { useBackLayer } from "./backStack";

type Row = { o: Order; c: Outcome | null; phone: string | null };

const fmtWhen = (iso: string | null) => iso
  ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })
  : "–";

export default function PaidOrders({ ws, orders, period, adNames, onClose }: {
  ws: Workspace; orders: Order[]; period: Period; adNames: Record<string, string>; onClose: () => void;
}) {
  const lang = ws.language;
  const T = (en: string, sw: string) => (lang === "sw" ? sw : en);
  const tz = ws.timezone || "Africa/Dar_es_Salaam";
  // Same rule as the Revenue card: paid orders whose payment falls on a day in the range.
  const paid = orders
    .filter((o) => o.status === "paid" && o.paid_at && localDay(o.paid_at, tz) >= period.from && localDay(o.paid_at, tz) <= period.to)
    .sort((a, b) => Date.parse(b.paid_at!) - Date.parse(a.paid_at!));
  const key = paid.map((o) => o.id).join(",");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState("");
  const [printId, setPrintId] = useState<string | null>(null);   // the sale whose receipt is open

  // Desktop: a popup over the blurred dashboard. Phone: a full-screen page.
  // Esc closes it; on a phone the Back button closes it instead of leaving the dashboard.
  // Back used to close this list even while a receipt was open on top of it (both vanished at once). The
  // shared back stack closes only the top popup: the receipt first, then this list.
  useBackLayer(true, onClose);
  useEffect(() => {
    // Esc while a receipt is open closes only the receipt (it listens for Esc itself).
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.body.classList.contains("rcpt-open")) onClose(); };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let gone = false;
    setRows(null); setErr("");
    const convIds = [...new Set(paid.map((o) => o.conversation_id).filter(Boolean))] as string[];
    (async () => {
      const { data: cs, error } = convIds.length
        ? await supabase.from("conversation_outcomes").select("*").eq("workspace_id", ws.id).in("id", convIds)
        : { data: [], error: null };
      if (error) setErr(error.message);
      const byId = Object.fromEntries(((cs ?? []) as Outcome[]).map((c) => [c.id, c]));
      const contactIds = [...new Set(((cs ?? []) as Outcome[]).map((c) => c.contact_id).filter(Boolean))];
      const { data: cts } = contactIds.length ? await supabase.from("contacts").select("id,wa_id").eq("workspace_id", ws.id).in("id", contactIds) : { data: [] };
      const phoneOf = Object.fromEntries(((cts ?? []) as any[]).map((x) => [x.id, x.wa_id]));
      if (gone) return;
      setRows(paid.map((o) => {
        const c = o.conversation_id ? byId[o.conversation_id] ?? null : null;
        return { o, c, phone: c ? phoneOf[c.contact_id] ?? null : null };
      }));
    })();
    return () => { gone = true; };
  }, [key, ws.id]);

  const total = paid.reduce((s, o) => s + orderNet(o), 0);
  const cur = ws.currency;
  const srcLabel = (s: string | null | undefined) => s === "ad" ? T("From an ad", "Kutoka tangazo") : s === "organic" ? T("Not from an ad", "Si kutoka tangazo") : T("Source unknown", "Chanzo hakijulikani");
  const days = (a?: string | null, b?: string | null) => a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 864e5)) : null;

  return createPortal(
    <div className="dr-layer paid-layer" data-noswipe role="dialog" aria-modal="true" aria-labelledby="paid-h">
    <div className="dr-scrim" onClick={onClose} aria-hidden />
    <div className="card paid-list paid-modal">
      <div className="row between paid-head">
        <button className="paid-back" onClick={onClose} aria-label={T("Back", "Rudi")}>‹</button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 id="paid-h" style={{ margin: 0 }}>{T("Who paid", "Waliolipa")} <span className="muted">· {paid.length} · {money(total, cur)}</span></h2>
          <span className="small muted">{T("Paid orders in the dates and filters above, newest first. A sale counts on the day the money came in.", "Oda zilizolipwa kwenye tarehe na vichujio vilivyo juu, mpya kwanza. Mauzo yanahesabiwa siku pesa ilipoingia.")}</span>
        </div>
        <button className="small paid-x" onClick={onClose} aria-label={T("Close", "Funga")}>✕</button>
      </div>
      {err && <p className="err small">{err}</p>}
      {!rows ? <div className="skeleton cc-skel" /> : rows.length === 0 ? <p className="small muted">{T("No paid orders in these dates.", "Hakuna oda zilizolipwa kwenye tarehe hizi.")}</p> : (
        <div className="paid-rows paid-body">
          {rows.map(({ o, c, phone }) => {
            const net = orderNet(o);
            const cost = o.cost != null ? Number(o.cost) : (ws.unit_cost != null ? Number(ws.unit_cost) : null);
            const items = ((o as any).items ?? []) as { name: string; qty: number }[];
            const prodText = items.length ? items.map((i) => `${i.qty > 1 ? i.qty + "× " : ""}${i.name}`).join(", ") : o.product;
            const toPay = days(c?.started_at, o.paid_at);
            const adName = c?.ad_id ? adNames[c.ad_id] ?? c.ad_id : null;
            return (
              <div key={o.id} className="paid-row">
                <div className="row between" style={{ gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <b>{c?.contact_name || (phone ? "+" + phone : T("Customer without a chat", "Mteja bila chat"))}</b>
                    {phone && c?.contact_name && <span className="small muted"> · +{phone}</span>}
                  </div>
                  <b style={{ whiteSpace: "nowrap" }}>{money(net, o.currency)}</b>
                </div>
                <div className="paid-tags">
                  <span className={"pill " + (c?.source === "ad" ? "sold" : "open")}>{srcLabel(c?.source ?? o.conv_source)}</span>
                  {adName && <span className="chip" title={T("Ad the chat came from", "Tangazo chat ilipotoka")}>📣 {adName}</span>}
                  <span className="chip">{L[lang].fulfillment[o.fulfillment_status] === "–" ? T("Delivery not tracked", "Usafirishaji haufuatiliwi") : L[lang].fulfillment[o.fulfillment_status]}</span>
                  <span className="chip">{L[lang].provenance[o.provenance]}</span>
                </div>
                <div className="paid-grid small">
                  {o.receipt_no && <span><span className="muted">{T("Receipt no.", "Kumbukumbu Na.")}</span> <b>{o.receipt_no}</b>{o.payment_ref ? ` · ${T("txn", "muamala")} ${o.payment_ref}` : ""}</span>}
                  <span><span className="muted">{T("Paid", "Alilipa")}</span> {fmtWhen(o.paid_at)}</span>
                  <span><span className="muted">{T("Chat started", "Chat ilianza")}</span> {fmtWhen(c?.started_at ?? null)}{toPay != null ? ` · ${toPay === 0 ? T("paid same day", "alilipa siku hiyo") : T(`paid after ${toPay} day${toPay === 1 ? "" : "s"}`, `alilipa baada ya siku ${toPay}`)}` : ""}</span>
                  <span><span className="muted">{T("Products", "Bidhaa")}</span> {prodText || "–"}</span>
                  <span><span className="muted">{T("Cost", "Gharama")}</span> {cost != null ? money(cost, o.currency) : T("not typed", "haijaandikwa")}{cost != null ? <> · <span className="muted">{T("profit before ads", "faida kabla ya matangazo")}</span> {amt(net - cost, o.currency)}</> : ""}</span>
                  {(Number(o.discount) > 0 || Number(o.refund_amount) > 0) && <span><span className="muted">{T("Gross", "Jumla")}</span> {money(Number(o.amount), o.currency)}{Number(o.discount) > 0 ? ` − ${T("discount", "punguzo")} ${amt(Number(o.discount), o.currency)}` : ""}{Number(o.refund_amount) > 0 ? ` − ${T("refund", "marejesho")} ${amt(Number(o.refund_amount), o.currency)}` : ""}</span>}
                  {o.external_ref && !o.external_ref.startsWith("auto:") && <span><span className="muted">{T("Ref", "Kumbukumbu")}</span> {o.external_ref.replace(/^txn:/, "")}</span>}
                  {c?.paid_orders != null && Number(c.paid_orders) > 1 && <span><span className="muted">{T("Repeat customer", "Mteja wa kurudia")}</span> {T(`${c.paid_orders} paid orders`, `oda ${c.paid_orders} zilizolipwa`)}</span>}
                </div>
                {c?.kito_summary && <p className="small muted" style={{ margin: 0 }}>✦ {c.kito_summary}</p>}
                <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  {o.receipt_no && <button className="small" onClick={() => setPrintId(o.id)}>🧾 {T("Print receipt", "Chapisha risiti")} · {o.receipt_no}</button>}
                  {o.conversation_id && <a className="small" href={"#chats/open=" + o.conversation_id}>{T("Open chat →", "Fungua chat →")}</a>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
    {printId && <ReceiptPrint ws={ws} orderId={printId} onClose={() => setPrintId(null)} />}
    </div>,
    document.body,
  );
}
