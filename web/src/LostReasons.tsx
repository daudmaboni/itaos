// "Why people didn't buy" (Dashboard → #why). Data: lost_reasons_range() (migration 0087), from what Kito
// already read plus what the chat shows (never answered, a late reply, quiet before/after the price). No extra AI reads.
// Since 25 Nov 2026 the card has no date switch of its own: it follows the page's date picker, comparison
// period and Filters, so every number on the page covers the same chats.
import { errText } from "./errText";
import { useEffect, useState } from "react";
import { supabase, Workspace, money, fmt } from "./lib";
import { useKept } from "./keep";
import { rangeText } from "./ranges";
import type { Period } from "./metrics";
import type { Filters } from "./data";
import { reasonLabel, reasonAdvice, worth, trendOk, type LostRes, type Reason } from "./guards";

/** Fewer lost chats than this and the reasons are a handful of people, not a pattern. */
const FEW = 10;

export default function LostReasons({ ws, period, prevFrom, filters }: { ws: Workspace; period: Period | null; prevFrom?: string | null; filters?: Filters }) {
  const T = (en: string, sw: string) => (ws.language === "sw" ? sw : en);
  const lang = ws.language === "sw" ? "sw" : "en";
  const f = filters ?? {};
  const key = period ? `lost:${ws.id}:${period.from}:${period.to}:${f.source ?? ""}:${f.campaign ?? ""}:${f.ad ?? ""}` : `lost:${ws.id}:none`;
  const [r, setR] = useKept<LostRes | null>(key, null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<Reason | null>(null);

  useEffect(() => {
    if (!period) return;
    let live = true;
    setErr("");
    supabase.rpc("lost_reasons_range", {
      p_ws: ws.id, p_from: period.from, p_to: period.to, p_prev_from: prevFrom ?? null,
      p_source: f.source ?? null, p_campaign: f.campaign ?? null, p_ad: f.ad ?? null,
    }).then(async ({ data, error }) => {
      if (!live) return;
      if (!error) { setR(data as LostRes); return; }
      if (!/does not exist|schema cache|could not find/i.test(error.message)) { setErr(errText(error)); return; }
      // Database not updated yet: the old last-N-days version, as close to the page's period as it allows.
      const old = await supabase.rpc("lost_reasons", { p_ws: ws.id, p_days: period.days });
      if (!live) return;
      if (old.error) setErr(errText(old.error)); else setR(old.data as LostRes);
    });
    return () => { live = false; };
  }, [key, prevFrom]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = T("Why people didn't buy", "Kwa nini watu hawakununua");
  if (err) return <section className="card guard lost"><h2>{title}</h2><p className="err small">{err}</p></section>;
  if (!r || !period) return <section className="card guard lost" aria-busy="true"><div className="skeleton" style={{ minHeight: 140 }} /></section>;

  const when = rangeText(period, lang);
  const few = r.lost > 0 && r.lost < FEW;
  const max = Math.max(1, ...r.reasons.map((x) => x.n));
  const showTrend = trendOk(r);
  const top = r.reasons[0];

  return (
    <section className="card guard lost">
      <div className="g-head">
        <div>
          <h2>{title}</h2>
          <span className="small muted">{T(`Chats started ${when} that went quiet or said no, without paying. A chat counts once it's been quiet 3 days or Kito marked it lost. From what Kito read and what each chat shows.`,
            `Chats zilizoanza ${when} zilizonyamaza au kukataa, bila kulipa. Chat inahesabiwa ikikaa kimya siku 3 au Kito akiiweka kama imepotea. Kutoka alichosoma Kito na kinachoonekana kwenye kila chat.`)}</span>
          <div className="g-sum">
            <span className="g-pill">{T(`${fmt(r.lost)} didn't buy`, `${fmt(r.lost)} hawakununua`)}</span>
            <span className="g-pill ok">{T(`${fmt(r.sold)} bought`, `${fmt(r.sold)} walinunua`)}</span>
            {r.close_rate != null && <span className="g-pill">{T(`${Math.round(r.close_rate * 1000) / 10}% of those given the price paid`, `${Math.round(r.close_rate * 1000) / 10}% ya waliopewa bei walilipa`)}</span>}
          </div>
        </div>
      </div>
      {few && <p className="small muted" style={{ margin: "10px 0 0" }}>{T(`Only ${fmt(r.lost)} chats in this period, so treat these reasons as a hint. Pick a longer range at the top for a clearer pattern.`,
        `Chats ${fmt(r.lost)} tu kipindi hiki, kwa hiyo chukua sababu hizi kama dalili. Chagua kipindi kirefu zaidi juu kuona mwelekeo wazi.`)}</p>}

      {r.reasons.length === 0
        ? <p className="empty">{period.days <= 3
            ? T("Nobody counts as lost yet: chats from the last few days are still open. Pick a longer range at the top.", "Bado hakuna aliyehesabiwa kupotea: chats za siku chache zilizopita bado ziko wazi. Chagua kipindi kirefu zaidi juu.")
            : T("Nobody went quiet in this period, or Kito hasn't read these chats yet.", "Hakuna aliyenyamaza kipindi hiki, au Kito bado hajasoma chats hizi.")}</p>
        : <>
          {top && <p style={{ margin: "12px 0 0", lineHeight: 1.5 }}><b>{T("Biggest leak: ", "Uvujaji mkubwa: ")}{reasonLabel(top.reason, T).toLowerCase()}</b>{T(` (${fmt(top.n)} customers). `, ` (wateja ${fmt(top.n)}). `)}{reasonAdvice(top.reason, T)}</p>}
          <div className="lr-rows">
            {r.reasons.map((x) => {
              const w = worth(x.n, r.avg_sale);
              const isOpen = open === x.reason;
              return (
                <div className="lr-row" key={x.reason}>
                  <div className="lr-line" role="button" tabIndex={0} aria-expanded={isOpen} style={{ cursor: "pointer" }}
                    onClick={() => setOpen(isOpen ? null : x.reason)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(isOpen ? null : x.reason); } }}>
                    <span className="lr-name">{reasonLabel(x.reason, T)}</span>
                    <span className="lr-bar" aria-hidden><i style={{ width: `${(x.n / max) * 100}%` }} /></span>
                    <span className="lr-n">{fmt(x.n)}{showTrend && <small> · {T(`was ${fmt(x.prev)}`, `ilikuwa ${fmt(x.prev)}`)}</small>}</span>
                  </div>
                  {isOpen && (
                    <div className="lr-open">
                      <p>{reasonAdvice(x.reason, T)}</p>
                      <span className="small muted">{[
                        T(`${fmt(x.from_ads)} came from ads`, `${fmt(x.from_ads)} walitoka matangazo`),
                        x.after_price ? T(`${fmt(x.after_price)} had the price`, `${fmt(x.after_price)} walipewa bei`) : null,
                        w ? T(`winning back 1 in 10 is worth about ${money(w, ws.currency)}`, `kurudisha 1 kati ya 10 ni takriban ${money(w, ws.currency)}`) : null,
                      ].filter(Boolean).join(" · ")}</span>
                      {(x.examples ?? []).length > 0 && (
                        <ul className="lr-ex small">
                          {x.examples!.map((e) => <li key={e.id}><a href={"#chats/ids=" + e.id}><b>{e.name ?? T("Customer", "Mteja")}</b></a>{e.summary ? ` · ${e.summary}` : ""}</li>)}
                        </ul>
                      )}
                      {(x.ids ?? []).length > 0 && <a className="small" href={"#chats/ids=" + x.ids!.join(",")}>{T(`Open these ${x.ids!.length} chats`, `Fungua chats hizi ${x.ids!.length}`)} →</a>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {r.by_ad.length > 0 && (
            <p className="small muted lr-ads">{T("By ad: ", "Kwa tangazo: ")}{r.by_ad.map((a) => T(`“${a.name ?? a.ad_id}” lost ${fmt(a.lost)}, mostly ${reasonLabel(a.top, T).toLowerCase()} (${fmt(a.top_n)})`,
              `“${a.name ?? a.ad_id}” limepoteza ${fmt(a.lost)}, zaidi ${reasonLabel(a.top, T).toLowerCase()} (${fmt(a.top_n)})`)).join(" · ")}</p>
          )}
        </>}
    </section>
  );
}
