// Action Centre: the follow-up queue. Surfaces chats that need a reply or a follow-up, lets
// staff assign / snooze / complete / dismiss tasks, and asks Kito for a DRAFT that a human reviews and
// sends (copy to WhatsApp, or Send from itaOS). The Today tab (Today.tsx) merges all lists into one.
import { useEffect, useMemo, useRef, useState } from "react";
import Attention from "./Attention";
import { enterCards, enterRows, usePageEnter, select } from "./motion";
import { supabase, callFn, Workspace, Outcome, Task, L, when, ago, canEdit } from "./lib";
import { KitoLoader } from "./KitoLoader";
import { PromiseList, dueBucket } from "./Promises";
import { ReorderList } from "./Reorders";
import { AfterPriceList, afterPriceCount } from "./AfterPrice";
import { avaText, DoneRow } from "./ActionBits";
import { useKept, kept, put } from "./keep";
import { TodayList, QueueCard } from "./Today";

type Member = { user_id: string; role: string; email: string };
type Hidden = { after_price: string[]; promise: string[]; reorder: string[] };
const NO_HIDDEN: Hidden = { after_price: [], promise: [], reorder: [] };
type Msg = { id: string; direction: "in" | "out"; sent_at: string; body: string | null };
type Draft = { draft_sw: string; draft_en: string; why: string; grounded_on: string[]; missing: string[]; profile_used: boolean };

const tempOf = (r: Outcome) => r.kito_temp ?? (r.warm ? "warm" : null);

export default function Actions({ ws }: { ws: Workspace }) {
  const lang = ws.language;
  const T = (en: string, sw: string) => (lang === "sw" ? sw : en);
  // Kept while the app is open: coming back to Actions shows the last list at once and refreshes it quietly.
  const K = "actions:" + ws.id;
  const [rows, setRows] = useKept<Outcome[]>(K + ":rows", []);
  const [tasks, setTasks] = useKept<Task[]>(K + ":tasks", []);
  const [members, setMembers] = useKept<Member[]>(K + ":members", []);
  const [me, setMe] = useKept<string>(K + ":me", "");
  // Customers itaOS keeps aside to measure what it adds (0068): left out of these lists and reminders only.
  const [hidden, setHidden] = useKept<Hidden>(K + ":hidden", NO_HIDDEN);
  const [loading, setLoading] = useState(!kept(K + ":loaded"));
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState<"today" | "attention" | "promises" | "after_price" | "reorders" | "queue" | "tasks" | "done">(() => (location.hash.startsWith("#attention") || location.hash.includes("tab=attention") ? "attention" : location.hash.includes("tab=queue") ? "queue" : location.hash.includes("tab=reorders") ? "reorders" : location.hash.includes("tab=after_price") ? "after_price" : location.hash.includes("tab=promises") ? "promises" : "today"));
  const [reorderCount, setReorderCount] = useKept<number | null>(K + ":reorders", null);
  useEffect(() => {
    supabase.rpc("reorder_candidates", { p_ws: ws.id }).then(({ data }) => {
      const out = new Set(hidden.reorder);
      if (Array.isArray(data)) setReorderCount(data.filter((r: { state: string; conversation_id: string }) => r.state === "todo" && !out.has(r.conversation_id)).length);
    });
  }, [ws.id, hidden.reorder.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  // Refresh quietly: after the first load the page stays on screen while new data comes in
  // (no skeleton flash). The returned promise resolves once the new data is shown, so a button
  // can keep its spinner until its card has moved.
  const waiters = useRef<(() => void)[]>([]);

  const refresh = () => new Promise<void>((res) => { waiters.current.push(res); setTick((t) => t + 1); });
  const editor = canEdit(ws);

  useEffect(() => {
    let live = true;
    if (!kept(K + ":loaded")) setLoading(true);
    setErr("");
    const since = new Date(Date.now() - 45 * 864e5).toISOString();
    Promise.all([
      supabase.from("conversation_outcomes").select("*").eq("workspace_id", ws.id).gte("last_message_at", since).order("last_message_at", { ascending: false }).limit(500),
      supabase.from("follow_up_tasks").select("*").eq("workspace_id", ws.id).order("updated_at", { ascending: false }).limit(300),
      supabase.rpc("workspace_members", { p_ws: ws.id }),
      supabase.auth.getUser(),
      // Runs the at-risk check first, so a customer kept aside never flashes up in a list. Errors (older database) hide nobody.
      supabase.rpc("atrisk_hidden", { p_ws: ws.id }),
    ]).then(([c, t, m, u, h]) => {
      if (!live) return;
      const hd: Hidden = { after_price: [], promise: [], reorder: [] };
      for (const x of (h.data as { conversation_id: string; kind: keyof Hidden }[] | null) ?? []) hd[x.kind]?.push(x.conversation_id);
      setHidden(hd);
      const e = c.error || t.error || m.error;
      if (e) setErr(e.message);
      setRows((c.data as Outcome[]) ?? []); setTasks((t.data as Task[]) ?? []); setMembers((m.data as Member[]) ?? []); setMe(u.data.user?.id ?? "");
      setLoading(false); put(K + ":loaded", true);
      const w = waiters.current; waiters.current = []; w.forEach((f) => f());
    });
    return () => { live = false; };
  }, [ws.id, tick]);

  const hideAP = useMemo(() => new Set(hidden.after_price), [hidden]);
  const hideAny = useMemo(() => new Set([...hidden.after_price, ...hidden.promise, ...hidden.reorder]), [hidden]);
  const hideReorder = useMemo(() => new Set(hidden.reorder), [hidden]);
  const rowsAP = useMemo(() => rows.filter((r) => !hideAP.has(r.id)), [rows, hideAP]);
  // A customer kept aside gets no promise card (proposed or opened by Kito) during their window; finished ones stay in history.
  const tasksShown = useMemo(() => tasks.filter((t) => !(t.source === "kito_promise" && (t.status === "proposed" || t.status === "open" || t.status === "snoozed") && hideAny.has(t.conversation_id))), [tasks, hideAny]);
  // Customer promises (Ahadi) live in their own tab; the Tasks tab keeps the other follow-ups.
  const promises = useMemo(() => tasksShown.filter((t) => t.source === "kito_promise"), [tasksShown]);
  const promiseCount = useMemo(() => promises.filter((t) => t.status === "proposed" || ((t.status === "open" || t.status === "snoozed") && dueBucket(t) !== "upcoming")).length, [promises]);
  const open = useMemo(() => tasks.filter((t) => t.source !== "kito_promise").filter((t) => t.status === "open" || (t.status === "snoozed" && (!t.snoozed_until || Date.parse(t.snoozed_until) <= Date.now()))), [tasks]);
  const snoozed = useMemo(() => tasks.filter((t) => t.source !== "kito_promise" && t.status === "snoozed" && t.snoozed_until && Date.parse(t.snoozed_until) > Date.now()), [tasks]);
  const quietCount = useMemo(() => afterPriceCount(rowsAP, tasks), [rowsAP, tasks]);
  const closed = useMemo(() => tasks.filter((t) => t.status === "done" || t.status === "dismissed").slice(0, 50), [tasks]);
  const handled = useMemo(() => new Set(tasks.filter((t) => t.status !== "done" && t.status !== "dismissed" && t.status !== "proposed" || (t.completed_at && Date.now() - Date.parse(t.completed_at) < 7 * 864e5)).map((t) => t.conversation_id)), [tasks]);

  // Eligibility rules (deterministic): not a confirmed buyer, not marked lost, not already handled.
  const queue = useMemo(() => {
    const H = ws.follow_up_hours * 3600e3;
    const now = Date.now();
    const items = rows.filter((r) => !r.not_customer && r.outcome !== "sold" && Number(r.paid_orders) === 0 && r.outcome_override !== "lost" && !handled.has(r.id))
      .map((r) => {
        const temp = tempOf(r);
        const waiting = r.last_dir === "in" && !r.last_in_closing && r.last_message_at && now - Date.parse(r.last_message_at) > 30 * 60e3;
        const stale = r.last_dir === "out" && r.last_out_at && now - Date.parse(r.last_out_at) > H && (temp === "hot" || temp === "warm");
        // Someone waiting for a reply is always shown; a follow-up nudge is not, for a customer kept aside.
        const reason: "reply" | "follow_up" | null = waiting ? "reply" : stale && !hideAny.has(r.id) ? "follow_up" : null;
        return reason ? { r, reason, temp, age: now - Date.parse((waiting ? r.last_message_at : r.last_out_at) ?? r.last_message_at ?? "") } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    const rank = (x: typeof items[number]) => (x.reason === "reply" ? 0 : 10) + (x.temp === "hot" ? 0 : x.temp === "warm" ? 1 : 2);
    return items.sort((a, b) => rank(a) - rank(b) || b.age - a.age);
  }, [rows, handled, ws.follow_up_hours, hideAny]);

  const pageRef = usePageEnter<HTMLDivElement>((root) => { if (loading) return; enterCards(select(root, ":scope > .card"), { stagger: 0.07 }); enterRows(select(root, ".pcard, .by-item"), { delay: 0.25, stagger: 0.04 }); }, [loading, tab]);

  async function createTask(r: Outcome, reason: string) {
    const { error } = await supabase.from("follow_up_tasks").insert({
      workspace_id: ws.id, conversation_id: r.id, source: "queue",
      title: reason === "reply" ? T(`Reply to ${r.contact_name ?? "customer"}`, `Mjibu ${r.contact_name ?? "mteja"}`) : T(`Follow up with ${r.contact_name ?? "customer"}`, `Mfuatilie ${r.contact_name ?? "mteja"}`),
      draft: r.kito_next ? T("Suggested next step: ", "Hatua inayopendekezwa: ") + r.kito_next : null, draft_source: r.kito_next ? "kito" : null,
      due_at: new Date().toISOString(), created_by: me,
    });
    if (error) setErr(error.code === "23505" ? T("A task already exists for this chat.", "Tayari kuna kazi ya chat hii.") : error.message); else refresh();
  }

  if (loading) return <div className="skeletons" aria-busy="true"><div className="skeleton" style={{ minHeight: 90 }} /><div className="skeleton" style={{ minHeight: 300 }} /></div>;

  return (
    <div className="shell-grid" ref={pageRef}>
      <div className="hero">
        <div style={{ display: "grid", gap: 4 }}>
          <h2>{T("Actions", "Vitendo")}</h2>
          <div className="sub"><span>{queue.length} {T("chats need attention", "chats zinahitaji hatua")}</span><span>{open.length} {T("open tasks", "kazi wazi")}</span><span>{T("follow-up rule", "kanuni")}: {ws.follow_up_hours} h <a href="#settings/rules" className="small">{T("change", "badilisha")}</a></span></div>
        </div>
        <div className="seg" role="group" aria-label="View">
          <button className={tab === "today" ? "on" : ""} onClick={() => setTab("today")}>{T("Today", "Leo")}</button>
          <button className={tab === "attention" ? "on" : ""} onClick={() => setTab("attention")}>{T("Payments & deliveries", "Malipo na usafirishaji")}</button>
          <button className={tab === "promises" ? "on" : ""} onClick={() => setTab("promises")}>{T("Promises", "Ahadi")}{promiseCount ? ` (${promiseCount})` : ""}</button>
          <button className={tab === "after_price" ? "on" : ""} onClick={() => setTab("after_price")}>{T("After price", "Baada ya bei")}{quietCount ? ` (${quietCount})` : ""}</button>
          <button className={tab === "reorders" ? "on" : ""} onClick={() => setTab("reorders")}>{T("Reorders", "Nunua tena")}{reorderCount ? ` (${reorderCount})` : ""}</button>
          <button className={tab === "queue" ? "on" : ""} onClick={() => setTab("queue")}>{T("Queue", "Foleni")} ({queue.length})</button>
          <button className={tab === "tasks" ? "on" : ""} onClick={() => setTab("tasks")}>{T("Tasks", "Kazi")} ({open.length + snoozed.length})</button>
          <button className={tab === "done" ? "on" : ""} onClick={() => setTab("done")}>{T("Done", "Zilizokamilika")}</button>
        </div>
      </div>
      {err && <p className="err">{err}</p>}
      {!editor && <p className="small muted">{T("You have a viewer role: you can see the queue but not change tasks.", "Una nafasi ya kutazama tu: unaweza kuona foleni lakini si kubadilisha kazi.")}</p>}
      <p className="small muted page-note"><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>{T("Nothing is sent without you. Ask Kito for a draft, edit it, then copy it to WhatsApp or tap Send from itaOS (an approved WhatsApp template after 24 hours).", "Hakuna kinachotumwa bila wewe. Muombe Kito rasimu, ihariri, kisha inakili WhatsApp au bonyeza Tuma kutoka itaOS (kiolezo kilichoidhinishwa na WhatsApp baada ya saa 24).")}</p>

      {tab === "attention" && <Attention ws={ws} embedded />}
      {tab === "today" && <TodayList ws={ws} rows={rowsAP} tasks={tasks} promises={promises} queue={queue} hiddenReorder={hideReorder} editor={editor} onChange={refresh} onTake={createTask} />}
      {tab === "promises" && <PromiseList tasks={tasksShown} rows={rows} ws={ws} editor={editor} onChange={refresh} />}
      {tab === "after_price" && <AfterPriceList rows={rowsAP} tasks={tasks} ws={ws} editor={editor} onChange={refresh} />}
      {tab === "reorders" && <ReorderList ws={ws} editor={editor} onCount={setReorderCount} hidden={hideReorder} />}

      {tab === "queue" && (
        <section className="card flat">
          <div><h2>{T("Needs a reply or a follow-up", "Inahitaji jibu au ufuatiliaji")}</h2><span className="small muted">{T(`Customer waiting for a reply, or a warm chat with no message from you for ${ws.follow_up_hours} hours. Buyers, lost chats and handled chats are excluded.`, `Mteja anasubiri jibu, au chat yenye nia bila ujumbe wako kwa saa ${ws.follow_up_hours}. Wanunuzi, waliopotea na zilizoshughulikiwa hazimo.`)}</span></div>
          {queue.length === 0 ? <div className="empty">{T("Nothing waiting. Nice.", "Hakuna anayesubiri. Safi.")}</div> : (
            <div className="pgrid">{queue.map((q) => <QueueCard key={q.r.id} q={q} ws={ws} editor={editor} onTake={createTask} />)}</div>
          )}
        </section>
      )}

      {tab === "tasks" && (
        <section className="card flat">
          <h2>{T("Open tasks", "Kazi zilizo wazi")}</h2>
          {open.length === 0 && snoozed.length === 0 ? <div className="empty">{T("No open tasks. Take one from the queue.", "Hakuna kazi wazi. Chukua moja kutoka foleni.")}</div> : (
            <div className="pgrid">
              {open.map((t) => <TaskCard key={t.id} t={t} r={rows.find((x) => x.id === t.conversation_id)} ws={ws} members={members} me={me} editor={editor} onChange={refresh} />)}
              {snoozed.length > 0 && <h3 style={{ gridColumn: "1 / -1", margin: "8px 0 0" }}>{T("Snoozed", "Zimeahirishwa")}</h3>}
              {snoozed.map((t) => <TaskCard key={t.id} t={t} r={rows.find((x) => x.id === t.conversation_id)} ws={ws} members={members} me={me} editor={editor} onChange={refresh} />)}
            </div>
          )}
        </section>
      )}

      {tab === "done" && (
        <section className="card by-list">
          <h2 className="by-list-h">{T("Completed and dismissed", "Zilizokamilika na zilizoondolewa")}</h2>
          {closed.length === 0 ? <div className="empty">{T("Nothing yet.", "Hakuna bado.")}</div> : closed.map((t) => {
            const r = rows.find((x) => x.id === t.conversation_id);
            const name = r?.contact_name ?? t.title;
            return <DoneRow key={t.id} seed={t.conversation_id} name={name} href={"#chats/ids=" + t.conversation_id}
              sub={`${r?.contact_name ? t.title + " · " : ""}${T("closed", "imefungwa")} ${when(t.completed_at)}`}
              right={<span className={"pill " + (t.status === "done" ? "sold" : "lost")}>{t.status === "done" ? T("Done", "Imekamilika") : T("Dismissed", "Imeondolewa")}</span>} />;
          })}
        </section>
      )}
    </div>
  );
}

export function TaskCard({ t, r, ws, members, me, editor, onChange, compact }: { t: Task; r?: Outcome; ws: Workspace; members: Member[]; me: string; editor: boolean; onChange: () => void; compact?: boolean }) {
  const lang = ws.language;
  const T = (en: string, sw: string) => (lang === "sw" ? sw : en);
  const [draft, setDraft] = useState(t.draft ?? "");
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false); // Kito is writing a draft
  const [err, setErr] = useState("");
  const [kito, setKito] = useState<Draft | null>(null);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [history, setHistory] = useState<{ action: string; at: string; details: any }[] | null>(null);
  useEffect(() => setDraft(t.draft ?? ""), [t.id, t.draft]);

  async function patch(p: Partial<Task>, okMsg?: string) {
    setBusy(true); setErr("");
    const { error } = await supabase.from("follow_up_tasks").update(p).eq("id", t.id).eq("workspace_id", ws.id);
    setBusy(false);
    if (error) setErr(error.message); else { if (okMsg) setErr(okMsg); onChange(); }
  }
  async function askKito() {
    setBusy(true); setAsking(true); setErr(""); setKito(null);
    try {
      const d = await callFn<Draft>("kito", { workspace_id: ws.id, action: "draft_reply", conversation_id: t.conversation_id });
      setKito(d);
      const text = lang === "sw" ? d.draft_sw : d.draft_en;
      setDraft(text);
      await supabase.from("follow_up_tasks").update({ draft: text, draft_source: "kito" }).eq("id", t.id).eq("workspace_id", ws.id);
      onChange();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false); setAsking(false);
  }
  async function showChat() {
    if (msgs) { setMsgs(null); return; }
    const { data } = await supabase.from("messages").select("id,direction,sent_at,body").eq("conversation_id", t.conversation_id).order("sent_at", { ascending: false }).limit(12);
    setMsgs(((data as Msg[]) ?? []).reverse());
  }
  async function showHistory() {
    if (history) { setHistory(null); return; }
    const { data } = await supabase.from("task_events").select("action,at,details").eq("task_id", t.id).order("at", { ascending: false }).limit(20);
    setHistory((data as any[]) ?? []);
  }
  const copy = async () => { try { await navigator.clipboard.writeText(draft); setErr(T("Copied. Paste it in WhatsApp and send it yourself.", "Imenakiliwa. Bandika WhatsApp na utume mwenyewe.")); } catch { setErr(T("Could not copy.", "Haikunakiliwa.")); } };
  const snoozeFor = (days: number) => patch({ status: "snoozed", snoozed_until: new Date(Date.now() + days * 864e5).toISOString() });

  const name = r?.contact_name ?? t.title;
  return (
    <div className={"pcard" + (busy ? " busy" : "")}>
      <div className="pc-head">
        <span className="pc-ava" aria-hidden>{avaText(name)}</span>
        <div className="pc-who">
          <b title={name}>{name}</b>
          <span className="small muted">{r?.contact_name ? t.title + " · " : ""}{t.status === "snoozed" ? `${T("snoozed until", "imeahirishwa hadi")} ${when(t.snoozed_until)}` : `${T("created", "imetengenezwa")} ${ago(t.created_at)}`}</span>
        </div>
        <div className="pc-chips"><span className="chip">{t.source === "queue" ? T("from queue", "kutoka foleni") : T("manual", "mkono")}</span></div>
      </div>
      {r?.kito_summary && <p className="pc-sum">{r.kito_summary}</p>}
      {!compact && <div className="small" style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <a className="pc-open" href={"#chats/ids=" + t.conversation_id}>{T("Open chat", "Fungua chat")} →</a>
        <button className="linkish small" onClick={showChat}>{msgs ? T("Hide last messages", "Ficha") : T("Last messages", "Ujumbe wa mwisho")}</button>
        <button className="linkish small" onClick={showHistory}>{history ? T("Hide history", "Ficha historia") : T("History", "Historia")}</button>
      </div>}
      {msgs && <div className="bubbles" style={{ maxHeight: 220 }}>{msgs.map((m) => <div key={m.id} className={"bub " + m.direction}><span className="t">{m.direction === "in" ? r?.contact_name ?? T("Customer", "Mteja") : ws.name} · {when(m.sent_at)}</span>{m.body ?? ""}</div>)}</div>}
      {history && <div className="evidence">{history.length === 0 ? <span className="muted">–</span> : history.map((h, i) => <span key={i}><b>{h.action}</b> · {when(h.at)} {h.details ? <span className="muted">{JSON.stringify(h.details)}</span> : null}</span>)}</div>}
      <div className="pc-foot">
        {editor && (
          <div className="pc-fields">
            <span className="small muted">{T("Assigned to", "Imepewa")}</span>
            <select className="pc-kind" value={t.assigned_to ?? ""} disabled={busy} onChange={(e) => patch({ assigned_to: e.target.value || null })}>
              <option value="">{T("nobody", "hakuna")}</option>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.email}{m.user_id === me ? T(" (me)", " (mimi)") : ""}</option>)}
            </select>
          </div>
        )}
        <div className="draft-label">{T("Draft — not sent", "Rasimu — haijatumwa")}{t.draft_source ? ` · ${t.draft_source === "kito" ? T("written by Kito", "imeandikwa na Kito") : t.draft_source === "edited" ? T("edited by you", "imehaririwa na wewe") : T("written by you", "imeandikwa na wewe")}` : ""}</div>
        <textarea value={draft} disabled={!editor || busy} onChange={(e) => setDraft(e.target.value)} placeholder={T("Write the message you plan to send, or ask Kito for a draft.", "Andika ujumbe unaopanga kutuma, au muombe Kito rasimu.")} />
        {kito && (
          <div className="evidence">
            <span><b>{T("Why", "Kwa nini")}:</b> {kito.why}</span>
            {kito.grounded_on.length > 0 && <span><b>{T("Based on", "Kwa msingi wa")}:</b> {kito.grounded_on.map((q, i) => <q key={i}>{q}</q>).reduce((a: any[], x, i) => (i ? [...a, " · ", x] : [x]), [])}</span>}
            {kito.missing.length > 0 && <span className="warnt"><b>{T("Fill in before sending", "Jaza kabla ya kutuma")}:</b> {kito.missing.join(", ")}</span>}
            {!kito.profile_used && <span className="muted">{T("No business profile yet: prices and delivery are placeholders. Add it in Settings → Business.", "Hakuna wasifu wa biashara: bei na usafirishaji ni nafasi tupu. Ongeza kwenye Mipangilio.")}</span>}
            <span className="muted">{lang === "sw" ? "English: " + kito.draft_en : "Kiswahili: " + kito.draft_sw}</span>
          </div>
        )}
        {editor && (
          <div className="pc-picks">
            <button className="pc-pick" disabled={busy} onClick={askKito}>{asking ? <><KitoLoader size="sm" />{T("Kito is writing…", "Kito anaandika…")}</> : T("Ask Kito for a draft", "Muombe Kito rasimu")}</button>
            <button className="pc-pick" disabled={busy || draft === (t.draft ?? "")} onClick={() => patch({ draft: draft || null }, T("Draft saved.", "Rasimu imehifadhiwa."))}>{T("Save draft", "Hifadhi rasimu")}</button>
            <button className="pc-pick" disabled={!draft} onClick={copy}>{T("Copy", "Nakili")}</button>
          </div>
        )}
        {editor && (
          <div className="pc-acts wrap">
            <button className="pc-pick" disabled={busy} onClick={() => patch({ status: "dismissed" })}>{T("Dismiss", "Ondoa")}</button>
            <button className="pc-pick" disabled={busy} onClick={() => snoozeFor(1)}>{T("Snooze 1 day", "Ahirisha siku 1")}</button>
            <button className="pc-pick" disabled={busy} onClick={() => snoozeFor(3)}>{T("Snooze 3 days", "Ahirisha siku 3")}</button>
            <button className="primary" disabled={busy} onClick={() => patch({ status: "done" })}>{T("Done", "Imekamilika")}</button>
          </div>
        )}
      </div>
      {err && <div className={"pc-msg small " + (/saved|Copied|Imenakiliwa|imehifadhiwa/.test(err) ? "ok" : "err")}>{err}</div>}
    </div>
  );
}
