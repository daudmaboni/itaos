// Printable receipts for a recorded sale, in the 8 designs Daud picked from the receipt canvas
// (#1 till slip, #3 letterhead, #5 IMELIPWA stamp, #6 tear-off, #8 black & white thermal — the default,
// #10 reorder card with QR, #13 Kiswahili | English, #16 delivery label). Switch between them with the
// chips; the last one used is remembered on this device. One total for the whole sale, never a price per
// product. Each design is drawn at real paper size (96 px = 1 inch) and prints 1:1.
// Every design carries a real QR code (21 Nov 2026) that opens itaos.app/r/<secret code> (ReceiptCheck.tsx):
// the customer sees the receipt is genuine and can order again on WhatsApp; the business's staff can open the
// sale in itaOS. The code is random per sale (migration 0055), so receipts can't be guessed from the number.
// The bar also sends the same link to the customer on WhatsApp, copies it, or gives the sale a new link.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { supabase, Workspace, Order, orderNet, amt } from "./lib";

export type ReceiptStyle = "till" | "letterhead" | "stamp" | "tearoff" | "mono" | "reorder" | "bilingual" | "shipping";
export const RECEIPT_STYLES: { key: ReceiptStyle; n: number; en: string; sw: string; page: string; w: number }[] = [
  { key: "mono", n: 8, en: "Black & white", sw: "Nyeusi na nyeupe", page: "80mm 200mm", w: 302 },
  { key: "till", n: 1, en: "Till slip", sw: "Risiti ndogo", page: "80mm 200mm", w: 302 },
  { key: "letterhead", n: 3, en: "Letterhead (A5)", sw: "Barua (A5)", page: "A5", w: 559 },
  { key: "stamp", n: 5, en: "IMELIPWA stamp", sw: "Muhuri IMELIPWA", page: "A6", w: 397 },
  { key: "tearoff", n: 6, en: "Two-part tear-off", sw: "Sehemu mbili", page: "105mm 228mm", w: 397 },
  { key: "reorder", n: 10, en: "Reorder card + QR", sw: "Kadi ya kuagiza + QR", page: "A6", w: 397 },
  { key: "bilingual", n: 13, en: "Kiswahili | English", sw: "Kiswahili | Kiingereza", page: "A5 landscape", w: 794 },
  { key: "shipping", n: 16, en: "Delivery label", sw: "Lebo ya mzigo", page: "4in 6in", w: 384 },
];
const STORE = "itaos:receipt-style";
const loadStyle = (): ReceiptStyle => { try { const v = localStorage.getItem(STORE) as ReceiptStyle; return RECEIPT_STYLES.some((s) => s.key === v) ? v : "mono"; } catch { return "mono"; } };

type R = {
  biz: string; bizPhone: string | null; waLink: string | null; no: string; customer: string; custPhone: string | null;
  items: string[]; total: string; date: string; dateTime: string; ref: string | null; provider: string;
  place: string | null; landmark: string | null; deliveryNote: string | null; altPhone: string | null;
  link: string | null; custWa: string | null;
};

/** The public receipt link a QR opens. Same site the app is on (itaos.app in production). */
export const receiptLink = (token: string | null | undefined) => (token ? `${location.origin}/r/${token}` : null);

// Brand colours (Kayani system): green, deep green, honey, cream.
const C = { green: "#029046", greenText: "#027a3d", forest: "#0b3b24", honey: "#e9a23b", cream: "#f5f0e6", surface: "#fffdf8", ink: "#13231a", muted: "#56665c", line: "#e3dccd", mint: "#dcefe2" };
const DISPLAY = "'Bricolage Grotesque', Inter, system-ui, sans-serif";
const BODY = "Inter, system-ui, sans-serif";
const MONO = "'Geist Mono', ui-monospace, 'Courier New', monospace";

const localPhone = (wa: string | null | undefined) => {
  if (!wa) return null;
  const d = wa.replace(/\D/g, "");
  return d.startsWith("255") && d.length === 12 ? "0" + d.slice(3) : "+" + d;
};
const masked = (wa: string | null | undefined) => { const p = localPhone(wa); return p && p.length >= 10 ? `${p.slice(0, 4)} *** ${p.slice(-3)}` : p; };

async function loadReceipt(ws: Workspace, orderId: string): Promise<R> {
  const { data: o, error } = await supabase.from("orders").select("*").eq("workspace_id", ws.id).eq("id", orderId).single();
  if (error || !o) throw new Error(error?.message ?? "not found");
  const ord = o as Order & { items?: { name?: string; qty?: number }[]; receipt_no?: string | null; payment_ref?: string | null; };
  const [cv, wn, lk] = await Promise.all([
    ord.conversation_id ? supabase.from("conversations").select("contact:contacts(name,wa_id,full_name,alt_phone,delivery_place,region,district,area,landmark,delivery_note)").eq("id", ord.conversation_id).single() : Promise.resolve({ data: null } as any),
    supabase.from("wa_numbers").select("display_phone").eq("workspace_id", ws.id).limit(1),
    // The sale's secret QR code (made on first print, migration 0055). No receipt number yet → no link.
    ord.receipt_no ? supabase.rpc("receipt_link", { p_order: orderId }) : Promise.resolve({ data: null } as any),
  ]);
  const ct = (cv.data as any)?.contact ?? null;
  const phone = (wn.data as any)?.[0]?.display_phone ?? null;
  const items = ord.items?.length
    ? ord.items.map((x) => `${x.name ?? "?"} × ${x.qty ?? 1}`)
    : ord.product ? ord.product.split(/\s*[,+]\s*/).filter(Boolean) : [];
  const at = ord.paid_at ?? ord.occurred_at;
  const d = new Date(at);
  const opt = { timeZone: ws.timezone || "Africa/Dar_es_Salaam" } as const;
  return {
    biz: ws.name, bizPhone: phone ? localPhone(phone) : null, waLink: phone ? `https://wa.me/${String(phone).replace(/\D/g, "")}` : null,
    no: ord.receipt_no ?? "—", // the buyer's name (0056: owner-typed, read by Kito, or the saved label with its tags removed), never the raw tagged label
    customer: ct?.full_name || masked(ct?.wa_id) || "—", custPhone: masked(ct?.wa_id),
    // the delivery location exactly as the customer wrote it; otherwise what the owner filled in
    place: ct?.delivery_place || [ct?.area, ct?.district, ct?.region].filter(Boolean).join(", ") || null, landmark: ct?.landmark ?? null,
    deliveryNote: ct?.delivery_note ?? null, altPhone: ct?.alt_phone ?? null,
    items: items.length ? items : ["—"], total: `${ord.currency} ${amt(orderNet(ord), ord.currency)}`,
    date: d.toLocaleDateString("en-GB", { ...opt, day: "numeric", month: "short", year: "numeric" }),
    dateTime: d.toLocaleString("en-GB", { ...opt, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", ""),
    ref: ord.payment_ref ?? null, provider: "M-Pesa",
    link: receiptLink((lk.data as string | null) ?? null), custWa: ct?.wa_id ? String(ct.wa_id).replace(/\D/g, "") : null,
  };
}

export default function ReceiptPrint({ ws, orderId, onClose }: { ws: Workspace; orderId: string; onClose: () => void }) {
  const sw = ws.language === "sw";
  const T = (en: string, s: string) => (sw ? s : en);
  const [style, setStyleState] = useState<ReceiptStyle>(loadStyle);
  const setStyle = (s: ReceiptStyle) => { setStyleState(s); try { localStorage.setItem(STORE, s); } catch { /* storage blocked */ } };
  const [r, setR] = useState<R | null>(null);
  const [err, setErr] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const meta = RECEIPT_STYLES.find((s) => s.key === style)!;

  useEffect(() => { loadReceipt(ws, orderId).then(setR).catch(() => setErr(T("Couldn't load this sale.", "Imeshindwa kupakia mauzo haya."))); }, [ws.id, orderId]);
  // The QR holds the receipt link (check + order again + staff). A sale without a receipt number yet falls back to WhatsApp.
  const qrTarget = r?.link ?? r?.waLink ?? null;
  useEffect(() => {
    if (!qrTarget) { setQr(null); return; }
    QRCode.toDataURL(qrTarget, { margin: 0, width: 360, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } }).then(setQr).catch(() => setQr(null));
  }, [qrTarget]);
  const [note, setNote] = useState("");
  const flash = (m: string) => { setNote(m); window.setTimeout(() => setNote(""), 2500); };
  const copyLink = async () => {
    if (!r?.link) return;
    try { await navigator.clipboard.writeText(r.link); flash(T("Link copied", "Link imenakiliwa")); }
    catch { window.prompt(T("Copy this link", "Nakili link hii"), r.link); }
  };
  const sendText = r?.link ? `Asante kwa kununua ${r.biz}! Risiti yako ni ${r.no}. Ifungue hapa kuihakiki au kuagiza tena: ${r.link}` : "";
  const sendHref = r?.link && r.custWa ? `https://wa.me/${r.custWa}?text=${encodeURIComponent(sendText)}` : null;
  const newLink = async () => {
    if (!r?.link) return;
    if (!window.confirm(T("Give this sale a new QR link? QR codes already printed for it will stop working.", "Weka link mpya ya QR kwa mauzo haya? QR zilizokwisha chapishwa hazitafanya kazi tena."))) return;
    const { data, error } = await supabase.rpc("rotate_receipt_link", { p_order: orderId });
    if (error) { flash(error.code === "42501" ? T("Only the owner or an admin can do this", "Mmiliki au admin pekee") : T("Couldn't change the link", "Imeshindwa kubadilisha link")); return; }
    setR({ ...r, link: receiptLink(data as string) });
    flash(T("New link ready — print again", "Link mpya iko tayari — chapisha tena"));
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.classList.add("rcpt-open");
    return () => { window.removeEventListener("keydown", onKey); document.body.classList.remove("rcpt-open"); };
  }, []);

  return createPortal(
    <div className="rcpt-root" role="dialog" aria-modal="true" aria-label={T("Print receipt", "Chapisha risiti")}>
      <style>{`
        .rcpt-root{position:fixed;inset:0;z-index:200;background:rgba(10,14,12,.55);backdrop-filter:blur(6px);display:flex;flex-direction:column;overflow:auto}
        .rcpt-bar{position:sticky;top:0;z-index:1;background:var(--panel,#fff);color:var(--ink,#111);padding:12px 16px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;box-shadow:0 1px 0 rgba(0,0,0,.08)}
        .rcpt-bar .chips{display:flex;gap:6px;overflow-x:auto;flex:1 1 320px;padding-bottom:2px}
        .rcpt-bar .chips button{white-space:nowrap;border-radius:999px;padding:8px 12px;min-height:40px}
        .rcpt-bar a.button{display:inline-flex;align-items:center;min-height:40px;padding:8px 14px;border-radius:10px;border:1px solid var(--line,#ddd);color:inherit;text-decoration:none;font-weight:600}
        .rcpt-sub{flex-basis:100%;display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;font-size:13px;color:var(--muted,#667)}
        .rcpt-sub span{flex:1 1 240px}
        .rcpt-sub a,.rcpt-sub .linkish{color:inherit;font-weight:600;text-decoration:underline;text-underline-offset:3px;background:none;border:0;padding:4px 0;min-height:0;cursor:pointer;font-size:13px}
        .rcpt-bar .chips button[aria-pressed=true]{background:${C.green};color:#fff;border-color:${C.green}}
        .rcpt-stage{flex:1;display:flex;justify-content:center;align-items:flex-start;padding:24px 12px 48px}
        .rcpt-paper{box-shadow:0 10px 40px rgba(0,0,0,.35);transform-origin:top center}
        @media (max-width:820px){.rcpt-paper.wide{transform:scale(.46)}}
        @media (max-width:640px){.rcpt-paper.mid{transform:scale(.62)}}
        @media print{
          @page{size:${meta.page};margin:0}
          body.rcpt-open > *:not(.rcpt-root){display:none!important}
          .rcpt-root{position:static;background:none;backdrop-filter:none;overflow:visible}
          .rcpt-bar{display:none!important}
          .rcpt-stage{padding:0;display:block}
          .rcpt-paper{box-shadow:none;transform:none!important}
          *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
        }`}</style>
      <div className="rcpt-bar">
        <b style={{ marginRight: 8 }}>{T("Receipt", "Risiti")}{r ? ` ${r.no}` : ""}</b>
        <div className="chips" role="group" aria-label={T("Receipt design", "Muundo wa risiti")}>
          {RECEIPT_STYLES.map((s) => (
            <button key={s.key} type="button" aria-pressed={style === s.key} onClick={() => setStyle(s.key)}>#{s.n} {sw ? s.sw : s.en}</button>
          ))}
        </div>
        <button type="button" className="primary" disabled={!r} onClick={() => window.print()}>{T("Print", "Chapisha")}</button>
        {sendHref && <a className="button" href={sendHref} target="_blank" rel="noopener noreferrer" title={T("Send the receipt link to the customer on WhatsApp", "Mtumie mteja link ya risiti WhatsApp")}>{T("Send to customer", "Mtumie mteja")}</a>}
        {r?.link && <button type="button" onClick={copyLink}>{T("Copy link", "Nakili link")}</button>}
        <button type="button" onClick={onClose}>{T("Close", "Funga")}</button>
        {r?.link && <div className="rcpt-sub">
          <span>{note || T("The QR opens this receipt online: customers can check it's genuine and order again.", "QR inafungua risiti hii mtandaoni: mteja anahakiki ni halali na kuagiza tena.")}</span>
          <a href={r.link} target="_blank" rel="noopener">{T("Preview", "Angalia")}</a>
          <button type="button" className="linkish" onClick={newLink}>{T("New link", "Link mpya")}</button>
        </div>}
      </div>
      <div className="rcpt-stage" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {err ? <div className="card">{err}</div> : !r ? <div className="card">{T("Loading…", "Inapakia…")}</div> : (
          <div className={"rcpt-paper" + (meta.w > 600 ? " wide" : meta.w > 330 ? " mid" : "")}>
            {style === "till" && <Till r={r} qr={qr} />}
            {style === "letterhead" && <Letterhead r={r} qr={qr} />}
            {style === "stamp" && <Stamp r={r} qr={qr} />}
            {style === "tearoff" && <TearOff r={r} qr={qr} />}
            {style === "mono" && <Mono r={r} qr={qr} />}
            {style === "reorder" && <Reorder r={r} qr={qr} />}
            {style === "bilingual" && <Bilingual r={r} qr={qr} />}
            {style === "shipping" && <Shipping r={r} qr={qr} />}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ---------- shared bits ----------
const Mark = ({ r, size, light }: { r: R; size: number; light?: boolean }) => (
  <div style={{ width: size, height: size, borderRadius: 9999, flexShrink: 0, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: DISPLAY, fontWeight: 800, fontSize: size / 2,
    ...(light ? { border: "3px solid #fff", color: "#fff" } : { background: C.green, color: "#fff" }) }}>{r.biz.trim().charAt(0).toUpperCase()}</div>
);
const Line = ({ k, v, kc = C.muted }: { k: string; v: React.ReactNode; kc?: string }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><span style={{ color: kc }}>{k}</span><span style={{ fontWeight: 600, textAlign: "right" }}>{v}</span></div>
);
const Label = ({ children, color = C.muted }: { children: React.ReactNode; color?: string }) => (
  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", color }}>{children}</span>
);
// The receipt QR with a short two-language caption. Black on white so thermal printers and phone cameras read it.
const Qr = ({ qr, size, caption = true, align = "center", color = C.muted }: { qr: string | null; size: number; caption?: boolean; align?: "center" | "left"; color?: string }) => !qr ? null : (
  <div style={{ display: "flex", flexDirection: align === "center" ? "column" : "row", alignItems: "center", gap: align === "center" ? 6 : 10, flexShrink: 0 }}>
    <img src={qr} alt="QR" width={size} height={size} style={{ width: size, height: size, imageRendering: "pixelated", background: "#fff", padding: 4, boxSizing: "content-box", borderRadius: 4 }} />
    {caption && <span style={{ fontSize: 11, lineHeight: 1.3, color, textAlign: align, maxWidth: align === "center" ? size + 60 : 120 }}>
      <b>Scan: hakiki risiti · agiza tena</b><br />Check receipt · order again
    </span>}
  </div>
);
const Items = ({ r, size = 14, gap = 8 }: { r: R; size?: number; gap?: number }) => (
  <div style={{ display: "flex", flexDirection: "column", gap, fontSize: size }}>{r.items.map((x, i) => <span key={i}>{x}</span>)}</div>
);

// ---------- #1 till slip (80 mm) ----------
function Till({ r, qr }: { r: R; qr: string | null }) {
  return (
    <div style={{ width: 302, minHeight: 600, boxSizing: "border-box", background: C.surface, fontFamily: BODY, color: C.ink, display: "flex", flexDirection: "column" }}>
      <div style={{ background: C.green, color: "#fff", padding: "24px 20px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
        <Mark r={r} size={52} light />
        <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 26, letterSpacing: "-0.02em" }}>{r.biz}</div>
        <div style={{ fontSize: 12 }}>Dar es Salaam{r.bizPhone ? ` · ${r.bizPhone}` : ""}</div>
      </div>
      <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ textAlign: "center" }}><Label color={C.ink}>RISITI · RECEIPT</Label></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
          <Line k="Kumbukumbu Na." v={r.no} /><Line k="Tarehe" v={r.dateTime} /><Line k="Jina" v={r.customer} />{r.place && <Line k="Mahali" v={r.place} />}
        </div>
        <div style={{ borderTop: `2px dashed ${C.line}` }} />
        <Items r={r} />
        <div style={{ borderTop: `2px dashed ${C.line}` }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Jumla · Total</span>
          <span style={{ background: C.honey, color: C.forest, fontWeight: 700, fontSize: 16, padding: "6px 12px", borderRadius: 9999 }}>{r.total}</span>
        </div>
        {r.ref && <div style={{ fontSize: 13 }}><Line k="Muamala M-Pesa" v={r.ref} /></div>}
        <div style={{ borderTop: `2px dashed ${C.line}` }} />
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 18, color: C.greenText }}>Asante kwa kutuamini</div>
          <div style={{ fontSize: 12, color: C.muted }}>Thank you for trusting us. Maswali? Tuandikie WhatsApp.</div>
        </div>
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 4 }}><Qr qr={qr} size={96} /></div>
      </div>
    </div>
  );
}

// ---------- #3 cream letterhead (A5) ----------
function Letterhead({ r, qr }: { r: R; qr: string | null }) {
  const td = { padding: "14px 0", borderBottom: `1px solid ${C.line}` } as const;
  return (
    <div style={{ width: 559, height: 794, boxSizing: "border-box", background: C.cream, color: C.ink, fontFamily: BODY, display: "flex", flexDirection: "column" }}>
      <div style={{ height: 10, background: C.green }} />
      <div style={{ padding: "44px 48px 0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}><Mark r={r} size={48} />
          <div style={{ display: "flex", flexDirection: "column" }}><span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 24 }}>{r.biz}</span><span style={{ fontSize: 12, color: C.muted }}>Dar es Salaam{r.bizPhone ? ` · ${r.bizPhone}` : ""}</span></div></div>
        <div style={{ textAlign: "right", display: "flex", flexDirection: "column" }}><span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 30, color: C.greenText }}>Risiti</span><span style={{ fontSize: 12, color: C.muted }}>Receipt</span></div>
      </div>
      <div style={{ padding: "28px 48px 0", display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16, fontSize: 13 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}><Label>JINA</Label><span style={{ fontWeight: 600 }}>{r.customer}</span>{r.custPhone && <span style={{ color: C.muted }}>{r.custPhone}</span>}{r.place && <span style={{ color: C.muted }}>{r.place}</span>}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}><Label>KUMBUKUMBU NA.</Label><span style={{ fontWeight: 600 }}>{r.no}</span></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}><Label>TAREHE</Label><span style={{ fontWeight: 600 }}>{r.date}</span></div>
      </div>
      <div style={{ margin: "28px 48px 0", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 24, padding: "8px 20px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead><tr style={{ color: C.muted, fontSize: 12, textAlign: "left" }}><th style={{ ...td, padding: "12px 0", fontWeight: 700 }}>Bidhaa · Items</th></tr></thead>
          <tbody>{r.items.map((x, i) => <tr key={i}><td style={i === r.items.length - 1 ? { padding: "14px 0" } : td}>{x}</td></tr>)}</tbody>
        </table>
      </div>
      <div style={{ margin: "20px 48px 0", display: "flex", justifyContent: "space-between", alignItems: "center", background: C.green, color: "#fff", borderRadius: 24, padding: "18px 24px" }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Jumla · Total paid</span>
        <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 28 }}>{r.total}</span>
      </div>
      {r.ref && <div style={{ margin: "16px 48px 0", fontSize: 13, color: C.muted }}>Imelipwa kwa M-Pesa · Muamala: <span style={{ color: C.ink, fontWeight: 600 }}>{r.ref}</span></div>}
      <div style={{ margin: "auto 48px 44px", display: "flex", justifyContent: "space-between", alignItems: "flex-end", fontSize: 13 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 20, color: C.greenText }}>Asante kwa kutuamini.</span>
          <Qr qr={qr} size={72} align="left" />
        </div>
        <span style={{ color: C.muted, textAlign: "right" }}>Sahihi · Signed<br />______________</span>
      </div>
    </div>
  );
}

// ---------- #5 IMELIPWA stamp (A6) ----------
function Stamp({ r, qr }: { r: R; qr: string | null }) {
  return (
    <div style={{ width: 397, height: 559, boxSizing: "border-box", background: C.cream, color: C.ink, fontFamily: BODY, padding: 40, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 22, color: C.greenText }}>{r.biz}</span><Label>{r.no}</Label></div>
      <div style={{ borderTop: `1px solid ${C.line}` }} />
      <Items r={r} />
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 16, paddingTop: 8, borderTop: `1px solid ${C.line}` }}><span>Jumla</span><span>{r.total}</span></div>
      <div style={{ fontSize: 13, color: C.muted, display: "flex", flexDirection: "column", gap: 3 }}><span>Jina: {r.customer}{r.place ? ` · ${r.place}` : ""}</span><span>{r.date}{r.ref ? ` · M-Pesa ${r.ref}` : ""}</span></div>
      <div style={{ alignSelf: "center", marginTop: 4, transform: "rotate(-8deg)", border: `4px solid ${C.greenText}`, outline: `2px solid ${C.greenText}`, outlineOffset: 5, borderRadius: 9999, width: 180, height: 180, boxSizing: "border-box", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, color: C.greenText, textAlign: "center" }}>
        <Label color={C.greenText}>{r.biz.toUpperCase().slice(0, 18)}</Label>
        <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 32 }}>IMELIPWA</span>
        <Label color={C.greenText}>PAID · {r.dateTime.slice(0, 10).replace(/\//g, ".")}</Label>
      </div>
      <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10, fontSize: 13, color: C.muted }}>
        <span>Asante kwa kutuamini.<br />Thank you.</span>
        <Qr qr={qr} size={58} align="left" />
      </div>
    </div>
  );
}

// ---------- #6 two-part tear-off ----------
function TearOff({ r, qr }: { r: R; qr: string | null }) {
  return (
    <div style={{ width: 397, minHeight: 860, boxSizing: "border-box", background: C.surface, color: C.ink, fontFamily: BODY, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "36px 40px 28px", display: "flex", flexDirection: "column", gap: 14, minHeight: 520, boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Mark r={r} size={38} /><span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20 }}>{r.biz}</span></div>
          <span style={{ background: C.mint, color: C.greenText, fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", padding: "6px 10px", borderRadius: 9999, whiteSpace: "nowrap" }}>NAKALA YA MTEJA</span>
        </div>
        <div style={{ fontSize: 12, color: C.muted }}>Customer copy · {r.no} · {r.date}</div>
        <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 14 }}><Items r={r} /></div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.green, color: "#fff", borderRadius: 16, padding: "14px 18px" }}><span style={{ fontWeight: 700 }}>Jumla</span><span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 24 }}>{r.total}</span></div>
        <div style={{ fontSize: 13, color: C.muted, display: "flex", flexDirection: "column", gap: 3 }}><span>Jina: {r.customer}</span>{r.place && <span>Mahali: {r.place}</span>}{r.ref && <span>M-Pesa: {r.ref}</span>}</div>
        <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
          <span style={{ fontSize: 13 }}>Asante kwa kutuamini. Hifadhi risiti hii. · Keep this receipt.</span>
          <Qr qr={qr} size={64} caption={false} />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", color: C.muted, fontSize: 12 }}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" strokeLinecap="round"><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" /></svg>
        <div style={{ flexGrow: 1, borderTop: `2px dashed ${C.muted}` }} /><span>kata hapa</span>
      </div>
      <div style={{ padding: "26px 40px 36px", display: "flex", flexDirection: "column", gap: 12, background: C.cream, flexGrow: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 18 }}>{r.no}</span><Label>NAKALA YA DUKA</Label></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, fontSize: 13 }}>
          <div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: C.muted }}>Jina</span><span style={{ fontWeight: 600 }}>{r.customer}</span></div>
          <div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: C.muted }}>Simu</span><span style={{ fontWeight: 600 }}>{r.custPhone ?? "—"}</span></div>
          <div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: C.muted }}>Jumla</span><span style={{ fontWeight: 600 }}>{r.total}</span></div>
          <div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: C.muted }}>M-Pesa</span><span style={{ fontWeight: 600 }}>{r.ref ?? "—"}</span></div>
        </div>
        {r.place && <div style={{ fontSize: 13, color: C.muted }}>Mahali: <b style={{ color: C.ink }}>{r.place}{r.landmark ? ` (${r.landmark})` : ""}</b></div>}
        <div style={{ fontSize: 13, color: C.muted }}>Bidhaa: {r.items.join(", ")}</div>
        <div style={{ fontSize: 13, color: C.muted }}>Imetumwa na · Sent by: ________________</div>
      </div>
    </div>
  );
}

// ---------- #8 black & white thermal (default) ----------
function Mono({ r, qr }: { r: R; qr: string | null }) {
  return (
    <div style={{ width: 302, minHeight: 600, boxSizing: "border-box", background: "#fff", color: "#000", fontFamily: BODY, padding: "24px 18px", display: "flex", flexDirection: "column", gap: 12, fontSize: 13 }}>
      <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <div style={{ width: 44, height: 44, borderRadius: 9999, border: "3px solid #000", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: DISPLAY, fontWeight: 800, fontSize: 22 }}>{r.biz.trim().charAt(0).toUpperCase()}</div>
        <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 24 }}>{r.biz.toUpperCase()}</span>
        <span>Dar es Salaam</span>
        {r.bizPhone && <span>Simu: {r.bizPhone}</span>}
      </div>
      <div style={{ textAlign: "center", fontWeight: 700, letterSpacing: "0.08em", borderTop: "2px solid #000", borderBottom: "2px solid #000", padding: "6px 0" }}>RISITI YA MALIPO</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, fontFamily: MONO }}>
        <Line k="KUMB NA:" v={r.no} kc="#000" /><Line k="TAREHE:" v={r.dateTime} kc="#000" /><Line k="JINA:" v={r.customer.toUpperCase()} kc="#000" />{r.place && <Line k="MAHALI:" v={r.place.toUpperCase()} kc="#000" />}
      </div>
      <div style={{ borderTop: "1px dashed #000" }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontFamily: MONO }}>{r.items.map((x, i) => <span key={i}>{x.toUpperCase()}</span>)}</div>
      <div style={{ borderTop: "1px dashed #000" }} />
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 18 }}><span>JUMLA</span><span>{r.total}</span></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, fontFamily: MONO }}>
        <Line k="MALIPO:" v="M-PESA" kc="#000" />{r.ref && <Line k="MUAMALA:" v={r.ref} kc="#000" />}
      </div>
      <div style={{ borderTop: "1px dashed #000" }} />
      <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>ASANTE KWA KUTUAMINI</span><span>Thank you · Karibu tena</span>
      </div>
      {qr && <div style={{ marginTop: 10, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <img src={qr} alt="QR" width={120} height={120} style={{ width: 120, height: 120, imageRendering: "pixelated" }} />
        <span style={{ fontWeight: 700, fontSize: 12, letterSpacing: "0.04em" }}>SCAN: HAKIKI · AGIZA TENA</span>
        <span style={{ fontSize: 11 }}>Check receipt · Order again</span>
      </div>}
      <div style={{ textAlign: "center", fontFamily: MONO, fontSize: 12 }}>{r.no}</div>
    </div>
  );
}

// ---------- #10 reorder card with QR (A6) ----------
function Reorder({ r, qr }: { r: R; qr: string | null }) {
  return (
    <div style={{ width: 397, height: 559, boxSizing: "border-box", background: C.cream, color: C.ink, fontFamily: BODY, padding: 40, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Mark r={r} size={40} /><div style={{ display: "flex", flexDirection: "column" }}><span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20 }}>{r.biz}</span><span style={{ fontSize: 12, color: C.muted }}>Risiti · {r.no} · {r.date}</span></div></div>
      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 24, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 8, fontSize: 14 }}>
        <Items r={r} />
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 16, borderTop: `1px solid ${C.line}`, paddingTop: 8 }}><span>Jumla</span><span>{r.total}</span></div>
        <div style={{ fontSize: 12, color: C.muted }}>{r.customer}{r.place ? ` · ${r.place}` : ""}{r.ref ? ` · M-Pesa ${r.ref}` : ""}</div>
      </div>
      <div style={{ background: C.forest, color: "#fff", borderRadius: 24, padding: 20, display: "flex", gap: 16, alignItems: "center", marginTop: "auto" }}>
        <div style={{ width: 110, height: 110, flexShrink: 0, background: "#fff", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", padding: 8, boxSizing: "border-box" }}>
          {qr ? <img src={qr} alt="WhatsApp QR" style={{ width: "100%", height: "100%" }} /> : <span style={{ color: C.muted, fontSize: 12 }}>WhatsApp</span>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>Unahitaji tena?</span>
          <span style={{ fontSize: 13 }}>{r.link ? "Scan: agiza tena kwa WhatsApp na hakiki risiti. · Order again & check your receipt." : "Scan to message us on WhatsApp."}</span>
          {r.bizPhone && <span style={{ fontSize: 13, fontWeight: 700, color: C.honey }}>{r.bizPhone}</span>}
        </div>
      </div>
    </div>
  );
}

// ---------- #13 Kiswahili | English (A5 landscape) ----------
function Bilingual({ r, qr }: { r: R; qr: string | null }) {
  const col = (lang: string, title: string, k: [string, string, string, string, string], thanks: string, pad: string) => (
    <div style={{ padding: pad, display: "flex", flexDirection: "column", gap: 12 }}>
      <Label color={C.greenText}>{lang}</Label>
      <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 26 }}>{title}</span>
      <span style={{ fontSize: 14 }}>{k[0]}: <b>{r.customer}</b></span>
      {r.place && <span style={{ fontSize: 14 }}>{k[4]}: <b>{r.place}</b></span>}
      <span style={{ fontSize: 14 }}>{k[1]}: <b>{r.items.join(", ")}</b></span>
      <span style={{ fontSize: 14 }}>{k[2]}: <b>{r.date}</b></span>
      {r.ref && <span style={{ fontSize: 14 }}>{k[3]}: <b>{r.ref}</b></span>}
      <span style={{ marginTop: "auto", fontSize: 14, color: C.muted }}>{thanks}</span>
    </div>
  );
  return (
    <div style={{ width: 794, height: 559, boxSizing: "border-box", background: C.cream, color: C.ink, fontFamily: BODY, display: "flex", flexDirection: "column" }}>
      <div style={{ background: C.green, color: "#fff", padding: "24px 44px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}><Mark r={r} size={42} light /><span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 24 }}>{r.biz}</span></div>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.08em" }}>KUMBUKUMBU NA. {r.no}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", flexGrow: 1 }}>
        <div style={{ borderRight: `1px solid ${C.line}`, display: "flex" }}>{col("KISWAHILI", "Risiti ya malipo", ["Jina", "Bidhaa", "Tarehe", "Muamala M-Pesa", "Mahali"], "Asante kwa kutuamini.", "32px 44px")}</div>
        {col("ENGLISH", "Payment receipt", ["Name", "Items", "Date", "M-Pesa ref", "Location"], "Thank you for trusting us.", "32px 44px")}
      </div>
      <div style={{ margin: "0 44px 36px", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 24, padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 700 }}>Jumla · Total</span>
        <span style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, color: C.greenText }}>{r.total}</span>
          <Qr qr={qr} size={52} caption={false} />
        </span>
      </div>
    </div>
  );
}

// ---------- #16 delivery label + receipt (4×6 in) ----------
function Shipping({ r, qr }: { r: R; qr: string | null }) {
  return (
    <div style={{ width: 384, height: 576, boxSizing: "border-box", background: "#fff", color: C.ink, fontFamily: BODY, border: `3px solid ${C.ink}`, display: "flex", flexDirection: "column" }}>
      <div style={{ background: C.green, color: "#fff", padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 22 }}>{r.biz}</span><Label color="#fff">{r.no}</Label></div>
      <div style={{ padding: "18px 20px", borderBottom: `3px solid ${C.ink}`, display: "flex", flexDirection: "column", gap: 6 }}>
        <Label>KWA · TO</Label>
        <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, lineHeight: 1 }}>{r.customer}</span>
        {r.custPhone && <span style={{ fontSize: 15 }}>{r.custPhone}</span>}
        {r.place ? <span style={{ fontSize: 15, fontWeight: 600 }}>{r.place}</span> : <span style={{ fontSize: 15, color: C.muted }}>Mahali: ______________________</span>}
        {r.landmark && <span style={{ fontSize: 13, color: C.muted }}>{r.landmark}</span>}
        {r.altPhone && <span style={{ fontSize: 13 }}>Simu nyingine: {r.altPhone}</span>}
      </div>
      <div style={{ padding: "14px 20px", borderBottom: `3px solid ${C.ink}`, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, fontSize: 13 }}>
        <div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: C.muted }}>Kutoka</span><span style={{ fontWeight: 600 }}>{r.biz}{r.bizPhone ? `, ${r.bizPhone}` : ""}</span></div>
        <div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: C.muted }}>Tarehe</span><span style={{ fontWeight: 600 }}>{r.date}</span></div>
        <div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: C.muted }}>Usafiri</span><span style={{ fontWeight: 600 }}>{r.deliveryNote ? r.deliveryNote.slice(0, 40) : "__________"}</span></div>
        <div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: C.muted }}>Vipande</span><span style={{ fontWeight: 600 }}>{r.items.length}</span></div>
      </div>
      <div style={{ padding: "14px 20px", display: "flex", gap: 12, flexGrow: 1, alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 }}>
          <Label>NDANI · CONTENTS</Label>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{r.items.join(" · ")}</span>
          {r.ref && <span style={{ fontSize: 13, color: C.muted }}>Muamala M-Pesa: {r.ref}</span>}
        </div>
        <Qr qr={qr} size={72} caption={false} />
      </div>
      <div style={{ background: C.ink, color: "#fff", padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}><span style={{ fontWeight: 700, letterSpacing: "0.08em", fontSize: 13 }}>IMELIPWA · USILIPE TENA</span><span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 22, whiteSpace: "nowrap" }}>{r.total}</span></div>
    </div>
  );
}
