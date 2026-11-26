// Today (Actions → Today, the default tab): ONE list of the customers worth contacting now, merged from
// the separate lists, best first, each customer once:
//   1. waiting for your reply   2. promises overdue / due today   3. promises with no clear time
//   4. went quiet after the price (hot → warm)   5. due to buy again   6. quiet after the price (cold)
// Same flag rules as the separate tabs; customers kept aside for the trial are already removed by the caller.
// The cards are the same cards as in those tabs (draft with Kito, copy, Send from itaOS, Sent / Not now).
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase, Workspace, Outcome, Task, L, ago, callFn } from "./lib";
import { WaTap } from "./WaTap";
import { KitoLoader } from "./KitoLoader";
import { errText } from "./errText";
import { phoneOf } from "./chatParts";
import { avaText } from "./ActionBits";
import { useKept } from "./keep";
import { PromiseCard, dueBucket } from "./Promises";
import { QuietCard } from "./AfterPrice";
import { ReorderCard, type ReorderRow } from "./Reorders";
import { mergeToday, type QueueItem, type Item } from "./today";
export type { QueueItem } from "./today";
import { quietAfterPrice } from "./afterPrice";
import { PayCheckCard } from "./PaymentGuard";
import type { PayItem, PayRes } from "./guards";
import { useLive } from "./live";

const DAY = 864e5;

export function TodayList({ ws, rows, tasks, promises, queue, hiddenReorder, editor, onChange, onTake }: {
  ws: Workspace; rows: Outcome[]; tasks: Task[]; promises: Task[]; queue: QueueItem[]; hiddenReorder: Set<string>;
  editor: boolean; onChange: () => void | Promise<void>; onTake: (r: Outcome, reason: string) => void;
}) {
  const lang = ws.language;
  const T = (en: string, sw: string) => (lang === "sw" ? sw : en);
  const [reorders, setReorders] = useKept<ReorderRow[] | null>("reorders:" + ws.id, null);
  const [tick, setTick] = useState(0);
  useLive(ws.id, () => setTick((t) => t + 1)); // updates by itself (live.ts)
  useEffect(() => {
    let live = true;
    supabase.rpc("reorder_candidates", { p_ws: ws.id }).then(({ data }) => { if (live && Array.isArray(data)) setReorders(data as ReorderRow[]); });
    return () => { live = false; };
  }, [ws.id, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  // Suspicious payment screenshots (Fake payment guard): checked before anything else today.
  const [pays, setPays] = useKept<PayItem[]>("todaypays:" + ws.id, []);
  useEffect(() => {
    let live = true;
    supabase.rpc("payment_checks", { p_ws: ws.id, p_days: 14 }).then(({ data, error }) => { if (live && !error && data) setPays((data as PayRes).items ?? []); });
    return () => { live = false; };
  }, [ws.id, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const quiet = useMemo(() => quietAfterPrice(rows, tasks), [rows, tasks]);
  const items = useMemo(() => mergeToday({
    queue, promises, quiet, bucket: dueBucket, payments: pays,
    reorders: (reorders ?? []).filter((x) => x.state === "todo" && !hiddenReorder.has(x.conversation_id)),
  }), [queue, promises, quiet, reorders, hiddenReorder, pays]);

  // Phone numbers for "Open in WhatsApp" on the after-price cards.
  const [phones, setPhones] = useState<Record<string, string>>({});
  const need = items.filter((i) => i.kind === "after_price").map((i) => (i as Extract<Item, { kind: "after_price" }>).r.contact_id).filter((id) => !(id in phones));
  useEffect(() => {
    if (!need.length) return;
    supabase.from("contacts").select("id,wa_id").eq("workspace_id", ws.id).in("id", need).then(({ data }) => {
      setPhones((p) => ({ ...p, ...Object.fromEntries((data ?? []).map((c: any) => [c.id, c.wa_id ?? ""])) }));
    });
  }, [need.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Progress over the last 7 days: what happened after each follow-up (a journey, not proof itaOS caused it).
  const progress = useMemo(() => {
    const since = Date.now() - 7 * DAY;
    const done = tasks.filter((t) => t.status === "done" && t.completed_at && Date.parse(t.completed_at) >= since
      && (t.source === "after_price" || t.source === "reorder" || t.source === "kito_promise" || t.source === "queue"));
    let replied = 0, bought = 0;
    for (const t of done) {
      const r = rows.find((x) => x.id === t.conversation_id);
      if (!r) continue;
      const at = Date.parse(t.completed_at!);
      if (r.last_paid_at && Date.parse(r.last_paid_at) > at) bought++;
      else if (r.last_dir === "in" && r.last_message_at && Date.parse(r.last_message_at) > at) replied++;
    }
    return { done: done.length, replied: replied + bought, bought };
  }, [tasks, rows]);

  const label: Record<Item["kind"], string> = {
    reply: T("Waiting for your reply", "Anasubiri jibu lako"), promise: T("Promise", "Ahadi"),
    after_price: T("Quiet after the price", "Kimya baada ya bei"), reorder: T("Due to buy again", "Wakati wa kununua tena"),
    payment: T("Check this payment", "Kagua malipo haya"),
  };
  const refresh = async () => { setTick((x) => x + 1); await onChange(); };

  return (
    <>
      <section className="card flat">
        <div className="today-head">
          <h2>{T("Today", "Leo")} <span className="today-n">{items.length}</span></h2>
          <span className="small muted">{T("Who to contact now, best first.", "Wa kuwasiliana nao sasa, bora kwanza.")}</span>
          {progress.done > 0 && (
            <div className="today-prog" title={T("What happened after your follow-ups in the last 7 days. Not proof itaOS caused it: see Money itaOS brought back on Home.", "Kilichotokea baada ya ufuatiliaji wako siku 7 zilizopita. Si uthibitisho kwamba itaOS ilisababisha: angalia Pesa itaOS imerudisha kwenye Home.")}>
              <span className="tp-k">{T("Last 7 days", "Siku 7")}</span>
              <span><b>{progress.done}</b> {T("followed up", "umewafuatilia")}</span>
              <span><b>{progress.replied}</b> {T("replied", "wamejibu")}</span>
              <span className="good"><b>{progress.bought}</b> {T("bought", "wamenunua")}</span>
            </div>
          )}
        </div>
        {items.length === 0
          ? <div className="empty">{T("Nobody to contact right now. New customers show up here by themselves.", "Hakuna wa kuwasiliana naye sasa. Wateja wapya wanaonekana hapa wenyewe.")}</div>
          : <div className="pgrid">{items.map((i) => (
            <div className="today-item" key={i.kind + i.id}>
              <span className={"today-why " + i.kind}>{label[i.kind]}</span>
              {i.kind === "reply" && <QueueCard q={i.q} ws={ws} editor={editor} onTake={onTake} showReason={false} onDone={refresh} />}
              {i.kind === "promise" && <PromiseCard t={i.t} r={rows.find((x) => x.id === i.t.conversation_id)} ws={ws} editor={editor} onChange={refresh} />}
              {i.kind === "after_price" && <QuietCard r={i.r} quietDays={Math.max(1, Math.floor(i.quietFor / DAY))} phone={phoneOf(phones[i.r.contact_id])} ws={ws} editor={editor} T={T} onDone={refresh} />}
              {i.kind === "reorder" && <ReorderCard r={i.x} ws={ws} editor={editor} T={T} onDone={() => { void refresh(); }} />}
              {i.kind === "payment" && <PayCheckCard it={i.p} ws={ws} editor={editor} onDone={() => { void refresh(); }} />}
            </div>
          ))}</div>}
      </section>
    </>
  );
}

/** The queue card (customer waiting / follow-up due), shared by Today and the Queue tab. */
export function QueueCard({ q, ws, editor, onTake, showReason = true, onDone }: { q: QueueItem; ws: Workspace; editor: boolean; onTake: (r: Outcome, reason: string) => void; /** Today already says why above the card */ showReason?: boolean; onDone?: () => void | Promise<void> }) {
  const lang = ws.language;
  const T = (en: string, sw: string) => (lang === "sw" ? sw : en);
  const { r, reason, temp } = q;
  const name = r.contact_name ?? T("Customer", "Mteja");
  const blocker = r.kito_blocker && r.kito_blocker !== "none" ? (L[lang].blocker[r.kito_blocker] ?? r.kito_blocker) : null;
  // Calm card (23 Nov 2026): who + when, one chip, two lines of what happened, the next step in a soft box,
  // and one row with Open chat and Take it. The stage label and the reason live in the chat, not here.
  return (
    <div className="pcard pq">
      <div className="pc-head">
        <span className="pc-ava" aria-hidden>{avaText(name)}</span>
        <div className="pc-who">
          <b title={name}>{name}</b>
          <span className="small muted">{ago(r.last_message_at)}{r.last_dir === "in" ? T(" · they wrote last", " · ameandika mwisho") : T(" · you wrote last", " · uliandika mwisho")}</span>
        </div>
        {showReason && reason === "reply" ? <span className="chip bad">{T("Waiting", "Anasubiri")}</span>
          : showReason ? <span className="chip">{T("Follow up", "Fuatilia")}</span>
          : temp ? <span className={"temp " + temp + (r.kito_temp ? "" : " guess")}>{L[lang].temp[temp as "hot"]}</span> : null}
      </div>
      {r.kito_summary ? <p className="pc-sum">{r.kito_summary}</p> : <p className="pc-sum muted">{T("Kito has not read this chat yet.", "Kito bado hajasoma chat hii.")}</p>}
      {editor && reason === "reply" && r.last_dir === "in"
        ? <ReplyDraft r={r} ws={ws} T={T} onDone={onDone} />
        : r.kito_next && <div className="pc-next"><b>{T("Next", "Fanya")}</b><span>{r.kito_next}{blocker && <em> · {blocker}</em>}</span></div>}
      <div className="pc-row">
        <a className="pc-open small" href={"#chats/ids=" + r.id}>{T("Open chat", "Fungua chat")} →</a>
        {editor && <button className="pc-take" onClick={() => onTake(r, reason)}>{T("Take it", "Chukua")}</button>}
      </div>
    </div>
  );
}

// Customer waiting (26 Nov 2026): Kito writes the reply by itself, in the customer's language, and one tap
// opens WhatsApp with it typed. A few drafts are written at a time so a long list doesn't hit the AI all at
// once. A draft is kept per customer message (localStorage), so reopening the app doesn't pay for it again;
// when the customer writes something new, Kito writes a fresh one.
const DRAFTS_AT_ONCE = 2;
let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(f: () => Promise<T>): Promise<T> {
  if (running >= DRAFTS_AT_ONCE) await new Promise<void>((ok) => waiting.push(ok));
  running++;
  try { return await f(); } finally { running--; waiting.shift()?.(); }
}
const draftKey = (r: Outcome) => "rd:" + r.id + ":" + (r.last_message_at ?? "");
function savedDraft(r: Outcome): string | null { try { return localStorage.getItem(draftKey(r)); } catch { return null; } }
function saveDraft(r: Outcome, text: string) {
  try {
    localStorage.setItem(draftKey(r), text);
    // keep storage small: drop drafts for older messages of this chat
    for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k?.startsWith("rd:" + r.id + ":") && k !== draftKey(r)) localStorage.removeItem(k); }
  } catch { /* private mode */ }
}

function ReplyDraft({ r, ws, T, onDone }: { r: Outcome; ws: Workspace; T: (en: string, sw: string) => string; onDone?: () => void | Promise<void> }) {
  const [text, setText] = useState<string>(() => savedDraft(r) ?? "");
  const [writing, setWriting] = useState(false);
  const [err, setErr] = useState("");
  const asked = useRef("");
  async function ask(force = false) {
    if (!force && (savedDraft(r) || asked.current === draftKey(r))) return;
    asked.current = draftKey(r);
    setWriting(true); setErr("");
    try {
      const d = await slot(() => callFn<{ text?: string; chat_lang?: string; draft_sw: string; draft_en: string }>("kito", { workspace_id: ws.id, action: "draft_reply", conversation_id: r.id, purpose: "reply" }));
      const t = (d.text ?? (d.chat_lang === "en" ? d.draft_en : d.draft_sw) ?? "").trim();
      setText(t); saveDraft(r, t);
    } catch (e) { setErr(errText(e)); }
    setWriting(false);
  }
  useEffect(() => { const s = savedDraft(r); if (s) setText(s); else void ask(); }, [r.id, r.last_message_at]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="pc-foot rd">
      <div className="draft-label">{T("Kito's reply, in their language. Edit if you like.", "Jibu la Kito, kwa lugha yake. Badilisha ukipenda.")}</div>
      {writing && !text
        ? <div className="rd-writing small muted"><KitoLoader size="sm" />{T("Kito is writing the reply…", "Kito anaandika jibu…")}</div>
        : <textarea value={text} rows={3} onChange={(e) => { setText(e.target.value); saveDraft(r, e.target.value); }} />}
      <div className="pc-row rd-row">
        <WaTap conversationId={r.id} draft={text} T={T} onSent={async () => { await onDone?.(); }} />
        <button className="linkish small" disabled={writing} onClick={() => void ask(true)}>{writing && text ? <span className="kito-spin sm" aria-hidden /> : null}{T("Write again", "Andika upya")}</button>
      </div>
      {err && <div className="small err">{err}</div>}
    </div>
  );
}
