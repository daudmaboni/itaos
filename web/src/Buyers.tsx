// "Buyers" (Wateja walionunua): everyone who has paid, as a small customer database — corrected name,
// WhatsApp + second phone, region / district / area / landmark, delivery note, orders, total spent and the
// last purchase. Locations (and names / phones from "Name 07xx… Town" delivery messages) are suggested
// from the chat and marked "suggested" until the owner saves them. Data: list_buyers / save_customer
// (migration 0054). The saved details feed Find a payment and printed receipts.
import { errText } from "./errText";
import { useRemembered } from "./remember";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase, callFn, Workspace, money, canEdit, localDay } from "./lib";
import { useBackLayer } from "./backStack";

export type Buyer = {
  contact_id: string; wa_name: string | null; full_name: string | null; phone: string | null; alt_phone: string | null;
  delivery_place: string | null; region: string | null; district: string | null; area: string | null; landmark: string | null; delivery_note: string | null;
  location_source: "auto" | "owner" | null; location_evidence: string | null;
  // where the name came from (0056): typed by the owner, read by Kito in the chat, the delivery message, or the saved label cleaned
  name_source: "auto" | "owner" | "kito" | "clean" | null; name_evidence?: string | null; receiver_name?: string | null;
  orders: number; spent: number; currency: string | null; first_at: string | null; last_at: string | null;
  last_conversation_id: string | null; last_receipt: string | null; products: string | null;
};

export const REGIONS = ["Arusha", "Dar es Salaam", "Dodoma", "Geita", "Iringa", "Kagera", "Katavi", "Kigoma", "Kilimanjaro", "Lindi", "Manyara",
  "Mara", "Mbeya", "Morogoro", "Mtwara", "Mwanza", "Njombe", "Pwani", "Rukwa", "Ruvuma", "Shinyanga", "Simiyu", "Singida", "Songwe",
  "Tabora", "Tanga", "Zanzibar"];

export const local = (wa: string | null | undefined) => { if (!wa) return ""; const d = wa.replace(/\D/g, ""); return d.startsWith("255") && d.length === 12 ? "0" + d.slice(3) : "+" + d; };
// The delivery location exactly as the customer wrote it; the region is added only when their words don't already say it.
export const placeOf = (b: Pick<Buyer, "delivery_place" | "area" | "district" | "region">) => {
  if (b.delivery_place) return b.region && !b.delivery_place.toLowerCase().includes(b.region.toLowerCase().split(" ")[0]) ? `${b.delivery_place} · ${b.region}` : b.delivery_place;
  return [b.area, b.district, b.region].filter(Boolean).join(", ");
};
// A name or place itaOS guessed (not read from the chat, not typed by the owner) is worth a look.
const toCheck = (b: Buyer) => b.location_source === "auto" || b.name_source === "auto" || b.name_source === "clean" || !b.full_name;
/** Places typed all in small or all in capital letters get tidy capitals ("tanga" → "Tanga", "ROMBO - TARAKEA" → "Rombo - Tarakea"). Mixed case is kept as typed. */
const tidy = (s: string) => (s && (s === s.toLowerCase() || s === s.toUpperCase()) ? s.toLowerCase().replace(/(^|[\s,./(-])(\p{L})/gu, (_m, a, c) => a + c.toUpperCase()) : s);
export const initials = (n: string | null) => { const w = (n ?? "").trim().split(/\s+/).filter((x) => /\p{L}/u.test(x)); return w.length ? (w[0][0] + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase() : ""; };
/** A steady colour per customer for the initials circle. */
export const hue = (id: string) => { let h = 2166136261; for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) % 360; };
// One formatter for every row (building one per call made a 400-buyer list freeze the phone).
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" });
const day = (iso: string | null) => iso ? DAY.format(new Date(iso)) : "–";

export default function Buyers({ ws }: { ws: Workspace }) {
  const sw = ws.language === "sw";
  const T = (en: string, s: string) => (sw ? s : en);
  const editor = canEdit(ws);
  const [q, setQ] = useState(() => decodeURIComponent(location.hash.match(/#buyers\/q=([^&]+)/)?.[1] ?? ""));
  const [region, setRegion] = useRemembered<string>("buyers-region", "");
  const [only, setOnly] = useState<"all" | "nolocation" | "suggested">("all");
  const [rows, setRows] = useState<Buyer[] | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const seq = useRef(0);

  const load = async () => {
    const my = ++seq.current;
    const { data, error } = await supabase.rpc("list_buyers", { p_ws: ws.id, p_q: q.trim() || null, p_region: region || null });
    if (my !== seq.current) return;
    if (error) { setErr(errText(error)); setRows([]); return; }
    setErr(""); setRows((data as Buyer[]) ?? []);
  };
  useEffect(() => { const t = window.setTimeout(load, q ? 300 : 0); return () => window.clearTimeout(t); }, [q, region, ws.id]);
  // Pull-to-refresh: reload quietly (pullRefresh.ts tags new rows).
  const pullRef = useRef(load); pullRef.current = load;
  useEffect(() => { const f = () => { void pullRef.current(); }; window.addEventListener("itaos-refresh", f); return () => window.removeEventListener("itaos-refresh", f); }, []);

  const shown = useMemo(() => (rows ?? []).filter((b) =>
    only === "all" ? true : only === "nolocation" ? !b.region && !b.delivery_place : toCheck(b)), [rows, only]);
  const counts = useMemo(() => ({
    all: rows?.length ?? 0,
    nolocation: (rows ?? []).filter((b) => !b.region && !b.delivery_place).length,
    suggested: (rows ?? []).filter(toCheck).length,
  }), [rows]);
  const regionsInData = useMemo(() => Array.from(new Set([...(rows ?? []).map((b) => b.region).filter(Boolean) as string[]])).sort(), [rows]);

  const openB = open ? (rows ?? []).find((b) => b.contact_id === open) ?? null : null;
  const csv = () => {
    const head = ["Name", "WhatsApp name", "Phone", "Second phone", "Delivery location", "Region", "District/town", "Area", "Landmark", "Delivery note", "Location confirmed", "Orders", "Total spent", "Currency", "First purchase", "Last purchase", "Last receipt", "Products"];
    const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = shown.map((b) => [b.full_name ?? b.wa_name, b.wa_name, local(b.phone), b.alt_phone, b.delivery_place, b.region, b.district, b.area, b.landmark, b.delivery_note,
      b.location_source === "owner" ? "yes" : b.region ? "suggested" : "", b.orders, Math.round(b.spent), b.currency, day(b.first_at), day(b.last_at), b.last_receipt, b.products].map(esc).join(","));
    const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${ws.name.replace(/\W+/g, "-")}-buyers-${localDay(new Date(), ws.timezone || "Africa/Dar_es_Salaam")}.csv`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="stack" style={{ display: "grid", gap: 16 }}>
      <style>{`.by-layer .by-modal{position:relative;z-index:1;width:min(680px,100%);max-height:calc(100dvh - 48px);display:flex;flex-direction:column;padding:0;gap:0;overflow:hidden;
          border-radius:24px;box-shadow:0 30px 80px -20px rgba(0,0,0,.45),0 2px 8px rgba(0,0,0,.12);animation:dr-pop-in .3s cubic-bezier(.2,.9,.3,1.15) both}
        .by-layer.closing .by-modal{animation:by-out .18s ease-in both}
        @keyframes by-out{to{opacity:0;transform:translateY(8px) scale(.97)}}
        .by-m-head{flex:none;display:grid;grid-template-columns:56px minmax(0,1fr) auto;gap:14px;align-items:start;padding:20px 20px 16px;border-bottom:1px solid var(--line)}
        .by-av.big{width:56px;height:56px;font-size:19px}
        .by-m-title{display:grid;gap:3px;min-width:0}
        .by-m-title h2{margin:0;font-size:20px;letter-spacing:-.01em;overflow-wrap:anywhere}
        .by-x{all:unset;box-sizing:border-box;cursor:pointer;width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:var(--raised);color:var(--ink)}
        .by-x:hover{background:var(--line)}.by-x:focus-visible{box-shadow:0 0 0 2px var(--accent)}
        .by-m-body{flex:1 1 auto;overflow:auto;overscroll-behavior:contain;padding:16px 20px 22px;display:grid;gap:16px;align-content:start}
        .by-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
        .by-stats>span{display:grid;gap:3px;padding:10px 12px;border-radius:14px;background:var(--raised);min-width:0}
        .by-stats b{font-size:15px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .by-m-prods{display:grid;gap:6px}.by-m-prods>div{display:flex;flex-wrap:wrap;gap:5px}.by-m-prods .chip{margin:0}
        .by-modal .by-edit{padding:0;border-bottom:0}
        @media (max-width:640px){
          .by-layer{place-items:end stretch;padding:0}
          .by-layer .by-modal{width:100%;max-height:92dvh;border-radius:24px 24px 0 0;animation:dr-sheet-up .3s cubic-bezier(.2,.8,.2,1) both}
          .by-layer.closing .by-modal{animation:dr-sheet-down .18s ease-in both}
          .by-layer .by-modal::before{content:"";display:block;flex:none;width:38px;height:5px;border-radius:3px;background:var(--line-2);margin:8px auto 0}
          .by-m-head{grid-template-columns:48px minmax(0,1fr) auto;gap:12px;padding:12px 16px 14px}
          .by-av.big{width:48px;height:48px;font-size:17px}
          .by-m-title h2{font-size:18px}
          .by-m-body{padding:14px 16px calc(22px + env(safe-area-inset-bottom))}
          .by-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
        }
        .by-filters{display:flex;gap:6px;flex-wrap:wrap}
        .by-filters button{all:unset;box-sizing:border-box;cursor:pointer;font:500 13px/1 var(--font);padding:9px 14px;min-height:38px;display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:var(--raised);border:1px solid transparent}
        .by-filters button:hover{border-color:var(--line-2)}.by-filters button[aria-pressed=true]{background:var(--ink);color:var(--card)}
        .by-filters button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
        .by-edit{display:grid;gap:10px;padding:4px 0 18px;border-bottom:1px solid var(--line)}
        .by-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
        .by-grid label{display:grid;gap:4px;font-size:13px;color:var(--muted);min-width:0}
        .by-grid input,.by-grid select,.by-grid textarea{width:100%;min-width:0;box-sizing:border-box}
        .by-grid input,.by-grid select,.by-grid textarea{font:inherit;font-size:15px;color:var(--ink);padding:10px 12px;border:1px solid var(--line-2);border-radius:10px;background:var(--card)}
        .by-wide{grid-column:1/-1}`}</style>
      <section className="card flat" style={{ display: "grid", gap: 10 }}>
        <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
          <div>
            <h2 style={{ margin: 0 }}>{T("Buyers", "Wateja walionunua")} {rows && <span className="muted" style={{ fontWeight: 400 }}>{counts.all}</span>}</h2>
            <span className="small muted">{T("Everyone who has paid, with their corrected name, phones and where they are. Receipts and payment search use these details.",
              "Kila aliyelipa, na jina sahihi, simu na mahali alipo. Risiti na utafutaji wa malipo vinatumia taarifa hizi.")}</span>
          </div>
          {shown.length > 0 && <button type="button" className="small" onClick={csv}>{T("Download CSV", "Pakua CSV")}</button>}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={T("Name, phone, place or product", "Jina, simu, mahali au bidhaa")}
            aria-label={T("Search buyers", "Tafuta wateja")} style={{ flex: "1 1 260px", minWidth: 0, fontSize: 16, padding: "11px 14px" }} />
          <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label={T("Region", "Mkoa")} style={{ fontSize: 15, padding: "10px 12px" }}>
            <option value="">{T("All regions", "Mikoa yote")}</option>
            {regionsInData.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="by-filters" role="group" aria-label={T("Show", "Onyesha")}>
          <button type="button" aria-pressed={only === "all"} onClick={() => setOnly("all")}>{T("All", "Wote")} <span className="muted">{counts.all}</span></button>
          <button type="button" aria-pressed={only === "suggested"} onClick={() => setOnly("suggested")}>{T("To check", "Za kuhakiki")} <span className="muted">{counts.suggested}</span></button>
          <button type="button" aria-pressed={only === "nolocation"} onClick={() => setOnly("nolocation")}>{T("No location", "Bila mahali")} <span className="muted">{counts.nolocation}</span></button>
        </div>
        {err && <span className="err small">{T("Couldn't load buyers right now. Try again in a moment.", "Imeshindwa kupakia wateja sasa. Jaribu tena baada ya muda.")}</span>}
      </section>

      {rows && shown.length === 0 && !err && <div className="empty">{q || region ? <span className="dead-end"><b>{T("No buyers match that.", "Hakuna mteja anayelingana.")}</b><span className="dead-acts">{q && <button type="button" className="small" onClick={() => setQ("")}>{T("Clear the search", "Futa utafutaji")}</button>}{region && <button type="button" className="small" onClick={() => setRegion("")}>{T("All regions", "Mikoa yote")}</button>}<a className="small" href="#receipts">{T("Search payments instead →", "Tafuta kwenye malipo →")}</a></span></span> : only !== "all" ? T("Nothing here — all done.", "Hakuna hapa — yote yamekamilika.") : T("No paid customers yet.", "Bado hakuna mteja aliyelipa.")}</div>}

      {shown.length > 0 && (
        <section className="card by-list" aria-label={T("Buyers", "Wateja walionunua")}>
          {shown.map((b) => {
            const isOpen = open === b.contact_id;
            const place = placeOf({ ...b, delivery_place: tidy(b.delivery_place ?? "") || null, district: tidy(b.district ?? "") || null, area: tidy(b.area ?? "") || null });
            const check = toCheck(b);
            const prods = (b.products ?? "").split(",").map((x) => x.trim()).filter(Boolean);
            const toggle = () => setOpen(isOpen ? null : b.contact_id);
            return (
              <div key={b.contact_id} className="by-item" data-rid={b.contact_id}>
                <div role="button" tabIndex={0} className="by-row" aria-haspopup="dialog" onClick={toggle}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}>
                  <span className="by-av" style={{ ["--h" as any]: hue(b.contact_id) }} aria-hidden>{b.full_name && initials(b.full_name) ||
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>}</span>
                  <span className="by-main">
                    <span className="by-name">
                      {b.full_name ? <b>{b.full_name}</b> : <b className="muted">{T("Customer", "Mteja")}</b>}
                      {check && <span className="by-dot" title={T("Name or place suggested by itaOS. Open to check it.", "Jina au mahali vimependekezwa na itaOS. Fungua uhakiki.")} aria-label={T("to check", "ya kuhakiki")} />}
                    </span>
                    <span className="by-phone">{local(b.phone)}{b.alt_phone ? ` · ${b.alt_phone}` : ""}</span>
                    <span className={"by-place" + (place ? "" : " none")}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z" /><circle cx="12" cy="9" r="2.5" /></svg>
                      {place || T("No location yet", "Bado hakuna mahali")}
                      {place && b.location_source === "owner" && <span className="by-ok" title={T("Confirmed by you", "Umethibitisha")}>✓</span>}
                    </span>
                  </span>
                  <span className="by-money">
                    <b>{money(b.spent, b.currency || "TZS")}</b>
                    <span>{b.orders === 1 ? T("1 order", "Oda 1") : T(`${b.orders} orders`, `Oda ${b.orders}`)}</span>
                    <span>{day(b.last_at)}</span>
                  </span>
                  {prods.length > 0 && <span className="by-prods">{prods.slice(0, 4).map((x) => <span key={x} className="chip">{x}</span>)}{prods.length > 4 && <span className="chip">+{prods.length - 4}</span>}</span>}
                </div>
              </div>
            );
          })}
        </section>
      )}
      {openB && <BuyerModal b={openB} T={T} editor={editor} onClose={() => setOpen(null)}
        onSaved={(nb) => { setRows((rs) => rs?.map((x) => x.contact_id === nb.contact_id ? nb : x) ?? rs); }} />}
    </div>
  );
}

/** Freeze the page behind the popup (iOS-safe: pins the body and puts the scroll back after). */
function lockScroll() {
  const y = window.scrollY, b = document.body.style;
  const prev = { position: b.position, top: b.top, left: b.left, right: b.right, width: b.width, overflow: b.overflow };
  Object.assign(b, { position: "fixed", top: `-${y}px`, left: "0", right: "0", width: "100%", overflow: "hidden" });
  document.documentElement.classList.add("sheet-open");
  return () => { Object.assign(b, prev); document.documentElement.classList.remove("sheet-open"); window.scrollTo(0, y); };
}

/** One buyer in a popup over the blurred page: centred card on computers, a sheet from the bottom on phones.
 *  Closes with ×, Esc, a tap on the blurred background, or when you follow a link (Open chat, receipt). */
function BuyerModal({ b, T, editor, onClose, onSaved }: { b: Buyer; T: (en: string, s: string) => string; editor: boolean; onClose: () => void; onSaved: (b: Buyer) => void }) {
  const [closing, setClosing] = useState(false);
  const close = () => { if (closing) return; setClosing(true); window.setTimeout(onClose, 180); };
  const closeRef = useRef(close); closeRef.current = close;
  useBackLayer(true, () => closeRef.current()); // phone Back closes the buyer card
  const xBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const unlock = lockScroll();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    const nav = () => onClose(); // a link inside (Open chat, receipt) moved to another page
    window.addEventListener("keydown", esc); window.addEventListener("hashchange", nav);
    xBtn.current?.focus({ preventScroll: true });
    return () => { unlock(); window.removeEventListener("keydown", esc); window.removeEventListener("hashchange", nav); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const place = placeOf({ ...b, delivery_place: tidy(b.delivery_place ?? "") || null, district: tidy(b.district ?? "") || null, area: tidy(b.area ?? "") || null });
  const prods = (b.products ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const cur = b.currency || "TZS";
  return createPortal(
    <div className={"dr-layer by-layer" + (closing ? " closing" : "")} data-noswipe role="dialog" aria-modal="true" aria-labelledby="by-m-h">
      <div className="dr-scrim" onClick={close} aria-hidden />
      <div className="card by-modal">
        <div className="by-m-head">
          <span className="by-av big" style={{ ["--h" as any]: hue(b.contact_id) }} aria-hidden>{b.full_name && initials(b.full_name) ||
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>}</span>
          <div className="by-m-title">
            <h2 id="by-m-h">{b.full_name || T("Customer", "Mteja")}</h2>
            <span className="by-phone">{local(b.phone)}{b.alt_phone ? ` · ${b.alt_phone}` : ""}</span>
            <span className={"by-place" + (place ? "" : " none")}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z" /><circle cx="12" cy="9" r="2.5" /></svg>
              {place || T("No location yet", "Bado hakuna mahali")}
              {place && b.location_source === "owner" && <span className="by-ok">✓ {T("confirmed", "imethibitishwa")}</span>}
            </span>
          </div>
          <button ref={xBtn} type="button" className="by-x" aria-label={T("Close", "Funga")} onClick={close}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <div className="by-m-body">
          {toCheck(b) && <div className="finding warn small"><b>{T("Worth a check", "Inafaa kuhakiki")}</b> {T("itaOS suggested this name or place from the chat. Fix it if needed and tap Confirm and save.", "itaOS imependekeza jina au mahali hapa kutoka kwenye chat. Rekebisha ikihitajika kisha bonyeza Thibitisha na uhifadhi.")}</div>}
          <div className="by-stats">
            <span><span className="small muted">{T("Total spent", "Jumla aliyotumia")}</span><b>{money(b.spent, cur)}</b></span>
            <span><span className="small muted">{T("Orders", "Oda")}</span><b>{b.orders}</b></span>
            <span><span className="small muted">{T("First purchase", "Alinunua kwanza")}</span><b>{day(b.first_at)}</b></span>
            <span><span className="small muted">{T("Last purchase", "Alinunua mwisho")}</span><b>{day(b.last_at)}</b></span>
          </div>
          {prods.length > 0 && <div className="by-m-prods"><span className="small muted">{T("Bought", "Amenunua")}</span><div>{prods.map((x) => <span key={x} className="chip">{x}</span>)}</div></div>}
          <BuyerEdit b={b} T={T} editor={editor} onSaved={onSaved} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function BuyerEdit({ b, T, editor, onSaved }: { b: Buyer; T: (en: string, s: string) => string; editor: boolean; onSaved: (b: Buyer) => void }) {
  const [f, setF] = useState({ full_name: b.full_name ?? "", alt_phone: b.alt_phone ?? "", delivery_place: b.delivery_place ?? "", region: b.region ?? "", district: b.district ?? "", area: b.area ?? "", landmark: b.landmark ?? "", delivery_note: b.delivery_note ?? "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const id = (k: string) => `by-${b.contact_id}-${k}`;
  const save = async () => {
    setBusy(true); setMsg("");
    const { error } = await supabase.rpc("save_customer", { p_contact: b.contact_id, p_full_name: f.full_name, p_alt_phone: f.alt_phone, p_delivery_place: f.delivery_place, p_region: f.region,
      p_district: f.district, p_area: f.area, p_landmark: f.landmark, p_delivery_note: f.delivery_note });
    setBusy(false);
    if (error) { setMsg(T("Couldn't save. Try again.", "Imeshindwa kuhifadhi. Jaribu tena.")); return; }
    const hasLoc = !!(f.delivery_place || f.region || f.district || f.area);
    onSaved({ ...b, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null])) as Partial<Buyer>,
      location_source: hasLoc ? "owner" : null, name_source: f.full_name.trim() ? "owner" : null, location_evidence: null } as Buyer);
    setMsg(T("Saved", "Imehifadhiwa"));
  };
  const [reading, setReading] = useState(false);
  const reread = async () => {
    setReading(true); setMsg("");
    try {
      await callFn("names", { contact_id: b.contact_id });
      const { data } = await supabase.from("contacts").select("full_name,name_source,name_evidence,receiver_name").eq("id", b.contact_id).single();
      if (data) { const nb = { ...b, ...(data as Partial<Buyer>) } as Buyer; onSaved(nb); setF((x) => ({ ...x, full_name: nb.full_name ?? "" })); }
      setMsg(data?.name_source === "kito" ? T("Name read from the chat", "Jina limesomwa kwenye chat") : T("No name in the chat — kept the best guess", "Hakuna jina kwenye chat — tumebaki na makadirio bora"));
    } catch { setMsg(T("Kito couldn't read the chat now. Try again.", "Kito hakuweza kusoma chat sasa. Jaribu tena.")); }
    setReading(false);
  };
  const nameFrom = b.name_source === "owner" ? T("Name typed by you. Receipts use it as it is.", "Jina umeandika wewe. Risiti zinalitumia kama lilivyo.")
    : b.name_source === "kito" ? T("Name Kito found in the chat", "Jina Kito alilopata kwenye chat")
    : b.name_source === "auto" ? T("Name taken from their delivery message", "Jina limetoka kwenye ujumbe wao wa mzigo")
    : b.name_source === "clean" ? T(`Guessed from the saved name "${b.wa_name ?? ""}"`, `Limekadiriwa kutoka jina lililohifadhiwa "${b.wa_name ?? ""}"`)
    : T("No name found yet. Receipts show the phone number.", "Bado jina halijapatikana. Risiti zinaonyesha namba ya simu.");
  return (
    <div className="by-edit">
      <span className="small muted" style={{ overflowWrap: "anywhere" }}>{nameFrom}{b.name_source === "kito" && b.name_evidence ? <>: <i>“{b.name_evidence}”</i></> : null}
        {b.receiver_name ? <> · {T("parcel for", "mzigo ni wa")} <b>{b.receiver_name}</b></> : null}</span>
      {b.location_source === "auto" && b.location_evidence && (
        <span className="small muted">{T("Taken from their delivery message:", "Imetoka kwenye ujumbe wao wa mzigo:")} <i>“{b.location_evidence}”</i></span>
      )}
      <div className="by-grid">
        <label htmlFor={id("n")}>{T("Full name", "Jina kamili")}<input id={id("n")} value={f.full_name} onChange={set("full_name")} disabled={!editor} placeholder={b.wa_name ?? ""} /></label>
        <label>{T("WhatsApp number", "Namba ya WhatsApp")}<input value={local(b.phone)} disabled readOnly /></label>
        <label htmlFor={id("p")}>{T("Second phone", "Simu nyingine")}<input id={id("p")} value={f.alt_phone} onChange={set("alt_phone")} disabled={!editor} inputMode="tel" placeholder="07xx xxx xxx" /></label>
        <label htmlFor={id("dp")} className="by-wide">{T("Delivery location — as the customer wrote it", "Mahali pa kupelekea — kama mteja alivyoandika")}<input id={id("dp")} value={f.delivery_place} onChange={set("delivery_place")} disabled={!editor} placeholder={T("e.g. Kyela, boda Kasumulu", "mfano Kyela, boda Kasumulu")} /></label>
        <label htmlFor={id("r")}>{T("Region", "Mkoa")}
          <select id={id("r")} value={f.region} onChange={set("region")} disabled={!editor}>
            <option value="">{T("—", "—")}</option>
            {[...REGIONS, ...(f.region && !REGIONS.includes(f.region) ? [f.region] : [])].map((r) => <option key={r} value={r}>{r}</option>)}
          </select></label>
        <label htmlFor={id("d")}>{T("District / town", "Wilaya / mji")}<input id={id("d")} value={f.district} onChange={set("district")} disabled={!editor} placeholder={T("e.g. Kyela", "mfano Kyela")} /></label>
        <label htmlFor={id("a")}>{T("Area / street (optional)", "Eneo / mtaa (si lazima)")}<input id={id("a")} value={f.area} onChange={set("area")} disabled={!editor} placeholder={T("e.g. Mbezi Beach", "mfano Mbezi Beach")} /></label>
        <label htmlFor={id("l")} className="by-wide">{T("Landmark", "Alama ya eneo")}<input id={id("l")} value={f.landmark} onChange={set("landmark")} disabled={!editor} placeholder={T("e.g. near Africana, Goba mti pesa", "mfano karibu na Africana, Goba mti pesa")} /></label>
        <label htmlFor={id("dn")} className="by-wide">{T("Delivery note", "Maelezo ya kusafirisha")}<textarea id={id("dn")} rows={2} value={f.delivery_note} onChange={set("delivery_note")} disabled={!editor} placeholder={T("e.g. send by bus to Kyela, picks up at the stand", "mfano tuma kwa basi Kyela, atachukua stendi")} /></label>
      </div>
      <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        {editor && <button type="button" className="primary" disabled={busy} onClick={save}>{busy ? T("Saving…", "Inahifadhi…") : toCheck(b) ? T("Confirm and save", "Thibitisha na uhifadhi") : T("Save", "Hifadhi")}</button>}
        {editor && b.name_source !== "owner" && <button type="button" disabled={reading || busy} onClick={reread}>{reading ? T("Reading the chat…", "Inasoma chat…") : T("Read name from chat again", "Soma jina kwenye chat tena")}</button>}
        {b.last_conversation_id && <a href={"#chats/open=" + b.last_conversation_id}>{T("Open chat →", "Fungua chat →")}</a>}
        {b.last_receipt && <a href={"#receipts/q=" + encodeURIComponent(b.last_receipt)}>{T("Last receipt", "Risiti ya mwisho")} {b.last_receipt} →</a>}
        {msg && <span className={"small " + (/Saved|Imehifadhiwa|read from|imesomwa|best guess|makadirio/.test(msg) ? "ok" : "err")}>{msg}</span>}
      </div>
    </div>
  );
}
