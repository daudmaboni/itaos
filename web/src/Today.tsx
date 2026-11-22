// Today (Actions → Today, the default tab): ONE list of the customers worth contacting now, merged from
// the separate lists, best first, each customer once:
//   1. waiting for your reply   2. promises overdue / due today   3. promises with no clear time
//   4. went quiet after the price (hot → warm)   5. due to buy again   6. quiet after the price (cold)
// Same flag rules as the separate tabs; customers kept aside for the trial are already removed by the caller.
// The cards are the same cards as in those tabs (draft with Kito, copy, Send from itaOS, Sent / Not now).
import { useEffect, useMemo, useState } from "react";
import { supabase, Workspace, Outcome, Task, L, ago } from "./lib";
import { phoneOf } from "./chatParts";
import { avaText } from "./ActionBits";
import { useKept } from "./keep";
import { PromiseCard, dueBucket } from "./Promises";
import { QuietCard } from "./AfterPrice";
import { ReorderCard, type ReorderRow } from "./Reorders";
import { mergeToday, type QueueItem, type Item } from "./today";
export type { QueueItem } from "./today";
import { quietAfterPrice } from "./afterPrice";

const DAY = 864e5;

export function TodayList({ ws, rows, tasks, promises, queue, hiddenReorder, editor, onChange, onTake }: {
  ws: Workspace; rows: Outcome[]; tasks: Task[]; promises: Task[]; queue: QueueItem[]; hiddenReorder: Set<string>;
  editor: boolean; onChange: () => void | Promise<void>; onTake: (r: Outcome, reason: string) => void;
}) {
  const lang = ws.language;
  const T = (en: string, sw: string) => (lang === "sw" ? sw : en);
  const [reorders, setReorders] = useKept<ReorderRow[] | null>("reorders:" + ws.id, null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    supabase.rpc("reorder_candidates", { p_ws: ws.id }).then(({ data }) => { if (live && Array.isArray(data)) setReorders(data as ReorderRow[]); });
    return () => { live = false; };
  }, [ws.id, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const quiet = useMemo(() => quietAfterPrice(rows, tasks), [rows, tasks]);
  const items = useMemo(() => mergeToday({
    queue, promises, quiet, bucket: dueBucket,
    reorders: (reorders ?? []).filter((x) => x.state === "todo" && !hiddenReorder.has(x.conversation_id)),
  }), [queue, promises, quiet, reorders, hiddenReorder]);

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
  };
  const refresh = async () => { setTick((x) => x + 1); await onChange(); };

  return (
    <>
      <section className="card flat">
        <div className="row between" style={{ alignItems: "flex-start" }}>
          <div>
            <h2>{T("Today", "Leo")} ({items.length})</h2>
            <span className="small muted">{T("Everyone worth contacting now, best first, each customer once: waiting for a reply, promises that are due, quiet after the price, and past buyers due to buy again.",
              "Kila mtu anayefaa kuwasiliana naye sasa, bora kwanza, kila mteja mara moja: wanaosubiri jibu, ahadi zilizofika, kimya baada ya bei, na wanunuzi wa zamani wanaofaa kununua tena.")}</span>
          </div>
          {progress.done > 0 && (
            <span className="small today-prog" title={T("What happened after your follow-ups. Not proof itaOS caused it: see Money itaOS brought back on Home.", "Kilichotokea baada ya ufuatiliaji wako. Si uthibitisho kwamba itaOS ilisababisha: angalia Pesa itaOS imerudisha kwenye Home.")}>
              {T(`Last 7 days: ${progress.done} followed up · ${progress.replied} replied · ${progress.bought} bought`, `Siku 7: ${progress.done} umewafuatilia · ${progress.replied} wamejibu · ${progress.bought} wamenunua`)}
            </span>
          )}
        </div>
        {items.length === 0
          ? <div className="empty">{T("Nobody to contact right now. New customers show up here by themselves.", "Hakuna wa kuwasiliana naye sasa. Wateja wapya wanaonekana hapa wenyewe.")}</div>
          : <div className="pgrid">{items.map((i) => (
            <div className="today-item" key={i.kind + i.id}>
              <span className={"today-why " + i.kind}>{label[i.kind]}</span>
              {i.kind === "reply" && <QueueCard q={i.q} ws={ws} editor={editor} onTake={onTake} />}
              {i.kind === "promise" && <PromiseCard t={i.t} r={rows.find((x) => x.id === i.t.conversation_id)} ws={ws} editor={editor} onChange={refresh} />}
              {i.kind === "after_price" && <QuietCard r={i.r} quietDays={Math.max(1, Math.floor(i.quietFor / DAY))} phone={phoneOf(phones[i.r.contact_id])} ws={ws} editor={editor} T={T} onDone={refresh} />}
              {i.kind === "reorder" && <ReorderCard r={i.x} ws={ws} editor={editor} T={T} onDone={() => { void refresh(); }} />}
            </div>
          ))}</div>}
      </section>
    </>
  );
}

/** The queue card (customer waiting / follow-up due), shared by Today and the Queue tab. */
export function QueueCard({ q, ws, editor, onTake }: { q: QueueItem; ws: Workspace; editor: boolean; onTake: (r: Outcome, reason: string) => void }) {
  const lang = ws.language;
  const T = (en: string, sw: string) => (lang === "sw" ? sw : en);
  const { r, reason, temp } = q;
  const name = r.contact_name ?? T("Customer", "Mteja");
  return (
    <div className="pcard">
      <div className="pc-head">
        <span className="pc-ava" aria-hidden>{avaText(name)}</span>
        <div className="pc-who">
          <b title={name}>{name}</b>
          <span className="small muted">{T("Last message", "Ujumbe wa mwisho")} {ago(r.last_message_at)}{r.last_dir === "in" ? T(" · from customer", " · kutoka mteja") : T(" · from you", " · kutoka kwako")}</span>
        </div>
        <div className="pc-chips">
          <span className={"chip " + (reason === "reply" ? "bad" : "")}>{reason === "reply" ? T("Customer is waiting", "Mteja anasubiri") : T("Follow-up due", "Ufuatiliaji umefika")}</span>
          {temp && <span className={"temp " + temp + (r.kito_temp ? "" : " guess")}>{L[lang].temp[temp as "hot"]}</span>}
          {(r.kito_label ?? r.label) && <span className="chip">{L[lang].label[(r.kito_label ?? r.label)!]}</span>}
        </div>
      </div>
      {r.kito_summary ? <p className="pc-sum">{r.kito_summary}</p> : <p className="pc-sum muted">{T("Kito has not read this chat yet.", "Kito bado hajasoma chat hii.")}</p>}
      {r.kito_next && <div className="small muted">→ {r.kito_next}</div>}
      {r.kito_blocker && r.kito_blocker !== "none" && <div className="small muted">{T("Blocker", "Kikwazo")}: {L[lang].blocker[r.kito_blocker] ?? r.kito_blocker}</div>}
      <a className="pc-open small" href={"#chats/ids=" + r.id}>{T("Open chat", "Fungua chat")} →</a>
      {editor ? <div className="pc-foot"><div className="pc-acts"><button className="primary" onClick={() => onTake(r, reason)}>{T("Take it", "Chukua")}</button></div></div> : <div style={{ height: 6 }} />}
    </div>
  );
}
