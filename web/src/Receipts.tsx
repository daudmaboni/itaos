// "Find a payment" (Tafuta malipo): search the business's payments by our receipt number (Kumbukumbu Na.,
// e.g. KH-000123), the payment's transaction code (namba ya muamala), the customer's name or phone, a place
// they mentioned in the chat, and/or the day they paid. Results are a short list (count + total on top);
// tap one to open the whole payment: who, what, how much, when, how they paid, the proof and Print.
// Search runs in the database: search_payments (migration 0053) and find_payment (0047, for payments that
// were never recorded as a sale), only over this business's sales.
import { useEffect, useRef, useState } from "react";
import { supabase, Workspace, money, orderNet, localDay } from "./lib";
import ReceiptPrint from "./ReceiptPrint";
import WalletCheck from "./WalletCheck";
import { PaymentSummary } from "./PaymentGuard";
import DateRange from "./DateRange";
import { RangeSel, resolveRange, addDays, presetLabel } from "./ranges";
import { fromLocalInput } from "./Orders";
import { local, initials, hue } from "./Buyers";

type Found = {
  order: null | {
    id: string; receipt_no: string | null; amount: number; discount: number; refund_amount: number; currency: string;
    status: string; items: { name?: string; qty?: number }[] | null; product: string | null; notes: string | null;
    paid_at: string | null; occurred_at: string; created_at: string; provenance: string; inferred_from: string | null;
    payment_ref: string | null; fulfillment_status: string;
  };
  conversation_id: string | null;
  customer: { name: string | null; wa_name?: string | null; phone: string | null; alt_phone?: string | null; location?: string | null; landmark?: string | null } | null;
  evidence: null | {
    message_id: string; sent_at: string; direction: string; text: string;
    receipt: null | { amount?: number | null; currency?: string | null; txn_code?: string | null; provider?: string | null; paid_to?: string | null; sender?: string | null; paid_at?: string | null };
  };
  matched?: "code" | "name" | "location" | "date";
  place?: string | null;
};
type Recent = { id: string; receipt_no: string; amount: number; discount: number; refund_amount: number; currency: string; paid_at: string | null; product: string | null; contact_id: string | null; contact: { full_name: string | null; wa_id: string | null } | null };
type By = "any" | "code" | "name" | "location";
const LIMIT = 200;

const fmt = (iso: string | null | undefined) => iso
  ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })
  : "–";
const itemsOf = (o: Found["order"]) => !o ? null : o.items?.length ? o.items.map((x) => `${x.name ?? "?"}${x.qty && x.qty > 1 ? ` × ${x.qty}` : ""}`).join(", ") : o.product;
const keyOf = (f: Found, i: number) => f.order?.id ?? f.evidence?.message_id ?? String(i);

export default function Receipts({ ws }: { ws: Workspace }) {
  const sw = ws.language === "sw";
  const T = (en: string, s: string) => (sw ? s : en);
  const tz = ws.timezone || "Africa/Dar_es_Salaam";
  const today = localDay(new Date(), tz);
  const [q, setQ] = useState(() => decodeURIComponent(location.hash.match(/#receipts\/q=([^&]+)/)?.[1] ?? ""));
  const [by, setBy] = useState<By>("any");
  const [range, setRange] = useState<RangeSel | null>(null);
  const [res, setRes] = useState<Found[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [recent, setRecent] = useState<Recent[]>([]);
  const [start, setStart] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const seq = useRef(0);
  const [printId, setPrintId] = useState<string | null>(null);
  const period = range ? resolveRange(range, today, start) : null;

  useEffect(() => {
    supabase.from("orders").select("id,receipt_no,amount,discount,refund_amount,currency,paid_at,product,contact_id,contact:contacts(full_name,wa_id)").eq("workspace_id", ws.id)
      .not("receipt_no", "is", null).order("receipt_seq", { ascending: false }).limit(8)
      .then(({ data }) => setRecent((data as unknown as Recent[]) ?? []));
    supabase.from("orders").select("paid_at").eq("workspace_id", ws.id).eq("status", "paid").not("paid_at", "is", null)
      .order("paid_at", { ascending: true }).limit(1)
      .then(({ data }) => { const d = (data as { paid_at: string }[] | null)?.[0]?.paid_at; setStart(d ? localDay(d, tz) : null); });
  }, [ws.id]);

  // Search as you type (after a short pause), and whenever the "search by" or the dates change.
  useEffect(() => {
    const term = q.trim();
    if (!period && term.length < 2) { setRes(null); setErr(""); setBusy(false); return; }
    if (term && term.length < 2) return;
    const my = ++seq.current;
    const t = window.setTimeout(async () => {
      setBusy(true); setErr("");
      const p_from = period ? fromLocalInput(period.from + "T00:00") : null;
      const p_to = period ? fromLocalInput(addDays(period.to, 1) + "T00:00") : null;
      const calls = [supabase.rpc("search_payments", { p_ws: ws.id, p_q: term || null, p_by: by, p_from, p_to, p_limit: LIMIT })];
      // Codes on a receipt screenshot / payment SMS whose sale was never recorded: only the code search finds those.
      if (term.length >= 3 && !period && (by === "any" || by === "code")) calls.push(supabase.rpc("find_payment", { p_ws: ws.id, p_q: term }));
      const out = await Promise.all(calls);
      if (my !== seq.current) return;
      setBusy(false);
      const bad = out.find((r) => r.error);
      if (bad && !out[0].data) { setErr(bad.error!.message); setRes([]); return; }
      const list = [...((out[0].data as Found[]) ?? [])];
      const seen = new Set(list.map((f) => f.order?.id).filter(Boolean));
      for (const f of ((out[1]?.data as Found[]) ?? [])) {
        if (f.order && seen.has(f.order.id)) continue;
        list.push({ ...f, matched: "code" });
        if (f.order) seen.add(f.order.id);
      }
      list.sort((a, b) => Date.parse(b.order?.paid_at ?? b.evidence?.sent_at ?? "") - Date.parse(a.order?.paid_at ?? a.evidence?.sent_at ?? ""));
      setRes(list);
      setOpenKey(list.length === 1 ? keyOf(list[0], 0) : null);
    }, term ? 350 : 0);
    return () => window.clearTimeout(t);
  }, [q, by, range?.key, period?.from, period?.to, ws.id]);

  const BYS: [By, string, string][] = [
    ["any", T("Anything", "Chochote"), T("Receipt no., M-Pesa code, name, phone or place", "Kumbukumbu Na., muamala, jina, simu au mahali")],
    ["code", T("Receipt / M-Pesa code", "Risiti / muamala"), T("e.g. KH-000123 or TKL8XJ2Q4P", "mfano KH-000123 au TKL8XJ2Q4P")],
    ["name", T("Name or phone", "Jina au simu"), T("Customer name or phone, e.g. Juma or 0712…", "Jina la mteja au simu, mfano Juma au 0712…")],
    ["location", T("Location", "Mahali"), T("A place they mentioned, e.g. Mbeya, Arusha, Kariakoo", "Mahali walipotaja, mfano Mbeya, Arusha, Kariakoo")],
  ];
  const paid = (res ?? []).filter((f) => f.order && f.order.status === "paid");
  const total = paid.reduce((n, f) => n + orderNet(f.order!), 0);
  const cur = paid[0]?.order?.currency ?? "TZS";
  const term = q.trim();
  const when = period && range ? (range.key === "custom" ? (period.from === period.to ? period.from : `${period.from} – ${period.to}`) : presetLabel(range.key, sw ? "sw" : "en").toLowerCase()) : "";

  return (
    <div className="stack" style={{ display: "grid", gap: 16 }}>
      <style>{`.pay-find{display:flex;gap:10px;flex-wrap:wrap;align-items:stretch}.pay-find input{flex:1 1 260px;min-width:0}
        .pay-by{display:flex;gap:6px;flex-wrap:wrap}
        .pay-by button{all:unset;box-sizing:border-box;cursor:pointer;font:500 13px/1 var(--font);padding:9px 14px;min-height:38px;display:inline-flex;align-items:center;border-radius:999px;background:var(--raised);color:var(--ink-2,var(--ink));border:1px solid transparent}
        .pay-by button:hover{border-color:var(--line-2)}.pay-by button[aria-pressed=true]{background:var(--ink);color:var(--card)}
        .pay-by button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
        .pay-open{padding:0 8px 12px}`}</style>
      <section className="card flat" style={{ display: "grid", gap: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>{T("Find a payment", "Tafuta malipo")}</h2>
          <span className="small muted">{T("Search by receipt number, M-Pesa code, the customer's name or phone, or a place they mentioned. Pick dates to see every payment on those days.",
            "Tafuta kwa kumbukumbu namba, namba ya muamala, jina au simu ya mteja, au mahali alipotaja. Chagua tarehe kuona malipo yote ya siku hizo.")}</span>
        </div>
        <div className="pay-by" role="group" aria-label={T("Search by", "Tafuta kwa")}>
          {BYS.map(([k, label]) => <button key={k} type="button" aria-pressed={by === k} onClick={() => setBy(k)}>{label}</button>)}
        </div>
        <div className="pay-find">
          <input id="pay-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" spellCheck={false}
            aria-label={T("Search payments", "Tafuta malipo")} placeholder={BYS.find((b) => b[0] === by)![2]}
            style={{ fontSize: 17, padding: "12px 14px", textTransform: by === "code" ? "uppercase" : "none" }} />
          <DateRange value={range ?? { key: "all" }} onChange={(r) => setRange(r.key === "all" ? null : r)} today={today} tz={tz} lang={sw ? "sw" : "en"} start={start} />
        </div>
        {busy && <span className="small muted">{T("Searching…", "Inatafuta…")}</span>}
        {err && <span className="err small">{T("Couldn't search right now. Try again in a moment.", "Imeshindwa kutafuta sasa. Jaribu tena baada ya muda.")}</span>}
      </section>

      {res && !busy && !err && res.length === 0 && (
        <div className="empty">{term
          ? T(`Nothing found for “${term}”${when ? ` ${when}` : ""}. Try another spelling, part of the number, or “Anything”.`, `Hakuna kilichopatikana kwa “${term}”${when ? ` ${when}` : ""}. Jaribu tahajia nyingine, sehemu ya namba, au “Chochote”.`)
          : T(`No payments ${when}.`, `Hakuna malipo ${when}.`)}</div>
      )}

      {res && res.length > 0 && (
        <section className="card by-list">
          <div className="row between by-list-h" style={{ flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ margin: 0 }}>{paid.length === 1 ? T("1 payment", "Malipo 1") : T(`${paid.length} payments`, `Malipo ${paid.length}`)}{when ? <span className="muted" style={{ fontWeight: 400 }}> · {when}</span> : null}</h3>
            {paid.length > 0 && <b>{money(total, cur)}</b>}
          </div>
          {res.length >= LIMIT && <span className="small muted by-list-h">{T(`Showing the latest ${LIMIT}. Narrow the dates to see older ones.`, `Inaonyesha ${LIMIT} za karibuni. Punguza tarehe kuona za zamani.`)}</span>}
          {res.map((f, i) => {
            const k = keyOf(f, i), o = f.order, open = openKey === k;
                        return (
              <div key={k} className={"by-item" + (open ? " open" : "")}>
                <PayRow seed={(o as any)?.contact_id ?? f.customer?.phone ?? k} name={f.customer?.name ?? null} phone={f.customer?.phone ?? null}
                  receipt={o?.receipt_no ?? T("Payment message", "Ujumbe wa malipo")}
                  prods={o ? split(itemsOf(o)) : [T("Not recorded as a sale", "Haijarekodiwa kama mauzo")]}
                  place={f.matched === "location" && f.place ? `“…${f.place}…”` : f.customer?.location ?? null}
                  when={fmt(o?.paid_at ?? f.evidence?.sent_at)} amount={o ? money(orderNet(o), o.currency) : "—"}
                  note={o?.status === "refunded" ? T("refunded", "imerudishwa") : null}
                  open={open} onClick={() => setOpenKey(open ? null : k)} T={T} />
                {open && <div className="pay-open"><PaymentCard f={f} T={T} onPrint={setPrintId} /></div>}
              </div>
            );
          })}
        </section>
      )}

      {printId && <ReceiptPrint ws={ws} orderId={printId} onClose={() => setPrintId(null)} />}

      {!res && !busy && recent.length > 0 && (
        <section className="card by-list" aria-label={T("Latest receipts", "Risiti za karibuni")}>
          <h3 className="by-list-h">{T("Latest receipts", "Risiti za karibuni")}</h3>
          {recent.map((r) => (
            <div key={r.id} className="by-item">
              <PayRow seed={r.contact_id ?? r.id} name={r.contact?.full_name ?? null} phone={r.contact?.wa_id ?? null} receipt={r.receipt_no}
                prods={split(r.product)} when={fmt(r.paid_at)} amount={money(orderNet(r), r.currency)}
                onClick={() => { setBy("code"); setQ(r.receipt_no); }} T={T} />
            </div>
          ))}
        </section>
      )}
      <PaymentSummary ws={ws} />
      <WalletCheck ws={ws} />
    </div>
  );
}

// One payment in a list, laid out like a row on the Buyers page: avatar, who + receipt, place, amount + date, product chips.
function PayRow({ seed, name, phone, receipt, prods, place, when, amount, note, open, onClick, T }: {
  seed: string; name: string | null; phone: string | null; receipt: string; prods: string[]; place?: string | null; when: string;
  amount: string; note?: string | null; open?: boolean; onClick: () => void; T: (en: string, s: string) => string }) {
  const ph = local(phone);
  return (
    <div role="button" tabIndex={0} className="by-row" aria-expanded={open} onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}>
      <span className="by-av" style={{ ["--h" as any]: hue(seed) }} aria-hidden>{name && initials(name) ||
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>}</span>
      <span className="by-main">
        <span className="by-name">{name ? <b>{name}</b> : <b className="muted">{T("Customer", "Mteja")}</b>}</span>
        <span className="by-phone">{receipt}{ph ? ` · ${ph}` : ""}</span>
        {place && <span className="by-place">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z" /><circle cx="12" cy="9" r="2.5" /></svg>
          {place}</span>}
      </span>
      <span className="by-money">
        <b>{amount}</b>
        <span>{when}</span>
        {note && <span>{note}</span>}
      </span>
      {prods.length > 0
        ? <span className="by-prods">{prods.slice(0, 4).map((x, i) => <span key={i} className="chip">{x}</span>)}{prods.length > 4 && <span className="chip">+{prods.length - 4}</span>}</span>
        : <span className="by-prods"><span className="small muted">{T("Products not recorded", "Bidhaa hazijaandikwa")}</span></span>}
    </div>
  );
}
const split = (x: string | null | undefined) => (x ?? "").split(",").map((v) => v.trim()).filter(Boolean);

function PaymentCard({ f, T, onPrint }: { f: Found; T: (en: string, s: string) => string; onPrint: (id: string) => void }) {
  const o = f.order, ev = f.evidence, rc = ev?.receipt ?? null;
  const items = itemsOf(o);
  const status = !o ? T("Payment message — not recorded as a sale", "Ujumbe wa malipo — haujarekodiwa kama mauzo")
    : o.status === "paid" ? T("Paid", "Imelipwa") : o.status === "refunded" ? T("Refunded", "Imerudishwa") : o.status === "cancelled" ? T("Cancelled", "Imeghairiwa") : T("Pending", "Inasubiri");
  const how = o?.inferred_from === "tick" ? T("your ✅ price message", "ujumbe wako wa bei wenye ✅")
    : o?.inferred_from === "kito" ? T("Kito, confirmed by you", "Kito, umethibitisha")
    : o?.inferred_from === "rules" ? T("chat rules, confirmed by you", "kanuni za chat, umethibitisha")
    : o?.provenance === "csv_import" ? T("imported", "imeingizwa") : T("recorded by hand", "imerekodiwa kwa mkono");
  // Label left, value right; long values wrap instead of pushing the card off the screen. `stack` puts the value under the label.
  const Row = ({ k, v, stack }: { k: string; v: React.ReactNode; stack?: boolean }) => v == null || v === "" ? null : (
    <div className={"kv" + (stack ? " stack" : "")}><span className="muted">{k}</span><span>{v}</span></div>
  );
  // Notes carry an internal WhatsApp message id ("[wamsg:wamid.…]") — useful to the system, noise to the owner.
  const notes = o?.notes ? o.notes.replace(/\s*\[wamsg:[^\]]*\]/g, "").trim() || null : null;
  return (
    <section className="card pay-card" style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 2 }}>
          <span className="small muted">{T("Receipt no.", "Kumbukumbu Na.")}</span>
          <b style={{ fontSize: 24 }}>{o?.receipt_no ?? "—"}</b>
        </div>
        <div style={{ display: "grid", gap: 4, justifyItems: "end" }}>
          <span className={"pill " + (o?.status === "paid" ? "sold" : o ? "lost" : "open")}>{status}</span>
          {o && <b style={{ fontSize: 22 }}>{money(orderNet(o), o.currency)}</b>}
        </div>
      </div>
      <div className="pay-body">
      <div className="small kv-list">
        <Row k={T("Customer", "Mteja")} v={f.customer?.name || (f.customer?.phone ? "+" + f.customer.phone : null)} />
        <Row k={T("Phone", "Simu")} v={f.customer?.phone ? "+" + f.customer.phone + (f.customer.alt_phone ? ` · ${f.customer.alt_phone}` : "") : null} />
        <Row k={T("Location", "Mahali")} v={f.customer?.location ? f.customer.location + (f.customer.landmark ? ` (${f.customer.landmark})` : "") : null} />
        <Row k={T("Bought", "Alinunua")} v={items} stack />
        <Row k={T("Place mentioned in the chat", "Mahali alipotaja kwenye chat")} v={f.place && f.place !== f.customer?.location ? `“…${f.place}…”` : null} stack />
        <Row k={T("Paid on", "Alilipa")} v={o ? fmt(o.paid_at) : ev ? fmt(ev.sent_at) : null} />
        {o && (Number(o.discount) > 0 || Number(o.refund_amount) > 0) && <Row k={T("Before discount / refund", "Kabla ya punguzo / marejesho")} v={money(Number(o.amount), o.currency)} />}
        <Row k={T("Transaction code", "Namba ya muamala")} v={o?.payment_ref ?? rc?.txn_code ?? null} />
        <Row k={T("Paid with", "Amelipa kwa")} v={rc?.provider ?? null} />
        <Row k={T("Sent by (on receipt)", "Aliyetuma (kwenye risiti)")} v={rc?.sender ?? null} />
        <Row k={T("Paid to (on receipt)", "Aliyelipwa (kwenye risiti)")} v={rc?.paid_to ?? null} />
        <Row k={T("Amount on receipt", "Kiasi kwenye risiti")} v={rc?.amount != null ? money(rc.amount, rc.currency || o?.currency || "TZS") : null} />
        <Row k={T("How the sale was recorded", "Mauzo yalirekodiwa vipi")} v={o ? `${how} · ${fmt(o.created_at)}` : null} stack />
        <Row k={T("Notes", "Maelezo")} v={notes} stack />
      </div>
      <div className="pay-side">
      {ev && (
        <div className="evidence small" style={{ display: "grid", gap: 4 }}>
          <span className="muted">{rc ? T("Payment screenshot", "Picha ya malipo") : T("Payment message", "Ujumbe wa malipo")} · {fmt(ev.sent_at)}</span>
          {ev.text && <span>{ev.text}</span>}
        </div>
      )}
      {!ev && o && <span className="small muted">{T("No receipt screenshot or payment SMS found in the chat for this sale.", "Hakuna picha ya risiti wala SMS ya malipo kwenye chat kwa mauzo haya.")}</span>}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        {o && o.status === "paid" && <button type="button" className="primary" onClick={() => onPrint(o.id)}>{T("Print receipt", "Chapisha risiti")}</button>}
        {f.conversation_id && <a href={"#chats/ids=" + f.conversation_id}>{T("Open the chat →", "Fungua chat →")}</a>}
        {f.customer?.phone && <a href={"#buyers/q=" + encodeURIComponent("0" + f.customer.phone.replace(/^255/, ""))}>{T("Edit customer details →", "Rekebisha taarifa za mteja →")}</a>}
      </div>
      </div>
      </div>
    </section>
  );
}
