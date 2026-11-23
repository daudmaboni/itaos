// Fake payment guard (migration 0079: payment_checks, chat_payment_flags, guard_review, set_pay_receivers).
// Every payment screenshot Kito read is checked against: the same code in another chat, the business's own
// payment numbers, the owner's pasted M-Pesa statement, the agreed amount, the date on it, and signs of editing.
// The owner decides each one: "Money came in" or "Fake". Fakes add up to money saved.
//   default export  the full list (its own page, #payments)
//   PaymentSummary  the overview card on the Dashboard and Receipts: counts only, opens the page
//   PayFlagBanner   the strip at the top of a chat with an unchecked suspicious screenshot
//   PayCheckCard    one screenshot to check (also used in Actions → Today)
import { errText } from "./errText";
import { useEffect, useMemo, useState } from "react";
import { supabase, Workspace, money, fmt, ago, canEdit } from "./lib";
import { useKept } from "./keep";
import { flagText, flagShort, receiverSuggestions, type PayItem, type PayRes } from "./guards";

const needsUpdate = (m: string) => /does not exist|schema cache|could not find/i.test(m);

export default function PaymentGuard({ ws }: { ws: Workspace }) {
  const T = (en: string, sw: string) => (ws.language === "sw" ? sw : en);
  const days = 90;
  const [r, setR] = useKept<PayRes | null>(`paycheck:${ws.id}:${days}`, null);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  const [all, setAll] = useState(false);
  const [editRecv, setEditRecv] = useState(false);
  const editor = canEdit(ws);

  useEffect(() => {
    let live = true;
    supabase.rpc("payment_checks", { p_ws: ws.id, p_days: days }).then(({ data, error }) => {
      if (!live) return;
      if (error) setErr(needsUpdate(error.message) ? T("This needs the latest itaOS update. Try again in a few minutes.", "Hii inahitaji sasisho jipya. Jaribu tena baada ya dakika chache.") : errText(error));
      else { setErr(""); setR(data as PayRes); }
    });
    return () => { live = false; };
  }, [ws.id, days, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = T("Fake payment guard", "Kinga ya malipo feki");
  if (err) return <section className="card guard"><h2>{title}</h2><p className="err small">{err}</p></section>;
  if (!r) return <section className="card guard" aria-busy="true"><div className="skeleton" style={{ minHeight: 110 }} /></section>;

  const cur = ws.currency;
  const open = r.items.filter((i) => !i.verdict);
  const done = r.items.filter((i) => i.verdict);
  const show = all ? [...open, ...done] : open;
  const noRecv = (r.receivers ?? []).length === 0;

  return (
    <section className="card guard" id="payment-guard">
      <div className="g-head">
        <div>
          <h2>{title}</h2>
          <span className="small muted">{T(`Every payment screenshot from the last ${days} days, checked before you send the product.`,
            `Kila picha ya malipo ya siku ${days} zilizopita, imekaguliwa kabla hujatuma mzigo.`)}</span>
          <div className="g-sum">
            <span className="g-pill">{T(`${fmt(r.checked)} checked`, `${fmt(r.checked)} zimekaguliwa`)}</span>
            {r.to_check > 0
              ? <span className={"g-pill " + (r.to_check_red ? "bad" : "warn")}>{T(`${fmt(r.to_check)} to look at`, `${fmt(r.to_check)} za kuangalia`)}</span>
              : <span className="g-pill ok">{T("Nothing suspicious", "Hakuna cha kutilia shaka")}</span>}
            {r.fakes > 0 && <span className="g-pill ok">{T(`${fmt(r.fakes)} ${r.fakes === 1 ? "fake" : "fakes"} caught · ${money(r.fakes_amount, cur)} kept`, `Feki ${fmt(r.fakes)} zimekamatwa · ${money(r.fakes_amount, cur)} zimeokolewa`)}</span>}
          </div>
        </div>
      </div>

      {(
        <Receivers ws={ws} r={r} editor={editor} open={noRecv || editRecv} onToggle={() => setEditRecv((x) => !x)} onSaved={() => setTick((x) => x + 1)} T={T} />
      )}
      {!r.statement?.to && (
        <p className="small muted" style={{ margin: "10px 0 0" }}>{T("Tip: paste your M-Pesa messages in ", "Kidokezo: bandika jumbe zako za M-Pesa kwenye ")}<a href="#receipts">{T("Receipts → Check your M-Pesa", "Risiti → Kagua M-Pesa yako")}</a>{T(". Then itaOS also flags any screenshot whose payment never reached you.", ". Kisha itaOS itaonyesha pia picha yoyote ambayo malipo yake hayakukufikia.")}</p>)}

      {show.length === 0 && <p className="empty" style={{ marginTop: 12 }}>{T("Nothing to check. New payment screenshots are checked as they arrive.", "Hakuna cha kukagua. Picha mpya za malipo zinakaguliwa zinapoingia.")}</p>}
      {show.length > 0 && (
        <div className="g-list">
          {show.map((it) => <PayCheckCard key={it.message_id} it={it} ws={ws} editor={editor} onDone={() => setTick((x) => x + 1)} flat />)}
        </div>
      )}
      {done.length > 0 && (
        <button className="small g-more" onClick={() => setAll((x) => !x)}>{all ? T("Hide decided ones", "Ficha zilizoamuliwa") : T(`Show ${done.length} you already decided`, `Onyesha ${done.length} ulizokwisha amua`)}</button>
      )}
    </section>
  );
}

/** Dashboard / Receipts: the overview only. Tapping it opens the Payment checks page. */
export function PaymentSummary({ ws }: { ws: Workspace }) {
  const T = (en: string, sw: string) => (ws.language === "sw" ? sw : en);
  const [r, setR] = useKept<PayRes | null>(`paycheck:${ws.id}:30`, null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    supabase.rpc("payment_checks", { p_ws: ws.id, p_days: 30 }).then(({ data, error }) => {
      if (!live) return;
      if (error) setErr(needsUpdate(error.message) ? T("This needs the latest itaOS update.", "Hii inahitaji sasisho jipya.") : errText(error));
      else { setErr(""); setR(data as PayRes); }
    });
    return () => { live = false; };
  }, [ws.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const title = T("Fake payment guard", "Kinga ya malipo feki");
  if (err) return <section className="card guard"><h2>{title}</h2><p className="err small">{err}</p></section>;
  if (!r) return <section className="card guard" aria-busy="true"><div className="skeleton" style={{ minHeight: 90 }} /></section>;
  const noRecv = (r.receivers ?? []).length === 0;
  const status = r.to_check_red > 0
    ? T(`${fmt(r.to_check_red)} ${r.to_check_red === 1 ? "payment looks" : "payments look"} wrong. Check before sending anything.`, `Malipo ${fmt(r.to_check_red)} yanaonekana si sahihi. Kagua kabla ya kutuma chochote.`)
    : r.to_check > 0 ? T(`${fmt(r.to_check)} ${r.to_check === 1 ? "screenshot needs" : "screenshots need"} a quick look.`, `Picha ${fmt(r.to_check)} zinahitaji kuangaliwa.`)
    : T("Every payment screenshot looks fine.", "Picha zote za malipo zinaonekana sawa.");
  return (
    <a className="card guard g-sumcard" href="#payments" aria-label={T("Open payment checks", "Fungua ukaguzi wa malipo")}>
      <div className="g-head">
        <div>
          <h2>{title}</h2>
          <span className="small muted">{T("Payment screenshots from the last 30 days", "Picha za malipo za siku 30 zilizopita")}</span>
        </div>
        <span className="g-open" aria-hidden>›</span>
      </div>
      <div className="g-stats">
        <span><b>{fmt(r.checked)}</b><small>{T("checked", "zimekaguliwa")}</small></span>
        <span className={r.to_check_red ? "bad" : r.to_check ? "warn" : "ok"}><b>{fmt(r.to_check)}</b><small>{T("to look at", "za kuangalia")}</small></span>
        <span className={r.fakes ? "ok" : ""}><b>{fmt(r.fakes)}</b><small>{T(r.fakes === 1 ? "fake caught" : "fakes caught", "feki zimekamatwa")}</small></span>
        <span><b>{money(r.fakes_amount, ws.currency)}</b><small>{T("kept", "zimeokolewa")}</small></span>
      </div>
      <p className={"g-status small" + (r.to_check_red ? " bad" : r.to_check ? " warn" : "")}>{status}</p>
      {noRecv && <p className="small muted" style={{ margin: 0 }}>{T("Add your payment numbers on the page so itaOS can spot money paid to someone else.", "Ongeza namba zako za malipo kwenye ukurasa ili itaOS ione pesa zilizolipwa kwa mtu mwingine.")}</p>}
    </a>
  );
}

/** The business's own payment numbers, with numbers seen on customers' screenshots offered as one-tap adds. */
function Receivers({ ws, r, editor, open, onToggle, onSaved, T }: {
  ws: Workspace; r: PayRes; editor: boolean; open: boolean; onToggle: () => void; onSaved: () => void; T: (en: string, sw: string) => string;
}) {
  const [list, setList] = useState<string[]>(r.receivers ?? []);
  const [add, setAdd] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { setList(r.receivers ?? []); }, [r.receivers]);
  const sugg = useMemo(() => receiverSuggestions(r.suggest ?? [], list), [r.suggest, list]);

  async function save(next: string[]) {
    setBusy(true); setMsg("");
    const { data, error } = await supabase.rpc("set_pay_receivers", { p_ws: ws.id, p_list: next });
    setBusy(false);
    if (error) { setMsg(errText(error)); return; }
    setList((data as string[]) ?? next); setAdd(""); onSaved();
  }

  if (!open) {
    return (
      <p className="small muted" style={{ margin: "10px 0 0" }}>
        {T("Your payment numbers: ", "Namba zako za malipo: ")}<b>{list.join(" · ")}</b>{editor && <> · <button className="small" style={{ padding: "2px 10px" }} onClick={onToggle}>{T("Change", "Badilisha")}</button></>}
      </p>
    );
  }
  return (
    <div className="g-recv">
      <div>
        <b>{T("Your payment numbers", "Namba zako za malipo")}</b>
        <div className="small muted">{T("Lipa namba, till, phone or bank account that customers pay into. itaOS flags any screenshot paid to something else.",
          "Lipa namba, till, simu au akaunti ya benki ambayo wateja hulipia. itaOS itaonyesha picha yoyote iliyolipwa kwingine.")}</div>
      </div>
      {list.length > 0 && <div className="g-chips">{list.map((x) => (
        <span className="g-tag" key={x}>{x}{editor && <button aria-label={T(`Remove ${x}`, `Ondoa ${x}`)} disabled={busy} onClick={() => void save(list.filter((y) => y !== x))}>✕</button>}</span>
      ))}</div>}
      {editor && sugg.length > 0 && (
        <div className="g-chips" aria-label={T("Seen on customers' screenshots", "Zimeonekana kwenye picha za wateja")}>
          <span className="small muted" style={{ alignSelf: "center" }}>{T("Seen on screenshots:", "Zimeonekana kwenye picha:")}</span>
          {sugg.slice(0, 5).map((s) => (
            <button key={s.num} className="g-sug" disabled={busy} onClick={() => void save([...list, s.num])}
              title={T(`Seen ${s.n} times. Only add it if it is yours.`, `Imeonekana mara ${s.n}. Iongeze tu kama ni yako.`)}>
              + {s.num}{s.label ? ` · ${s.label}` : ""} <span className="muted">×{s.n}</span>
            </button>
          ))}
        </div>
      )}
      {editor && (
        <form className="g-add" onSubmit={(e) => { e.preventDefault(); if (add.trim()) void save([...list, add.trim()]); }}>
          <input value={add} onChange={(e) => setAdd(e.target.value)} placeholder={T("e.g. 36030266 or 0754 123 456", "mfano 36030266 au 0754 123 456")} aria-label={T("Add a payment number", "Ongeza namba ya malipo")} inputMode="text" />
          <button className="primary" disabled={busy || !add.trim()}>{T("Add", "Ongeza")}</button>
          {list.length > 0 && <button type="button" onClick={onToggle}>{T("Done", "Maliza")}</button>}
        </form>
      )}
      {msg && <span className="err small">{msg}</span>}
    </div>
  );
}

/** One screenshot to check, with the owner's two answers. */
export function PayCheckCard({ it, ws, editor, onDone, flat = false }: { it: PayItem; ws: Workspace; editor: boolean; onDone: () => void; flat?: boolean }) {
  const T = (en: string, sw: string) => (ws.language === "sw" ? sw : en);
  const M = (n: number | null | undefined) => money(n, ws.currency);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function decide(v: "ok" | "fake" | null) {
    setBusy(true); setErr("");
    const { error } = await supabase.rpc("guard_review", { p_ws: ws.id, p_kind: "payment", p_ref: it.message_id, p_verdict: v, p_amount: v === "fake" ? (it.amount ?? it.expected) : null, p_conv: it.conversation_id });
    setBusy(false);
    if (error) setErr(errText(error)); else onDone();
  }
  const body = (
    <>
      <div className="g-top">
        <b>{it.contact_name ?? T("Customer", "Mteja")}</b>
        <span className="g-amt">{M(it.amount)}</span>
      </div>
      <div className="small muted">{[it.provider, it.txn_code ? T(`code ${it.txn_code}`, `muamala ${it.txn_code}`) : null, T(`sent ${ago(it.sent_at)}`, `ilitumwa ${ago(it.sent_at)}`)].filter(Boolean).join(" · ")}</div>
      <div>{it.flags.map((f) => <span key={f} className={"chip " + (f === "reused" || f === "receiver" || f === "wallet" ? "bad" : "warn")}>{flagShort(f, T)}</span>)}
        {it.verdict === "ok" && <span className="chip ok">{T("Money came in", "Pesa imeingia")}</span>}
        {it.verdict === "fake" && <span className="chip bad">{T("You marked it fake", "Umeiweka feki")}</span>}</div>
      {!it.verdict && <ul className="g-why small">{it.flags.map((f) => <li key={f}>{flagText(f, it, T, M)}</li>)}</ul>}
      {!it.verdict && it.flags.includes("edited") && it.notes && <p className="small muted" style={{ margin: 0 }}>{T("Kito noticed: ", "Kito ameona: ")}{it.notes}</p>}
      <div className="g-acts">
        <a href={"#chats/ids=" + it.conversation_id}>{T("Open chat", "Fungua chat")} →</a>
        {it.other_conversation_id && <a href={"#chats/ids=" + it.other_conversation_id}>{T("The other chat with this code", "Chat nyingine yenye muamala huu")} →</a>}
        {editor && !it.verdict && <>
          <button className="small" disabled={busy} onClick={() => void decide("ok")}>{T("Money came in", "Pesa imeingia")}</button>
          <button className="small" disabled={busy} onClick={() => void decide("fake")} style={{ color: "var(--bad)" }}>{T("It's fake", "Ni feki")}</button>
        </>}
        {editor && it.verdict && <button className="small" disabled={busy} onClick={() => void decide(null)}>{T("Undo", "Tendua")}</button>}
      </div>
      {!it.verdict && <span className="small muted">{T("Check your own M-Pesa or bank app before sending the product. A screenshot alone is not proof.", "Angalia M-Pesa au benki yako mwenyewe kabla ya kutuma mzigo. Picha peke yake si uthibitisho.")}</span>}
      {err && <span className="err small">{err}</span>}
    </>
  );
  return flat ? <div className={"g-item" + (it.verdict ? " done" : "")}>{body}</div> : <div className="pcard guard" style={{ paddingBottom: 14 }}>{body}</div>;
}

/** The strip at the top of an open chat when one of its payment screenshots looks wrong. */
export function PayFlagBanner({ ws, convId }: { ws: Workspace; convId: string }) {
  const T = (en: string, sw: string) => (ws.language === "sw" ? sw : en);
  const M = (n: number | null | undefined) => money(n, ws.currency);
  const [items, setItems] = useState<PayItem[]>([]);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setItems([]);
    supabase.rpc("chat_payment_flags", { p_conv: convId }).then(({ data, error }) => { if (live && !error && Array.isArray(data)) setItems(data as PayItem[]); });
    return () => { live = false; };
  }, [convId, tick]);
  if (!items.length) return null;
  const it = items[0]!;
  const red = it.severity === "red";
  async function decide(v: "ok" | "fake") {
    setBusy(true);
    await supabase.rpc("guard_review", { p_ws: ws.id, p_kind: "payment", p_ref: it.message_id, p_verdict: v, p_amount: v === "fake" ? (it.amount ?? it.expected) : null, p_conv: convId });
    setBusy(false); setTick((x) => x + 1);
  }
  return (
    <div className={"pay-flag" + (red ? "" : " amber")} role="alert">
      <span><b>{red ? T("Check this payment before you send anything", "Kagua malipo haya kabla ya kutuma chochote") : T("This payment screenshot needs a look", "Picha hii ya malipo inahitaji kuangaliwa")}</b>
        {" · "}{M(it.amount)}{items.length > 1 ? T(` · ${items.length} screenshots`, ` · picha ${items.length}`) : ""}</span>
      <ul>{it.flags.map((f) => <li key={f}>{flagText(f, it, T, M)}</li>)}</ul>
      {canEdit(ws) && <div className="g-acts">
        <button className="small" disabled={busy} onClick={() => void decide("ok")}>{T("Money came in", "Pesa imeingia")}</button>
        <button className="small" disabled={busy} onClick={() => void decide("fake")}>{T("It's fake", "Ni feki")}</button>
        {it.other_conversation_id && <a className="small" href={"#chats/ids=" + it.other_conversation_id}>{T("Other chat with this code →", "Chat nyingine yenye muamala huu →")}</a>}
      </div>}
    </div>
  );
}
