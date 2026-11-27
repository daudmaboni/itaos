// Ad money manager card (Ads page). Data: ad_money_range() (migration 0089), for exactly the dates the
// page's date picker shows (27 Nov 2026: its own 7/14/30 switch is gone). Logic: adMoney.ts.
// Says, in plain words, which running ad to add money to, keep, fix or stop, judged on PAID sales.
import { errText } from "./errText";
import { useEffect, useMemo, useState } from "react";
import { supabase, Workspace, money, fmt, converter, displayCurrency } from "./lib";
import { useKept } from "./keep";
import { planAdMoney, adsManagerUrl, type AdMoneyRes, type AdLine, type Advice, type Verdict, type Reason } from "./adMoney";

/** Fewer days than this rarely has enough paid sales to judge an ad fairly. */
export const FAIR_DAYS = 14;

export default function AdMoney({ ws, period, label }: { ws: Workspace; period: { from: string; to: string } | null; label: string }) {
  const T = (en: string, sw: string) => (ws.language === "sw" ? sw : en);
  const from = period?.from ?? null, to = period?.to ?? null;
  // Kept while the app is open: coming back to the page shows the last figures at once, refreshed quietly.
  const [r, setR] = useKept<AdMoneyRes | null>(`admoney:${ws.id}:${from}:${to}`, null);
  const [err, setErr] = useState("");
  const [all, setAll] = useState(false);
  const [how, setHow] = useState(false);

  useEffect(() => {
    if (!from || !to) return;   // the page is still working out its dates
    let gone = false;
    setErr("");
    supabase.rpc("ad_money_range", { p_ws: ws.id, p_from: from, p_to: to }).then(({ data, error }) => {
      if (gone) return;
      if (error) setErr(errText(error)); else setR(data as AdMoneyRes);
    });
    return () => { gone = true; };
  }, [ws.id, from, to]);

  const cur = displayCurrency(ws);
  const plan = useMemo(() => {
    if (!r) return null;
    const cv = converter(ws);
    return planAdMoney(r, (n) => cv(n, r.ad_currency ?? ws.currency), (n) => cv(n, ws.currency));
  }, [r, ws]);

  const title = T("Ad money manager", "Meneja wa pesa za matangazo");
  const short = !!r && r.days < FAIR_DAYS;
  if (err) return <section className="card admoney"><h2>{title}</h2><p className="err small">{err}</p></section>;
  if (!r || !plan) return <section className="card admoney" aria-busy="true"><div className="skeleton" style={{ minHeight: 120 }} /></section>;

  const M = (n: number | null | undefined) => money(n, cur);
  const sales = (n: number) => (Number.isInteger(n) ? fmt(n) : "≈ " + (n < 10 ? n.toFixed(1) : fmt(Math.round(n))));
  const name = (l: AdLine) => l.ad.name ?? l.ad.ad_id;
  const t = r.totals;

  const verdictLabel: Record<Verdict, string> = {
    scale: T("Add money", "Ongeza pesa"), keep: T("Keep going", "Endelea"), watch: T("Getting costly", "Linakuwa ghali"),
    stop: T("Stop it", "Lizime"), early: T("Too early", "Bado mapema"), off: T("Not running", "Halitumiki"),
  };
  const verdictCls: Record<Verdict, string> = { scale: "ok", keep: "", watch: "warn", stop: "bad", early: "", off: "" };
  const reason = (w: Reason): string => {
    switch (w.k) {
      case "no_sale": return T(`Spent ${M(w.spend)}, nobody paid yet`, `Limetumia ${M(w.spend)}, bado hakuna aliyelipa`);
      case "losing": return T(`A paid sale costs ${M(w.cps)}, more than one sale leaves you (${M(w.be)})`, `Mauzo moja yanagharimu ${M(w.cps)}, zaidi ya unachobaki nacho kwa mauzo moja (${M(w.be)})`);
      case "cheap": return T(`A paid sale costs ${M(w.cps)}, well under ${M(w.be)}`, `Mauzo moja yanagharimu ${M(w.cps)}, chini sana ya ${M(w.be)}`);
      case "costly": return T(`A paid sale costs ${M(w.cps)}, your average is ${M(w.avg)}`, `Mauzo moja yanagharimu ${M(w.cps)}, wastani wako ni ${M(w.avg)}`);
      case "fine": return T(`A paid sale costs ${M(w.cps)}, you can go up to ${M(w.be)}`, `Mauzo moja yanagharimu ${M(w.cps)}, unaweza kufika hadi ${M(w.be)}`);
      case "too_early": return T(`Let it spend about ${M(w.need)} more before judging`, `Liache litumie takriban ${M(w.need)} zaidi kabla ya kuamua`);
      case "no_data": return T("Not enough sales yet to judge", "Bado hakuna mauzo ya kutosha kuamua");
      case "stopped": return T("Not running now", "Halitumiki sasa");
    }
  };
  const adviceText = (a: Advice): string => {
    switch (a.k) {
      case "move": return T(`Move about ${M(a.perDay)} a day from “${name(a.from)}” to “${name(a.to)}”. ${reason(a.from.why)}.`,
        `Hamisha takriban ${M(a.perDay)} kwa siku kutoka “${name(a.from)}” kwenda “${name(a.to)}”. ${reason(a.from.why)}.`);
      case "stop": return T(`Stop “${name(a.ad)}”. ${reason(a.ad.why)}.`, `Zima “${name(a.ad)}”. ${reason(a.ad.why)}.`);
      case "scale": return T(`“${name(a.ad)}” is making you money: a paid sale costs about ${M(a.ad.cps)}. Add up to 20% to its daily budget, then check here again in 3 days.`,
        `“${name(a.ad)}” linakuingizia pesa: mauzo moja yanagharimu takriban ${M(a.ad.cps)}. Ongeza hadi 20% kwenye bajeti yake ya siku, kisha angalia hapa tena baada ya siku 3.`);
      case "fix": return T(`“${name(a.ad)}” is getting costly: a paid sale costs ${M(a.ad.cps)}. Try a new video or picture before adding money.`,
        `“${name(a.ad)}” linakuwa ghali: mauzo moja yanagharimu ${M(a.ad.cps)}. Jaribu video au picha mpya kabla ya kuongeza pesa.`);
      case "second_ad": return T(`Only “${name(a.ad)}” is running, so there is nothing to compare it with. Start a second ad with a different video or picture on a small budget. itaOS will show which one brings paid sales for less.`,
        `Ni “${name(a.ad)}” peke yake linaloendelea, kwa hiyo hakuna cha kulinganisha nalo. Anzisha tangazo la pili lenye video au picha tofauti kwa bajeti ndogo. itaOS itakuonyesha lipi linaleta wateja wanaolipa kwa gharama ndogo.`);
      case "none_running": return T("No ad is running right now. When you start one, itaOS judges it here by the sales it brings.", "Hakuna tangazo linaloendelea sasa. Ukianzisha, itaOS italipima hapa kwa mauzo linayoleta.");
      case "no_sales_yet": return T("No paid sales recorded in these days yet. Record sales in Chats so itaOS can judge your ads by money, not messages.", "Bado hakuna mauzo yaliyorekodiwa siku hizi. Rekodi mauzo kwenye Chats ili itaOS ipime matangazo yako kwa pesa, si kwa ujumbe.");
    }
  };

  const live = plan.lines.filter((l) => l.running);
  const stopped = plan.lines.filter((l) => !l.running);
  const shown = all ? plan.lines : live;

  return (
    <section className="card admoney">
      <div className="row between">
        <div>
          <h2>{title}</h2>
          <span className="small muted">{T(`Each running ad judged by the people who paid, not by messages · ${label}`, `Kila tangazo linaloendelea linapimwa kwa waliolipa, si kwa ujumbe · ${label}`)}</span>
        </div>
      </div>
      {short && <p className="small muted am-short">{T(`${r.days === 1 ? "One day is" : `${r.days} days is`} too short to judge ads fairly, so these verdicts can swing. Pick 14 days or more at the top before you stop or add money to an ad.`,
        `${r.days === 1 ? "Siku moja ni" : `Siku ${r.days} ni`} chache mno kupima matangazo vizuri, kwa hiyo majibu haya yanaweza kubadilika. Chagua siku 14 au zaidi juu kabla ya kuzima au kuongeza pesa kwenye tangazo.`)}</p>}

      {plan.advice.length > 0 && (
        <ol className="am-todo">
          {plan.advice.map((a, i) => <li key={i}><span>{adviceText(a)}</span></li>)}
        </ol>
      )}

      {plan.breakEven != null && (
        <p className="small muted am-be">
          {T(`An ad sale brings ${M(plan.avgSale)} on average. `, `Mauzo ya tangazo yanaleta wastani wa ${M(plan.avgSale)}. `)}
          {plan.costKnown
            ? T(`After product cost, an ad can spend up to ${M(plan.breakEven)} per paid sale and still not lose.`, `Baada ya gharama ya bidhaa, tangazo linaweza kutumia hadi ${M(plan.breakEven)} kwa kila mauzo bila hasara.`)
            : <>{T("Product cost is not set, so the full price is used. ", "Gharama ya bidhaa haijawekwa, kwa hiyo bei nzima inatumika. ")}<a href="#settings/rules">{T("Set it in Settings → Rules → Rates", "Iweke kwenye Mipangilio → Rules → Viwango")}</a></>}
        </p>
      )}

      <div className="am-rows">
        {shown.map((l) => (
          <div className={"am-row" + (l.running ? "" : " dim")} key={l.ad.ad_id}>
            <div className="am-name">
              <b>{name(l)}</b>
              <span className="small muted">{reason(l.why)}</span>
            </div>
            <div className="am-stats">
              <span><small>{T("Spent", "Matumizi")}</small><b>{M(l.spend)}</b></span>
              <span><small>{T("Paid", "Walilipa")}</small><b title={l.ad.sales_exact < l.ad.sales ? T(`${fmt(l.ad.sales_exact)} tagged with this ad, the rest is its share of untagged ad chats`, `${fmt(l.ad.sales_exact)} wana alama ya tangazo hili, wengine ni sehemu yake ya chats zisizo na alama`) : undefined}>{sales(Number(l.ad.sales))}</b></span>
              <span><small>{T("Per paid sale", "Kwa mauzo moja")}</small><b>{l.cps != null ? M(l.cps) : "–"}</b></span>
              <span><small>{T("Left after ad", "Faida baada ya tangazo")}</small><b className={l.profit == null ? "" : l.profit >= 0 ? "good" : "bad"}>{l.profit == null ? "–" : M(l.profit)}</b></span>
            </div>
            <div className="am-act">
              <span className={"chip " + verdictCls[l.verdict]}>{verdictLabel[l.verdict]}</span>
              {l.running && (l.verdict === "stop" || l.verdict === "scale" || l.verdict === "watch") && (
                <a className="btn small" href={adsManagerUrl(l.ad)} target="_blank" rel="noreferrer">{T("Open in Ads Manager", "Fungua Ads Manager")}</a>
              )}
            </div>
          </div>
        ))}
        {!shown.length && <p className="small muted">{T("No ad spent money in these days.", "Hakuna tangazo lililotumia pesa siku hizi.")}</p>}
      </div>

      <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
        {stopped.length > 0 && <button type="button" className="linkish small" onClick={() => setAll((x) => !x)} aria-expanded={all}>{all ? T("Hide stopped ads", "Ficha matangazo yaliyosimama") : T(`Show ${stopped.length} stopped ads`, `Onyesha matangazo ${stopped.length} yaliyosimama`)}</button>}
        <button type="button" className="linkish small" onClick={() => setHow((x) => !x)} aria-expanded={how}>{T("How itaOS counts this", "itaOS inahesabuje")}</button>
      </div>
      {how && (
        <div className="small muted am-how">
          <p>{T(`${label}. A sale counts on the day it was paid, for the ad the customer's chat came from, if they paid within ${ws.conversion_window_days ?? 30} days of starting the chat.`,
            `${label}. Mauzo yanahesabiwa siku yaliyolipwa, kwa tangazo ambalo chat ya mteja ilitoka, kama alilipa ndani ya siku ${ws.conversion_window_days ?? 30} tangu aanze chat.`)}</p>
          {t.shared_chats > 0 && <p>{T(`${fmt(t.shared_chats)} of ${fmt(t.ad_chats)} ad chats arrived without the ad's tag (WhatsApp sometimes drops it). Each of those is shared between the ads that ran that day, by how many chats Meta says each ad brought. That's why some paid counts show “≈”.`,
            `Chats ${fmt(t.shared_chats)} kati ya ${fmt(t.ad_chats)} za matangazo zilikuja bila alama ya tangazo (WhatsApp wakati mwingine huiondoa). Kila moja inagawanywa kati ya matangazo yaliyoendelea siku hiyo, kulingana na chats ambazo Meta inasema kila tangazo lilileta. Ndiyo maana baadhi ya hesabu zina “≈”.`)}</p>}
          <p>{T(`Cost per paid sale is steadied toward your average (${plan.avgCps != null ? M(plan.avgCps) : "–"}) until an ad has enough chats, so one lucky sale can't make a small ad look like a winner.`,
            `Gharama kwa mauzo inasogezwa karibu na wastani wako (${plan.avgCps != null ? M(plan.avgCps) : "–"}) mpaka tangazo liwe na chats za kutosha, ili mauzo moja ya bahati yasifanye tangazo dogo lionekane bora.`)}</p>
          <p>{T(`Only payments recorded in itaOS count: ${fmt(t.ad_sales)} sales from ad chats out of ${fmt(t.all_sales)} sales in these days.`,
            `Malipo yaliyorekodiwa itaOS pekee ndiyo yanahesabiwa: mauzo ${fmt(t.ad_sales)} kutoka chats za matangazo kati ya mauzo ${fmt(t.all_sales)} siku hizi.`)}</p>
        </div>
      )}
    </section>
  );
}
