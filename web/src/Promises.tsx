// Ahadi: customer promises Kito found in chats ("nitalipa Ijumaa", "nipigie saa kumi").
// Kito only PROPOSES; the owner confirms the day (or picks one) or dismisses. Confirmed promises ring the
// phone when due (push-send, migration 0046). itaOS never messages the customer: drafts are copied and
// sent by the owner from WhatsApp. A recorded paid order closes the chat's promises automatically.
import { useEffect, useState } from "react";
import { supabase, callFn, Workspace, Outcome, Task, ago, when } from "./lib";
import { KitoLoader } from "./KitoLoader";
import { toLocalInput, fromLocalInput } from "./Orders";

type Kind = NonNullable<Task["kind"]>;
const KINDS: Kind[] = ["pay", "call", "collect", "come_back", "other"];
const DAY = 864e5;

export function kindLabel(k: Task["kind"], sw: boolean) {
  switch (k) {
    case "pay": return sw ? "Atalipa" : "Will pay";
    case "call": return sw ? "Apigiwe simu" : "Call them";
    case "collect": return sw ? "Atachukua / atapita" : "Will collect";
    case "come_back": return sw ? "Atarudi" : "Will come back";
    default: return sw ? "Ahadi" : "Promise";
  }
}

/** "YYYY-MM-DD" in East Africa time, `days` from today. */
const eatDay = (days: number, from = Date.now()) => toLocalInput(new Date(from + days * DAY).toISOString()).slice(0, 10);
const lastOfMonth = () => {
  const [y, m] = eatDay(0).split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** When a task is due, as East Africa dates: "overdue" | "today" | "upcoming". */
export function dueBucket(t: Task, now = Date.now()): "overdue" | "today" | "upcoming" | "undated" {
  const at = t.status === "snoozed" && t.snoozed_until ? t.snoozed_until : t.due_at;
  if (!at) return "undated";
  const d = toLocalInput(at).slice(0, 10), today = eatDay(0, now);
  return d < today ? "overdue" : d === today ? "today" : "upcoming";
}

/** Google Calendar "add event" link, filled in: no Google login on our side, the owner just presses Save.
 *  30 minutes at the promise time, with what the customer said and a link back to the chat. */
export function gcalUrl(o: { title: string; at: string; details: string }) {
  const start = new Date(o.at), end = new Date(start.getTime() + 30 * 60e3);
  const z = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const q = new URLSearchParams({ action: "TEMPLATE", text: o.title, dates: `${z(start)}/${z(end)}`, details: o.details, ctz: "Africa/Dar_es_Salaam" });
  return "https://calendar.google.com/calendar/render?" + q.toString();
}

export function PromiseCard({ t, r, ws, editor, onChange }: { t: Task; r?: Outcome; ws: Workspace; editor: boolean; onChange: () => void | Promise<void> }) {
  const sw = ws.language === "sw";
  const T = (en: string, s: string) => (sw ? s : en);
  const proposed = t.status === "proposed";
  const at = t.status === "snoozed" && t.snoozed_until ? t.snoozed_until : t.due_at;
  const [due, setDue] = useState(at ? toLocalInput(at) : "");
  const [kind, setKind] = useState<Kind>(t.kind ?? "other");
  const [doing, setDoing] = useState<string | null>(null);   // which button is working (shows the spinner)
  const busy = doing !== null;
  const [msg, setMsg] = useState("");
  const [moving, setMoving] = useState(false);   // "Postponed": pick the new day
  const [draft, setDraft] = useState(t.draft ?? "");
  const [writing, setWriting] = useState(false);
  useEffect(() => { setDue(at ? toLocalInput(at) : ""); setKind(t.kind ?? "other"); setDraft(t.draft ?? ""); }, [t.id, at, t.kind, t.draft]);

  const name = r?.contact_name ?? T("Customer", "Mteja");
  const quick = (d: string) => setDue(`${d}T${kind === "call" ? "10:00" : "09:00"}`);

  // Keeps the spinner on the clicked button until the list has reloaded and this card has moved.
  async function run(which: string, p: PromiseLike<{ error: any }>, ok?: string) {
    setDoing(which); setMsg("");
    const { error } = await p;
    if (error) { setDoing(null); setMsg(error.message); return; }
    if (ok) setMsg(ok);
    try { await onChange(); } finally { setDoing(null); }
    // If this business has Google connected, push the change to Google Tasks now (the 5-minute job is the backup).
    callFn("google", { action: "sync", workspace_id: ws.id, only: "tasks" }).catch(() => {});
  }
  const patch = (which: string, p: Partial<Task>, ok?: string) => run(which, supabase.from("follow_up_tasks").update(p).eq("id", t.id).eq("workspace_id", ws.id), ok);
  const confirm = () => {
    if (!due) { setMsg(T("Pick a day first.", "Chagua siku kwanza.")); return; }
    return run("remind", supabase.rpc("confirm_promise", { p_task: t.id, p_due: fromLocalInput(due), p_kind: kind }));
  };
  const spin = (which: string) => doing === which && <span className="kito-spin sm" aria-hidden />;
  async function askKito() {
    setWriting(true); setMsg("");
    try {
      const d = await callFn<{ draft_sw: string; draft_en: string }>("kito", { workspace_id: ws.id, action: "draft_reply", conversation_id: t.conversation_id });
      const text = sw ? d.draft_sw : d.draft_en;
      setDraft(text);
      await supabase.from("follow_up_tasks").update({ draft: text, draft_source: "kito" }).eq("id", t.id).eq("workspace_id", ws.id);
    } catch (e) { setMsg((e as Error).message); }
    setWriting(false);
  }
  const copy = async () => { try { await navigator.clipboard.writeText(draft); setMsg(T("Copied. Paste it in WhatsApp and send it yourself.", "Imenakiliwa. Bandika WhatsApp na utume mwenyewe.")); } catch { setMsg(T("Could not copy.", "Haikunakiliwa.")); } };

  const bucket = dueBucket(t);
  const initials = (name.replace(/[^\p{L}\s]/gu, " ").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();
  const picks: [string, string][] = [
    [T("Tomorrow", "Kesho"), eatDay(1)], [T("In 3 days", "Siku 3"), eatDay(3)],
    [T("Next week", "Wiki ijayo"), eatDay(7)], [T("End of month", "Mwisho wa mwezi"), lastOfMonth()],
  ];
  const dueDay = due.slice(0, 10);
  return (
    <div className={"pcard" + (proposed ? " proposed" : "") + (bucket === "overdue" && !proposed ? " overdue" : "") + (busy ? " busy" : "")}>
      <div className="pc-head">
        <span className="pc-ava" aria-hidden>{initials}</span>
        <div className="pc-who">
          <b title={name}>{name}</b>
          <span className="small muted">{T("said", "alisema")} {ago(t.promise_at ?? t.created_at)}</span>
        </div>
        <div className="pc-chips">
          {!proposed && <span className="chip">{kindLabel(t.kind, sw)}</span>}
          {!proposed && at && <span className={"chip " + (bucket === "overdue" ? "bad" : bucket === "today" ? "ok" : "")}>{bucket === "overdue" ? T("overdue · ", "imepita · ") : bucket === "today" ? T("today · ", "leo · ") : ""}{when(at)}</span>}
          {t.result === "no_answer" && <span className="chip">{T("no answer last time", "hakupokea mara iliyopita")}</span>}
          {t.result === "postponed" && <span className="chip">{T("postponed", "ameahirisha")}</span>}
        </div>
      </div>

      {t.promise_text && (
        <div className="pc-quote">
          <span>{t.promise_text}</span>
          {t.when_text && <em className="pc-when">{t.when_text}</em>}
        </div>
      )}
      {r?.kito_summary && <p className="pc-sum">{r.kito_summary}</p>}
      <a className="pc-open small" href={"#chats/open=" + t.conversation_id}>{T("Open chat", "Fungua chat")} →</a>

      {proposed ? (
        editor ? (
          <div className="pc-foot">
            <div className="pc-q">
              {t.needs_date ? T("When should itaOS remind you?", "itaOS ikukumbushe lini?") : T("Kito read this day. Fix it if it's wrong.", "Kito amesoma siku hii. Rekebisha kama si sahihi.")}
            </div>
            <div className="pc-picks" role="group">
              {picks.map(([label, d]) => (
                <button key={label} type="button" className={"pc-pick" + (dueDay === d ? " on" : "")} aria-pressed={dueDay === d} onClick={() => quick(d)}>{label}</button>
              ))}
            </div>
            <div className="pc-fields">
              <input className="pc-date" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} aria-label={T("Day and time", "Siku na saa")} />
              <select className="pc-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label={T("Type", "Aina")}>{KINDS.map((k) => <option key={k} value={k}>{kindLabel(k, sw)}</option>)}</select>
            </div>
            <div className="pc-acts">
              <button className="linkish small" disabled={busy} onClick={() => patch("dismiss", { status: "dismissed" })}>{spin("dismiss")}{T("Not a promise", "Si ahadi")}</button>
              <button className="primary" disabled={busy} aria-busy={doing === "remind"} onClick={confirm}>{spin("remind")}{doing === "remind" ? T("Saving…", "Inahifadhi…") : T("Remind me", "Nikumbushe")}</button>
            </div>
          </div>
        ) : null
      ) : (
        <div className="pc-foot">
          <div className="draft-label">{T("Draft — not sent", "Rasimu — haijatumwa")}</div>
          <textarea value={draft} disabled={!editor} onChange={(e) => setDraft(e.target.value)} placeholder={T("Ask Kito for a message that mentions their promise, or write your own.", "Muombe Kito ujumbe unaotaja ahadi yake, au andika wako.")} />
          {editor && <div className="pc-picks">
            <button className="pc-pick" disabled={writing} onClick={askKito}>{writing ? <><KitoLoader size="sm" />{T("Kito is writing…", "Kito anaandika…")}</> : T("Ask Kito for a draft", "Muombe Kito rasimu")}</button>
            <button className="pc-pick" disabled={!draft} onClick={copy}>{T("Copy", "Nakili")}</button>
            {at && <a className="pc-pick gcal" target="_blank" rel="noopener noreferrer" title={T("Opens Google Calendar with this reminder filled in. Press Save there.", "Inafungua Google Calendar ikiwa na kikumbusho hiki. Bonyeza Save huko.")}
              href={gcalUrl({
                title: `${name} — ${kindLabel(t.kind, sw)} · ${ws.name}`,
                at,
                details: [t.promise_text ? `“${t.promise_text}”` : "", r?.kito_summary ?? "", `${T("Open the chat in itaOS", "Fungua chat kwenye itaOS")}: https://itaos.app/#chats/open=${t.conversation_id}`].filter(Boolean).join("\n\n"),
              })}>
              <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18M12 14v4M10 16h4" /></svg>
              {T("Add to Google Calendar", "Weka Google Calendar")}
            </a>}
          </div>}
          {moving && editor && (
            <div className="pc-fields">
              <input className="pc-date" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
              <button className="primary small" disabled={busy || !due} onClick={() => { setMoving(false); patch("move", { status: "open", due_at: fromLocalInput(due), snoozed_until: null, result: "postponed" }); }}>{spin("move")}{T("Save new day", "Hifadhi siku mpya")}</button>
            </div>
          )}
          {editor && (
            <div className="pc-acts wrap">
              <button className="pc-pick" disabled={busy} onClick={() => patch("lost", { status: "dismissed", result: "not_interested" })}>{spin("lost")}{T("Not interested", "Hana nia")}</button>
              <button className="pc-pick" disabled={busy} onClick={() => setMoving((m) => !m)}>{T("Postponed…", "Ameahirisha…")}</button>
              <button className="pc-pick" disabled={busy} onClick={() => patch("snooze", { status: "snoozed", snoozed_until: new Date(Date.now() + DAY).toISOString(), result: "no_answer" })}>{spin("snooze")}{T("No answer — tomorrow", "Hakupokea — kesho")}</button>
              <button className="pc-pick" disabled={busy} onClick={() => patch("called", { status: "done", result: "called" })}>{spin("called")}{T("Talked to them", "Nimeongea naye")}</button>
              <button className="primary" disabled={busy} onClick={() => { patch("paid", { status: "done", result: "paid" }); location.hash = "#chats/open=" + t.conversation_id; }} title={T("Opens the chat so you can record the sale", "Inafungua chat ili urekodi mauzo")}>{spin("paid")}{T("Paid → record sale", "Amelipa → rekodi mauzo")}</button>
            </div>
          )}
        </div>
      )}
      {msg && <div className={"pc-msg small " + (/Copied|Imenakiliwa/.test(msg) ? "ok" : "err")}>{msg}</div>}
    </div>
  );
}

export function PromiseList({ tasks, rows, ws, editor, onChange }: { tasks: Task[]; rows: Outcome[]; ws: Workspace; editor: boolean; onChange: () => void | Promise<void> }) {
  const sw = ws.language === "sw";
  const T = (en: string, s: string) => (sw ? s : en);
  const mine = tasks.filter((t) => t.source === "kito_promise");
  const proposed = mine.filter((t) => t.status === "proposed").sort((a, b) => Date.parse(b.promise_at ?? b.created_at) - Date.parse(a.promise_at ?? a.created_at));
  const live = mine.filter((t) => t.status === "open" || t.status === "snoozed");
  const due = (t: Task) => Date.parse((t.status === "snoozed" && t.snoozed_until) || t.due_at || "") || 0;
  const by = (b: ReturnType<typeof dueBucket>) => live.filter((t) => dueBucket(t) === b).sort((x, y) => due(x) - due(y));
  const groups: [string, Task[]][] = [
    [T("Overdue", "Zimepita"), by("overdue")],
    [T("Due today", "Leo"), by("today")],
    [T("Coming up", "Zijazo"), by("upcoming")],
  ];
  const card = (t: Task) => <PromiseCard key={t.id} t={t} r={rows.find((x) => x.id === t.conversation_id)} ws={ws} editor={editor} onChange={onChange} />;
  return (
    <>
      <section className="card flat">
        <div><h2>{T("Kito found these promises", "Kito amepata ahadi hizi")} ({proposed.length})</h2>
          <span className="small muted">{T("Customers who said when they'll pay, call or come. Confirm the day and itaOS reminds you on your phone, or dismiss it.", "Wateja waliosema lini watalipa, wapigiwe au watakuja. Thibitisha siku na itaOS itakukumbusha kwenye simu, au iondoe.")}</span></div>
        {proposed.length === 0 ? <div className="empty">{T("Nothing new. Kito checks every chat that gets a new message.", "Hakuna mpya. Kito anaangalia kila chat inayopata ujumbe mpya.")}</div>
          : <div className="pgrid">{proposed.map(card)}</div>}
      </section>
      <section className="card flat">
        <div><h2>{T("Your reminders", "Vikumbusho vyako")} ({live.length})</h2></div>
        {live.length === 0 ? <div className="empty">{T("No confirmed promises yet.", "Hakuna ahadi zilizothibitishwa bado.")}</div> : groups.map(([label, list]) => list.length > 0 && (
          <div key={label}><h3>{label} ({list.length})</h3><div className="pgrid">{list.map(card)}</div></div>
        ))}
      </section>
    </>
  );
}
