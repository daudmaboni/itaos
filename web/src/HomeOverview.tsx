// Dashboard home, under the money summary: "Do this now" (the 3 most urgent things) and four tiles that open
// their own pages (Ads, Payment checks, Why people didn't buy, Staff leak guard). Everything in full lives on
// those pages; here it's one number and one line each.
import { useEffect, useMemo } from "react";
import { supabase, Workspace, money, fmt, converter } from "./lib";
import { useKept } from "./keep";
import { planAdMoney, type AdMoneyRes, type Advice } from "./adMoney";
import { openLeaks, reasonLabel, type LeakRes, type LostRes, type PayRes } from "./guards";
import { pickDoNow } from "./doNow";

type Counts = { waiting: number; overdue: number; proposed: number };
type Data = { pay: PayRes | null; leak: LeakRes | null; lost: LostRes | null; ad: AdMoneyRes | null; counts: Counts | null };

export default function HomeOverview({ ws, spend, roas, period }: { ws: Workspace; spend: string; roas: string | null; period: string }) {
  const T = (en: string, sw: string) => (ws.language === "sw" ? sw : en);
  const [d, setD] = useKept<Data>("home-overview:" + ws.id, { pay: null, leak: null, lost: null, ad: null, counts: null });

  useEffect(() => {
    let live = true;
    const put = (k: keyof Data) => ({ data, error }: { data: unknown; error: unknown }) => { if (live && !error && data) setD((x) => ({ ...x, [k]: data })); };
    supabase.rpc("payment_checks", { p_ws: ws.id, p_days: 30 }).then(put("pay"));
    supabase.rpc("ad_money", { p_ws: ws.id, p_days: 14 }).then(put("ad"));
    supabase.rpc("lost_reasons", { p_ws: ws.id, p_days: 30 }).then(put("lost"));
    supabase.rpc("staff_leaks", { p_ws: ws.id, p_days: 30 }).then(put("leak"));
    const since = new Date(Date.now() - 3 * 864e5).toISOString(), now = new Date().toISOString();
    Promise.all([
      supabase.from("conversations").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id).eq("last_dir", "in")
        .gte("last_message_at", since).or("last_in_closing.is.null,last_in_closing.eq.false"),
      supabase.from("follow_up_tasks").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id).eq("source", "kito_promise").eq("status", "open").lt("due_at", now),
      supabase.from("follow_up_tasks").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id).eq("source", "kito_promise").eq("status", "proposed"),
    ]).then(([w, o, p]) => { if (live) setD((x) => ({ ...x, counts: { waiting: w.count ?? 0, overdue: o.count ?? 0, proposed: p.count ?? 0 } })); });
    return () => { live = false; };
  }, [ws.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const plan = useMemo(() => {
    if (!d.ad) return null;
    const cv = converter(ws);
    try { return planAdMoney(d.ad, (n) => cv(n, d.ad!.ad_currency ?? ws.currency), (n) => cv(n, ws.currency)); } catch { return null; }
  }, [d.ad, ws]);

  const M = (n: number | null | undefined) => money(n, ws.currency);
  const adName = (a: Advice) => (a.k === "move" ? a.from.ad.name ?? a.from.ad.ad_id : "ad" in a ? a.ad.ad.name ?? a.ad.ad.ad_id : null);
  const ready = d.pay && d.leak && d.counts;
  const items = ready ? pickDoNow({
    payRed: d.pay!.to_check_red, payAmber: d.pay!.to_check - d.pay!.to_check_red,
    waiting: d.counts!.waiting, overdue: d.counts!.overdue, proposed: d.counts!.proposed,
    ad: plan?.advice[0] ?? null, adName,
    leaks: d.leak!.numbers.filter((x) => !x.verdict).length + d.leak!.paid_elsewhere.length,
    unrecorded: d.leak!.unrecorded, unrecordedAmount: M(d.leak!.unrecorded_amount),
  }, T) : null;

  const top = d.lost?.reasons[0];
  const leakN = d.leak ? openLeaks(d.leak) : null;
  return (
    <>
      <section className="card donow" aria-busy={!items}>
        <h2>{T("Do this now", "Fanya hivi sasa")}</h2>
        {!items ? <div className="skeleton" style={{ minHeight: 90 }} />
          : items.length === 0 ? <p className="dn-clear">{T("All clear. Nobody is waiting and nothing looks wrong.", "Kila kitu kiko sawa. Hakuna anayesubiri na hakuna kinachoonekana kibaya.")}</p>
          : <ol className="dn-list">{items.map((i) => (
            <li key={i.key} className={"dn-" + i.tone}><a href={i.href}><span className="dn-dot" aria-hidden /><span className="dn-text">{i.text}</span><span className="dn-cta">{i.cta} ›</span></a></li>
          ))}</ol>}
      </section>

      <div className="tiles">
        <a className="tile" href="#ads">
          <span className="tl-k">{T("Ads", "Matangazo")}</span>
          <b className="tl-v">{roas ?? spend}</b>
          <span className="tl-s">{roas ? T(`return on ad spend · ${spend} spent`, `mapato kwa tangazo · ${spend} zimetumika`) : T(`spent · ${period}`, `zimetumika · ${period}`)}</span>
          {plan?.advice[0] && plan.advice[0].k !== "none_running" && plan.advice[0].k !== "no_sales_yet" && <span className="tl-s tl-note">{T(`${plan.advice.length} to do`, `${plan.advice.length} za kufanya`)}</span>}
        </a>
        <a className={"tile" + (d.pay?.to_check_red ? " bad" : d.pay?.to_check ? " warn" : "")} href="#payments">
          <span className="tl-k">{T("Payment checks", "Ukaguzi wa malipo")}</span>
          <b className="tl-v">{d.pay ? fmt(d.pay.to_check) : "–"}</b>
          <span className="tl-s">{d.pay ? T(`to look at · ${fmt(d.pay.checked)} checked`, `za kuangalia · ${fmt(d.pay.checked)} zimekaguliwa`) : "…"}</span>
          {d.pay && d.pay.fakes > 0 && <span className="tl-s tl-note">{T(`${fmt(d.pay.fakes)} fake caught · ${M(d.pay.fakes_amount)} kept`, `feki ${fmt(d.pay.fakes)} · ${M(d.pay.fakes_amount)} zimeokolewa`)}</span>}
        </a>
        <a className="tile" href="#why">
          <span className="tl-k">{T("Why people didn't buy", "Kwa nini hawakununua")}</span>
          <b className="tl-v">{d.lost ? fmt(d.lost.lost) : "–"}</b>
          <span className="tl-s">{d.lost ? T("didn't buy · 30 days", "hawakununua · siku 30") : "…"}</span>
          {top && <span className="tl-s tl-note">{T("Most: ", "Wengi: ")}{reasonLabel(top.reason, T).toLowerCase()}</span>}
        </a>
        <a className={"tile" + (leakN ? " warn" : "")} href="#leaks">
          <span className="tl-k">{T("Staff leak guard", "Kinga ya uvujaji")}</span>
          <b className="tl-v">{leakN == null ? "–" : fmt(leakN)}</b>
          <span className="tl-s">{leakN == null ? "…" : leakN ? T("to look at · 30 days", "za kuangalia · siku 30") : T("no leaks found", "hakuna uvujaji")}</span>
          {d.leak && d.leak.unrecorded > 0 && <span className="tl-s tl-note">{T(`${M(d.leak.unrecorded_amount)} paid, not recorded`, `${M(d.leak.unrecorded_amount)} zimelipwa, hazijarekodiwa`)}</span>}
        </a>
      </div>
    </>
  );
}
