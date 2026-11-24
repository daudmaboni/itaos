// Ahadi: customer promises Kito found in chats ("nitalipa Ijumaa", "nipigie saa kumi").
// Kito only PROPOSES; the owner confirms the day (or picks one) or dismisses. Confirmed promises ring the
// phone when due (push-send, migration 0046). itaOS never messages the customer: drafts are copied and
// sent by the owner from WhatsApp. A recorded paid order closes the chat's promises automatically.
import { errText } from "./errText";
import CopyBtn from "./CopyBtn";
import { showUndo } from "./undo";
import { useEffect, useRef, useState } from "react";
import { supabase, callFn, Workspace, Outcome, Task, ago, when } from "./lib";
import { KitoLoader } from "./KitoLoader";
import { SendNow } from "./SendNow";
import { toLocalInput, fromLocalInput } from "./Orders";
import { useBackLayer } from "./backStack";

type Kind = NonNullable<Task["kind"]>;
/** Kept vs broken per customer (promise_record, migration 0072). */
export type Record_ = { kept: number; broken: number; days: number; contacts: { contact_id: string; conversation_ids: string[]; kept: number; broken: number; name: string }[] };

function firstName(s: string | null | undefined) {
  const head = String(s ?? "").split(/[·|•,(]/)[0].trim();
  const w = head.split(/\s+/).find((x) => /^[\p{L}'’]{2,}$/u.test(x));
  return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : null;
}
/** The question for a customer who gave no clear time: asks for a day and an hour, so their answer becomes a reminder. */
export function askDayText(kind: Task["kind"], name: string | null | undefined, sw: boolean) {
  const n = firstName(name);
  const hi = sw ? (n ? `Habari ${n}` : "Habari") : (n ? `Hi ${n}` : "Hi");
  switch (kind) {
    case "call": return sw ? `${hi}, sawa kabisa 🙏 Nikupigie muda gani ukipata nafasi? Hakuna haraka.` : `${hi}, no problem 🙏 What time suits you for a call? No rush at all.`;
    case "collect": return sw ? `${hi}, karibu sana 🙏 Ukipanga siku ya kupita niambie tu, tutakuwa tumekuandalia. Hakuna haraka.` : `${hi}, you're welcome 🙏 Whenever you plan to come by, just tell me the day and we'll have it ready. No rush.`;
    default: return sw ? `${hi}, sawa kabisa 🙏 Nikutafute lini ukiwa tayari? Hakuna haraka.` : `${hi}, no problem at all 🙏 When would be a good time to check back with you? No rush.`;
  }
}
/** The soft check-in for a customer waiting for money: asks how they are, leaves the door open, never asks about paying. */
export function gentleText(name: string | null | undefined, sw: boolean) {
  const n = firstName(name);
  return sw
    ? `Habari${n ? " " + n : ""}, natumaini uko poa 🙏 Mzigo wako bado upo tayari. Ukiwa tayari niambie tu, nikuandalie. Hakuna haraka.`
    : `Hi${n ? " " + n : ""}, hope you're doing well 🙏 Your order is still here for you. Whenever you're ready, just let me know and I'll get it ready. No rush.`;
}
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

export function PromiseCard({ t, r, ws, editor, onChange, focus, rec }: { t: Task; r?: Outcome; ws: Workspace; editor: boolean; onChange: () => void | Promise<void>;
  /** Opened from the "promise due" notification: scroll here and have Kito write the message. */ focus?: boolean;
  /** This customer's promise record */ rec?: { kept: number; broken: number } }) {
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
  const [ask, setAsk] = useState(false);          // "No clear time": the question asking for a day
  const [askText, setAskText] = useState("");
  const el = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (!focus || focused.current) return;
    focused.current = true;
    el.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (!proposed && editor && !t.draft) { if (t.gentle) setDraft(gentleText(r?.contact_name, sw)); else void askKito(); }
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = r?.contact_name ?? T("Customer", "Mteja");
  const quick = (d: string) => setDue(`${d}T${kind === "call" ? "10:00" : "09:00"}`);

  // Keeps the spinner on the clicked button until the list has reloaded and this card has moved.
  async function run(which: string, p: PromiseLike<{ error: any }>, ok?: string) {
    setDoing(which); setMsg("");
    const { error } = await p;
    if (error) { setDoing(null); setMsg(errText(error)); return; }
    if (ok) setMsg(ok);
    try { await onChange(); } finally { setDoing(null); }
    // If this business has Google connected, push the change to Google Tasks now (the 5-minute job is the backup).
    callFn("google", { action: "sync", workspace_id: ws.id, only: "tasks" }).catch(() => {});
  }
  const patch = async (which: string, p: Partial<Task>, ok?: string) => {
    // Remember how the card was, so a slip can be undone (the toast puts it back).
    const before: Partial<Task> = { status: t.status, result: (t as any).result ?? null, snoozed_until: t.snoozed_until ?? null, due_at: t.due_at } as Partial<Task>;
    await run(which, supabase.from("follow_up_tasks").update(p).eq("id", t.id).eq("workspace_id", ws.id), ok);
    const said: Record<string, string> = { lost: T("Marked not interested", "Imewekwa: hana nia"), dismiss: T("Not a promise — removed", "Si ahadi — imeondolewa"), snooze: T("Moved to tomorrow", "Imehamishiwa kesho"), called: T("Marked as talked to", "Imewekwa: umeongea naye"), move: T("Moved to the new day", "Imehamishiwa siku mpya") };
    if (said[which]) showUndo(`${r?.contact_name ?? T("Customer", "Mteja")}: ${said[which]}`, async () => {
      await supabase.from("follow_up_tasks").update(before).eq("id", t.id).eq("workspace_id", ws.id);
      await onChange();
    }, T("Undo", "Rudisha"));
  };
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
    } catch (e) { setMsg(errText(e)); }
    setWriting(false);
  }

  const bucket = dueBucket(t);
  const initials = (name.replace(/[^\p{L}\s]/gu, " ").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();
  const picks: [string, string][] = [
    [T("Tomorrow", "Kesho"), eatDay(1)], [T("In 3 days", "Siku 3"), eatDay(3)],
    [T("Next week", "Wiki ijayo"), eatDay(7)], [T("End of month", "Mwisho wa mwezi"), lastOfMonth()],
  ];
  const dueDay = due.slice(0, 10);
  return (
    <div ref={el} className={"pcard" + (proposed ? " proposed" : "") + (bucket === "overdue" && !proposed ? " overdue" : "") + (busy ? " busy" : "") + (focus ? " focus" : "")}>
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
          {rec && rec.kept + rec.broken > 0 && <span className={"chip " + (rec.broken >= 2 && rec.broken > rec.kept ? "bad" : rec.kept > 0 && rec.broken === 0 ? "ok" : "")} title={T("This customer's promises in the last 90 days", "Ahadi za mteja huyu siku 90 zilizopita")}>{T(`kept ${rec.kept} · broke ${rec.broken}`, `ametimiza ${rec.kept} · amevunja ${rec.broken}`)}</span>}
          {t.gentle && !proposed && <span className="chip ok" title={T("Waiting for money: a soft check-in, never a push to pay", "Anasubiri hela: kumjulia hali tu, si kumbana alipe")}>{T("soft check-in", "kumjulia hali")}</span>}
          {proposed && t.asked_at && <span className="chip">{T("asked for a day ", "umemuuliza siku ")}{ago(t.asked_at)}</span>}
        </div>
      </div>

      {t.promise_text && (
        <div className="pc-quote">
          <span>{t.promise_text}</span>
          {t.when_text && <em className="pc-when">{t.when_text}</em>}
        </div>
      )}
      {r?.kito_summary && <p className="pc-sum">{r.kito_summary}</p>}
      <a className="pc-open small" href={"#chats/ids=" + t.conversation_id}>{T("Open chat", "Fungua chat")} →</a>

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
            {t.needs_date && (ask ? (
              <div className="pc-ask">
                <div className="draft-label">{T("A gentle question — if they answer with a day, the reminder sets itself", "Swali la upole — akijibu na siku, kikumbusho kitajiweka chenyewe")}</div>
                <textarea value={askText} onChange={(e) => setAskText(e.target.value)} />
                <div className="pc-picks">
                  <button className="pc-pick" disabled={!askText} onClick={async () => { try { await navigator.clipboard.writeText(askText); setMsg(T("Copied. Paste it in WhatsApp and send it yourself.", "Imenakiliwa. Bandika WhatsApp na utume mwenyewe.")); await supabase.from("follow_up_tasks").update({ asked_at: new Date().toISOString() }).eq("id", t.id).eq("workspace_id", ws.id); } catch { setMsg(T("Could not copy.", "Haikunakiliwa.")); } }}>{T("Copy", "Nakili")}</button>
                  <SendNow ws={ws} conversationId={t.conversation_id} purpose="promise" draft={askText} name={r?.contact_name} T={T}
                    onSent={() => { setAsk(false); patch("ask", { asked_at: new Date().toISOString() }, T("Sent. When they answer with a day, the reminder is set by itself.", "Imetumwa. Akijibu na siku, kikumbusho kitajiweka chenyewe.")); }} />
                </div>
              </div>
            ) : (
              <button className="pc-pick" type="button" onClick={() => { setAskText(askDayText(t.kind, r?.contact_name, sw)); setAsk(true); }}>{T("Ask gently when to check back", "Muulize kwa upole lini umtafute")}</button>
            ))}
            <div className="pc-acts">
              <button className="linkish small" disabled={busy} onClick={() => patch("dismiss", { status: "dismissed" })}>{spin("dismiss")}{T("Not a promise", "Si ahadi")}</button>
              <button className="primary" disabled={busy} aria-busy={doing === "remind"} onClick={confirm}>{spin("remind")}{doing === "remind" ? T("Saving…", "Inahifadhi…") : T("Remind me", "Nikumbushe")}</button>
            </div>
          </div>
        ) : null
      ) : (
        <div className="pc-foot">
          <div className="draft-label">{T("Draft — not sent", "Rasimu — haijatumwa")}</div>
          {t.gentle && <div className="small muted">{T("They're waiting for money. Check in on them, don't ask about paying — they'll come back when ready.", "Anasubiri hela. Mjulie hali tu, usimuulize kuhusu kulipa — atarudi akiwa tayari.")}</div>}
          <textarea value={draft} disabled={!editor} onChange={(e) => setDraft(e.target.value)} placeholder={t.gentle ? T("A warm check-in, no talk of paying.", "Kumjulia hali kwa upole, bila kuongelea malipo.") : T("Ask Kito for a message that mentions their promise, or write your own.", "Muombe Kito ujumbe unaotaja ahadi yake, au andika wako.")} />
          {editor && <div className="pc-picks">
            {t.gentle && <button className="pc-pick" onClick={() => setDraft(gentleText(r?.contact_name, sw))}>{T("Soft check-in message", "Ujumbe wa kumjulia hali")}</button>}
            <button className="pc-pick" disabled={writing} onClick={askKito}>{writing ? <><KitoLoader size="sm" />{T("Kito is writing…", "Kito anaandika…")}</> : T("Ask Kito for a draft", "Muombe Kito rasimu")}</button>
            <CopyBtn text={draft} T={T} />
            <SendNow ws={ws} conversationId={t.conversation_id} purpose="promise" draft={draft} name={r?.contact_name} T={T}
              onSent={(txt) => patch("called", { status: "done", result: "called", draft: txt }, T("Sent from your WhatsApp number.", "Imetumwa kutoka namba yako ya WhatsApp."))} />
          </div>}
          {moving && editor && (
            <div className="pc-fields">
              <input className="pc-date" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
              <button className="primary small" disabled={busy || !due} onClick={() => { setMoving(false); patch("move", { status: "open", due_at: fromLocalInput(due), snoozed_until: null, result: "postponed" }); }}>{spin("move")}{T("Save new day", "Hifadhi siku mpya")}</button>
            </div>
          )}
          {editor && (
            // Two outcomes up front; the rarer ones sit under "More" so the card stays calm.
            <div className="pc-acts pc-acts2">
              <details className="pc-more">
                <summary className="pc-pick">{T("More", "Zaidi")}</summary>
                <div className="pc-more-menu">
                  <button className="pc-pick" disabled={busy} onClick={() => patch("snooze", { status: "snoozed", snoozed_until: new Date(Date.now() + DAY).toISOString(), result: "no_answer" })}>{spin("snooze")}{T("No answer — tomorrow", "Hakupokea — kesho")}</button>
                  <button className="pc-pick" disabled={busy} onClick={() => setMoving((m) => !m)}>{T("Postponed…", "Ameahirisha…")}</button>
                  <button className="pc-pick" disabled={busy} onClick={() => patch("lost", { status: "dismissed", result: "not_interested" })}>{spin("lost")}{T("Not interested", "Hana nia")}</button>
                {at && <a className="pc-pick gcal" target="_blank" rel="noopener noreferrer" title={T("Opens Google Calendar with this reminder filled in. Press Save there.", "Inafungua Google Calendar ikiwa na kikumbusho hiki. Bonyeza Save huko.")}
              href={gcalUrl({
                title: `${name} — ${kindLabel(t.kind, sw)} · ${ws.name}`,
                at,
                details: [t.promise_text ? `“${t.promise_text}”` : "", r?.kito_summary ?? "", `${T("Open the chat in itaOS", "Fungua chat kwenye itaOS")}: https://itaos.app/#chats/open=${t.conversation_id}`].filter(Boolean).join("\n\n"),
              })}>
              <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18M12 14v4M10 16h4" /></svg>
              {T("Add to Google Calendar", "Weka Google Calendar")}
                </a>}
                </div>
              </details>
              <button className="pc-pick" disabled={busy} onClick={() => patch("called", { status: "done", result: "called" })}>{spin("called")}{T("Talked to them", "Nimeongea naye")}</button>
              <button className="primary" disabled={busy} onClick={() => { patch("paid", { status: "done", result: "paid" }); location.hash = "#chats/open=" + t.conversation_id; }} title={T("Opens the chat so you can record the sale", "Inafungua chat ili urekodi mauzo")}>{spin("paid")}{T("Paid → record sale", "Amelipa → rekodi mauzo")}</button>
            </div>
          )}
        </div>
      )}
      {msg && <div className={"pc-msg small " + (/Copied|Imenakiliwa|Sent|Imetumwa/.test(msg) ? "ok" : "err")}>{msg}</div>}
    </div>
  );
}

export function PromiseList({ tasks, rows, ws, editor, onChange }: { tasks: Task[]; rows: Outcome[]; ws: Workspace; editor: boolean; onChange: () => void | Promise<void> }) {
  const sw = ws.language === "sw";
  const T = (en: string, s: string) => (sw ? s : en);
  // Opened from a "promise due" notification: #actions/tab=promises&task=<id>
  const focusOf = () => /[&/?]task=([0-9a-f-]{36})/.exec(location.hash)?.[1] ?? null;
  const [focusId, setFocusId] = useState<string | null>(focusOf);
  useEffect(() => { const f = () => setFocusId(focusOf()); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  // Kept vs broken (migration 0072)
  const [rec, setRec] = useState<Record_ | null>(null);
  useEffect(() => {
    let live = true;
    supabase.rpc("promise_record", { p_ws: ws.id, p_days: 90 }).then(({ data }) => { if (live && data) setRec(data as Record_); });
    return () => { live = false; };
  }, [ws.id, tasks.length]);
  const recOf = (conv: string) => rec?.contacts.find((c) => c.conversation_ids.includes(conv));
  const breakers = (rec?.contacts ?? []).filter((c) => c.broken >= 2);
  const mine = tasks.filter((t) => t.source === "kito_promise");
  const proposed = mine.filter((t) => t.status === "proposed").sort((a, b) => Date.parse(b.promise_at ?? b.created_at) - Date.parse(a.promise_at ?? a.created_at));
  const live = mine.filter((t) => t.status === "open" || t.status === "snoozed");
  const due = (t: Task) => Date.parse((t.status === "snoozed" && t.snoozed_until) || t.due_at || "") || 0;
  // Overdue ones sit behind their own small tile; the main list is what's coming, soonest first (24 Nov 2026).
  const overdue = live.filter((t) => dueBucket(t) === "overdue").sort((x, y) => due(y) - due(x)); // most recently missed first
  const coming = live.filter((t) => dueBucket(t) !== "overdue").sort((x, y) => (due(x) || Infinity) - (due(y) || Infinity));
  const today = eatDay(0), tomorrow = eatDay(1);
  const dayOf = (t: Task) => { const at = (t.status === "snoozed" && t.snoozed_until) || t.due_at; return at ? toLocalInput(at).slice(0, 10) : ""; };
  const dayLabel = (d: string) => {
    if (!d) return T("No day set", "Hakuna siku");
    if (d === today) return T("Today", "Leo");
    if (d === tomorrow) return T("Tomorrow", "Kesho");
    return new Date(d + "T12:00:00Z").toLocaleDateString(sw ? "sw-TZ" : "en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
  };
  const byDay: [string, Task[]][] = [];
  for (const t of coming) { const d = dayOf(t); const g = byDay.find(([k]) => k === d); if (g) g[1].push(t); else byDay.push([d, [t]]); }
  const [showOverdue, setShowOverdue] = useState(false);
  useBackLayer(showOverdue, () => setShowOverdue(false)); // phone Back returns to the promise list
  const openOverdue = () => { setShowOverdue(true); requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" })); };
  const card = (t: Task) => <PromiseCard key={t.id} t={t} r={rows.find((x) => x.id === t.conversation_id)} ws={ws} editor={editor} onChange={onChange} focus={t.id === focusId} rec={recOf(t.conversation_id)} />;
  const [tab, setTab] = useState<"clear" | "unclear">(() => (location.hash.includes("promises=unclear") ? "unclear" : "clear"));
  useEffect(() => {
    const f = tasks.find((t) => t.id === focusId); if (!f) return;
    setTab(f.status === "proposed" ? "unclear" : "clear");
    if (f.status !== "proposed" && dueBucket(f) === "overdue") setShowOverdue(true); // opened from a notification for a missed day
  }, [focusId, tasks]);
  // Closed by itaOS because a payment showed up in the chat, in the last 7 days: shown so the owner can reopen a wrong one.
  const autoClosed = mine.filter((t) => t.status === "done" && t.auto_closed && t.completed_at && Date.now() - Date.parse(t.completed_at) < 7 * DAY);
  const [reopening, setReopening] = useState<string | null>(null);
  const how = (a: Task["auto_closed"]) => a === "receipt" ? T("payment screenshot / M-Pesa message", "picha ya malipo / ujumbe wa M-Pesa") : a === "customer_said_paid" ? T("customer said they paid", "mteja alisema amelipa") : T("you confirmed payment in the chat", "ulithibitisha malipo kwenye chat");
  async function reopen(t: Task) {
    setReopening(t.id);
    await supabase.from("follow_up_tasks").update({ status: "open", result: null, auto_closed: null, completed_at: null }).eq("id", t.id).eq("workspace_id", ws.id);
    setReopening(null); await onChange();
    callFn("google", { action: "sync", workspace_id: ws.id, only: "tasks" }).catch(() => {});
  }
  if (showOverdue) return (
    <section className="card flat poverdue">
      <div className="poverdue-head">
        <button type="button" className="poverdue-back" onClick={() => setShowOverdue(false)} aria-label={T("Back to promises", "Rudi kwenye ahadi")}>‹</button>
        <div><h2>{T("Overdue promises", "Ahadi zilizopita")} ({overdue.length})</h2>
          <span className="small muted">{T("Most recently missed first. Check in gently, mark them talked to, or move them to a new day.", "Zilizopita karibuni kwanza. Mjulie hali kwa upole, weka umeongea naye, au mhamishie siku mpya.")}</span></div>
      </div>
      {overdue.length === 0 ? <div className="empty">{T("All caught up. No overdue promises.", "Umemaliza zote. Hakuna ahadi zilizopita.")}</div> : <div className="pgrid">{overdue.map(card)}</div>}
    </section>
  );
  return (
    <>
      <div className="seg" role="tablist" aria-label={T("Promises", "Ahadi")}>
        <button role="tab" aria-selected={tab === "clear"} className={tab === "clear" ? "on" : ""} onClick={() => setTab("clear")}>{T("Clear time", "Muda wazi")} ({live.length})</button>
        <button role="tab" aria-selected={tab === "unclear"} className={tab === "unclear" ? "on" : ""} onClick={() => setTab("unclear")}>{T("No clear time", "Muda haujulikani")} ({proposed.length})</button>
      </div>
      {tab === "clear" ? (
        <section className="card flat">
          <div><h2>{T("Promises with a clear time", "Ahadi zenye muda wazi")} ({live.length})</h2>
            <span className="small muted">{T("Reminders itaOS set by itself, also in your Google Tasks.", "Vikumbusho itaOS imeweka yenyewe, pia kwenye Google Tasks yako.")}</span>
            <details className="act-how"><summary className="small muted">{T("How the time is picked", "Muda unavyochaguliwa")}</summary><p className="small muted">{T("itaOS set these reminders by itself and sent them to your Google Tasks. \"Baada ya saa moja\", \"saa 11 jioni\", \"17:00\": that time. A day without an hour (\"kesho\", \"Jumanne wiki ijayo\"): between 9 and 12 in the morning. \"Nasubiri hela\": a soft check-in 3 days later.", "itaOS imeweka vikumbusho hivi yenyewe na kuvituma kwenye Google Tasks yako. \"Baada ya saa moja\", \"saa 11 jioni\", \"17:00\": muda huo. Siku bila saa (\"kesho\", \"Jumanne wiki ijayo\"): kati ya saa 3 asubuhi na saa 6 mchana. \"Nasubiri hela\": kumjulia hali baada ya siku 3.")}</p></details></div>
          {rec && rec.kept + rec.broken > 0 && (
            <div className="prec">
              <span><b>{rec.kept}</b> {T("kept", "zimetimizwa")} · <b>{rec.broken}</b> {T("broken", "zimevunjwa")} <span className="muted small">({Math.round((rec.kept / (rec.kept + rec.broken)) * 100)}% {T("kept, last 90 days", "zimetimizwa, siku 90")})</span></span>
              {breakers.length > 0 && <span className="small">{T("Broke 2+ promises:", "Wamevunja ahadi 2+:")} {breakers.slice(0, 8).map((b, i) => <a key={b.contact_id} href={"#chats/open=" + b.conversation_ids[0]}>{i ? ", " : ""}{b.name} ({b.broken})</a>)}</span>}
            </div>
          )}
          <button type="button" className={"pover" + (overdue.length ? " has" : "")} disabled={!overdue.length} onClick={openOverdue}>
            <span className="pover-dot" aria-hidden />
            <span className="pover-txt">
              <b>{T("Overdue promises", "Ahadi zilizopita")}</b>
              <span className="small muted">{overdue.length ? T("The day passed and nothing happened yet. Tap to follow up.", "Siku imepita na bado hakuna kilichofanyika. Gusa ufuatilie.") : T("None — every promise is still on time.", "Hakuna — ahadi zote bado ziko kwa wakati.")}</span>
            </span>
            <span className="pover-n">{overdue.length}</span>
            {overdue.length > 0 && <span className="pover-go" aria-hidden>›</span>}
          </button>
          {coming.length === 0 ? <div className="empty">{live.length ? T("Nothing coming up. Only overdue ones are left.", "Hakuna zijazo. Zimebaki zilizopita tu.") : T("No reminders yet. When a customer names a time or a day, it shows here by itself.", "Hakuna vikumbusho bado. Mteja akitaja muda au siku, itaonekana hapa yenyewe.")}</div> : (
            <>
              <h3 className="pday-h">{T("Coming up", "Zijazo")} ({coming.length})</h3>
              {byDay.map(([d, list]) => (
                <div key={d || "none"} className="pday"><h4>{dayLabel(d)} <span className="muted">· {list.length}</span></h4><div className="pgrid">{list.map(card)}</div></div>
              ))}
            </>
          )}
          {autoClosed.length > 0 && (
            <div className="pclosed">
              <h3>{T("Closed by itaOS: looks paid", "Zimefungwa na itaOS: zinaonekana zimelipwa")} ({autoClosed.length})</h3>
              <span className="small muted">{T("A payment showed up in the chat after the promise, so the reminder was cancelled (Google Tasks too). Wrong? Reopen it.", "Malipo yalionekana kwenye chat baada ya ahadi, kwa hiyo kikumbusho kimefutwa (na Google Tasks). Si sahihi? Kifungue tena.")}</span>
              {autoClosed.map((t) => {
                const r = rows.find((x) => x.id === t.conversation_id);
                return (
                  <div className="prow" key={t.id}>
                    <a href={"#chats/open=" + t.conversation_id}><b>{r?.contact_name ?? T("Customer", "Mteja")}</b> <span className="small muted">· {how(t.auto_closed)} · {ago(t.completed_at)}</span></a>
                    {editor && <button className="pc-pick" disabled={reopening === t.id} onClick={() => reopen(t)}>{reopening === t.id ? T("Reopening…", "Inafungua…") : T("Not paid — reopen", "Hajalipa — fungua tena")}</button>}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <section className="card flat">
          <div><h2>{T("Promises with no clear time", "Ahadi zisizo na muda wazi")} ({proposed.length})</h2>
            <span className="small muted">{T("The customer didn't say when (\"nitakujulisha\", \"nikipata mshahara\", \"baadae\"). Pick a day to get a reminder, or dismiss it.", "Mteja hakusema lini (\"nitakujulisha\", \"nikipata mshahara\", \"baadae\"). Chagua siku upate kikumbusho, au iondoe.")}</span></div>
          {proposed.length === 0 ? <div className="empty">{T("Nothing here. Kito checks every chat that gets a new message.", "Hakuna kitu hapa. Kito anaangalia kila chat inayopata ujumbe mpya.")}</div>
            : <div className="pgrid">{proposed.map(card)}</div>}
        </section>
      )}
    </>
  );
}
