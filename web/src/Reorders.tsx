// Reorders (Step 3): customers who bought 45–120 days ago and haven't bought since. Kito writes a short
// "how are you getting on / want more?" draft; the owner copies it and sends it from WhatsApp themselves,
// or taps "Send from itaOS" (the approved reorder template, since these are always past the 24 hours). "Sent" records the contact so itaOS can show who replied and who bought again.
import { useEffect, useState } from "react";
import { supabase, callFn, Workspace, ago, money } from "./lib";
import { KitoLoader } from "./KitoLoader";
import { avaText, DoneRow } from "./ActionBits";
import { useKept } from "./keep";
import { SendNow } from "./SendNow";

export type ReorderRow = Row;
type Row = {
  conversation_id: string; contact_name: string | null; last_paid_at: string; products: string | null; amount: number | null;
  currency: string | null; orders_count: number; last_message_at: string | null; last_dir: string | null; state: "todo" | "contacted";
  task_id: string | null; contacted_at: string | null; draft: string | null; replied: boolean; reordered: boolean; reorder_amount: number | null;
};
type Draft = { text: string; why: string; missing: string[] };

const DAY = 864e5;
const daysSince = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / DAY));

export function ReorderList({ ws, editor, onCount, hidden }: { ws: Workspace; editor: boolean; onCount?: (n: number) => void; hidden?: Set<string> }) {
  const sw = ws.language === "sw";
  const T = (en: string, s: string) => (sw ? s : en);
  // Kept while the app is open: coming back shows the list at once and refreshes it quietly.
  const [rows, setRows] = useKept<Row[] | null>("reorders:" + ws.id, null);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    supabase.rpc("reorder_candidates", { p_ws: ws.id }).then(({ data, error }) => {
      if (!live) return;
      if (error) setErr(/function .* does not exist|schema cache|could not find/i.test(error.message) ? T("This page needs the latest itaOS update. Try again in a few minutes.", "Ukurasa huu unahitaji sasisho jipya. Jaribu tena baada ya dakika chache.") : error.message);
      else { setErr(""); setRows((data as Row[]) ?? []); }
    });
    return () => { live = false; };
  }, [ws.id, tick]);
  const todo = (rows ?? []).filter((r) => r.state === "todo" && !hidden?.has(r.conversation_id)).sort((a, b) => Date.parse(a.last_paid_at) - Date.parse(b.last_paid_at));
  const done = (rows ?? []).filter((r) => r.state === "contacted").sort((a, b) => Date.parse(b.contacted_at ?? "") - Date.parse(a.contacted_at ?? ""));
  useEffect(() => { onCount?.(todo.length); }, [todo.length]);   // eslint-disable-line react-hooks/exhaustive-deps
  const back = done.filter((r) => r.reordered).length, replied = done.filter((r) => r.replied).length;

  if (!rows && !err) return <div className="skeleton" style={{ minHeight: 200 }} aria-busy="true" />;
  return (
    <>
      <section className="card flat">
        <div><h2>{T("Bring past buyers back", "Warudishe wanunuzi wa zamani")} ({todo.length})</h2>
          <span className="small muted">{T("Customers whose last purchase was 45–120 days ago and who haven't bought since. Ask Kito for a message, send it from WhatsApp, then tap Sent.", "Wateja walionunua mara ya mwisho siku 45–120 zilizopita na hawajanunua tena. Muombe Kito ujumbe, utume kutoka WhatsApp, kisha bonyeza Nimetuma.")}</span></div>
        {err && <p className="err">{err}</p>}
        {todo.length === 0 ? <div className="empty">{T("Nobody to contact right now. Customers appear here 45 days after they buy.", "Hakuna wa kuwasiliana sasa. Wateja wanaonekana hapa siku 45 baada ya kununua.")}</div>
          : <div className="pgrid">{todo.map((r) => <ReorderCard key={r.conversation_id} r={r} ws={ws} editor={editor} T={T} onDone={() => setTick((t) => t + 1)} />)}</div>}
      </section>
      {done.length > 0 && (
        <section className="card by-list">
          <div className="by-list-h"><h2 style={{ margin: 0 }}>{T("Contacted", "Umewasiliana nao")} ({done.length})</h2>
            <span className="small muted">{T(`Last 45 days: ${replied} replied, ${back} bought again.`, `Siku 45 zilizopita: ${replied} wamejibu, ${back} wamenunua tena.`)}</span></div>
          {done.map((r) => (
            <DoneRow key={r.conversation_id} seed={r.conversation_id} name={r.contact_name ?? T("Customer", "Mteja")} href={"#chats/open=" + r.conversation_id}
              sub={`${T("Contacted", "Ulimtumia")} ${ago(r.contacted_at)}`}
              right={r.reordered
                ? <><b>{r.reorder_amount ? money(r.reorder_amount, r.currency ?? ws.currency) : ""}</b><span className="chip ok">{T("Bought again", "Amenunua tena")}</span></>
                : r.replied ? <span className="chip">{T("Replied", "Amejibu")}</span> : <span className="chip">{T("No reply yet", "Bado hajajibu")}</span>}
              chips={r.products ? r.products.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 4).map((x, i) => <span key={i} className="chip">{x}</span>) : undefined} />
          ))}
        </section>
      )}
    </>
  );
}

export function ReorderCard({ r, ws, editor, T, onDone }: { r: Row; ws: Workspace; editor: boolean; T: (en: string, s: string) => string; onDone: () => void }) {
  const sw = ws.language === "sw";
  // The draft survives switching tabs (and arrives even if you left while Kito was writing).
  const [d, setD] = useKept<Draft | null>("reorder-draft:" + r.conversation_id, null);
  const [writing, setWriting] = useState(false);
  const [doing, setDoing] = useState<"" | "sent" | "skip">("");
  const [msg, setMsg] = useState("");
  const days = daysSince(r.last_paid_at);

  async function ask() {
    setWriting(true); setMsg("");
    try {
      const x = await callFn<{ draft_sw: string; draft_en: string; why: string; missing: string[] }>("reorder", { workspace_id: ws.id, conversation_id: r.conversation_id });
      setD({ text: sw ? x.draft_sw : x.draft_en, why: x.why, missing: x.missing ?? [] });
    } catch (e) { setMsg((e as Error).message); }
    setWriting(false);
  }
  const copy = async () => { try { await navigator.clipboard.writeText(d?.text ?? ""); setMsg(T("Copied. Paste it in WhatsApp and send it yourself.", "Imenakiliwa. Bandika WhatsApp na utume mwenyewe.")); } catch { setMsg(T("Could not copy.", "Haikunakiliwa.")); } };
  async function record(status: "done" | "dismissed", sentText?: string) {
    setDoing(status === "done" ? "sent" : "skip"); setMsg("");
    const now = new Date().toISOString();
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("follow_up_tasks").insert({
      workspace_id: ws.id, conversation_id: r.conversation_id, source: "reorder", status,
      title: T("Reorder check-in", "Kumkumbusha kununua tena"), draft: sentText ?? d?.text ?? null, draft_source: sentText && sentText !== d?.text ? "edited" : d ? "kito" : null,
      result: status === "done" ? "called" : "not_interested", completed_at: now, due_at: now, created_by: u.user?.id ?? null,
    });
    setDoing("");
    if (error) setMsg(error.message); else { setD(null); onDone(); }
  }

  const name = r.contact_name ?? T("Customer", "Mteja");
  const prods = (r.products ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return (
    <div className={"pcard" + (doing ? " busy" : "")}>
      <div className="pc-head">
        <span className="pc-ava" aria-hidden>{avaText(name)}</span>
        <div className="pc-who">
          <b title={name}>{name}</b>
          <span className="small muted">{T(`last bought ${days} days ago`, `alinunua mara ya mwisho siku ${days} zilizopita`)}</span>
        </div>
        <div className="pc-chips">
          {r.amount ? <span className="chip">{money(r.amount, r.currency ?? ws.currency)}</span> : null}
          {r.orders_count > 1 && <span className="chip ok">{T(`bought ${r.orders_count}×`, `amenunua mara ${r.orders_count}`)}</span>}
        </div>
      </div>
      {prods.length > 0 && <div className="pc-picks">{prods.map((x, i) => <span key={i} className="chip">{x}</span>)}</div>}
      {r.last_message_at && <p className="pc-sum">{T("Last message", "Ujumbe wa mwisho")} {ago(r.last_message_at)}{r.last_dir === "in" ? T(" · from them", " · kutoka kwake") : ""}</p>}
      <a className="pc-open small" href={"#chats/open=" + r.conversation_id}>{T("Open chat", "Fungua chat")} →</a>
      <div className="pc-foot">
        <div className="draft-label">{T("Draft — not sent", "Rasimu — haijatumwa")}</div>
        <textarea value={d?.text ?? ""} disabled={!editor} onChange={(e) => setD({ text: e.target.value, why: d?.why ?? "", missing: d?.missing ?? [] })}
          placeholder={T("Ask Kito for a message that mentions what they bought, or write your own.", "Muombe Kito ujumbe unaotaja walichonunua, au andika wako.")} />
        {d?.missing?.length ? <div className="small warnt">{T("Fill in before sending:", "Jaza kabla ya kutuma:")} {d.missing.join(", ")}</div> : null}
        {editor && <div className="pc-picks">
          <button className="pc-pick" disabled={writing} onClick={ask}>{writing ? <><KitoLoader size="sm" />{T("Kito is writing…", "Kito anaandika…")}</> : d ? T("Write again", "Andika upya") : T("Ask Kito for a draft", "Muombe Kito rasimu")}</button>
          <button className="pc-pick" disabled={!d?.text} onClick={copy}>{T("Copy", "Nakili")}</button>
          <SendNow ws={ws} conversationId={r.conversation_id} purpose="reorder" draft={d?.text} name={r.contact_name} product={r.products} T={T} onSent={(txt) => record("done", txt)} />
        </div>}
        {editor && (
          <div className="pc-acts">
            <button className="linkish small" disabled={!!doing} onClick={() => record("dismissed")} title={T("Hide for 60 days", "Ficha kwa siku 60")}>{doing === "skip" && <span className="kito-spin sm" aria-hidden />}{T("Not now", "Si sasa")}</button>
            <button className="primary" disabled={!!doing} onClick={() => record("done")} title={T("You sent a message from WhatsApp", "Umetuma ujumbe kutoka WhatsApp")}>{doing === "sent" && <span className="kito-spin sm" aria-hidden />}{T("Sent", "Nimetuma")}</button>
          </div>
        )}
      </div>
      {msg && <div className={"pc-msg small " + (/Copied|Imenakiliwa/.test(msg) ? "ok" : "err")}>{msg}</div>}
    </div>
  );
}
