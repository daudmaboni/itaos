// Dashboard home, under the money summary: "Do this now" (the 3 most urgent things) and four tiles that open
// their own pages (Ads, Payment checks, Why people didn't buy, Staff leak guard). Everything in full lives on
// those pages; here it's one number and one line each.
import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { CardMenu, refreshPage } from "./CardMenu";
import { supabase, Workspace, money, fmt, converter } from "./lib";
import { useKept } from "./keep";
import { planAdMoney, type AdMoneyRes, type Advice } from "./adMoney";
import { openLeaks, reasonLabel, type LeakRes, type LostRes, type PayRes } from "./guards";
import { pickDoNow } from "./doNow";
import HomeTiles from "./HomeTiles";

type Counts = { waiting: number; overdue: number; proposed: number };
type Data = { pay: PayRes | null; leak: LeakRes | null; lost: LostRes | null; ad: AdMoneyRes | null; counts: Counts | null };

export default function HomeOverview({ ws, spend, roasN, insight }: { ws: Workspace; spend: string; roasN: number | null; insight?: ReactNode }) {
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
        <CardMenu label={T("Do this now options", "Chaguo za Fanya hivi sasa")} items={[
          { label: T("Refresh the list", "Sasisha orodha"), onClick: refreshPage },
          { label: T("Open chats waiting for a reply", "Fungua chats zinazosubiri jibu"), href: "#chats" },
          { label: T("Open all actions", "Fungua vitendo vyote"), href: "#actions" },
        ]} />
        {!items ? <div className="skeleton" style={{ minHeight: 90 }} />
          : items.length === 0 ? <p className="dn-clear">{T("All clear. Nobody is waiting and nothing looks wrong.", "Kila kitu kiko sawa. Hakuna anayesubiri na hakuna kinachoonekana kibaya.")}</p>
          : <ol className="dn-list">{items.map((i) => (
            <li key={i.key} className={"dn-" + i.tone}><a href={i.href}><span className="dn-dot" aria-hidden /><span className="dn-text">{i.text}</span><span className="dn-cta">{i.cta} ›</span></a></li>
          ))}</ol>}
      </section>

      {insight}

      <HomeTiles ws={ws} input={{
        roas: roasN, spend, adTodo: plan ? plan.advice.filter((a) => a.k !== "none_running" && a.k !== "no_sales_yet").length : 0,
        lost: d.lost?.lost ?? null, sold: d.lost?.sold ?? null, topReason: top ? reasonLabel(top.reason, T) : null,
        checked: d.pay?.checked ?? null, toCheck: d.pay?.to_check ?? null, toCheckRed: d.pay?.to_check_red ?? null,
        leaks: leakN, messages: d.leak?.phone_messages ?? null,
      }} />
    </>
  );
}
