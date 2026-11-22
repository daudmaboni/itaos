// "Money itaOS brought back" (migration 0068). Built so the owner can't argue with it:
//  - The big number is PROVEN once enough customers have been kept aside: itaOS compares the slipping-away
//    customers it showed the owner with the ones it quietly kept aside, and only the difference counts.
//    Until then it shows the VERY LIKELY sales: the owner messaged after an itaOS flag, the customer replied, then paid.
//  - Everything comes from WhatsApp messages and recorded payments, never from a button the owner presses.
//  - Every sale is listed with its level; sales the customer made on their own, or through a new ad, are shown but not counted.
import { useEffect, useState } from "react";
import { supabase, Workspace, money, fmt } from "./lib";
import type { Period } from "./metrics";

type Kind = "promise" | "after_price" | "reorder";
type Tier = "very_likely" | "likely" | "on_own" | "ad";
type Item = { order_id: string; conversation_id: string; amount: number; tier: Tier; kind: Kind; flagged_at: string; acted_at: string | null; replied_at: string | null; paid_at: string; name: string };
type Amt = { amount: number; orders: number };
type Res = {
  currency: string; days: number; price_month: number | null;
  method: "proven" | "evidence"; headline: number; headline_low: number | null; headline_high: number | null;
  proof: { ready: boolean; shown_n: number; shown_paid: number; hidden_n: number; hidden_paid: number; shown_rate: number | null; hidden_rate: number | null; need_hidden: number; need_shown: number; exact: boolean; pct: number; extra_customers: number | null };
  past: { ready: boolean; n: number; paid: number; rate: number | null; now_n: number; now_paid: number; now_rate: number | null; extra: number | null };
  tiers: Record<Tier, Amt>;
  by_kind: { kind: Kind; amount: number; orders: number }[];
  items: Item[]; total: number; orders: number; waiting: number;
  left: { ignored: number; amount: number | null; acted_rate: number | null; ignored_rate: number | null };
  found_orders: number; found_amount: number;
};

const when = (iso: string, tz: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", timeZone: tz });
const pct = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 100)}%`);

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
  const [how, setHow] = useState(false);

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
  if (!r.tiers) return <section className="card rec"><h2>{T("Money itaOS brought back", "Pesa itaOS imerudisha")}</h2><p className="small muted">{T("Updating… try again in a few minutes.", "Inasasishwa… jaribu tena baada ya dakika chache.")}</p></section>;

  // The dashboard may show USD while sales are in TZS: convert every amount the same way.
  const M = (n: number) => money(conv(n) ?? n, cur);
  const kindLabel: Record<Kind, string> = {
    promise: T("Promise", "Ahadi"),
    after_price: T("After the price", "Baada ya bei"),
    reorder: T("Reorder", "Nunua tena"),
  };
  const tierLabel: Record<Tier, string> = {
    very_likely: T("Very likely", "Uhakika mkubwa"),
    likely: T("Likely", "Inawezekana"),
    on_own: T("Paid on their own", "Walilipa wenyewe"),
    ad: T("Came back from an ad", "Walirudi kupitia tangazo"),
  };
  const proven = r.method === "proven";
  const big = r.headline;
  const showRange = proven && !r.proof.exact && r.headline_low != null && r.headline_high != null;
  // What itaOS cost for the same number of days (monthly price spread over 30 days).
  const cost = r.price_month != null && r.price_month > 0 ? (r.price_month * r.days) / 30 : null;
  const times = cost && big > 0 ? big / cost : null;
  const ratio = r.proof.hidden_rate && r.proof.shown_rate ? r.proof.shown_rate / r.proof.hidden_rate : null;
  const p = r.proof;

  return (
    <section className="card rec">
      <div className="row between">
        <div>
          <h2>{T("Money itaOS brought back", "Pesa itaOS imerudisha")}</h2>
          <span className="small muted">{proven
            ? T("Extra sales that would not have happened without itaOS, in this period.", "Mauzo ya ziada yasingetokea bila itaOS, kipindi hiki.")
            : T("Customers itaOS flagged, you messaged, they replied and paid, in this period.", "Wateja itaOS iliwaonyesha, ukawatumia ujumbe, wakajibu na kulipa, kipindi hiki.")}</span>
        </div>
        {times != null && <span className="rec-x" title={T(`itaOS cost about ${M(cost!)} for these ${r.days} days`, `itaOS iligharimu takriban ${M(cost!)} kwa siku hizi ${r.days}`)}>{times >= 10 ? Math.round(times) : times.toFixed(1)}× {T("its cost", "gharama yake")}</span>}
      </div>

      {big > 0 || r.orders > 0 ? (
        <div className="rec-big">
          <b>{showRange ? `${M(r.headline_low!)} – ${M(r.headline_high!)}` : M(big)}</b>
          <span className="small muted">
            {proven
              ? <span className="chip ok">{T("Proven", "Imethibitishwa")}</span>
              : <>{fmt(r.tiers.very_likely.orders)} {r.tiers.very_likely.orders === 1 ? T("sale", "mauzo") : T("sales", "mauzo")}</>}
          </span>
        </div>
      ) : (
        <p className="rec-empty">
          {T("Nothing yet in this period.", "Bado hakuna kipindi hiki.")}{" "}
          {r.waiting > 0
            ? T(`${fmt(r.waiting)} customers you messaged after an itaOS flag can still pay. If they do, it shows here.`, `Wateja ${fmt(r.waiting)} uliowatumia ujumbe baada ya itaOS kuwaonyesha bado wanaweza kulipa. Wakilipa, itaonekana hapa.`)
            : T("Message the customers in Actions, and the sales that follow show here.", "Watumie ujumbe wateja walio kwenye Actions, mauzo yatakayofuata yataonekana hapa.")}
          {" "}<a href="#actions">{T("Open Actions →", "Fungua Actions →")}</a>
        </p>
      )}

      {/* The proof: shown vs kept aside */}
      {p.shown_n > 0 && p.hidden_n > 0 && (
        <div className="rec-rows">
          <div className="rec-row"><span>{T("Customers itaOS showed you", "Wateja itaOS ilikuonyesha")}</span><span className="muted small">{fmt(p.shown_paid)}/{fmt(p.shown_n)}</span><b>{pct(p.shown_rate)} {T("paid", "walilipa")}</b></div>
          <div className="rec-row"><span>{T("Customers it kept aside", "Wateja iliowaweka pembeni")}</span><span className="muted small">{fmt(p.hidden_paid)}/{fmt(p.hidden_n)}</span><b>{pct(p.hidden_rate)} {T("paid", "walilipa")}</b></div>
          {proven && ratio != null && ratio > 1 && <p className="small" style={{ margin: 0 }}>{T(`Customers itaOS reminded you about paid ${ratio.toFixed(1)}× as often.`, `Wateja itaOS ilikukumbusha walilipa mara ${ratio.toFixed(1)} zaidi.`)}{p.extra_customers ? T(` About ${fmt(p.extra_customers)} extra customers paid because of it.`, ` Takriban wateja ${fmt(p.extra_customers)} wa ziada walilipa kwa sababu yake.`) : ""}</p>}
        </div>
      )}
      {!proven && (
        <p className="small muted" style={{ margin: 0 }}>{T(`Proof in progress: ${fmt(p.hidden_n)} of ${p.need_hidden} customers kept aside so far, ${fmt(p.shown_n)} of ${p.need_shown} shown. Then this number becomes proven.`, `Uthibitisho unaendelea: wateja ${fmt(p.hidden_n)} kati ya ${p.need_hidden} wamewekwa pembeni, ${fmt(p.shown_n)} kati ya ${p.need_shown} wameonyeshwa. Baada ya hapo namba hii itathibitishwa.`)}</p>
      )}

      {/* The business's own past */}
      {r.past.ready && r.past.rate != null && (
        <p className="small" style={{ margin: 0 }}>{T(`Before itaOS, ${pct(r.past.rate)} of customers who went quiet after the price came back and paid. With itaOS: ${pct(r.past.now_rate)}.`, `Kabla ya itaOS, ${pct(r.past.rate)} ya wateja walionyamaza baada ya bei walirudi kulipa. Na itaOS: ${pct(r.past.now_rate)}.`)}{r.past.extra ? T(` That's about ${M(r.past.extra)} more this period.`, ` Hiyo ni takriban ${M(r.past.extra)} zaidi kipindi hiki.`) : ""}</p>
      )}

      {/* The levels */}
      <div className="rec-rows">
        {(["very_likely", "likely", "on_own", "ad"] as Tier[]).filter((t) => r.tiers[t].orders > 0).map((t) => (
          <div className="rec-row" key={t}>
            <span>{tierLabel[t]}{(t === "on_own" || t === "ad") && <span className="small muted"> · {T("not counted", "haihesabiwi")}</span>}</span>
            <span className="muted small">{fmt(r.tiers[t].orders)}</span>
            <b className={t === "on_own" || t === "ad" ? "muted" : ""}>{M(r.tiers[t].amount)}</b>
          </div>
        ))}
      </div>

      {r.items.length > 0 && <button type="button" className="linkish small" onClick={() => setOpen((x) => !x)} aria-expanded={open}>{open ? T("Hide the sales", "Ficha mauzo") : T("See every sale", "Ona kila mauzo")}</button>}
      {open && (
        <div className="rec-rows">
          {r.items.map((i) => (
            <a className="rec-row" key={i.order_id} href={"#chats/open=" + i.conversation_id}>
              <span>{i.name} <span className="chip">{tierLabel[i.tier]}</span>
                <span className="small muted" style={{ display: "block" }}>
                  {kindLabel[i.kind]} {when(i.flagged_at, tz)}
                  {i.acted_at && <> → {T("you messaged", "ulimtumia")} {when(i.acted_at, tz)}</>}
                  {i.replied_at && <> → {T("replied", "alijibu")} {when(i.replied_at, tz)}</>}
                  {" "}→ {T("paid", "alilipa")} {when(i.paid_at, tz)}
                </span>
              </span>
              <span />
              <b>{M(i.amount)}</b>
            </a>
          ))}
        </div>
      )}

      {/* Money left on the table */}
      {r.left.ignored > 0 && (
        <p className="small" style={{ margin: 0 }}>
          {r.left.amount && r.left.amount > 0
            ? T(`${fmt(r.left.ignored)} customers itaOS flagged got no message from you. Going by your own numbers, about ${M(r.left.amount)} was left on the table.`, `Wateja ${fmt(r.left.ignored)} itaOS iliwaonyesha hawakupata ujumbe wako. Kwa namba zako mwenyewe, takriban ${M(r.left.amount)} iliachwa mezani.`)
            : T(`${fmt(r.left.ignored)} customers itaOS flagged got no message from you.`, `Wateja ${fmt(r.left.ignored)} itaOS iliwaonyesha hawakupata ujumbe wako.`)}
          {" "}<a href="#actions">{T("Open Actions →", "Fungua Actions →")}</a>
        </p>
      )}
      {r.waiting > 0 && big > 0 && <p className="small muted" style={{ margin: 0 }}>{T(`${fmt(r.waiting)} more customers you messaged can still pay.`, `Wateja ${fmt(r.waiting)} zaidi uliowatumia ujumbe bado wanaweza kulipa.`)}</p>}
      {r.found_orders > 0 && (
        <p className="small muted rec-found">{T(`Also: itaOS spotted and recorded ${fmt(r.found_orders)} sales from the chats for you (${M(r.found_amount)}). Those aren't counted above.`, `Pia: itaOS iliona na kurekodi mauzo ${fmt(r.found_orders)} kutoka kwenye chats (${M(r.found_amount)}). Hayo hayajahesabiwa juu.`)}</p>
      )}

      <button type="button" className="linkish small" onClick={() => setHow((x) => !x)} aria-expanded={how}>{how ? T("Hide how this is counted", "Ficha jinsi inavyohesabiwa") : T("How is this counted?", "Inahesabiwaje?")}</button>
      {how && (
        <div className="small muted" style={{ display: "grid", gap: 6 }}>
          <span>{T("1. itaOS notes every customer who is slipping away: went quiet after the price, made a payment promise, or is due to buy again.", "1. itaOS inamwona kila mteja anayepotea: amenyamaza baada ya bei, ameahidi kulipa, au ni wakati wa kununua tena.")}</span>
          <span>{T(`2. To prove itself, it keeps about ${p.pct}% of them aside and doesn't remind you about them (their chats stay in Chats, and anyone waiting for your reply is always shown). Never the same customer twice.`, `2. Ili kujithibitisha, inaweka pembeni takriban ${p.pct}% yao na haikukumbushi kuhusu wao (chats zao zinabaki kwenye Chats, na anayesubiri jibu lako anaonyeshwa daima). Kamwe si mteja yule yule mara mbili.`)}</span>
          <span>{T("3. It compares how often the two groups pay. Only the difference is money itaOS brought back.", "3. Inalinganisha mara ngapi makundi mawili yanalipa. Tofauti pekee ndiyo pesa itaOS imerudisha.")}</span>
          <span>{T("4. It reads your real WhatsApp messages and recorded payments, not buttons. Sales from a new ad, or that came before you messaged, are not counted.", "4. Inasoma ujumbe wako halisi wa WhatsApp na malipo yaliyorekodiwa, si vitufe. Mauzo kutoka tangazo jipya, au yaliyokuja kabla hujatuma ujumbe, hayahesabiwi.")}</span>
        </div>
      )}
    </section>
  );
}
