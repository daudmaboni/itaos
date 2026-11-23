// "Why people didn't buy" (Dashboard). Data: lost_reasons() (migration 0079), from what Kito already read
// plus what the chat shows (never answered, a late reply, quiet before/after the price). No extra AI reads.
import { useEffect, useState } from "react";
import { supabase, Workspace, money, fmt } from "./lib";
import { useKept } from "./keep";
import { reasonLabel, reasonAdvice, worth, trendOk, type LostRes, type Reason } from "./guards";

const DAYS = [14, 30, 90] as const;
type Days = (typeof DAYS)[number];
const KEY = "itaos:lost-days";

export default function LostReasons({ ws }: { ws: Workspace }) {
  const T = (en: string, sw: string) => (ws.language === "sw" ? sw : en);
  const [days, setDays] = useState<Days>(() => { try { const v = Number(localStorage.getItem(KEY)); return (DAYS as readonly number[]).includes(v) ? (v as Days) : 30; } catch { return 30; } });
  const [r, setR] = useKept<LostRes | null>(`lost:${ws.id}:${days}`, null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<Reason | null>(null);
  const pick = (d: Days) => { setDays(d); try { localStorage.setItem(KEY, String(d)); } catch { /* ignore */ } };

  useEffect(() => {
    let live = true;
    setErr("");
    supabase.rpc("lost_reasons", { p_ws: ws.id, p_days: days }).then(({ data, error }) => {
      if (!live) return;
      if (error) setErr(/does not exist|schema cache|could not find/i.test(error.message) ? T("This needs the latest itaOS update. Try again in a few minutes.", "Hii inahitaji sasisho jipya. Jaribu tena baada ya dakika chache.") : error.message);
      else setR(data as LostRes);
    });
    return () => { live = false; };
  }, [ws.id, days]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = T("Why people didn't buy", "Kwa nini watu hawakununua");
  const seg = (
    <div className="seg" role="radiogroup" aria-label={T("Days", "Siku")}>
      {DAYS.map((d) => <button key={d} role="radio" aria-checked={days === d} className={days === d ? "on" : ""} onClick={() => pick(d)}>{T(`${d} days`, `Siku ${d}`)}</button>)}
    </div>
  );
  if (err) return <section className="card guard lost"><h2>{title}</h2><p className="err small">{err}</p></section>;
  if (!r) return <section className="card guard lost" aria-busy="true"><div className="skeleton" style={{ minHeight: 140 }} /></section>;

  const max = Math.max(1, ...r.reasons.map((x) => x.n));
  const showTrend = trendOk(r);
  const top = r.reasons[0];

  return (
    <section className="card guard lost">
      <div className="g-head">
        <div>
          <h2>{title}</h2>
          <span className="small muted">{T(`Chats from the last ${days} days that went quiet or said no, without paying. From what Kito read and what each chat shows.`,
            `Chats za siku ${days} zilizopita zilizonyamaza au kukataa, bila kulipa. Kutoka alichosoma Kito na kinachoonekana kwenye kila chat.`)}</span>
          <div className="g-sum">
            <span className="g-pill">{T(`${fmt(r.lost)} didn't buy`, `${fmt(r.lost)} hawakununua`)}</span>
            <span className="g-pill ok">{T(`${fmt(r.sold)} bought`, `${fmt(r.sold)} walinunua`)}</span>
            {r.close_rate != null && <span className="g-pill">{T(`${Math.round(r.close_rate * 1000) / 10}% of those given the price paid`, `${Math.round(r.close_rate * 1000) / 10}% ya waliopewa bei walilipa`)}</span>}
          </div>
        </div>
        {seg}
      </div>

      {r.reasons.length === 0
        ? <p className="empty">{T("Nobody went quiet in this period, or Kito hasn't read these chats yet.", "Hakuna aliyenyamaza kipindi hiki, au Kito bado hajasoma chats hizi.")}</p>
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
