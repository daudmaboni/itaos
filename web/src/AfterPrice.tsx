// Went quiet after the price (Actions → After price): customers who got a price, didn't buy and
// haven't written for a day or more. Kito writes a gentle follow-up; the owner opens WhatsApp with
// the message filled in and sends it themselves (itaOS never sends). "Sent" records it, so the list
// can show who replied and who bought afterwards.
import { useEffect, useMemo, useState } from "react";
import { supabase, callFn, Workspace, Outcome, Task, L, ago } from "./lib";
import { phoneOf } from "./chatParts";
import { KitoLoader } from "./KitoLoader";
import { useKept } from "./keep";
import { quietAfterPrice, contactedAfterPrice } from "./afterPrice";

type Draft = { text: string; why: string; missing: string[] };
const DAY = 864e5;

export function afterPriceCount(rows: Outcome[], tasks: Task[]) { return quietAfterPrice(rows, tasks).length; }

export function AfterPriceList({ rows, tasks, ws, editor, onChange }: { rows: Outcome[]; tasks: Task[]; ws: Workspace; editor: boolean; onChange: () => void | Promise<void> }) {
  const sw = ws.language === "sw";
  const T = (en: string, s: string) => (sw ? s : en);
  const todo = useMemo(() => quietAfterPrice(rows, tasks), [rows, tasks]);
  const done = useMemo(() => contactedAfterPrice(rows, tasks), [rows, tasks]);
  const [phones, setPhones] = useState<Record<string, string>>({});
  const ids = todo.map((x) => x.r.contact_id).filter((id) => !(id in phones));
  useEffect(() => {
    if (!ids.length) return;
    supabase.from("contacts").select("id,wa_id").eq("workspace_id", ws.id).in("id", ids).then(({ data }) => {
      setPhones((p) => ({ ...p, ...Object.fromEntries((data ?? []).map((c: any) => [c.id, c.wa_id ?? ""])) }));
    });
  }, [ids.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const replied = done.filter((c) => c.replied).length, bought = done.filter((c) => c.bought).length;

  return (
    <>
      <section className="card flat">
        <div><h2>{T("Went quiet after the price", "Wamenyamaza baada ya bei")} ({todo.length})</h2>
          <span className="small muted">{T("Customers who got your price, haven't bought and haven't written for a day or more (last 14 days). Hot ones first. Ask Kito for a follow-up, send it from WhatsApp, then tap Sent.",
            "Wateja waliopata bei yako, hawajanunua na hawajaandika kwa siku moja au zaidi (siku 14 zilizopita). Wa moto kwanza. Muombe Kito ujumbe wa kufuatilia, utume kutoka WhatsApp, kisha bonyeza Nimetuma.")}</span></div>
        {todo.length === 0
          ? <div className="empty">{T("Nobody waiting on a follow-up. Customers appear here a day after they go quiet on your price.", "Hakuna anayesubiri kufuatiliwa. Wateja wanaonekana hapa siku moja baada ya kunyamaza kwenye bei yako.")}</div>
          : <div className="queue">{todo.map(({ r, quietFor }) => <QuietCard key={r.id} r={r} quietDays={Math.max(1, Math.floor(quietFor / DAY))} phone={phoneOf(phones[r.contact_id])} ws={ws} editor={editor} T={T} onDone={onChange} />)}</div>}
      </section>
      {done.length > 0 && (
        <section className="card flat">
          <div><h2>{T("Followed up", "Umewafuatilia")} ({done.length})</h2>
            <span className="small muted">{T(`Last 14 days: ${replied} replied, ${bought} bought.`, `Siku 14 zilizopita: ${replied} wamejibu, ${bought} wamenunua.`)}</span></div>
          <div className="queue">{done.map(({ r, t, replied, bought }) => (
            <div className="qitem reorder done" key={t.id}>
              <div><b>{r?.contact_name ?? T("Customer", "Mteja")}</b>
                <div className="small muted">{T("Followed up", "Ulimfuatilia")} {ago(t.completed_at)}</div></div>
              <div className="small">{bought ? <span className="chip ok">{T("Bought", "Amenunua")}</span>
                : replied ? <span className="chip">{T("Replied", "Amejibu")}</span> : <span className="chip">{T("No reply yet", "Bado hajajibu")}</span>}</div>
              <a className="small" href={"#chats/ids=" + t.conversation_id}>{T("Open chat →", "Fungua chat →")}</a>
            </div>))}
          </div>
        </section>
      )}
    </>
  );
}

function QuietCard({ r, quietDays, phone, ws, editor, T, onDone }: { r: Outcome; quietDays: number; phone: string | null; ws: Workspace; editor: boolean; T: (en: string, s: string) => string; onDone: () => void | Promise<void> }) {
  const lang = ws.language;
  // The draft survives switching tabs (and arrives even if you left while Kito was writing).
  const [d, setD] = useKept<Draft | null>("afterprice-draft:" + r.id, null);
  const [writing, setWriting] = useState(false);
  const [doing, setDoing] = useState<"" | "sent" | "skip">("");
  const [msg, setMsg] = useState("");

  async function ask() {
    setWriting(true); setMsg("");
    try {
      const x = await callFn<{ chat_lang: string; draft_sw: string; draft_en: string; why: string; missing: string[] }>("kito", { workspace_id: ws.id, action: "draft_reply", conversation_id: r.id });
      // Send in the language the customer writes in.
      setD({ text: x.chat_lang === "en" ? x.draft_en : x.draft_sw, why: x.why, missing: x.missing ?? [] });
    } catch (e) { setMsg((e as Error).message); }
    setWriting(false);
  }
  const copy = async () => { try { await navigator.clipboard.writeText(d?.text ?? ""); setMsg(T("Copied. Paste it in WhatsApp and send it yourself.", "Imenakiliwa. Bandika WhatsApp na utume mwenyewe.")); } catch { setMsg(T("Could not copy.", "Haikunakiliwa.")); } };
  async function record(status: "done" | "dismissed") {
    setDoing(status === "done" ? "sent" : "skip"); setMsg("");
    const now = new Date().toISOString();
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("follow_up_tasks").insert({
      workspace_id: ws.id, conversation_id: r.id, source: "after_price", status,
      title: T("Follow-up after the price", "Ufuatiliaji baada ya bei"), draft: d?.text ?? null, draft_source: d ? "kito" : null,
      result: status === "done" ? "called" : "not_interested", completed_at: now, due_at: now, created_by: u.user?.id ?? null,
    });
    if (error) { setDoing(""); setMsg(/check constraint/i.test(error.message) ? T("This needs the latest itaOS update. Try again in a few minutes.", "Hii inahitaji sasisho jipya. Jaribu tena baada ya dakika chache.") : error.message); return; }
    setD(null); await onDone(); setDoing("");
  }
  const waHref = phone ? `https://wa.me/${phone}${d?.text ? "?text=" + encodeURIComponent(d.text) : ""}` : null;

  return (
    <div className="qitem reorder">
      <div>
        <b>{r.contact_name ?? T("Customer", "Mteja")}</b>
        <div className="small" style={{ marginTop: 3 }}>
          <span className="chip bad">{quietDays === 1 ? T("quiet 1 day", "kimya siku 1") : T(`quiet ${quietDays} days`, `kimya siku ${quietDays}`)}</span>
          {r.kito_temp && <span className={"temp " + r.kito_temp}>{L[lang].temp[r.kito_temp]}</span>}
          {r.kito_blocker && r.kito_blocker !== "none" && <span className="chip">{L[lang].blocker[r.kito_blocker] ?? r.kito_blocker}</span>}
        </div>
        {r.kito_summary && <div className="promise-quote">{r.kito_summary}</div>}
        {r.kito_next && <div className="small muted">→ {r.kito_next}</div>}
        <a className="small" href={"#chats/ids=" + r.id}>{T("Open chat →", "Fungua chat →")}</a>
      </div>
      <div>
        <div className="draft-label">{T("Draft — not sent", "Rasimu — haijatumwa")}</div>
        <textarea value={d?.text ?? ""} disabled={!editor} onChange={(e) => setD({ text: e.target.value, why: d?.why ?? "", missing: d?.missing ?? [] })}
          placeholder={T("Ask Kito for a short follow-up based on this chat, or write your own.", "Muombe Kito ujumbe mfupi wa kufuatilia kutokana na chat hii, au andika wako.")} />
        {d?.why ? <div className="small muted">{d.why}</div> : null}
        {d?.missing?.length ? <div className="small warnt">{T("Fill in before sending:", "Jaza kabla ya kutuma:")} {d.missing.join(", ")}</div> : null}
        {editor && <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
          <button className="small" disabled={writing} onClick={ask}>{writing ? <><KitoLoader size="sm" />{T("Kito is writing…", "Kito anaandika…")}</> : d ? T("Write again", "Andika upya") : T("Ask Kito for a follow-up", "Muombe Kito ujumbe")}</button>
          <button className="small" disabled={!d?.text} onClick={copy}>{T("Copy", "Nakili")}</button>
          {waHref && <button className={"small" + (d?.text ? " primary" : "")} onClick={() => window.open(waHref, "_blank", "noopener")} title={T("Opens the chat with the message filled in. You press send.", "Inafungua chat ikiwa na ujumbe tayari. Wewe unabonyeza tuma.")}>{T("Open in WhatsApp", "Fungua WhatsApp")}</button>}
        </div>}
      </div>
      {editor && (
        <div className="promise-acts">
          <button className="small primary" disabled={!!doing} onClick={() => record("done")} title={T("You sent a follow-up from WhatsApp", "Umetuma ujumbe kutoka WhatsApp")}>{doing === "sent" && <span className="kito-spin sm" aria-hidden />}{T("Sent", "Nimetuma")}</button>
          <button className="linkish small" disabled={!!doing} onClick={() => record("dismissed")} title={T("Hide for 14 days", "Ficha kwa siku 14")}>{doing === "skip" && <span className="kito-spin sm" aria-hidden />}{T("Not now", "Si sasa")}</button>
        </div>
      )}
      {msg && <div className={"small " + (/Copied|Imenakiliwa/.test(msg) ? "ok" : "err")} style={{ gridColumn: "1 / -1" }}>{msg}</div>}
    </div>
  );
}
