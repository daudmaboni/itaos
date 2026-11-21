// Public receipt page: itaos.app/r/<secret code>, opened by scanning the QR on a printed itaOS receipt.
// One page does three jobs:
//  1. Proof — anyone can see the receipt is genuine (paid / refunded / cancelled), with what's printed on it.
//  2. Order again — opens the business's WhatsApp with "I want to order again, receipt KH-000042" typed in.
//  3. Staff — someone signed in to that business on this phone gets "Open in itaOS" and how often the
//     customer has opened it.
// The code in the link is random (migration 0055), so nobody can walk through other customers' receipts.
// Kiswahili first (customers), English underneath.
import { useEffect, useState } from "react";
import { supabase, amt } from "./lib";
import { hidePreloader } from "./preloader";
import { palette, type Brand } from "./brand";

type Check = {
  business: string; business_wa: string | null; timezone: string; receipt_no: string;
  status: "paid" | "refunded" | "cancelled" | "pending"; currency: string; total: number; paid: number; refunded: number;
  paid_at: string; items: { name: string; qty: number }[]; customer: string | null; payment_ref_end: string | null;
  delivery: string | null;
  brand?: Brand | null;   // 0059: the business's own look (Settings → Your receipts)
  staff: null | { order_id: string; workspace_id: string; scans: number; first_scan_at: string | null; last_scan_at: string | null };
};

// Neutral paper and ink. The brand colours come from the business (CSS variables --b… set per receipt).
const P0 = palette(null);
const G = { green: P0.green, greenText: P0.greenText, forest: P0.forest, honey: P0.honey, cream: "#f5f0e6", surface: "#fffdf8", ink: "#13231a", muted: "#56665c", line: "#e3dccd", mint: "#dcefe2", red: "#b42318", redBg: "#fdecea", amber: "#8a5a00", amberBg: "#fdf3dc" };

const DELIVERY: Record<string, [string, string]> = {
  not_shipped: ["Bado haujatumwa", "Not sent yet"],
  shipped: ["Mzigo umetumwa", "On its way"],
  delivered: ["Mzigo umefika", "Delivered"],
  returned: ["Mzigo umerudishwa", "Returned"],
};

export const tokenFromPath = (p = location.pathname) => p.match(/^\/r\/([A-Za-z0-9_-]{16,40})\/?$/)?.[1] ?? null;

function setMeta() {
  document.title = "Hakiki risiti · Check receipt";
  const add = (name: string, content: string) => { const m = document.createElement("meta"); m.name = name; m.content = content; document.head.appendChild(m); };
  add("robots", "noindex, nofollow"); // receipts never show up in search engines
  add("referrer", "no-referrer");     // the secret code never leaks to sites this page links to
  document.querySelector('link[rel="canonical"]')?.remove();
}

export default function ReceiptCheck() {
  const token = tokenFromPath();
  const [d, setD] = useState<Check | null | undefined>(undefined); // undefined = loading, null = not found
  const [failed, setFailed] = useState(false);

  const load = () => {
    if (!token) { setD(null); return; }
    setFailed(false); setD(undefined);
    supabase.rpc("receipt_check", { p_token: token }).then(({ data, error }) => {
      if (error) setFailed(true); else setD((data as Check) ?? null);
    });
  };
  useEffect(() => { setMeta(); hidePreloader(); load(); }, []);

  return (
    <div className="rc-root" style={vars(d?.brand)}>
      <style>{CSS}</style>
      <main className="rc-card" aria-live="polite">
        {failed ? <Problem onRetry={load} /> : d === undefined ? <Loading /> : d === null ? <NotFound /> : <Receipt d={d} />}
      </main>
      <a className="rc-foot" href="https://itaos.app/" target="_blank" rel="noopener">Imethibitishwa na <b>ita<span>.</span>OS</b> · Verified by itaOS</a>
    </div>
  );
}

/** The business's colours as CSS variables, and the browser bar colour to match. */
function vars(b?: Brand | null): React.CSSProperties {
  const p = palette(b);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", p.green);
  return { "--b": p.green, "--b-text": p.greenText, "--b-deep": p.forest, "--b-acc": p.honey, "--b-tint": p.mint } as React.CSSProperties;
}

function Receipt({ d }: { d: Check }) {
  const tz = d.timezone || "Africa/Dar_es_Salaam";
  const when = new Date(d.paid_at);
  const date = when.toLocaleDateString("en-GB", { timeZone: tz, day: "numeric", month: "short", year: "numeric" });
  const time = when.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  const itemsText = d.items.map((i) => (i.qty > 1 ? `${i.name} × ${i.qty}` : i.name)).join(", ");
  const wa = (text: string) => d.business_wa ? `https://wa.me/${d.business_wa}?text=${encodeURIComponent(text)}` : null;
  const reorder = wa(`Habari ${d.business}, nataka kuagiza tena${itemsText ? `: ${itemsText}` : ""}. Risiti yangu ni ${d.receipt_no}.`);
  const ask = wa(`Habari ${d.business}, nina swali kuhusu risiti ${d.receipt_no}.`);
  const partRefund = d.status === "paid" && Number(d.refunded) > 0;

  const badge =
    d.status === "paid" ? { cls: "ok", sw: "Risiti halali · Imelipwa", en: "Genuine receipt · Paid", icon: "✓" }
    : d.status === "refunded" ? { cls: "warn", sw: "Pesa imerudishwa", en: "Refunded — this sale was paid back", icon: "↺" }
    : d.status === "cancelled" ? { cls: "bad", sw: "Mauzo haya yamefutwa", en: "This sale was cancelled", icon: "×" }
    : { cls: "warn", sw: "Bado halijalipwa", en: "Not paid yet", icon: "…" };

  return (
    <>
      <header className="rc-head">
        {d.brand?.logo
          ? <div className="rc-mark logo" aria-hidden="true"><img src={d.brand.logo} alt="" /></div>
          : <div className="rc-mark" aria-hidden="true">{d.business.trim().charAt(0).toUpperCase()}</div>}
        <div><h1>{d.business}</h1><p>{d.brand?.town ? `${d.brand.town} · ` : ""}Risiti ya malipo · Payment receipt</p></div>
      </header>

      <div className={`rc-badge ${badge.cls}`} role="status">
        <span className="rc-icon" aria-hidden="true">{badge.icon}</span>
        <span><b>{badge.sw}</b><small>{badge.en}</small></span>
      </div>

      <dl className="rc-rows">
        <div><dt>Kumbukumbu Na. <small>Receipt no.</small></dt><dd className="mono">{d.receipt_no}</dd></div>
        <div><dt>Tarehe <small>Date</small></dt><dd>{date} · {time}</dd></div>
        {d.customer && <div><dt>Jina <small>Name</small></dt><dd>{d.customer}</dd></div>}
        {d.items.length > 0 && <div><dt>Bidhaa <small>Items</small></dt><dd>{d.items.map((i, k) => <span key={k} className="rc-item">{i.name}{i.qty > 1 ? ` × ${i.qty}` : ""}</span>)}</dd></div>}
        {d.payment_ref_end && <div><dt>Muamala{d.brand?.pay_method ? ` ${d.brand.pay_method}` : ""} <small>Payment code</small></dt><dd className="mono">•••• {d.payment_ref_end}</dd></div>}
        {d.status === "paid" && d.delivery && DELIVERY[d.delivery] && <div><dt>Mzigo <small>Delivery</small></dt><dd>{DELIVERY[d.delivery][0]} <small>{DELIVERY[d.delivery][1]}</small></dd></div>}
      </dl>

      <div className="rc-total">
        <span>Jumla <small>Total</small></span>
        <b>{d.currency} {amt(Number(d.status === "refunded" ? d.paid : d.total), d.currency)}</b>
      </div>
      {partRefund && <p className="rc-note">Sehemu ya pesa ({d.currency} {amt(Number(d.refunded), d.currency)}) imerudishwa. · Part of this was refunded.</p>}
      {d.status === "paid" && <p className="rc-note">Linganisha na risiti uliyoshika: namba, tarehe na jumla viwe sawa. · Check that the number, date and total match your paper receipt.</p>}

      <div className="rc-actions">
        {reorder
          ? <a className="rc-btn" href={reorder} target="_blank" rel="noopener noreferrer"><WaIcon /> Agiza tena kwa WhatsApp<small>Order again</small></a>
          : <p className="rc-note">Wasiliana na {d.business} kuagiza tena. · Contact the business to order again.</p>}
        {ask && <a className="rc-link" href={ask} target="_blank" rel="noopener noreferrer">Una swali kuhusu risiti hii? · Ask about this receipt</a>}
      </div>

      {d.staff && <Staff d={d} />}
    </>
  );
}

function Staff({ d }: { d: Check }) {
  const s = d.staff!;
  const ago = s.last_scan_at ? new Date(s.last_scan_at).toLocaleString("en-GB", { timeZone: d.timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <section className="rc-staff" aria-label="Staff">
      <p><b>Wewe ni mfanyakazi wa {d.business}.</b> Wateja hawaoni sehemu hii. · Only your team sees this.</p>
      <p className="rc-muted">
        {s.scans === 0 ? "Mteja bado hajafungua risiti hii. · The customer hasn't opened it yet."
          : `Imefunguliwa na mteja mara ${s.scans}${ago ? `, mara ya mwisho ${ago}` : ""}. · Opened by customers ${s.scans}×.`}
      </p>
      <a className="rc-btn dark" href={`/app#receipts/q=${encodeURIComponent(d.receipt_no)}`}>Fungua kwenye itaOS<small>Open this sale in itaOS</small></a>
    </section>
  );
}

const Loading = () => (
  <div className="rc-state"><div className="rc-spin" aria-hidden="true" /><p>Inahakiki risiti… <small>Checking receipt…</small></p></div>
);
const NotFound = () => (
  <div className="rc-state">
    <div className="rc-badge bad"><span className="rc-icon" aria-hidden="true">!</span><span><b>Risiti hii haijapatikana</b><small>We couldn't find this receipt</small></span></div>
    <p>Huenda QR imeharibika, imebadilishwa na duka, au risiti si halali. Wasiliana na duka ulilonunua kuthibitisha.</p>
    <p className="rc-muted">The QR may be damaged, replaced by the shop, or the receipt isn't genuine. Contact the shop you bought from.</p>
  </div>
);
const Problem = ({ onRetry }: { onRetry: () => void }) => (
  <div className="rc-state">
    <p><b>Imeshindwa kuhakiki sasa hivi.</b> Angalia intaneti kisha jaribu tena.</p>
    <p className="rc-muted">Couldn't check right now. Check your connection and try again.</p>
    <button className="rc-btn" type="button" onClick={onRetry}>Jaribu tena<small>Try again</small></button>
  </div>
);

const WaIcon = () => (
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1-.7-.3-1.4-.7-2-1.3-.5-.5-.9-1-1.3-1.6-.1-.2 0-.4.1-.5l.4-.4.2-.4v-.4l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.6.3-.6.6-.9 1.3-.9 2.1.1.9.4 1.8 1 2.6 1 1.5 2.3 2.7 3.9 3.4.4.2.9.4 1.3.5.5.1 1 .1 1.5 0 .6-.1 1.1-.5 1.4-1 .2-.3.2-.7.1-1.1l-.6-.3z"/></svg>
);

const CSS = `
html,body{background:${G.cream}!important}
.rc-root{min-height:100dvh;background:${G.cream};color:${G.ink};font-family:Inter,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;padding:20px 14px 28px;box-sizing:border-box;-webkit-font-smoothing:antialiased}
.rc-card{width:100%;max-width:440px;background:${G.surface};border-radius:24px;padding:22px 20px;box-sizing:border-box;box-shadow:0 1px 0 ${G.line},0 12px 40px rgba(19,35,26,.08);display:flex;flex-direction:column;gap:16px}
.rc-head{display:flex;align-items:center;gap:12px}
.rc-head h1{margin:0;font-family:'Bricolage Grotesque',Inter,sans-serif;font-weight:800;font-size:22px;letter-spacing:-.01em;line-height:1.15}
.rc-head p{margin:2px 0 0;font-size:13px;color:${G.muted}}
.rc-mark.logo{background:#fff;border:1px solid var(--line, #e3dccd);overflow:hidden}.rc-mark.logo img{width:86%;height:86%;object-fit:contain}
.rc-mark{width:44px;height:44px;flex-shrink:0;border-radius:999px;background:var(--b);color:#fff;display:grid;place-items:center;font-family:'Bricolage Grotesque',Inter,sans-serif;font-weight:800;font-size:22px}
.rc-badge{display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:16px}
.rc-badge b{display:block;font-size:17px;line-height:1.2}
.rc-badge small{display:block;font-size:13px;margin-top:2px;opacity:.85}
.rc-badge.ok{background:var(--b-tint);color:var(--b-deep)}
.rc-badge.warn{background:${G.amberBg};color:${G.amber}}
.rc-badge.bad{background:${G.redBg};color:${G.red}}
.rc-icon{width:34px;height:34px;flex-shrink:0;border-radius:999px;display:grid;place-items:center;font-weight:800;font-size:18px;color:#fff;background:currentColor}
.rc-badge.ok .rc-icon{background:var(--b)}.rc-badge.warn .rc-icon{background:var(--b-acc)}.rc-badge.bad .rc-icon{background:${G.red}}
.rc-icon{color:#fff!important}
.rc-rows{margin:0;display:flex;flex-direction:column}
.rc-rows>div{display:flex;justify-content:space-between;gap:16px;padding:11px 0;border-bottom:1px solid ${G.line};font-size:15px}
.rc-rows>div:last-child{border-bottom:0}
.rc-rows dt{color:${G.muted};flex-shrink:0}
.rc-rows dt small,.rc-rows dd small{display:block;font-size:12px;opacity:.8}
.rc-rows dd{margin:0;text-align:right;font-weight:600;display:flex;flex-direction:column;align-items:flex-end;gap:2px}
.rc-rows .mono{font-family:'Geist Mono',ui-monospace,monospace;letter-spacing:.02em}
.rc-total{display:flex;justify-content:space-between;align-items:center;background:var(--b);color:#fff;border-radius:16px;padding:16px 18px}
.rc-total span{font-weight:700}.rc-total small{display:block;font-weight:500;font-size:12px;opacity:.85}
.rc-total b{font-family:'Bricolage Grotesque',Inter,sans-serif;font-size:26px;font-weight:800}
.rc-note{margin:0;font-size:13px;color:${G.muted};line-height:1.45}
.rc-actions{display:flex;flex-direction:column;gap:12px;align-items:stretch;margin-top:4px}
.rc-btn{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:8px;min-height:54px;padding:10px 16px;border-radius:999px;border:0;background:#1fa855;color:#fff;font:700 16px Inter,system-ui,sans-serif;text-decoration:none;cursor:pointer;text-align:center}
.rc-btn small{flex-basis:100%;font-weight:500;font-size:12px;opacity:.9;margin-top:-6px}
.rc-btn.dark{background:var(--b-deep)}
.rc-btn:active{transform:scale(.98)}
.rc-link{text-align:center;color:var(--b-text);font-size:14px;font-weight:600;text-decoration:underline;text-underline-offset:3px;padding:6px}
.rc-staff{border-top:1px dashed ${G.line};padding-top:16px;display:flex;flex-direction:column;gap:10px;font-size:14px}
.rc-staff p{margin:0;line-height:1.45}
.rc-muted{color:${G.muted}}
.rc-item{display:block}
.rc-state{display:flex;flex-direction:column;gap:12px;padding:8px 0;font-size:15px;line-height:1.5}
.rc-state p{margin:0}.rc-state small{display:block;color:${G.muted}}
.rc-spin{width:36px;height:36px;border-radius:999px;border:3px solid var(--b-tint);border-top-color:var(--b);animation:rcspin .8s linear infinite;margin:12px auto 0}
@keyframes rcspin{to{transform:rotate(360deg)}}
.rc-state:has(.rc-spin){align-items:center;text-align:center}
.rc-foot{margin-top:18px;font-size:12px;color:${G.muted};text-decoration:none}
.rc-foot b{color:${G.ink}}.rc-foot b span{color:#f2b705}
@media (prefers-reduced-motion:reduce){.rc-spin{animation:none}}
@media print{.rc-actions,.rc-staff{display:none}.rc-card{box-shadow:none}}
`;
