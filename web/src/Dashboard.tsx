import type { ReactNode, FormEvent } from "react";
import FixList from "./FixList";
import { useEffect, useMemo, useRef, useState } from "react";
import { countTo, enterCards, enterRows, growBars, usePageEnter, select } from "./motion";
import { Workspace, AdPerf, fmt, pct, dur, L, amt, money, ago, supabase, callFn, canManage, converter, displayCurrency, moneyInput } from "./lib";
import { TrendChart, SpendSplit, CostBars } from "./Charts";
import { useGrowthData, type AdObjections } from "./data";
import { FilterBar, useFilters } from "./Filters";
import DateRange from "./DateRange";
import { RangeSel, loadRange, saveRange, presetLabel } from "./ranges";
import { Metric, delta, DEFINITIONS } from "./metrics";
import { SourceBadge, ProvenanceLegend } from "./Provenance";
import PaidOrders from "./PaidOrders";
import MoneyHero, { useHeroStyle, heroCovers } from "./MoneyHero";
import Recovered from "./Recovered";
import AdMoney from "./AdMoney";
import PaymentGuard from "./PaymentGuard";
import LostReasons from "./LostReasons";
import LeakGuard from "./LeakGuard";

export default function Dashboard({ ws, onWs }: { ws: Workspace; onWs?: (w: Workspace) => void }) {
  const [range, setRangeState] = useState<RangeSel>(() => loadRange("dashboard", { key: "last_7" }));
  const setRange = (r: RangeSel) => { setRangeState(r); saveRange("dashboard", r); };
  const lang = ws.language;
  const T = (en: string, sw: string) => (lang === "sw" ? sw : en);
  const D = (k: string) => DEFINITIONS[k]?.[lang] ?? "";
  const [filters, setFilters] = useFilters("dashboard");
  const g = useGrowthData(ws, range, { cache: true, filters });
  const { mx, prev, ads, daily, loading, err } = g;
  const rawAdCur = mx?.adCurrency ?? ws.currency;
  // Every amount on this page is shown in one currency (Settings → Currency). Ad spend comes from
  // Meta in USD and sales are in TZS, so one of them is converted with the exchange rate.
  const cur = displayCurrency(ws);
  const cv = converter(ws);
  const canConvert = rawAdCur === cur || cv(1, rawAdCur) != null;
  const adCur = canConvert ? cur : rawAdCur;            // currency ad amounts are shown in
  const A = (n: number | null | undefined) => (canConvert ? cv(n, rawAdCur) : n ?? null);   // ad amount → shown
  const W = (n: number | null | undefined) => cv(n, ws.currency) ?? (n ?? null);           // sales amount → shown
  const wsCur = cv(1, ws.currency) != null ? cur : ws.currency;
  const findings = g.findings;
  // Period is today and not over yet → cards say "so far today".
  const isToday = !!mx && mx.period.to === g.today && mx.period.from === g.today;
  // Ads cost money but no ad chat has paid yet: show the spend as the floor ("≥") instead of a dash.
  const noAdSaleYet = !!mx && (mx.spend.value ?? 0) > 0 && !mx.adCustomerOrders.value;
  const [showPaid, setShowPaid] = useState(false);
  const hero = useHeroStyle();
  const cover = heroCovers(hero);
  const adNames = useMemo(() => Object.fromEntries((g.options?.ads ?? []).map((a) => [a.id, a.name])), [g.options]);

  const costBars = useMemo(() => {
    const withSales = ads.filter((a) => Number(a.sold) > 0);
    if (withSales.length) return { kind: "sale" as const, items: withSales.map((a) => ({ name: a.ad_name ?? a.ad_id, cost: A(Number(a.spend) / Number(a.sold)) ?? 0, note: `${amt(A(Number(a.spend)), adCur)} · ${a.sold} ${T("attributed sales", "mauzo")}` })).sort((x, y) => x.cost - y.cost).slice(0, 8) };
    return { kind: "chat" as const, items: ads.filter((a) => Number(a.platform_conversations) > 0 && Number(a.spend) > 0).map((a) => ({ name: a.ad_name ?? a.ad_id, cost: A(Number(a.spend) / Number(a.platform_conversations)) ?? 0, note: `${amt(A(Number(a.spend)), adCur)} · ${fmt(a.platform_conversations)} chats` })).sort((x, y) => x.cost - y.cost).slice(0, 8) };
  }, [ads, lang, adCur, ws.fx_rate]);

  const trend = useMemo(() => {
    if (!mx || !prev) return { labels: [] as string[], cur: [] as number[], prev: [] as number[], weekly: false, partialLast: false, total: 0, change: null as number | null };
    const byDay: Record<string, number> = {};
    for (const r of daily) byDay[r.day] = (byDay[r.day] ?? 0) + (A(r.spend) ?? 0);
    const dayList = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(new Date(from + "T00:00:00Z").getTime() + i * 864e5).toISOString().slice(0, 10));
    const labels = dayList(mx.period.from, mx.period.days), prevDays = dayList(prev.period.from, prev.period.days);
    let cur = labels.map((d) => byDay[d] ?? 0), pv = prevDays.map((d) => byDay[d] ?? 0);
    // Long ranges: one point per day is just spikes, so add the days up into weeks.
    const weekly = labels.length > 92;
    const toWeeks = (a: number[]) => Array.from({ length: Math.ceil(a.length / 7) }, (_, i) => a.slice(i * 7, i * 7 + 7).reduce((x, y) => x + y, 0));
    const pts = weekly ? labels.filter((_, i) => i % 7 === 0) : labels;
    if (weekly) { cur = toWeeks(cur); pv = toWeeks(pv); }
    // The range runs to today and today isn't over yet → the last point is still filling up, don't draw it as a drop.
    // Weekly: the last week can also be short (e.g. 100 days = 14 weeks + 2 days).
    const partialLast = labels.length > 1 && (mx.period.to === g.today || (weekly && labels.length % 7 !== 0));
    return { labels: pts, cur, prev: pv, weekly, partialLast, total: A(mx.spend.value) ?? 0, change: delta(mx.spend, prev.spend) };
  }, [daily, mx, prev, adCur, ws.fx_rate, g.today]);

  const noData = !loading && !ads.length && !mx?.chats.value && !g.orders.length && !g.allTime?.orders;
  const pageRef = usePageEnter<HTMLDivElement>((root) => {
    if (loading) return;
    enterRows(select(root, ".hero > *"), { y: 10, stagger: 0.08 });
    enterCards(select(root, ".kpis > .kpi, .shell-grid > .card, .two > .card, .empty"), { stagger: 0.06, delay: 0.1 });
    growBars(select(root, ".fstep .bar > i, .costrow .bar > i"), { axis: "x", delay: 0.5, stagger: 0.07 });
    enterRows(select(root, "table tbody tr"), { delay: 0.45, stagger: 0.04 });
    enterRows(select(root, ".finding, .legend .li"), { delay: 0.4, x: -8, y: 0, stagger: 0.05 });
  }, [loading, JSON.stringify(range), noData]);
  const totalRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!loading) countTo(totalRef.current, trend.total, (n) => money(n, adCur), { duration: 1.2, delay: 0.35 }); }, [loading, trend.total, adCur]);
  // Automatic exchange rate: if the cards need one and none is stored yet, fetch it now instead of waiting for the hourly job.
  const fxMissing = !!mx && mx.returnOnAdSpend.note === "needs exchange rate" && ws.fx_auto !== false;
  useEffect(() => {
    if (!fxMissing) return;
    callFn("fx-rate", { workspace_id: ws.id })
      .then(() => supabase.from("workspaces").select("fx_rate,fx_auto,fx_updated_at,fx_source,fx_base").eq("id", ws.id).single())
      .then(({ data }) => { if (data?.fx_rate) onWs?.({ ...ws, ...data }); })
      .catch(() => { /* the hourly job will try again */ });
  }, [fxMissing, ws.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if ((loading && !g.cached) || !mx || !prev) return (
    <div className="skeletons dash-ia" aria-busy="true" aria-label="Loading">
      
      <div className="kpis">{[0, 1, 2, 3, 4, 5, 6].map((i) => <div className="skeleton" key={i} />)}</div>
      <div className="two"><div className="skeleton" style={{ minHeight: 300 }} /><div className="skeleton" style={{ minHeight: 300 }} /></div>
    </div>
  );

  const adsConn = g.conns.filter((c) => c.provider === "meta_ads");
  const waConn = g.conns.filter((c) => c.provider === "whatsapp");
  const failed = g.health.find((h) => h.status === "failed");
  const lastSync = adsConn.map((c) => c.last_sync_at).filter(Boolean).sort().pop() ?? null;
  const funnel: [string, Metric, string][] = [
    [T("Chats received", "Chats zilizopokelewa"), mx.chats, ""], [T("Got a reply", "Walijibiwa"), mx.replied, ""],
    [T("Price shared", "Bei ilitolewa"), mx.priced, ""], [T("Payment signal", "Dalili ya malipo"), mx.paymentSignals, "warn"],
    [T("Confirmed paid (attributed)", "Oda zilizolipwa (zimeunganishwa)"), mx.attributedSales, "good"],
  ];

  return (
    <div className="shell-grid dash-ia" ref={pageRef}>
      <div className="hero">
        <div style={{ display: "grid", gap: 4 }}>
          <h2>{greeting(lang, ws.timezone)}</h2>
          {(!adsConn.length || adsConn.some((c) => c.last_error)) && (
            <div className="sub"><span><span className="dot off" />{!adsConn.length ? T("Ad account not connected", "Akaunti ya matangazo haijaunganishwa") : T("Last ad sync had an error. See Connections.", "Usawazishaji wa mwisho ulikuwa na hitilafu. Angalia Connections.")}</span></div>
          )}
        </div>
        <div className="row">
          {g.cached && <span className="small muted" aria-live="polite"><span className="kito-spin sm" aria-hidden /> {T("Updating…", "Inasasisha…")}</span>}
          <DateRange value={range} onChange={setRange} today={g.today} tz={ws.timezone || "Africa/Dar_es_Salaam"} lang={lang} start={g.dataStart} />
        </div>
      </div>
      <FilterBar value={filters} onChange={setFilters} options={g.options ?? { campaigns: [], ads: [], products: [] }} lang={lang} />
      {err && <p className="err">{err}</p>}
      {failed && failed.events > 0 && <div className="finding warn"><b>{T(`${failed.events} WhatsApp events failed to process`, `Matukio ${failed.events} ya WhatsApp hayajachakatwa`)}</b><span className="small">{T("Some chats may be incomplete. Replay them from ", "Baadhi ya chats zinaweza kuwa hazijakamilika. Zirudie kutoka ")}<a href="#connect">Connections</a>.</span></div>}
      {noData ? (
        <div className="empty">{T("No data yet. Connect the ad account and WhatsApp, or upload chats and import orders, in ", "Bado hakuna data. Unganisha matangazo na WhatsApp, au pakia chats na uingize oda, kwenye ")}<a href="#connect">{T("Connections", "Connections")}</a>.</div>
      ) : (<>
        <MoneyHero style={hero} T={T} onRevenue={() => setShowPaid((x) => !x)} revenueOpen={showPaid} data={{
          revenue: money(W(mx.revenue.value), wsCur), revenueD: delta(mx.revenue, prev.revenue),
          revenueSub: `${mx.ordersPaid.value} ${T("paid orders", "oda zilizolipwa")} · ${periodText(mx.period, lang)}`,
          spend: money(A(mx.spend.value), adCur), spendD: delta(mx.spend, prev.spend),
          spendSub: `${fmt(mx.platformConversations.value)} ${T("chats (Meta)", "chats (Meta)")}`,
          split: (mx.ordersPaid.value ?? 0) > 0 && mx.revenue.value != null ? { ads: W(mx.adCustomerRevenue.value) ?? 0, other: (W(mx.revenue.value) ?? 0) - (W(mx.adCustomerRevenue.value) ?? 0),
            adsText: money(W(mx.adCustomerRevenue.value), wsCur), otherText: money((W(mx.revenue.value) ?? 0) - (W(mx.adCustomerRevenue.value) ?? 0), wsCur) } : null,
          roas: mx.returnOnAdSpendAllAdCustomers.value == null ? null : mx.returnOnAdSpendAllAdCustomers.value.toFixed(1) + "×",
          profit: mx.contribution.value == null ? null : money(W(mx.contribution.value), wsCur),
          profitNeg: (mx.contribution.value ?? 0) < 0,
          profitSub: mx.contribution.note === "no paid orders in period" ? T("no paid orders yet", "bado hakuna oda") : undefined,
        }} />
        <div className="kpis has-hero">
          {!cover.spend && <Kpi k={T("Ad spend", "Matumizi ya matangazo")} v={money(A(mx.spend.value), adCur)} n={A(mx.spend.value)} f={(x) => money(x, adCur)} s={`${fmt(mx.platformConversations.value)} ${T("chats (Meta)", "chats (Meta)")}`} d={delta(mx.spend, prev.spend)} src={mx.spend.provenance} title={D("spend")} />}
          <Kpi k={T("Cost per chat", "Gharama kwa chat")} v={money(A(mx.costPerPlatformConversation.value), adCur)} n={A(mx.costPerPlatformConversation.value)} f={(x) => money(x, adCur)} s={T("As in Ads Manager", "Kama Ads Manager")} d={delta(mx.costPerPlatformConversation, prev.costPerPlatformConversation)} invert src="platform" title={D("costPerPlatformConversation")} />
          <Kpi k={T("Cost per qualified inquiry", "Gharama kwa mteja aliyepewa bei")} v={money(A(mx.costPerQualifiedInquiry.value), adCur)} s={mx.costPerQualifiedInquiry.value == null ? (mx.adChats.value ? T(`${fmt(mx.adChats.value)} chats came from ads; none got a price yet`, `Chat ${fmt(mx.adChats.value)} zimetoka matangazo; hakuna iliyopewa bei bado`) : T("No chats from ads in this period.", "Hakuna chat kutoka matangazo kipindi hiki.")) : `${mx.costPerQualifiedInquiry.d} ${T("ad chats priced", "chats za tangazo zilizopewa bei")}`} d={delta(mx.costPerQualifiedInquiry, prev.costPerQualifiedInquiry)} invert src="matched" title={D("costPerQualifiedInquiry")} />
          <Kpi k={T("Cost per attributed sale", "Gharama kwa mauzo yaliyounganishwa")}
            v={noAdSaleYet ? `≥ ${money(A(mx.spend.value), adCur)}` : money(A(mx.costPerAttributedSale.value), adCur)}
            n={noAdSaleYet ? null : A(mx.costPerAttributedSale.value)} f={(x) => money(x, adCur)}
            s={mx.adCustomerOrders.value ? `${mx.adCustomerOrders.value} ${T("paid orders from ad chats", "oda kutoka chats za matangazo")}` : noAdSaleYet ? T("Spent so far, still waiting for the first ad sale", "Kilichotumika hadi sasa, bado tunasubiri mauzo ya kwanza ya tangazo") : T("No ad spend this period", "Hakuna matumizi ya matangazo kipindi hiki")}
            d={delta(mx.costPerAttributedSale, prev.costPerAttributedSale)} invert cls={noAdSaleYet ? "warn" : mx.costPerAttributedSale.value == null ? "" : "ok"} src="matched" title={D("costPerAttributedSale")} />
          {!cover.revenue && <Kpi onClick={() => setShowPaid((x) => !x)} active={showPaid} k={T("Revenue", "Mapato")} v={money(W(mx.revenue.value), wsCur)} n={W(mx.revenue.value)} f={(x) => money(x, wsCur)} s={`${mx.ordersPaid.value} ${T("paid orders", "oda zilizolipwa")} · ${periodText(mx.period, lang)}${mx.unconfirmedSignals.value ? ` · ${mx.unconfirmedSignals.value} ${T("unconfirmed signals", "dalili bila uthibitisho")}` : ""}`} d={delta(mx.revenue, prev.revenue)} src="confirmed" title={D("revenue")}
            s2={<>{(mx.ordersPaid.value ?? 0) > 0 && <span style={{ display: "block" }}>{T(`${money(W(mx.adCustomerRevenue.value), wsCur)} from ads · ${money(W((mx.revenue.value ?? 0) - (mx.adCustomerRevenue.value ?? 0)), wsCur)} not from ads`, `${money(W(mx.adCustomerRevenue.value), wsCur)} kutoka matangazo · ${money(W((mx.revenue.value ?? 0) - (mx.adCustomerRevenue.value ?? 0)), wsCur)} si matangazo`)}</span>}{g.allTime && <span style={{ display: "block" }}>{T(`All time: ${money(W(g.allTime.revenue), wsCur)} · ${fmt(g.allTime.orders)} orders`, `Tangu mwanzo: ${money(W(g.allTime.revenue), wsCur)} · oda ${fmt(g.allTime.orders)}`)}</span>}</>}
            s2t={g.allTime ? T(`All time (the Bought tab): ${fmt(g.allTime.orders)} orders from ${fmt(g.allTime.chats)} customers · ${money(W(g.allTime.revenue), wsCur)}. Each sale counts on the day the payment shows in the chat.`, `Tangu mwanzo (Wamenunua): oda ${fmt(g.allTime.orders)} kutoka wateja ${fmt(g.allTime.chats)} · ${money(W(g.allTime.revenue), wsCur)}. Kila mauzo yanahesabiwa siku malipo yanaonekana kwenye chat.`) : undefined} />}
          {!cover.roas && <Kpi k={T("Return on ad spend", "Mapato kwa shilingi ya tangazo")} v={mx.returnOnAdSpendAllAdCustomers.value == null ? "–" : mx.returnOnAdSpendAllAdCustomers.value.toFixed(1) + "×"} s={mx.returnOnAdSpendAllAdCustomers.value == null ? (mx.returnOnAdSpend.note === "needs exchange rate" ? (ws.fx_auto !== false ? T("Getting today's exchange rate…", "Inapata kiwango cha leo…") : T("Set the exchange rate in Settings → Rules", "Weka kiwango cha kubadilisha kwenye Mipangilio")) : T("No ad spend this period", "Hakuna matumizi ya matangazo")) : T(`${money(W(mx.adCustomerRevenue.value), wsCur)} paid by ${fmt(mx.adCustomerOrders.value)} ad customers this period`, `${money(W(mx.adCustomerRevenue.value), wsCur)} zimelipwa na wateja ${fmt(mx.adCustomerOrders.value)} wa matangazo kipindi hiki`)} src="matched" title={T("Money paid this period by customers who came from an ad ÷ what the ads cost this period. A customer who clicked the ad yesterday and paid today counts today.", "Pesa zilizolipwa kipindi hiki na wateja waliotoka kwenye tangazo ÷ gharama ya matangazo kipindi hiki. Mteja aliyebofya jana na kulipa leo anahesabiwa leo.")}
            s2={mx.returnOnAdSpend.value != null ? T(`Only chats that started in this period: ${mx.returnOnAdSpend.value.toFixed(1)}× (${money(W(mx.attributedAdRevenue.value), wsCur)})`, `Chats zilizoanza kipindi hiki tu: ${mx.returnOnAdSpend.value.toFixed(1)}× (${money(W(mx.attributedAdRevenue.value), wsCur)})`) : undefined}
            fix={mx.returnOnAdSpend.note === "needs exchange rate" && ws.fx_auto === false ? <SetNumber ws={ws} onWs={onWs} field="fx_rate" label={T(`1 ${rawAdCur} =`, `1 ${rawAdCur} =`)} unit={ws.currency} placeholder="2,600" hint={T("Use your bank's rate. You can change it later in Settings.", "Tumia kiwango cha benki yako. Unaweza kubadilisha baadaye kwenye Mipangilio.")} T={T} /> : null} />}
          {!cover.profit && <Kpi k={mx.contribution.note === "estimated" ? T("Profit (estimated)", "Faida (makadirio)") : T("Profit", "Faida")} v={money(W(mx.contribution.value), wsCur)}
            cls={mx.contribution.value == null ? "" : mx.contribution.value < 0 ? "flag" : mx.contribution.value > 0 ? "ok" : ""}
            s={mx.contribution.note === "no paid orders in period" && mx.contribution.value != null ? ((mx.spend.value ?? 0) > 0 ? T(`Ad spend${isToday ? " so far today" : ""} · no paid orders yet`, `Matumizi ya matangazo${isToday ? " hadi sasa leo" : ""} · bado hakuna oda iliyolipwa`) : T("No ad spend and no paid orders this period", "Hakuna matumizi wala oda zilizolipwa kipindi hiki"))
              : mx.contribution.value == null ? (mx.contribution.note === "needs exchange rate" ? T("Needs the exchange rate", "Inahitaji kiwango cha kubadilisha") : T(`${fmt(mx.coverage.ordersMissingCost)} of ${fmt(mx.contribution.d)} orders have no cost yet`, `Oda ${fmt(mx.coverage.ordersMissingCost)} kati ya ${fmt(mx.contribution.d)} hazina gharama bado`))
              : mx.contribution.note === "estimated" ? T(`after ads and product costs · ${fmt(mx.coverage.ordersEstimatedCost)} of ${fmt(mx.ordersPaid.value)} orders use your default cost`, `baada ya matangazo na gharama za bidhaa · oda ${fmt(mx.coverage.ordersEstimatedCost)} kati ya ${fmt(mx.ordersPaid.value)} zinatumia gharama ya kawaida`)
              : T(`after ads and the cost of ${fmt(mx.ordersPaid.value)} orders (${money(W(mx.coverage.orderCosts), wsCur)})`, `baada ya matangazo na gharama za oda ${fmt(mx.ordersPaid.value)} (${money(W(mx.coverage.orderCosts), wsCur)})`)} src="derived" title={D("contribution")}
            fix={mx.contribution.note === "needs exchange rate" ? <span className="small muted">{ws.fx_auto !== false ? T("Waiting for today's exchange rate.", "Inasubiri kiwango cha leo.") : T("Set the exchange rate on the card before this one.", "Weka kiwango cha kubadilisha kwenye kadi iliyotangulia.")}</span>
              : mx.contribution.note === "needs order costs" ? <span className="small muted">{T("Say what was in each sale: ", "Sema kilichokuwa kwenye kila mauzo: ")}<a href="#products">{T("My products → Sales with no cost yet", "Bidhaa zangu → Mauzo yasiyo na gharama")}</a>{T(". Or set a default cost per order in Settings → Rates.", ". Au weka gharama ya kawaida kwa oda kwenye Mipangilio → Viwango.")}</span>
              : mx.contribution.note === "estimated" ? <span className="small muted"><a href="#products">{T("Make it exact: say what was in each sale", "Ifanye kamili: sema kilichokuwa kwenye kila mauzo")}</a></span> : null} />}
          <Kpi k={T("Median first reply", "Muda wa kujibu")} v={dur(mx.medianFirstReply.value)} s={`${mx.over1h.value} ${T("waited over 1 h", "zilisubiri > saa 1")}${mx.noReply.value ? ` · ${mx.noReply.value} ${T("no reply", "hazikujibiwa")}` : ""}`} cls={mx.medianFirstReply.value != null && mx.medianFirstReply.value > 900 ? "flag" : ""} src="observed" />
          <Kpi k={T("Warm, waiting for follow-up", "Wenye nia, wanasubiri ufuatiliaji")} v={fmt(mx.warmNoFollowUp.value)} n={mx.warmNoFollowUp.value} f={(x) => fmt(Math.round(x))} s={`${T("of", "kati ya")} ${mx.warmNoFollowUp.n} ${T("warm", "wenye nia")} · ${T("rule", "kanuni")}: ${ws.follow_up_hours} h`} cls={mx.warmNoFollowUp.value ? "flag" : "ok"} src="inferred" />
        </div>
        {showPaid && <PaidOrders ws={ws} orders={g.orders} period={mx.period} adNames={adNames} onClose={() => setShowPaid(false)} />}
        <Recovered ws={ws} period={mx.period} conv={W} cur={wsCur} />
        <AdMoney ws={ws} />
        <PaymentGuard ws={ws} compact />
        <LostReasons ws={ws} />
        <LeakGuard ws={ws} />

        <div className="two">
          <section className="card">
            <div className="row between">
              <div><h2>{spendTitle(range, mx.period, lang)}</h2><span className="small muted">{trend.weekly ? T("Spend per week.", "Matumizi kwa wiki.") : T("Spend per day.", "Matumizi kwa siku.")}{trend.prev.some((v) => v > 0) ? T(" Solid: this period. Dashed: the one before.", " Mstari kamili: kipindi hiki. Wenye nukta: kilichopita.") : ""}{trend.partialLast ? (trend.weekly ? T(" The last week isn't complete.", " Wiki ya mwisho haijakamilika.") : T(" Today isn't over yet.", " Leo bado haijaisha.")) : ""} <SourceBadge p="platform" lang={lang} /></span></div>
              {trend.change != null && <span className={"delta " + (trend.change > 0 ? "up" : "down")}>{trend.change > 0 ? "↑" : "↓"} {Math.abs(Math.round(trend.change * 100))}%</span>}
            </div>
            <div className="big" ref={totalRef}>{money(trend.total, adCur)}</div>
            {trend.labels.length ? <TrendChart days={trend.labels} cur={trend.cur} prev={trend.prev} weekly={trend.weekly} partialLast={trend.partialLast} /> : <span className="small muted">–</span>}
          </section>
          <section className="card">
            <div><h2>{T("Where chats stop", "Chats zinaishia wapi")}</h2><span className="small muted">{T("Chats started in this period, compared with the period before.", "Chats zilizoanza kipindi hiki, ikilinganishwa na kilichopita.")}</span></div>
            {funnel.map(([l, v, c]) => {
              const pv = { chats: prev.chats, replied: prev.replied, priced: prev.priced, paymentSignals: prev.paymentSignals, attributedSales: prev.attributedSales } as Record<string, Metric>;
              const key = v === mx.chats ? "chats" : v === mx.replied ? "replied" : v === mx.priced ? "priced" : v === mx.paymentSignals ? "paymentSignals" : "attributedSales";
              const d = delta(v, pv[key]);
              const share = mx.chats.value ? Number(v.value) / Number(mx.chats.value) : 0;
              return (
                <div className="fstep" key={l}><span>{l} <SourceBadge p={v.provenance} lang={lang} compact /></span>
                  <div className={"bar " + c}><i style={{ width: `${share * 100}%` }} /></div>
                  <span className="num" style={{ textAlign: "right" }}>{v.value} · {pct(share)}{d != null && <span className={"small " + (d >= 0 ? "ok" : "err")}> {d >= 0 ? "↑" : "↓"}{Math.abs(Math.round(d * 100))}%</span>}</span></div>
              );
            })}
            <p className="small muted" style={{ margin: 0 }}>{T(`Sources: ${fmt(mx.adChats.value)} from ads · ${fmt(mx.organicChats.value)} organic · ${fmt(mx.unknownChats.value)} unknown. Attributed = paid within ${ws.conversion_window_days} days of the chat starting.`, `Vyanzo: ${fmt(mx.adChats.value)} matangazo · ${fmt(mx.organicChats.value)} moja kwa moja · ${fmt(mx.unknownChats.value)} haijulikani. Zimeunganishwa = zililipwa ndani ya siku ${ws.conversion_window_days} tangu chat ianze.`)}</p>
          </section>
        </div>

        <div className="two">
          <section className="card">
            <div className="row between"><h2>{T("What to fix this week", "Cha kurekebisha wiki hii")}</h2><a href="#report" className="small">{T("Full diagnosis →", "Uchunguzi kamili →")}</a></div>
            <FixList findings={findings} lang={lang === "sw" ? "sw" : "en"} />
          </section>
          <section className="card">
            {(() => {
              const cov: { label: string; ok: boolean; note: string }[] = [
              { label: T("Ad account", "Akaunti ya matangazo"), ok: adsConn.length > 0 && adsConn.every((c) => c.status === "active"), note: adsConn.length ? `${T("last successful sync", "usawazishaji wa mwisho")} ${ago(lastSync)}${adsConn.some((c) => c.last_error) ? " · " + T("last run had an error", "mara ya mwisho kulikuwa na hitilafu") : ""}` : T("not connected", "haijaunganishwa") },
              { label: "WhatsApp", ok: waConn.length > 0, note: waConn.length ? `${g.nums.map((n) => n.display_phone ?? n.phone_number_id).join(", ")} · ${T("history", "historia")}: ${g.nums[0]?.history_status ?? "–"}` : T("not connected; using uploaded chat exports", "haijaunganishwa; chats zilizopakiwa tu") },
              { label: T("Webhook events", "Matukio ya webhook"), ok: !failed || failed.events === 0, note: g.health.length ? g.health.map((h) => `${h.status}: ${h.events}`).join(" · ") : T("none received yet", "hakuna bado") },
              { label: T("Chat sources known", "Vyanzo vya chats vinajulikana"), ok: (mx.coverage.knownSourceShare ?? 0) >= 0.5, note: mx.coverage.knownSourceShare == null ? "–" : pct(mx.coverage.knownSourceShare) + " " + T("of chats have a known source", "ya chats zina chanzo") },
              { label: T("Read by Kito", "Zimesomwa na Kito"), ok: (mx.coverage.kitoReadShare ?? 0) >= 0.7, note: mx.coverage.kitoReadShare == null ? "–" : pct(mx.coverage.kitoReadShare) + " " + T("of chats this period", "ya chats kipindi hiki") },
              { label: T("Exchange rate", "Kiwango cha kubadilisha"), ok: !mx.coverage.fxNeeded || mx.coverage.fxSet, note: !mx.coverage.fxNeeded ? T("not needed", "haihitajiki") : mx.coverage.fxSet ? `1 ${rawAdCur} = ${fmt(ws.fx_rate)} ${ws.currency} · ${ws.fx_auto !== false ? T("automatic", "kiotomatiki") : T("set by you", "umeweka wewe")}` : T("needed for return on ad spend", "inahitajika kwa mapato kwa tangazo") },
              { label: T("Order costs", "Gharama za oda"), ok: mx.coverage.ordersMissingCost === 0 || mx.coverage.expensesCount > 0, note: mx.coverage.ordersMissingCost ? T(`${mx.coverage.ordersMissingCost} paid orders this period have no cost`, `Oda ${mx.coverage.ordersMissingCost} kipindi hiki hazina gharama`) : mx.ordersPaid.value ? T(`every order has a cost · ${money(W(mx.coverage.orderCosts), wsCur)}`, `kila oda ina gharama · ${money(W(mx.coverage.orderCosts), wsCur)}`) : T("no paid orders this period", "hakuna oda kipindi hiki") },
              { label: T("Orders", "Oda"), ok: (mx.ordersPaid.value ?? 0) > 0 || (mx.chats.value ?? 0) === 0, note: `${fmt(mx.ordersPaid.value)} ${T("paid", "zilizolipwa")} · ${money(W(mx.revenueManual.value), wsCur)} ${T("confirmed by you", "umethibitisha")} · ${money(W(mx.revenueImported.value), wsCur)} ${T("imported", "zimeingizwa")}${mx.ordersUnlinked.value ? ` · ${mx.ordersUnlinked.value} ${T("not linked to a chat", "hazijaunganishwa na chat")}` : ""}` }];
              const bad = cov.filter((c) => !c.ok).length;
              return <>
                <div className="row between"><h2>{T("Data coverage & sources", "Ukamilifu wa data na vyanzo")}</h2>
                  <span className={"cov-sum " + (bad ? "warn" : "ok")}>{bad ? T(`${bad} to check`, `${bad} za kuangalia`) : T("All good", "Yote sawa")}</span></div>
                <ul className="cov">{[...cov].sort((x, y) => Number(x.ok) - Number(y.ok)).map((c) => <Cov key={c.label} {...c} T={T} />)}</ul>
              </>;
            })()}
            <ProvenanceLegend lang={lang} />
          </section>
        </div>

        <section className="card">
          {costBars.kind === "sale" ? (
            <div><h2>{T("What an attributed sale costs", "Mauzo moja yanagharimu kiasi gani")}</h2><span className="small muted">{T("Spend ÷ paid orders from the ad's chats, " + adCur + ". Shorter is cheaper. A matched estimate.", "Matumizi ÷ oda zilizolipwa kutoka chats za tangazo, " + adCur + ". Fupi ni nafuu. Ni makadirio.")}</span></div>
          ) : (
            <div><h2>{T("What a chat costs", "Chat moja inagharimu kiasi gani")}</h2><span className="small muted">{T("No paid orders linked to ad chats yet, so this shows cost per chat started (Meta), " + adCur + ". Record orders in Chats to see cost per sale.", "Bado hakuna oda zilizounganishwa na matangazo, kwa hiyo hii ni gharama kwa chat (Meta), " + adCur + ". Rekodi oda kwenye Chats kuona gharama kwa mauzo.")}</span></div>
          )}
          {costBars.items.length ? <CostBars items={costBars.items} bestLabel={T("best", "bora")} f={(n) => amt(n, adCur)} /> : <span className="small muted">–</span>}
        </section>

        <div className="two">
          <section className="card">
            <div><h2>{T("Where the money went", "Pesa ilienda wapi")}</h2><span className="small muted">{T("Spend by ad, ", "Matumizi kwa tangazo, ") + adCur}</span></div>
            <SpendSplit total={A(mx.spend.value) ?? 0} f={(n) => amt(n, adCur)} items={ads.filter((a) => Number(a.spend) > 0).map((a) => ({ name: a.ad_name ?? a.ad_id, value: A(Number(a.spend)) ?? 0 }))} />
          </section>
          <section className="card">
            <h2>{T("Objections in unsold chats", "Pingamizi kwenye chats zisizouza")}</h2>
            <Objections list={g.objections} lang={lang} />
          </section>
        </div>

        {(g.objByAd?.length ?? 0) > 0 && <ObjectionsByAd rows={g.objByAd!} names={Object.fromEntries(g.options.ads.map((x) => [x.id, x.name]))} lang={lang} T={T} />}

        <AdsTable ads={ads} daily={g.daily} today={g.today} adCur={adCur} A={A} T={T} />
      </>)}
    </div>
  );
}

function Objections({ list, lang }: { list: [string, number][]; lang: "sw" | "en" }) {
  if (!list.length) return <span className="small muted">–</span>;
  return <ul className="dmini">{list.map(([k, n]) => <li key={k}><span>{L[lang].obj[k] ?? k}</span><b>{n}</b></li>)}</ul>;
}

/** "Ad X brings people who say it's too expensive": what stops buyers, split by the ad the chat came from. */
function ObjectionsByAd({ rows, names, lang, T }: { rows: AdObjections[]; names: Record<string, string>; lang: "sw" | "en"; T: (en: string, sw: string) => string }) {
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
  return (
    <section className="card">
      <div><h2>{T("What stops buyers, by ad", "Kinachozuia wanunuzi, kwa tangazo")}</h2>
        <span className="small muted">{T("Chats this period from each ad, how many bought, and the main reason the rest didn't (from what customers said). Ads with fewer than 8 chats are left out.", "Chat za kipindi hiki kutoka kila tangazo, wangapi wamenunua, na sababu kuu ya waliobaki kutonunua (kutokana na walichosema wateja). Matangazo yenye chat chini ya 8 hayamo.")}</span></div>
      <div className="scroll"><table className="ads-t objad">
        <thead><tr><th>{T("Ad", "Tangazo")}</th><th className="num">{T("Chats", "Chat")}</th><th className="num">{T("Bought", "Wamenunua")}</th><th>{T("Main objection in the rest", "Pingamizi kuu kwa waliobaki")}</th></tr></thead>
        <tbody>{rows.slice(0, 12).map((r) => {
          const top = Object.entries(r.counts).sort((a, b) => b[1] - a[1]);
          const [k, n] = top[0] ?? [null, 0];
          return (
            <tr key={r.ad_id}>
              <td title={r.ad_id}>{names[r.ad_id] ?? r.ad_id}</td>
              <td className="num">{r.chats}</td>
              <td className="num">{r.sold} <span className="small muted">({pct(r.sold, r.chats)}%)</span></td>
              <td>{k ? <><b>{L[lang].obj[k] ?? k}</b> <span className="small muted">{T(`${pct(n, r.unsold)}% of unsold`, `${pct(n, r.unsold)}% ya wasionunua`)}</span>
                {top.slice(1, 3).map(([k2, n2]) => <span key={k2} className="chip">{L[lang].obj[k2] ?? k2} {pct(n2, r.unsold)}%</span>)}</>
                : <span className="small muted">{T("No objection said", "Hakuna pingamizi lililosemwa")}</span>}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
    </section>
  );
}

/** "1–7 Nov" style label for the Revenue card, so it's clear which days are counted. */
/** Card title that says which range the total covers: "Ad spend · last 30 days", "Ad spend today". */
function spendTitle(range: RangeSel, p: { from: string; to: string }, lang: "sw" | "en") {
  const base = lang === "sw" ? "Matumizi ya matangazo" : "Ad spend";
  if (range.key === "today") return lang === "sw" ? `${base} leo` : `${base} today`;
  if (range.key === "yesterday") return lang === "sw" ? `${base} jana` : `${base} yesterday`;
  if (range.key === "custom") return `${base} · ${periodText(p, lang)}`;
  const l = presetLabel(range.key, lang);
  return `${base} · ${l.charAt(0).toLowerCase()}${l.slice(1)}`;
}

function periodText(p: { from: string; to: string }, lang: "sw" | "en") {
  const f = (d: string, withMonth: boolean) => new Date(d + "T00:00:00Z").toLocaleDateString(lang === "sw" ? "sw-TZ" : "en-GB", { day: "numeric", ...(withMonth ? { month: "short" } : {}), timeZone: "UTC" });
  const same = p.from.slice(0, 7) === p.to.slice(0, 7);
  return p.from === p.to ? f(p.to, true) : `${f(p.from, !same)}–${f(p.to, true)}`;
}

function Cov({ label, ok, note, T }: { label: string; ok: boolean; note: string; T: (en: string, sw: string) => string }) {
  return (
    <li className={ok ? "ok" : "bad"}>
      <span className="cov-ic" aria-hidden>{ok ? "✓" : "!"}</span>
      <div><strong>{label}</strong><small>{note}</small></div>
      <em>{ok ? T("OK", "Sawa") : T("Check", "Angalia")}</em>
    </li>
  );
}

/** KPI tile. Pass `n` + `f` to count the value up on load instead of showing `v` at once. */
function Kpi({ k, v, s, s2, s2t, cls = "", n, f, d, invert, src, title, fix, onClick, active }: { k: string; v: string; s?: string; s2?: ReactNode; s2t?: string; cls?: string; n?: number | null; f?: (x: number) => string; d?: number | null; invert?: boolean; src?: string; title?: string; fix?: ReactNode; onClick?: () => void; active?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  // The count-up writes the number straight into the page, so when there's no number any more put the text back (else the old figure stays).
  useEffect(() => { if (n != null && isFinite(n) && f) countTo(ref.current, n, f, { duration: 1.2, delay: 0.3 }); else if (ref.current) { countTo(ref.current, 0, () => v, { duration: 0 }); ref.current.textContent = v; } }, [n, f, v]);
  const good = d == null ? null : invert ? d < 0 : d > 0;
  return (
    <div className={"kpi " + cls + (onClick ? " kpi-click" : "") + (active ? " on" : "")} title={title}
      {...(onClick ? { role: "button", tabIndex: 0, "aria-expanded": !!active, onClick: (e: any) => { if (!(e.target as HTMLElement).closest("a,button,input,select")) onClick(); }, onKeyDown: (e: any) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } } : {})}>
      <span className="k"><span className="kt">{k}</span>{src && <SourceBadge p={src as any} lang="en" compact />}</span>
      <span className="kv">
        <span className="v" ref={ref}>{v}</span>
        {d != null && <span className={"delta " + (good ? "down" : "up")}>{d > 0 ? "↑" : "↓"} {Math.abs(Math.round(d * 100))}%</span>}
      </span>
      {s && <span className="s" title={s}>{s}</span>}
      {s2 && <span className="s kpi-s2" title={s2t ?? (typeof s2 === "string" ? s2 : undefined)}>{s2}</span>}
      {fix && <div className="kpi-fix">{fix}</div>}
    </div>
  );
}

/** A missing setting, filled in right on the card that needs it. */
function SetNumber({ ws, onWs, field, label, unit, placeholder, hint, T }: { ws: Workspace; onWs?: (w: Workspace) => void; field: "fx_rate" | "unit_cost"; label: string; unit: string; placeholder: string; hint: string; T: (en: string, sw: string) => string }) {
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!canManage(ws)) return <span className="small muted">{T("Ask the owner to set this in Settings.", "Mwombe mmiliki aweke hili kwenye Mipangilio.")}</span>;
  async function save(e: FormEvent) {
    e.preventDefault();
    const n = Number(v.replace(/[^\d.]/g, ""));
    if (!(n > 0)) return setErr(T("Enter a number.", "Weka namba."));
    setBusy(true); setErr("");
    const patch = field === "fx_rate" ? { fx_rate: n, fx_auto: false, fx_source: "manual", fx_updated_at: new Date().toISOString() } : { [field]: n };
    const { error } = await supabase.from("workspaces").update(patch).eq("id", ws.id);
    setBusy(false);
    if (error) setErr(error.message); else onWs?.({ ...ws, ...patch });
  }
  return (
    <form className="kpi-set" onSubmit={save}>
      <span className="small kpi-set-label">{label}</span>
      <div className="kpi-set-row">
        <input inputMode="decimal" placeholder={placeholder} value={v} onChange={moneyInput(setV)} aria-label={label} />
        <span className="small muted">{unit}</span>
        <button className="small primary" disabled={busy || !v.trim()}>{busy ? "…" : T("Save", "Hifadhi")}</button>
      </div>
      <span className="small muted kpi-hint">{err ? <span className="err">{err}</span> : hint}</span>
    </form>
  );
}

/** Greeting by the hour in the business's timezone (falls back to the device clock). */
function greeting(lang: "sw" | "en", tz?: string | null) {
  let h = new Date().getHours();
  try { if (tz) h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(new Date())); } catch { /* bad tz: keep device hour */ }
  if (lang === "sw") return h < 5 ? "Habari za usiku" : h < 12 ? "Habari za asubuhi" : h < 16 ? "Habari za mchana" : h < 19 ? "Habari za jioni" : "Habari za usiku";
  return h < 5 ? "Hello, night owl" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

type Run = "on" | "review" | "issue" | "off" | "unknown";
/** Meta's delivery status → what the owner needs to know. */
function runState(status: string | null | undefined, spentRecently: boolean): Run {
  const st = (status ?? "").toUpperCase();
  if (st === "ACTIVE") return "on";
  if (["PENDING_REVIEW", "IN_PROCESS", "PREAPPROVED"].includes(st)) return "review";
  // A problem only matters while the ad would otherwise be delivering; an old disapproved ad is just stopped.
  if (["WITH_ISSUES", "DISAPPROVED", "PENDING_BILLING_INFO"].includes(st)) return spentRecently ? "issue" : "off";
  if (st) return "off";
  return spentRecently ? "on" : "unknown";   // no status stored yet: spending in the last 2 days counts as running
}
const RUN_ORDER: Record<Run, number> = { on: 0, review: 1, issue: 2, unknown: 3, off: 4 };

function RunBadge({ r, T }: { r: Run; T: (en: string, sw: string) => string }) {
  const label = { on: T("Running", "Linaendelea"), review: T("In review", "Linakaguliwa"), issue: T("Problem", "Tatizo"), off: T("Stopped", "Limesimama"), unknown: T("Not known", "Haijulikani") }[r];
  return <span className={"run run-" + r} title={label}><i aria-hidden />{label}</span>;
}

const FOLD = 6;
function AdsTable({ ads, daily, today, adCur, A, T }: { ads: AdPerf[]; daily: { ad_id?: string; day: string; spend: number }[]; today: string; adCur: string;
  A: (n: number | null | undefined) => number | null; T: (en: string, sw: string) => string }) {
  const [show, setShow] = useState<"running" | "all">(() => { try { return (localStorage.getItem("itaos:ads-show") as "running" | "all") || "running"; } catch { return "running"; } });
  const [open, setOpen] = useState(false);
  const pick = (v: "running" | "all") => { setShow(v); setOpen(false); try { localStorage.setItem("itaos:ads-show", v); } catch { /* ignore */ } };
  const rows = useMemo(() => {
    const yday = new Date(new Date(today + "T00:00:00Z").getTime() - 864e5).toISOString().slice(0, 10);
    const recent = new Set(daily.filter((d) => d.ad_id && d.spend > 0 && d.day >= yday).map((d) => d.ad_id!));
    return ads.map((a) => ({ a, r: runState(a.status, recent.has(a.ad_id)) }))
      .sort((x, y) => RUN_ORDER[x.r] - RUN_ORDER[y.r] || Number(y.a.spend) - Number(x.a.spend));
  }, [ads, daily, today]);
  const running = rows.filter((x) => x.r === "on" || x.r === "review" || x.r === "issue");
  const list = show === "running" ? running : rows;
  const shown = open ? list : list.slice(0, FOLD);
  const hidden = list.length - shown.length;
  return (
    <section className="card">
      <div className="row between">
        <div><h2>{T("Ads: chats vs confirmed paying customers", "Matangazo: chats dhidi ya wateja waliothibitishwa")}</h2>
          <span className="small muted">{T(`${running.length} running · ${rows.length - running.length} stopped. Running ads first, most spend at the top.`, `${running.length} yanaendelea · ${rows.length - running.length} yamesimama. Yanayoendelea kwanza, matumizi makubwa juu.`)}</span></div>
        <div className="seg" role="radiogroup" aria-label={T("Which ads", "Matangazo gani")}>
          <button role="radio" aria-checked={show === "running"} className={show === "running" ? "on" : ""} onClick={() => pick("running")}>{T("Running", "Yanayoendelea")} <em>{running.length}</em></button>
          <button role="radio" aria-checked={show === "all"} className={show === "all" ? "on" : ""} onClick={() => pick("all")}>{T("All", "Yote")} <em>{rows.length}</em></button>
        </div>
      </div>
      <div className="scroll"><table className="ads-t">
        <thead><tr><th>#</th><th>Ad</th><th>{T("Status", "Hali")}</th><th className="n">Spend ({adCur})</th><th className="n">Clicks</th><th className="n">Chats (Meta)</th><th className="n">Chats seen</th><th className="n">Price shared</th><th className="n">{T("Signals", "Dalili")}</th><th className="n">{T("Paid (confirmed)", "Oda zilizolipwa")}</th><th className="n">{T("Cost / sale", "Gharama / mauzo")}</th></tr></thead>
        <tbody>
          {shown.map(({ a, r }, i) => (
            <tr key={a.ad_id} className={r === "off" || r === "unknown" ? "dim" : ""}>
              <td className="rank">{String(i + 1).padStart(2, "0")}</td>
              <td><b>{a.ad_name ?? a.ad_id}</b><div className="small muted">{a.campaign_name}</div></td>
              <td><RunBadge r={r} T={T} /></td>
              <td className="n">{amt(A(Number(a.spend)), adCur)}</td><td className="n">{fmt(a.clicks)}</td><td className="n">{fmt(a.platform_conversations)}</td><td className="n">{fmt(a.chats)}</td>
              <td className="n">{fmt(a.priced)}</td><td className="n muted">{fmt(a.payment_signals)}</td><td className="n"><b>{fmt(a.sold)}</b></td>
              <td className="n">{!(Number(a.sold) > 0) ? (a.spend > 0 && a.chats > 0 ? <span className="chip bad">{T("no confirmed sales", "hakuna mauzo yaliyothibitishwa")}</span> : "–") : amt(A(Number(a.spend) / Number(a.sold)), adCur)}</td>
            </tr>
          ))}
          {!list.length && <tr><td colSpan={11} className="muted small">{!ads.length ? T("No ad data for this period.", "Hakuna data ya matangazo kipindi hiki.") : T("No ad is running right now. Tap All to see the stopped ones.", "Hakuna tangazo linaloendelea sasa. Bofya Yote kuona yaliyosimama.")}</td></tr>}
        </tbody>
      </table></div>
      {/* Phones: one card per ad instead of an 11-column table */}
      <ul className="ads-m">
        {shown.map(({ a, r }) => (
          <li key={a.ad_id} className={r === "off" || r === "unknown" ? "dim" : ""}>
            <div className="ads-m-top">
              <div className="ads-m-name"><b>{a.ad_name ?? a.ad_id}</b>{a.campaign_name && <span className="small muted">{a.campaign_name}</span>}</div>
              <RunBadge r={r} T={T} />
            </div>
            <div className="ads-m-stats">
              <span><small>{T("Spend", "Matumizi")}</small><b>{amt(A(Number(a.spend)), adCur)}</b></span>
              <span><small>{T("Chats", "Chats")}</small><b>{fmt(a.platform_conversations)}</b></span>
              <span><small>{T("Paid", "Wamelipa")}</small><b>{fmt(a.sold)}</b></span>
              <span><small>{T("Cost / sale", "Gharama / mauzo")}</small><b className={!(Number(a.sold) > 0) && a.spend > 0 && a.chats > 0 ? "bad" : ""}>{!(Number(a.sold) > 0) ? (a.spend > 0 && a.chats > 0 ? T("No sale", "Hakuna") : "–") : amt(A(Number(a.spend) / Number(a.sold)), adCur)}</b></span>
            </div>
          </li>
        ))}
        {!list.length && <li className="muted small">{!ads.length ? T("No ad data for this period.", "Hakuna data ya matangazo kipindi hiki.") : T("No ad is running right now. Tap All to see the stopped ones.", "Hakuna tangazo linaloendelea sasa. Bofya Yote kuona yaliyosimama.")}</li>}
      </ul>
      {list.length > FOLD && (
        <button className="fold" onClick={() => setOpen((x) => !x)} aria-expanded={open}>
          {open ? T("Show less", "Onyesha machache") : T(`Show ${hidden} more`, `Onyesha ${hidden} zaidi`)} <span aria-hidden className={open ? "up" : ""}>▾</span>
        </button>
      )}
      <details className="note"><summary>{T("What these columns mean", "Maana ya safu hizi")}</summary>
        <p className="small muted">{T("“Chats seen” are chats itaOS linked to the ad through WhatsApp’s ad referral: a matched link, not proof the ad caused a purchase. “Signals” are inferred payments (words, screenshots, Kito) and are not counted as sales. Cost per sale uses only paid orders recorded in itaOS and paid within the conversion window. Status comes from Meta Ads Manager.", "“Chats seen” ni chats ambazo itaOS imeziunganisha na tangazo kupitia referral ya WhatsApp: ni uhusiano, si uthibitisho kuwa tangazo limesababisha ununuzi. “Dalili” ni malipo yaliyokisiwa (maneno, picha, Kito) na hayahesabiwi kama mauzo. Gharama kwa mauzo hutumia oda zilizolipwa na kurekodiwa itaOS ndani ya dirisha la uthibitisho. Hali inatoka Meta Ads Manager.")}</p>
      </details>
    </section>
  );
}
