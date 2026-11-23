// Staff leak guard (Dashboard). Data: staff_leaks() (migration 0079).
// Where money can slip away between a customer and the business account:
//   a business message asking to pay to a number that isn't the business's, a customer moved to another phone,
//   a customer's screenshot paid to someone else, and customers who paid but have no recorded sale.
// Plus each team member's numbers (assigned chats, bought, messages from itaOS, reply time).
import { useEffect, useState } from "react";
import { supabase, Workspace, money, fmt, ago, canEdit } from "./lib";
import { useKept } from "./keep";
import { prettyNum, openLeaks, type LeakRes } from "./guards";

const DAYS = [7, 30, 90] as const;
type Days = (typeof DAYS)[number];

export default function LeakGuard({ ws }: { ws: Workspace }) {
  const T = (en: string, sw: string) => (ws.language === "sw" ? sw : en);
  const [days, setDays] = useState<Days>(30);
  const [r, setR] = useKept<LeakRes | null>(`leaks:${ws.id}:${days}`, null);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState("");
  const [showOk, setShowOk] = useState(false);
  const editor = canEdit(ws);

  useEffect(() => {
    let live = true;
    supabase.rpc("staff_leaks", { p_ws: ws.id, p_days: days }).then(({ data, error }) => {
      if (!live) return;
      if (error) setErr(/does not exist|schema cache|could not find/i.test(error.message) ? T("This needs the latest itaOS update. Try again in a few minutes.", "Hii inahitaji sasisho jipya. Jaribu tena baada ya dakika chache.") : error.message);
      else { setErr(""); setR(data as LeakRes); }
    });
    return () => { live = false; };
  }, [ws.id, days, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = T("Staff leak guard", "Kinga ya uvujaji");
  if (err) return <section className="card guard leak"><h2>{title}</h2><p className="err small">{err}</p></section>;
  if (!r) return <section className="card guard leak" aria-busy="true"><div className="skeleton" style={{ minHeight: 110 }} /></section>;

  const M = (n: number | null | undefined) => money(n, ws.currency);
  const n = openLeaks(r);
  const nums = r.numbers.filter((x) => showOk || !x.verdict);
  const decided = r.numbers.length - r.numbers.filter((x) => !x.verdict).length;

  async function decide(flag: string, num: string, v: "ok" | "leak" | null, addAsMine = false) {
    setBusy(flag + num);
    const res = addAsMine
      ? await supabase.rpc("leak_ok_add_receiver", { p_ws: ws.id, p_num: num })
      : await supabase.rpc("guard_review", { p_ws: ws.id, p_kind: "leak", p_ref: `${flag}:${num}`, p_verdict: v });
    setBusy("");
    if (res.error) setErr(res.error.message); else setTick((x) => x + 1);
  }

  return (
    <section className="card guard leak">
      <div className="g-head">
        <div>
          <h2>{title}</h2>
          <span className="small muted">{T("Places where a customer's money could go somewhere other than your account.", "Mahali ambapo pesa ya mteja inaweza kwenda kwingine badala ya akaunti yako.")}</span>
          <div className="g-sum">
            {n > 0 ? <span className="g-pill warn">{T(`${fmt(n)} to look at`, `${fmt(n)} za kuangalia`)}</span> : <span className="g-pill ok">{T("No leaks found", "Hakuna uvujaji")}</span>}
            {r.unrecorded > 0 && <span className="g-pill">{T(`${fmt(r.unrecorded)} paid, not recorded · ${M(r.unrecorded_amount)}`, `${fmt(r.unrecorded)} wamelipa, hawajarekodiwa · ${M(r.unrecorded_amount)}`)}</span>}
          </div>
        </div>
        <div className="seg" role="radiogroup" aria-label={T("Days", "Siku")}>
          {DAYS.map((d) => <button key={d} role="radio" aria-checked={days === d} className={days === d ? "on" : ""} onClick={() => setDays(d)}>{T(`${d} days`, `Siku ${d}`)}</button>)}
        </div>
      </div>

      {!r.receivers_set && (
        <p className="small" style={{ margin: "10px 0 0" }}>{T("Add your payment numbers on ", "Ongeza namba zako za malipo kwenye ")}<a href="#receipts">{T("Receipts → Fake payment guard", "Risiti → Kinga ya malipo feki")}</a>{T(". Then itaOS can also spot messages that ask customers to pay into another number.", ". Kisha itaOS itaweza pia kuona jumbe zinazoomba wateja walipe namba nyingine.")}</p>
      )}

      {nums.length > 0 && (
        <div className="lk-sec">
          <h3>{T("Other numbers in your messages", "Namba nyingine kwenye jumbe zako")}</h3>
          <div className="g-list" style={{ marginTop: 0 }}>
            {nums.map((x) => (
              <div className={"g-item" + (x.verdict ? " done" : "")} key={x.flag + x.num}>
                <div className="g-top">
                  <b>{prettyNum(x.num)}</b>
                  <span className={"chip " + (x.flag === "pay_number" ? "bad" : "warn")}>{x.flag === "pay_number" ? T("Asked to pay here", "Kuomba malipo hapa") : T("Customer sent to this number", "Mteja ameelekezwa namba hii")}</span>
                </div>
                <span className="small muted">{T(`${fmt(x.n)} ${x.n === 1 ? "message" : "messages"} in ${fmt(x.chats)} ${x.chats === 1 ? "chat" : "chats"} · last ${ago(x.last_at)}`, `Jumbe ${fmt(x.n)} kwenye chats ${fmt(x.chats)} · mwisho ${ago(x.last_at)}`)}
                  {x.senders?.length ? T(` · sent by ${x.senders.join(", ")}`, ` · imetumwa na ${x.senders.join(", ")}`) : T(" · typed on the phone", " · imeandikwa kwenye simu")}</span>
                <p className="lk-sample">“{x.sample}”</p>
                <div className="g-acts">
                  <a href={"#chats/ids=" + x.conv_ids.join(",")}>{T("Open the chats", "Fungua chats")} →</a>
                  {editor && !x.verdict && <>
                    {x.flag === "pay_number" && <button className="small" disabled={busy !== ""} onClick={() => void decide(x.flag, x.num, "ok", true)}>{T("It's ours, add it", "Ni yetu, iongeze")}</button>}
                    {x.flag === "personal_number" && <button className="small" disabled={busy !== ""} onClick={() => void decide(x.flag, x.num, "ok")}>{T("It's fine", "Ni sawa")}</button>}
                    <button className="small" disabled={busy !== ""} onClick={() => void decide(x.flag, x.num, "leak")} style={{ color: "var(--bad)" }}>{T("Not ours", "Si yetu")}</button>
                  </>}
                  {x.verdict && <><span className={"chip " + (x.verdict === "ok" ? "ok" : "bad")}>{x.verdict === "ok" ? T("Marked fine", "Imewekwa sawa") : T("Marked not ours", "Imewekwa si yetu")}</span>
                    {editor && <button className="small" disabled={busy !== ""} onClick={() => void decide(x.flag, x.num, null)}>{T("Undo", "Tendua")}</button>}</>}
                </div>
              </div>
            ))}
          </div>
          {decided > 0 && <button className="small g-more" onClick={() => setShowOk((v) => !v)}>{showOk ? T("Hide decided ones", "Ficha zilizoamuliwa") : T(`Show ${decided} you already decided`, `Onyesha ${decided} ulizokwisha amua`)}</button>}
        </div>
      )}

      {r.paid_elsewhere.length > 0 && (
        <div className="lk-sec">
          <h3>{T("Customers who paid someone else", "Wateja waliolipa mtu mwingine")}</h3>
          <div className="g-list" style={{ marginTop: 0 }}>
            {r.paid_elsewhere.map((p) => (
              <div className="g-item" key={p.paid_to}>
                <div className="g-top"><b>{p.paid_to}</b><span className="g-amt">{M(p.amount)}</span></div>
                <span className="small muted">{T(`${fmt(p.n)} ${p.n === 1 ? "screenshot" : "screenshots"} · last ${ago(p.last_at)}. If this is yours, add it to your payment numbers.`, `Picha ${fmt(p.n)} · mwisho ${ago(p.last_at)}. Kama ni yako, iongeze kwenye namba zako za malipo.`)}</span>
                <div className="g-acts"><a href={"#chats/ids=" + p.conv_ids.join(",")}>{T("Open the chats", "Fungua chats")} →</a><a href="#receipts">{T("Payment numbers", "Namba za malipo")} →</a></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {r.unrecorded_items.length > 0 && (
        <div className="lk-sec">
          <h3>{T("Paid, but no sale recorded", "Wamelipa, lakini mauzo hayajarekodiwa")}</h3>
          <span className="small muted">{T("Kito or a screenshot says these customers paid more than 2 days ago. Record the sale, or check that the money really came in.", "Kito au picha inaonyesha wateja hawa walilipa zaidi ya siku 2 zilizopita. Rekodi mauzo, au hakikisha pesa iliingia kweli.")}</span>
          <div className="g-list" style={{ marginTop: 6 }}>
            {r.unrecorded_items.slice(0, 8).map((u) => (
              <div className="g-item" key={u.id}>
                <div className="g-top"><a href={"#chats/ids=" + u.id}><b>{u.name ?? T("Customer", "Mteja")}</b></a><span className="g-amt">{M(u.amount)}</span></div>
                <span className="small muted">{[u.why === "kito" ? T("Kito read a payment", "Kito ameona malipo") : u.why === "words" ? T("payment words in the chat", "maneno ya malipo kwenye chat") : T("payment screenshot", "picha ya malipo"),
                  T(`last message ${ago(u.at)}`, `ujumbe wa mwisho ${ago(u.at)}`), u.assigned ? T(`handled by ${u.assigned}`, `anashughulikiwa na ${u.assigned}`) : null].filter(Boolean).join(" · ")}</span>
              </div>
            ))}
          </div>
          {r.unrecorded_items.length > 8 && <a className="small g-more" style={{ display: "inline-block" }} href={"#chats/ids=" + r.unrecorded_items.map((u) => u.id).join(",")}>{T(`All ${r.unrecorded_items.length} →`, `Zote ${r.unrecorded_items.length} →`)}</a>}
        </div>
      )}

      <div className="lk-sec">
        <h3>{T("Your team", "Timu yako")}</h3>
        {r.team < 2
          ? <p className="small muted" style={{ margin: 0 }}>{T(`Only you are on this business, so there's nothing to compare. ${fmt(r.phone_messages)} messages were typed on the phone; WhatsApp doesn't say who typed them. To see each person's numbers, have your staff sign up at itaos.app, ask Pondi to add them to your business, and let them reply from itaOS.`,
            `Ni wewe peke yako kwenye biashara hii, kwa hiyo hakuna cha kulinganisha. Jumbe ${fmt(r.phone_messages)} ziliandikwa kwenye simu; WhatsApp haisemi nani aliandika. Kuona takwimu za kila mtu, waambie wafanyakazi wajisajili itaos.app, omba Pondi iwaongeze kwenye biashara yako, na wajibu kutoka itaOS.`)}</p>
          : <div className="lk-wrap"><table className="lk-people">
              <thead><tr><th>{T("Person", "Mtu")}</th><th>{T("Chats", "Chats")}</th><th>{T("Bought", "Walinunua")}</th><th>{T("Sent from itaOS", "Zilizotumwa itaOS")}</th><th>{T("Reply time", "Muda wa kujibu")}</th><th>{T("Flags", "Alama")}</th></tr></thead>
              <tbody>
                {r.people.map((p) => (
                  <tr key={p.id}><td>{p.name} <span className="muted small">{p.role}</span></td><td>{fmt(p.assigned)}</td>
                    <td>{fmt(p.bought)}{p.assigned ? <span className="muted small"> · {Math.round((p.bought / p.assigned) * 100)}%</span> : null}</td>
                    <td>{fmt(p.sent)}</td><td>{p.reply_min == null ? "–" : p.reply_min < 60 ? T(`${p.reply_min} min`, `dk ${p.reply_min}`) : T(`${Math.round(p.reply_min / 6) / 10} h`, `saa ${Math.round(p.reply_min / 6) / 10}`)}</td>
                    <td style={{ color: p.flags ? "var(--bad)" : undefined }}>{fmt(p.flags)}</td></tr>
                ))}
                <tr><td className="muted">{T("Phone (WhatsApp app)", "Simu (WhatsApp)")}</td><td>–</td><td>–</td><td className="muted">{T(`${fmt(r.phone_messages)} typed`, `${fmt(r.phone_messages)} zimeandikwa`)}</td><td>–</td><td>–</td></tr>
              </tbody>
            </table></div>}
      </div>
    </section>
  );
}
