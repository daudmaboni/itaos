// Receipts → "Check your M-Pesa": paste payment SMS messages or upload the statement CSV, and see which
// payments are already recorded as sales in itaOS and which are not (with the chat they most likely belong to).
// Recording one is the owner's tap (wallet_record, migration 0077). Data: wallet_lines + wallet_check.
import { errText } from "./errText";
import { useEffect, useMemo, useState } from "react";
import { supabase, Workspace, money, fmt, localDay } from "./lib";
import { parseWallet, type WalletLine } from "./walletParse";

type Item = {
  id: string; txn_id: string; at: string; amount: number; currency: string; sender_name: string | null; phone_tail: string | null; provider: string | null;
  status: "recorded" | "likely_recorded" | "not_recorded" | "dismissed"; order_id: string | null; conversation_id: string | null;
  matched: "code" | "amount" | "screenshot" | "phone" | "name" | null; contact_name: string | null;
};
type Res = { lines: number; sales_lines: number; recorded: number; not_recorded: number; not_recorded_amount: number; items: Item[]; last_upload: string | null };

const DAYS = 60;

export default function WalletCheck({ ws }: { ws: Workspace }) {
  const T = (en: string, sw: string) => (ws.language === "sw" ? sw : en);
  const tz = ws.timezone || "Africa/Dar_es_Salaam";
  const [text, setText] = useState("");
  const [res, setRes] = useState<Res | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [note, setNote] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [tick, setTick] = useState(0);
  const parsed: WalletLine[] = useMemo(() => (text.trim() ? parseWallet(text) : []), [text]);

  useEffect(() => {
    let live = true;
    const to = localDay(new Date(), tz), from = localDay(new Date(Date.now() - (DAYS - 1) * 864e5), tz);
    supabase.rpc("wallet_check", { p_ws: ws.id, p_from: from, p_to: to }).then(({ data, error }) => {
      if (!live) return;
      if (error) setErr(/does not exist|schema cache|could not find/i.test(error.message) ? T("This needs the latest itaOS update. Try again in a few minutes.", "Hii inahitaji sasisho jipya. Jaribu tena baada ya dakika chache.") : errText(error));
      else { setErr(""); setRes(data as Res); }
    });
    return () => { live = false; };
  }, [ws.id, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (/\.(xlsx?|pdf)$/i.test(f.name)) { setNote(T("Save the statement as CSV first (Excel: File → Save as → CSV), or paste the payment messages.", "Hifadhi taarifa kama CSV kwanza (Excel: File → Save as → CSV), au bandika jumbe za malipo.")); return; }
    setText(await f.text()); setNote("");
  }

  async function save() {
    if (!parsed.length) return;
    setBusy("save"); setNote("");
    const rows = parsed.map(({ date_guessed: _g, ...x }) => ({ ...x, workspace_id: ws.id }));
    const { error } = await supabase.from("wallet_lines").upsert(rows, { onConflict: "workspace_id,txn_id", ignoreDuplicates: true });
    setBusy("");
    if (error) { setNote(errText(error)); return; }
    setText(""); setNote(T(`${parsed.length} payments checked.`, `Malipo ${parsed.length} yamekaguliwa.`)); setTick((x) => x + 1);
  }
  async function record(i: Item) {
    setBusy(i.id);
    const { error } = await supabase.rpc("wallet_record", { p_line: i.id, p_conv: i.conversation_id });
    setBusy(""); if (error) setNote(errText(error)); else setTick((x) => x + 1);
  }
  async function dismiss(i: Item, v: boolean) {
    setBusy(i.id);
    const { error } = await supabase.from("wallet_lines").update({ dismissed: v }).eq("id", i.id).eq("workspace_id", ws.id);
    setBusy(""); if (error) setNote(errText(error)); else setTick((x) => x + 1);
  }

  const howLabel = (m: Item["matched"]) => m === "screenshot" ? T("same code on a payment screenshot", "namba ile ile kwenye picha ya malipo")
    : m === "phone" ? T("same last 4 digits", "tarakimu 4 za mwisho sawa") : m === "name" ? T("same name", "jina lile lile")
    : m === "amount" ? T("same amount within 2 days", "kiasi kile kile ndani ya siku 2") : m === "code" ? T("same code", "namba ile ile") : "";
  const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz });
  const todo = (res?.items ?? []).filter((i) => i.status === "not_recorded");
  const rest = (res?.items ?? []).filter((i) => i.status !== "not_recorded");

  return (
    <section className="card flat wallet" style={{ display: "grid", gap: 12 }}>
      <div>
        <h2 style={{ margin: 0 }}>{T("Check your M-Pesa", "Kagua M-Pesa yako")}</h2>
        <span className="small muted">{T("Paste the payment messages you received (M-Pesa, Mixx, Airtel Money, HaloPesa) or upload your statement as CSV. itaOS shows which payments are not recorded as sales yet, so your numbers count every shilling. Only the last 4 digits of a number are kept.",
          "Bandika jumbe za malipo ulizopokea (M-Pesa, Mixx, Airtel Money, HaloPesa) au pakia taarifa yako kama CSV. itaOS inaonyesha malipo ambayo bado hayajarekodiwa kama mauzo, ili hesabu zako zihesabu kila shilingi. Tarakimu 4 za mwisho za namba ndizo zinahifadhiwa.")}</span>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
        placeholder={T("Paste payment messages here, e.g. \"SK41… Confirmed. Tsh205,000.00 received from 2557… - JOHN DOE…\"", "Bandika jumbe za malipo hapa, mfano \"SK41… Imethibitishwa. Umepokea Tsh205,000.00 kutoka 2557… - JOHN DOE…\"")} />
      <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button className="primary" disabled={!parsed.length || busy === "save"} onClick={save}>
          {busy === "save" && <span className="kito-spin sm" aria-hidden />}
          {parsed.length ? T(`Check ${parsed.length} payments (${money(parsed.reduce((s, x) => s + x.amount, 0), "TZS")})`, `Kagua malipo ${parsed.length} (${money(parsed.reduce((s, x) => s + x.amount, 0), "TZS")})`) : T("Check payments", "Kagua malipo")}
        </button>
        <label className="linkish small" style={{ cursor: "pointer" }}>
          {T("or upload a CSV", "au pakia CSV")}
          <input type="file" accept=".csv,.txt,text/csv,text/plain" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {text.trim() && !parsed.length && <span className="small err">{T("No received payments found in that text.", "Hakuna malipo yaliyopokelewa kwenye maandishi hayo.")}</span>}
        {parsed.some((x) => x.date_guessed) && <span className="small muted">{T("Some messages have no date: today's date was used.", "Baadhi ya jumbe hazina tarehe: tarehe ya leo imetumika.")}</span>}
        {note && <span className="small">{note}</span>}
      </div>
      {err && <p className="err small">{err}</p>}

      {res && res.lines > 0 && (
        <>
          <p style={{ margin: 0 }}>
            <b>{T(`${fmt(res.recorded)} of ${fmt(res.sales_lines)} payments`, `Malipo ${fmt(res.recorded)} kati ya ${fmt(res.sales_lines)}`)}</b>{" "}
            {T(`in the last ${DAYS} days are recorded in itaOS.`, `ya siku ${DAYS} zilizopita yamerekodiwa itaOS.`)}{" "}
            {res.not_recorded > 0 && <span className="bad">{T(`${fmt(res.not_recorded)} are not: ${money(res.not_recorded_amount, ws.currency)}.`, `${fmt(res.not_recorded)} bado: ${money(res.not_recorded_amount, ws.currency)}.`)}</span>}
          </p>
          <div className="wl-rows">
            {todo.map((i) => (
              <div className="wl-row" key={i.id}>
                <div className="wl-main">
                  <b>{money(i.amount, i.currency)}</b>
                  <span className="small muted">{when(i.at)} · {i.sender_name ?? T("Unknown sender", "Mtumaji hajulikani")}{i.phone_tail ? ` · …${i.phone_tail}` : ""} · {i.txn_id}</span>
                  {i.conversation_id
                    ? <span className="small">{T("Likely ", "Huenda ni ")}<a href={"#chats/open=" + i.conversation_id}>{i.contact_name ?? T("this chat", "chat hii")}</a> <span className="muted">({howLabel(i.matched)})</span></span>
                    : <span className="small muted">{T("No matching chat found.", "Hakuna chat inayolingana.")}</span>}
                </div>
                <div className="wl-act">
                  <button className="linkish small" disabled={busy === i.id} onClick={() => dismiss(i, true)}>{T("Not a sale", "Si mauzo")}</button>
                  <button className="primary" disabled={busy === i.id} onClick={() => record(i)}>{busy === i.id && <span className="kito-spin sm" aria-hidden />}{i.conversation_id ? T("Record sale", "Rekodi mauzo") : T("Record without chat", "Rekodi bila chat")}</button>
                </div>
              </div>
            ))}
            {!todo.length && <p className="small muted" style={{ margin: 0 }}>{T("Every payment you gave itaOS is recorded. Nice.", "Kila malipo uliyoipa itaOS yamerekodiwa. Safi.")}</p>}
          </div>
          {rest.length > 0 && <button type="button" className="linkish small" onClick={() => setShowDone((x) => !x)} aria-expanded={showDone}>{showDone ? T("Hide recorded payments", "Ficha malipo yaliyorekodiwa") : T(`Show ${rest.length} recorded or set aside`, `Onyesha ${rest.length} yaliyorekodiwa au kuwekwa pembeni`)}</button>}
          {showDone && (
            <div className="wl-rows">
              {rest.map((i) => (
                <div className="wl-row dim" key={i.id}>
                  <div className="wl-main">
                    <b>{money(i.amount, i.currency)}</b>
                    <span className="small muted">{when(i.at)} · {i.sender_name ?? "–"} · {i.txn_id}</span>
                  </div>
                  <div className="wl-act">
                    {i.status === "dismissed"
                      ? <button className="linkish small" disabled={busy === i.id} onClick={() => dismiss(i, false)}>{T("Not a sale · undo", "Si mauzo · rudisha")}</button>
                      : <span className={"chip " + (i.status === "recorded" ? "ok" : "")}>{i.status === "recorded" ? T("Recorded", "Imerekodiwa") : T("Probably recorded", "Huenda imerekodiwa")}{i.contact_name ? ` · ${i.contact_name}` : ""}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
