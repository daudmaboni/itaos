// "Money itaOS brought back": sales that came after something itaOS did for the owner (a confirmed promise
// reminder, an after-price follow-up, a reorder message, a finished follow-up task), for the dashboard's
// date range. Strict on purpose — see migration 0065. When Pondi has set this business's monthly price,
// it also says how many times over itaOS paid for itself in the same days.
import { useEffect, useState } from "react";
import { supabase, Workspace, money, fmt } from "./lib";
import type { Period } from "./metrics";

type Src = "promise" | "after_price" | "reorder" | "follow_up";
type Item = { order_id: string; conversation_id: string; amount: number; currency: string; paid_at: string; nudge_at: string; source: Src; name: string };
type Res = {
  currency: string; total: number; orders: number; days: number;
  by_source: { source: Src; amount: number; orders: number }[];
  items: Item[]; waiting: number; found_orders: number; found_amount: number; price_month: number | null;
};

const when = (iso: string, tz: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", timeZone: tz });

export default function Recovered({ ws, period, conv, cur }: {
  ws: Workspace; period: Period;
  /** business currency → the currency the dashboard shows, and that currency */
  conv: (n: number | null | undefined) => number | null; cur: string;
}) {
  const T = (en: string, sw: string) => (ws.language === "sw" ? sw : en);
  const tz = ws.timezone || "Africa/Dar_es_Salaam";
  const [r, setR] = useState<Res | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let gone = false;
    setErr("");
    supabase.rpc("recovered_sales", { p_ws: ws.id, p_from: period.from, p_to: period.to }).then(({ data, error }) => {
      if (gone) return;
      if (error) setErr(error.message); else setR(data as Res);
    });
    return () => { gone = true; };
  }, [ws.id, period.from, period.to]);

  if (err) return <section className="card rec"><h2>{T("Money itaOS brought back", "Pesa itaOS imerudisha")}</h2><p className="err small">{err}</p></section>;
  if (!r) return <section className="card rec" aria-busy="true"><div className="skeleton" style={{ minHeight: 90 }} /></section>;

  // The dashboard may show USD while sales are in TZS: convert every amount the same way.
  const M = (n: number) => money(conv(n) ?? n, cur);
  const label: Record<Src, string> = {
    promise: T("Promise reminders", "Vikumbusho vya ahadi"),
    after_price: T("Follow-ups after the price", "Ufuatiliaji baada ya bei"),
    reorder: T("Reorder messages", "Ujumbe wa kununua tena"),
    follow_up: T("Other follow-ups", "Ufuatiliaji mwingine"),
  };
  // What itaOS cost for the same number of days (monthly price spread over 30 days).
  const cost = r.price_month != null && r.price_month > 0 ? (r.price_month * r.days) / 30 : null;
  const times = cost && r.total > 0 ? r.total / cost : null;

  return (
    <section className="card rec">
      <div className="row between">
        <div>
          <h2>{T("Money itaOS brought back", "Pesa itaOS imerudisha")}</h2>
          <span className="small muted">{T("Sales that came after a reminder or follow-up from itaOS, in this period.", "Mauzo yaliyokuja baada ya kikumbusho au ufuatiliaji wa itaOS, kipindi hiki.")}</span>
        </div>
        {times != null && <span className="rec-x" title={T(`itaOS cost about ${M(cost!)} for these ${r.days} days`, `itaOS iligharimu takriban ${M(cost!)} kwa siku hizi ${r.days}`)}>{times >= 10 ? Math.round(times) : times.toFixed(1)}× {T("its cost", "gharama yake")}</span>}
      </div>

      {r.orders > 0 ? (<>
        <div className="rec-big"><b>{M(r.total)}</b><span className="small muted">{fmt(r.orders)} {r.orders === 1 ? T("sale", "mauzo") : T("sales", "mauzo")}</span></div>
        <div className="rec-rows">
          {r.by_source.map((s) => (
            <div className="rec-row" key={s.source}><span>{label[s.source]}</span><span className="muted small">{fmt(s.orders)}</span><b>{M(s.amount)}</b></div>
          ))}
        </div>
        <button type="button" className="linkish small" onClick={() => setOpen((x) => !x)} aria-expanded={open}>{open ? T("Hide the sales", "Ficha mauzo") : T("See which sales", "Ona mauzo gani")}</button>
        {open && (
          <div className="rec-rows">
            {r.items.map((i) => (
              <a className="rec-row" key={i.order_id} href={"#chats/open=" + i.conversation_id}>
                <span>{i.name}<span className="small muted" style={{ display: "block" }}>{label[i.source]} {when(i.nudge_at, tz)} → {T("paid", "alilipa")} {when(i.paid_at, tz)}</span></span>
                <span />
                <b>{M(i.amount)}</b>
              </a>
            ))}
          </div>
        )}
      </>) : (
        <p className="rec-empty">
          {T("Nothing yet in this period.", "Bado hakuna kipindi hiki.")}{" "}
          {r.waiting > 0
            ? T(`${fmt(r.waiting)} customers you followed up are still inside their window. If they pay, it shows here.`, `Wateja ${fmt(r.waiting)} uliowafuatilia bado wako ndani ya muda wao. Wakilipa, itaonekana hapa.`)
            : T("Confirm promises and send the follow-ups in Actions, and the sales they bring show here.", "Thibitisha ahadi na tuma ufuatiliaji kwenye Actions, mauzo yatakayofuata yataonekana hapa.")}
          {" "}<a href="#actions">{T("Open Actions →", "Fungua Actions →")}</a>
        </p>
      )}

      {r.orders > 0 && r.waiting > 0 && <p className="small muted" style={{ margin: 0 }}>{T(`${fmt(r.waiting)} more followed-up customers can still pay.`, `Wateja ${fmt(r.waiting)} zaidi uliowafuatilia bado wanaweza kulipa.`)}</p>}
      {r.found_orders > 0 && (
        <p className="small muted rec-found">{T(`Also: itaOS spotted and recorded ${fmt(r.found_orders)} sales from the chats for you (${M(r.found_amount)}). Those aren't counted above.`, `Pia: itaOS iliona na kurekodi mauzo ${fmt(r.found_orders)} kutoka kwenye chats (${M(r.found_amount)}). Hayo hayajahesabiwa juu.`)}</p>
      )}
    </section>
  );
}
