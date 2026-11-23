// "Money itaOS brought back", method v2 (migration 0070). Honest by construction:
//  - The causal number comes ONLY from the trial: each slipping-away customer is assigned once, "shown" to the owner
//    or "kept aside", and the two groups are compared as assigned (owner acted or not). Until enough windows have
//    closed the card says so and shows the observational "sales after your follow-ups" instead, labelled as not proof.
//  - "Clear" only when the whole 95% range of the difference is above zero. Otherwise it is an estimate that may be zero.
//  - Journeys (messaged → replied → paid), the business's past and customers nobody messaged are context, never added in.
import { useEffect, useState } from "react";
import { supabase, Workspace, money, fmt } from "./lib";
import { useKept } from "./keep";
import type { Period } from "./metrics";

type Kind = "promise" | "after_price" | "reorder";
type Tier = "very_likely" | "likely" | "on_own" | "ad";
type Item = { order_id: string; conversation_id: string; amount: number; tier: Tier; kind: Kind; flagged_at: string; acted_at: string | null; replied_at: string | null; paid_at: string; name: string };
type Amt = { amount: number; orders: number };
type Arm = { n: number; bought: number; rate: number | null; rate_lo: number | null; rate_hi: number | null; revenue: number; per_customer: number | null };
type Res = {
  version: string; methodology?: string; experiment_start: string | null; currency: string; days: number; price_month: number | null;
  status: "learning" | "estimate" | "clear" | "off";
  trial: {
    pct: number; need_hold: number; need_show: number; pending_show: number; pending_hold: number;
    show: Arm & { messaged: number }; hold: Arm & { contaminated: number };
    diff_rate: number | null; diff_lo: number | null; diff_hi: number | null; shown_in_period: number;
    extra: number | null; extra_lo: number | null; extra_hi: number | null; extra_customers: number | null;
    extra_strict?: number | null; extra_strict_lo?: number | null; extra_strict_hi?: number | null;
  };
  recorded: Amt & { tick_orders?: number; tick_amount?: number }; tiers: Record<Tier, Amt>; items: Item[]; waiting: number; no_message: number;
  past: { n: number; paid: number; rate: number | null };
  capture: { entered: number; detected: number };
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
  // Kept while the app is open: coming back to the Dashboard shows the last figures at once, refreshed quietly.
  const [r, setR] = useKept<Res | null>(`recovered:${ws.id}:${period.from}:${period.to}`, null);
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

  const title0 = T("Money itaOS brought back", "Pesa itaOS imerudisha");
  if (err) return <section className="card rec"><h2>{title0}</h2><p className="err small">{err}</p></section>;
  if (!r) return <section className="card rec" aria-busy="true"><div className="skeleton" style={{ minHeight: 90 }} /></section>;
  if (!r.trial) return <section className="card rec"><h2>{title0}</h2><p className="small muted">{T("Updating… try again in a few minutes.", "Inasasishwa… jaribu tena baada ya dakika chache.")}</p></section>;

  // The dashboard may show USD while sales are in TZS: convert every amount the same way.
  const M = (n: number) => money(conv(n) ?? n, cur);
  const kindLabel: Record<Kind, string> = { promise: T("Promise", "Ahadi"), after_price: T("After the price", "Baada ya bei"), reorder: T("Reorder", "Nunua tena") };
  const tierLabel: Record<Tier, string> = {
    very_likely: T("You messaged, they replied, paid", "Ulituma, alijibu, alilipa"),
    likely: T("You messaged, they paid", "Ulituma, alilipa"),
    on_own: T("Paid without a message", "Alilipa bila ujumbe"),
    ad: T("Came back through a new ad", "Alirudi kupitia tangazo jipya"),
  };
  const t = r.trial;
  const trialOn = r.status === "estimate" || r.status === "clear";
  const clear = r.status === "clear";
  const extra = t.extra ?? 0;
  const compared = t.show.n + t.hold.n;
  // What itaOS cost for the same days — compared only with a clear trial result.
  const cost = r.price_month != null && r.price_month > 0 ? (r.price_month * r.days) / 30 : null;
  const times = clear && cost && extra > 0 ? extra / cost : null;

  const title = trialOn
    ? (clear ? T("Extra sales from itaOS", "Mauzo ya ziada kutoka itaOS") : T("Extra sales from itaOS (estimate)", "Makadirio ya mauzo ya ziada kutoka itaOS"))
    : T("Sales after your follow-ups", "Mauzo baada ya ufuatiliaji wako");

  return (
    <section className="card rec">
      <div className="row between">
        <div>
          <h2>{title}</h2>
          <span className="small muted">{trialOn
            ? T("Compared with similar customers itaOS kept aside, in this period.", "Ikilinganishwa na wateja kama hao itaOS iliowaweka pembeni, kipindi hiki.")
            : T("Paid within the window after you messaged a customer itaOS flagged.", "Walilipa ndani ya muda baada ya kumtumia ujumbe mteja itaOS iliyekuonyesha.")}</span>
        </div>
        {times != null && <span className="rec-x" title={T(`itaOS cost about ${M(cost!)} for these ${r.days} days`, `itaOS iligharimu takriban ${M(cost!)} kwa siku hizi ${r.days}`)}>{times >= 10 ? Math.round(times) : times.toFixed(1)}× {T("its cost", "gharama yake")}</span>}
      </div>

      {/* The big number */}
      {trialOn ? (
        <div className="rec-big">
          <b>{extra > 0 ? M(extra) : T("No clear difference yet", "Bado hakuna tofauti wazi")}</b>
          <span className="small muted">{clear
            ? <span className="chip ok">{T("Clearly above zero", "Wazi juu ya sifuri")}</span>
            : <span className="chip">{T("Could still be zero", "Bado inaweza kuwa sifuri")}</span>}</span>
        </div>
      ) : r.recorded.orders > 0 ? (
        <div className="rec-big"><b>{M(r.recorded.amount)}</b><span className="small muted">{fmt(r.recorded.orders)} {r.recorded.orders === 1 ? T("sale", "mauzo") : T("sales", "mauzo")}</span></div>
      ) : (
        <p className="rec-empty">
          {T("Nothing yet in this period.", "Bado hakuna kipindi hiki.")}{" "}
          {r.waiting > 0
            ? T(`${fmt(r.waiting)} customers you messaged can still pay.`, `Wateja ${fmt(r.waiting)} uliowatumia ujumbe bado wanaweza kulipa.`)
            : T("Message the customers in Actions, and the sales that follow show here.", "Watumie ujumbe wateja walio kwenye Actions, mauzo yatakayofuata yataonekana hapa.")}
          {" "}<a href="#actions">{T("Open Actions →", "Fungua Actions →")}</a>
        </p>
      )}
      {trialOn && t.extra_lo != null && t.extra_hi != null && extra > 0 && (
        <p className="small muted" style={{ margin: 0 }}>{T(`Likely range: ${M(Math.max(0, t.extra_lo))} – ${M(t.extra_hi)}. ${fmt(compared)} customers compared so far.`, `Kiwango kinachowezekana: ${M(Math.max(0, t.extra_lo))} – ${M(t.extra_hi)}. Wateja ${fmt(compared)} wamelinganishwa hadi sasa.`)}</p>
      )}
      {/* Sales itaOS recorded on its own from the owner's ✅ / "money received" messages, shown apart (no person pressed a button). */}
      {trialOn && t.extra_strict != null && (
        <p className="small" style={{ margin: 0 }}>{T(`Without the sales itaOS spotted from your messages: ${t.extra_strict > 0 ? M(t.extra_strict) : "no extra yet"}${t.extra_strict_lo != null && t.extra_strict_hi != null && t.extra_strict > 0 ? ` (range ${M(Math.max(0, t.extra_strict_lo))} – ${M(t.extra_strict_hi)})` : ""}.`,
          `Bila mauzo itaOS iliyoyaona kwenye jumbe zako: ${t.extra_strict > 0 ? M(t.extra_strict) : "bado hakuna ziada"}${t.extra_strict_lo != null && t.extra_strict_hi != null && t.extra_strict > 0 ? ` (kati ya ${M(Math.max(0, t.extra_strict_lo))} – ${M(t.extra_strict_hi)})` : ""}.`)}</p>
      )}
      {!trialOn && r.recorded.orders > 0 && (r.recorded.tick_orders ?? 0) > 0 && (
        <p className="small" style={{ margin: 0 }}>{T(`${fmt(r.recorded.tick_orders!)} of these ${fmt(r.recorded.orders)} were recorded by itaOS from your ✅ or "money received" messages. Without them: ${M(r.recorded.amount - (r.recorded.tick_amount ?? 0))}.`,
          `${fmt(r.recorded.tick_orders!)} kati ya haya ${fmt(r.recorded.orders)} yalirekodiwa na itaOS kutoka jumbe zako za ✅ au "tumepokea malipo". Bila hayo: ${M(r.recorded.amount - (r.recorded.tick_amount ?? 0))}.`)}</p>
      )}
      {!trialOn && (
        <p className="small muted" style={{ margin: 0 }}>{r.status === "off"
          ? T("Not proof that itaOS caused these sales: the comparison is switched off for this business.", "Si uthibitisho kwamba itaOS ilisababisha mauzo haya: ulinganisho umezimwa kwa biashara hii.")
          : T(`Not yet proof that itaOS caused these sales. Comparing with customers kept aside: ${fmt(Math.min(t.hold.n, t.need_hold))} of ${t.need_hold} kept aside and ${fmt(Math.min(t.show.n, t.need_show))} of ${t.need_show} shown have finished their window.`,
              `Bado si uthibitisho kwamba itaOS ilisababisha mauzo haya. Tunalinganisha na wateja waliowekwa pembeni: ${fmt(Math.min(t.hold.n, t.need_hold))} kati ya ${t.need_hold} waliowekwa pembeni na ${fmt(Math.min(t.show.n, t.need_show))} kati ya ${t.need_show} walioonyeshwa wamemaliza muda wao.`)}</p>
      )}

      {!trialOn && (t.show.n > 0 || t.pending_show > 0) && (
        <p className="small muted" style={{ margin: 0 }}>{t.show.n > 0
          ? T(`You messaged ${fmt(t.show.messaged)} of the ${fmt(t.show.n)} shown customers whose window has ended.`, `Ulituma ujumbe kwa ${fmt(t.show.messaged)} kati ya wateja ${fmt(t.show.n)} walioonyeshwa ambao muda wao umeisha.`)
          : T(`${fmt(t.pending_show)} shown customers are still inside their window.`, `Wateja ${fmt(t.pending_show)} walioonyeshwa bado wako ndani ya muda wao.`)}</p>
      )}

      {/* The comparison itself */}
      {t.show.n > 0 && t.hold.n > 0 && (
        <div className="rec-rows">
          <div className="rec-row"><span>{T("Customers itaOS showed you", "Wateja itaOS ilikuonyesha")}</span><span className="muted small">{fmt(t.show.bought)}/{fmt(t.show.n)}</span><b>{pct(t.show.rate)} {T("bought", "walinunua")}</b></div>
          <div className="rec-row"><span>{T("Customers it kept aside", "Wateja iliowaweka pembeni")}</span><span className="muted small">{fmt(t.hold.bought)}/{fmt(t.hold.n)}</span><b>{pct(t.hold.rate)} {T("bought", "walinunua")}</b></div>
          {clear && t.extra_customers != null && t.extra_customers > 0 && <p className="small" style={{ margin: 0 }}>{T(`About ${fmt(t.extra_customers)} extra customers bought this period.`, `Takriban wateja ${fmt(t.extra_customers)} wa ziada walinunua kipindi hiki.`)}</p>}
          <p className="small muted" style={{ margin: 0 }}>{T(`You messaged ${fmt(t.show.messaged)} of the ${fmt(t.show.n)} shown customers.`, `Ulituma ujumbe kwa ${fmt(t.show.messaged)} kati ya ${fmt(t.show.n)} walioonyeshwa.`)}{t.hold.contaminated > 0 ? T(` ${fmt(t.hold.contaminated)} kept-aside customers got a message anyway (they stay in their group, which makes the difference smaller, not bigger).`, ` Wateja ${fmt(t.hold.contaminated)} waliowekwa pembeni walipata ujumbe hata hivyo (wanabaki kwenye kundi lao, jambo linalopunguza tofauti, si kuiongeza).`) : ""}</p>
        </div>
      )}

      {/* Journeys: what happened after a flag (context) */}
      {(["very_likely", "likely", "on_own", "ad"] as Tier[]).some((k) => r.tiers[k].orders > 0) && (
        <div className="rec-rows">
          {trialOn && <span className="small muted">{T("What happened after the flags (not proof on its own):", "Kilichotokea baada ya kuonyeshwa (si uthibitisho peke yake):")}</span>}
          {(["very_likely", "likely", "on_own", "ad"] as Tier[]).filter((k) => r.tiers[k].orders > 0).map((k) => (
            <div className="rec-row" key={k}>
              <span>{tierLabel[k]}{(k === "on_own" || k === "ad") && <span className="small muted"> · {T("not counted", "haihesabiwi")}</span>}</span>
              <span className="muted small">{fmt(r.tiers[k].orders)}</span>
              <b className={k === "on_own" || k === "ad" ? "muted" : ""}>{M(r.tiers[k].amount)}</b>
            </div>
          ))}
        </div>
      )}
      {r.items.length > 0 && <button type="button" className="linkish small" onClick={() => setOpen((x) => !x)} aria-expanded={open}>{open ? T("Hide the sales", "Ficha mauzo") : T("See every sale", "Ona kila mauzo")}</button>}
      {open && (
        <div className="rec-rows">
          {r.items.map((i) => (
            <a className="rec-row" key={i.order_id} href={"#chats/open=" + i.conversation_id}>
              <span>{i.name}
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

      {r.no_message > 0 && (
        <p className="small" style={{ margin: 0 }}>{T(`${fmt(r.no_message)} customers itaOS flagged got no message from you before their window closed.`, `Wateja ${fmt(r.no_message)} itaOS iliwaonyesha hawakupata ujumbe wako kabla muda wao kuisha.`)} <a href="#actions">{T("Open Actions →", "Fungua Actions →")}</a></p>
      )}
      {r.past.rate != null && (
        <p className="small muted" style={{ margin: 0 }}>{T(`For context: before itaOS, ${pct(r.past.rate)} of customers who went quiet after the price came back and paid (${fmt(r.past.paid)} of ${fmt(r.past.n)}).`, `Kwa kulinganisha: kabla ya itaOS, ${pct(r.past.rate)} ya wateja walionyamaza baada ya bei walirudi kulipa (${fmt(r.past.paid)} kati ya ${fmt(r.past.n)}).`)}</p>
      )}
      {r.capture.entered + r.capture.detected > 0 && (
        <p className="small muted" style={{ margin: 0 }}>{T(`Only payments recorded in itaOS count: ${fmt(r.capture.entered)} entered by you, ${fmt(r.capture.detected)} spotted by itaOS this period.`, `Malipo yaliyorekodiwa kwenye itaOS pekee ndiyo yanahesabiwa: ${fmt(r.capture.entered)} uliyoingiza, ${fmt(r.capture.detected)} itaOS iliyoyaona kipindi hiki.`)}</p>
      )}

      <button type="button" className="linkish small" onClick={() => setHow((x) => !x)} aria-expanded={how}>{how ? T("Hide how this is counted", "Ficha jinsi inavyohesabiwa") : T("How is this counted?", "Inahesabiwaje?")}</button>
      {how && (
        <div className="small muted" style={{ display: "grid", gap: 6 }}>
          <span>{T("1. itaOS notes every customer who is slipping away: went quiet after the price, promised to pay, or is due to buy again.", "1. itaOS inamwona kila mteja anayepotea: amenyamaza baada ya bei, ameahidi kulipa, au ni wakati wa kununua tena.")}</span>
          <span>{T(`2. Each customer is put in one group, once: shown to you, or kept aside (about ${t.pct}%, evenly spread across hot, warm and cold customers). Kept-aside customers don't appear in Actions for their window; their chats stay in Chats, and anyone waiting for your reply is always shown.`, `2. Kila mteja anawekwa kwenye kundi moja, mara moja: anaonyeshwa kwako, au anawekwa pembeni (takriban ${t.pct}%, kwa usawa kati ya wateja wa moto, wenye nia na baridi). Waliowekwa pembeni hawaonekani kwenye Actions kwa muda wao; chats zao zinabaki kwenye Chats, na anayesubiri jibu lako anaonyeshwa daima.`)}</span>
          <span>{T("3. When their window closes, it compares how much each group bought, counting everyone in their group whether you messaged them or not. Only the difference is credited to itaOS.", "3. Muda wao ukiisha, inalinganisha kiasi kila kundi lilinunua, ikimhesabu kila mtu kwenye kundi lake ukimtumia ujumbe au la. Tofauti pekee ndiyo inahesabiwa kwa itaOS.")}</span>
          <span>{T("4. It says \"clearly above zero\" only when the whole likely range is above zero. Payments not recorded in itaOS are not counted.", "4. Inasema \"wazi juu ya sifuri\" pale tu kiwango chote kinachowezekana kiko juu ya sifuri. Malipo yasiyorekodiwa kwenye itaOS hayahesabiwi.")}</span>
          <span>{T("5. Sales itaOS records on its own from your ✅ or \"money received\" messages count as sales, but the card also shows the figure without them, so you can see how much rests on them.", "5. Mauzo itaOS inayorekodi yenyewe kutoka jumbe zako za ✅ au \"tumepokea malipo\" yanahesabiwa, lakini kadi inaonyesha pia kiasi bila hayo, ili uone kiasi gani kinategemea hayo.")}</span>
          <span>{T(`Method ${r.methodology ?? r.version}`, `Mbinu ${r.methodology ?? r.version}`)}{r.experiment_start ? T(`, comparison running since ${when(r.experiment_start, tz)}.`, `, ulinganisho tangu ${when(r.experiment_start, tz)}.`) : "."}</span>
        </div>
      )}
      {r.found_orders > 0 && (
        <p className="small muted rec-found">{T(`Also: itaOS spotted and recorded ${fmt(r.found_orders)} sales from the chats for you (${M(r.found_amount)}). Those aren't counted above.`, `Pia: itaOS iliona na kurekodi mauzo ${fmt(r.found_orders)} kutoka kwenye chats (${M(r.found_amount)}). Hayo hayajahesabiwa juu.`)}</p>
      )}
    </section>
  );
}
