// Ask Kito: any question about the business, in Kiswahili or English. Kito answers from the
// workspace's own data and shows the chats, ads and numbers behind the answer, with buttons to act.
// Kito never sends WhatsApp messages. It can PREPARE a chat delete; only the owner's click runs it.
import { useEffect, useRef, useState } from "react";
import { enterCards, usePageEnter, select } from "./motion";
import { supabase, callFn, Workspace, L, ago, money, fmt, canEdit } from "./lib";
import { KitoLogo } from "./Logo";
import { KitoLoader } from "./KitoLoader";
import { useKept } from "./keep";

type ChatItem = {
  chat_id: string; name: string | null; wa_id: string | null; last_message_at: string | null; last_dir: "in" | "out" | null;
  outcome: string | null; label: string | null; temp: "hot" | "warm" | "cold" | null; blocker: string | null; summary: string | null; next: string | null;
  payment_details_sent: boolean; payment_signal: boolean; paid_orders: number; paid_amount: number | null; why: string | null;
};
type AdItem = { ad_id: string; name: string; campaign: string | null; spend_30d: number; chats_30d: number; priced_30d: number; sales_30d: number; revenue_30d: number; cost_per_sale_30d: number | null; why: string | null };
type Block =
  | { kind: "chats"; title: string; items: ChatItem[] }
  | { kind: "ads"; title: string; items: AdItem[]; spend_currency?: string }
  | { kind: "table"; title: string; columns: string[]; labels: string[]; rows: unknown[][]; total: number; chat_ids?: string[] }
  | { kind: "stats"; title: string; items: { label: string; value: unknown }[] }
  | { kind: "delete_chats"; title: string; chat_ids: string[]; count: number; by_origin: Record<string, number>; messages: number; with_orders: number;
      sample: { name: string | null; origin: string; last_message_at: string | null }[]; allowed: boolean; request: string };
type Query = { purpose: string; sql: string; rows: number; error: string | null };
// What Kito is doing while it works: a spinner, steps that move along, and a seconds counter,
// so a 10–30 second answer never looks like the page froze.
const STEPS_EN = ["Reading your question", "Searching your chats and orders", "Checking the numbers", "Writing the answer"];
const STEPS_SW = ["Anasoma swali lako", "Anatafuta kwenye chat na oda zako", "Anakagua namba", "Anaandika jibu"];
export function KitoThinking({ sw }: { sw: boolean }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => { const id = setInterval(() => setSecs((x) => x + 1), 1000); return () => clearInterval(id); }, []);
  const steps = sw ? STEPS_SW : STEPS_EN;
  const at = secs < 2 ? 0 : secs < 7 ? 1 : secs < 14 ? 2 : 3; // the last step stays until the answer lands
  return (
    <div className="card kito-thinking" role="status" aria-live="polite">
      <div className="kito-thinking-head">
        <KitoLoader />
        <div>
          <b>{sw ? "Kito anapitia data yako…" : "Kito is looking through your data…"}</b>
          <span className="small muted">{secs}s{secs >= 25 ? (sw ? " · maswali makubwa huchukua hadi dakika moja" : " · big questions can take up to a minute") : ""}</span>
        </div>
      </div>
      <ol className="kito-steps">
        {steps.map((label, i) => (
          <li key={label} className={i < at ? "done" : i === at ? "on" : ""}>
            <i aria-hidden>{i < at ? "✓" : ""}</i>{label}{i === at ? "…" : ""}
          </li>
        ))}
      </ol>
      <div className="kito-bar" aria-hidden><span /></div>
    </div>
  );
}

export type Answer = { id: string | null; created_at: string; question: string; answer: string; blocks: Block[]; caveats: string[]; follow_ups: string[]; queries: Query[] };
type Turn = { question: string; answer?: Answer; error?: string; pending?: boolean };

const SUGGEST = {
  en: [
    "Who did I send Lipa namba to but hasn't paid?",
    "Which ads are bringing paying customers this month?",
    "What do customers who paid have in common?",
    "Which hot chats are waiting for our reply?",
    "Why do people go quiet after the price?",
    "How much did we sell this week compared to last week?",
  ],
  sw: [
    "Nani nilimtumia Lipa namba lakini hajalipa?",
    "Matangazo gani yanaleta wateja wanaolipa mwezi huu?",
    "Wateja waliolipa wanafanana kwa nini?",
    "Chat zipi za moto zinasubiri tuwajibu?",
    "Kwa nini watu wanakaa kimya baada ya bei?",
    "Tumeuza kiasi gani wiki hii ukilinganisha na wiki iliyopita?",
  ],
};

// One icon and colour per suggestion, in the same order as SUGGEST (both languages).
const SUGGEST_LOOK: { tone: string; d: string }[] = [
  { tone: "amber", d: "M3 7h18v10H3zM3 11h18M7 15h3" },                       // Lipa namba sent, not paid
  { tone: "blue", d: "M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1ZM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12" }, // ads
  { tone: "green", d: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM22 19v-1a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8" }, // customers who paid
  { tone: "red", d: "M12 3c1 3 4 4.5 4 9a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 0-8Z" }, // hot chats
  { tone: "violet", d: "M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12ZM9 12h.01M12 12h.01M15 12h.01" }, // quiet after price
  { tone: "teal", d: "M3 20h18M6 16v-5M11 16V8M16 16v-8M21 4l-5 4-4-2-6 4" },   // this week vs last
];

// staff = Pondi platform admin. Only staff see "How Kito found this" (the raw database queries): business
// owners get the answer, the tables and the chats behind it, never SQL (21 Nov 2026).
export default function Kito({ ws, staff = false }: { ws: Workspace; staff?: boolean }) {
  const lang = ws.language;
  const T = (en: string, sw: string) => (lang === "sw" ? sw : en);
  // Kept while the app is open: switching tabs mid-answer no longer loses the conversation, and an
  // answer that arrives while you're on another tab is waiting when you come back.
  const [turns, setTurns] = useKept<Turn[]>("kito:turns:" + ws.id, []);
  const [q, setQ] = useKept("kito:q:" + ws.id, "");
  const [recent, setRecent] = useKept<Answer[]>("kito:recent:" + ws.id, []);
  const [showAll, setShowAll] = useState(false);
  // The same question asked twice shows once (the newest answer).
  const recentList = recent.filter((r, i) => recent.findIndex((x) => x.question.trim().toLowerCase() === r.question.trim().toLowerCase()) === i);
  const busy = turns.some((t) => t.pending);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pageRef = usePageEnter<HTMLDivElement>((root) => { enterCards(select(root, ":scope > .card")); }, []);

  useEffect(() => {
    supabase.from("kito_asks").select("id,created_at,question,answer,queries").eq("workspace_id", ws.id).not("answer", "is", null)
      .order("created_at", { ascending: false }).limit(15)
      .then(({ data }) => setRecent((data ?? []).map((r: any) => ({ id: r.id, created_at: r.created_at, question: r.question, queries: r.queries ?? [], ...r.answer }))));
  }, [ws.id]);

  useEffect(() => { if (turns.length) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turns]);

  // Floating Ask bar: slides away while you scroll down (more room to read), comes back the moment you
  // scroll up, at the top, or at the bottom of the page. Never hides while you're typing or Kito is thinking.
  const [barHidden, setBarHidden] = useState(false);
  const keepBar = useRef(false);
  keepBar.current = busy || q.trim().length > 0;
  useEffect(() => {
    let last = window.scrollY, ticking = false;
    const run = () => {
      ticking = false;
      const y = window.scrollY, dy = y - last;
      const atBottom = y + window.innerHeight >= document.documentElement.scrollHeight - 48;
      const typing = document.activeElement === inputRef.current;
      if (keepBar.current || typing || y < 60 || atBottom) setBarHidden(false);
      else if (dy > 6) setBarHidden(true);
      else if (dy < -6) setBarHidden(false);
      if (Math.abs(dy) > 6 || y < 60) last = y;
    };
    const on = () => { if (!ticking) { ticking = true; requestAnimationFrame(run); } };
    addEventListener("scroll", on, { passive: true });
    return () => removeEventListener("scroll", on);
  }, []);
  useEffect(() => { if (busy) setBarHidden(false); }, [busy]);

  // One line that grows as you type (up to ~5 lines).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 132) + "px";
    el.style.overflowY = el.scrollHeight > 132 ? "auto" : "hidden"; // no stray scrollbar on a short question
  }, [q]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setQ("");
    const history = turns.filter((t) => t.answer).slice(-4).map((t) => ({ question: t.question, answer: t.answer!.answer }));
    setTurns((ts) => [...ts, { question: text, pending: true }]);
    try {
      const a = await callFn<Answer>("kito-ask", { workspace_id: ws.id, question: text, history });
      setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { question: text, answer: a } : t)));
      setRecent((r) => [a, ...r.filter((x) => x.id !== a.id)].slice(0, 15));
    } catch (e) {
      setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { question: text, error: (e as Error).message } : t)));
    }
    inputRef.current?.focus();
  }

  return (
    <div className="shell-grid" ref={pageRef}>
      <div className="hero">
        <div className="kito-hero">
          <KitoLogo size={52} title="Kito" />
          <div>
          <h2>{T("Ask Kito", "Muulize Kito")}</h2>
          <div className="sub"><span>{T("Ask anything about your chats, customers, ads and sales. Kito answers from your own data.", "Uliza chochote kuhusu chat, wateja, matangazo na mauzo yako. Kito anajibu kutoka kwenye data yako.")}</span></div>
        </div>
        </div>
        {turns.length > 0 && <button className="small" onClick={() => setTurns([])} disabled={busy}>{T("New conversation", "Mazungumzo mapya")}</button>}
      </div>

      {turns.length === 0 && (
        <div className="kito-start">
          <div className="kito-sec">{T("Try asking", "Jaribu kuuliza")}</div>
          <div className="kito-suggest">
            {SUGGEST[lang].map((s, i) => (
              <button key={s} type="button" className={"kito-sg tone-" + SUGGEST_LOOK[i].tone} onClick={() => ask(s)}>
                <span className="kito-sg-ico" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={SUGGEST_LOOK[i].d} /></svg></span>
                <span className="kito-sg-text">{s}</span>
                <span className="kito-sg-go" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
              </button>
            ))}
          </div>
          {recentList.length > 0 && (<>
            <div className="kito-sec">{T("Your recent questions", "Maswali yako ya karibuni")}</div>
            <div className="kito-recent">
              {(showAll ? recentList : recentList.slice(0, 5)).map((r) => (
                <button key={r.id ?? r.created_at} type="button" className="kito-recent-item" onClick={() => setTurns([{ question: r.question, answer: r }])}>
                  <span className="kito-rc-ico" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" /></svg></span>
                  <span className="kito-rc-q">{r.question}</span>
                  <span className="kito-rc-when">{ago(r.created_at)}</span>
                </button>
              ))}
              {recentList.length > 5 && (
                <button type="button" className="kito-rc-more" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? T("Show fewer", "Onyesha machache") : T(`Show all ${recentList.length}`, `Onyesha yote ${recentList.length}`)}
                </button>
              )}
            </div>
          </>)}
        </div>
      )}

      {turns.map((t, i) => (
        <div key={i} className="kito-turn">
          <div className="kito-q">{t.question}</div>
          {t.pending && <KitoThinking sw={lang === "sw"} />}
          {t.error && <div className="card"><p className="err" style={{ margin: 0 }}>{t.error}</p></div>}
          {t.answer && <AnswerCard a={t.answer} ws={ws} onAsk={ask} staff={staff} stale={!!t.answer.id && i === 0 && turns.length === 1 && Date.now() - Date.parse(t.answer.created_at) > 3600e3} />}
        </div>
      ))}
      <div ref={endRef} />

      <form className={"kito-ask" + (barHidden ? " away" : "") + (busy ? " busy" : "")} aria-hidden={barHidden || undefined}
        onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <span className="kito-ask-mark"><KitoLogo size={34} compact /></span>
        <textarea ref={inputRef} rows={1} value={q} maxLength={1500} disabled={busy} tabIndex={barHidden ? -1 : undefined}
          aria-label={T("Ask Kito", "Muulize Kito")}
          placeholder={busy ? T("Kito is thinking…", "Kito anafikiri…") : T("Ask Kito anything…", "Muulize Kito chochote…")}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(q); } }} />
        <button type="submit" className="kito-ask-go" tabIndex={barHidden ? -1 : undefined} disabled={busy || q.trim().length < 2} aria-label={T("Ask", "Uliza")}>
          {busy ? <KitoLoader size="sm" /> : <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>}
        </button>
      </form>
      <p className="small muted" style={{ margin: 0 }}>{T("Kito reads your data and never sends messages. It can prepare a delete, but nothing is deleted until you press Delete. Confirmed sales come from recorded orders only.", "Kito anasoma data yako na hatumi ujumbe. Anaweza kuandaa kufuta, lakini hakuna kinachofutwa mpaka ubonyeze Futa. Mauzo yaliyothibitishwa ni oda zilizorekodiwa tu.")}</p>
    </div>
  );
}

function AnswerCard({ a, ws, onAsk, stale, staff }: { a: Answer; ws: Workspace; onAsk: (q: string) => void; stale: boolean; staff: boolean }) {
  const T = (en: string, sw: string) => (ws.language === "sw" ? sw : en);
  return (
    <div className="card kito-answer">
      <div className="kito-by"><KitoLogo size={28} /><b>Kito</b></div>
      {stale && <p className="small muted" style={{ margin: 0 }}>{T(`Saved answer from ${ago(a.created_at)}. Ask again for fresh numbers.`, `Jibu lililohifadhiwa ${ago(a.created_at)}. Uliza tena kupata takwimu mpya.`)}</p>}
      <Prose text={a.answer} />
      {a.blocks.map((b, i) => <BlockView key={i} b={b} ws={ws} />)}
      {a.caveats.length > 0 && (
        <div className="evidence">
          <b className="small">{T("Keep in mind", "Zingatia")}</b>
          {a.caveats.map((c, i) => <span key={i}>{c}</span>)}
        </div>
      )}
      {a.follow_ups.length > 0 && (
        <div className="kito-suggest">
          {a.follow_ups.map((f) => <button key={f} className="small" onClick={() => onAsk(f)}>{f}</button>)}
        </div>
      )}
      {staff && a.queries.length > 0 && (
        <details className="kito-how">
          <summary className="small muted">{T(`Staff only · How Kito found this (${a.queries.length} ${a.queries.length === 1 ? "query" : "queries"})`, `Wafanyakazi tu · Kito amepataje hili (maswali ${a.queries.length} kwenye data)`)}</summary>
          {a.queries.map((qq, i) => (
            <div key={i} className="kito-query">
              <span className="small"><b>{i + 1}.</b> {qq.purpose} · {qq.error ? <span className="err">{T("failed, retried", "ilishindwa, akajaribu tena")}</span> : `${fmt(qq.rows)} ${T("rows", "mistari")}`}</span>
              <pre>{qq.sql}</pre>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

/** Minimal formatting: paragraphs, "- " bullets and **bold**. No HTML from the AI is ever rendered. */
function Prose({ text }: { text: string }) {
  const bold = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>));
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="kito-prose">
      {blocks.map((blk, i) => {
        const lines = blk.split("\n").filter((l) => l.trim());
        if (lines.length && lines.every((l) => /^\s*([-•*]|\d+[.)])\s+/.test(l))) {
          return <ul key={i}>{lines.map((l, j) => <li key={j}>{bold(l.replace(/^\s*([-•*]|\d+[.)])\s+/, ""))}</li>)}</ul>;
        }
        return <p key={i}>{lines.map((l, j) => <span key={j}>{j > 0 && <br />}{bold(l)}</span>)}</p>;
      })}
    </div>
  );
}

function BlockView({ b, ws }: { b: Block; ws: Workspace }) {
  if (b.kind === "chats") return <ChatsBlock b={b} ws={ws} />;
  if (b.kind === "ads") return <AdsBlock b={b} ws={ws} />;
  if (b.kind === "delete_chats") return <DeleteBlock b={b} ws={ws} />;
  if (b.kind === "stats") return (
    <div className="kito-block">
      {b.title && <h3>{b.title}</h3>}
      <div className="kpis">{b.items.map((s, i) => <div key={i} className="kpi"><div className="k">{s.label}</div><div className="v">{cell(s.value)}</div></div>)}</div>
    </div>
  );
  return <TableBlock b={b} ws={ws} />;
}

function cell(v: unknown): string {
  if (v == null) return "–";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (typeof v === "boolean") return v ? "✓" : "–";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function TableBlock({ b, ws }: { b: Extract<Block, { kind: "table" }>; ws: Workspace }) {
  const T = (en: string, sw: string) => (ws.language === "sw" ? sw : en);
  const [all, setAll] = useState(false);
  const rows = all ? b.rows : b.rows.slice(0, 12);
  return (
    <div className="kito-block">
      <div className="row between"><h3>{b.title}</h3>{b.chat_ids && b.chat_ids.length > 0 && <a className="small" href={"#chats/ids=" + b.chat_ids.slice(0, 100).join(",")}>{T("Open these chats", "Fungua chat hizi")} →</a>}</div>
      <div className="scroll">
        <table>
          <thead><tr>{b.labels.map((l, i) => <th key={i}>{l}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={typeof v === "number" ? "n" : ""}>{cell(v)}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {b.rows.length > 12 && <button className="small" onClick={() => setAll(!all)}>{all ? T("Show less", "Onyesha machache") : T(`Show all ${b.rows.length}`, `Onyesha zote ${b.rows.length}`)}</button>}
      {b.total > b.rows.length && <span className="small muted">{T(`Showing ${b.rows.length} of ${b.total}.`, `Inaonyesha ${b.rows.length} kati ya ${b.total}.`)}</span>}
    </div>
  );
}

function ChatsBlock({ b, ws }: { b: Extract<Block, { kind: "chats" }>; ws: Workspace }) {
  const T = (en: string, sw: string) => (ws.language === "sw" ? sw : en);
  const [all, setAll] = useState(false);
  const items = all ? b.items : b.items.slice(0, 8);
  const ids = b.items.map((c) => c.chat_id);
  return (
    <div className="kito-block">
      <div className="row between">
        <h3>{b.title} <span className="muted">· {b.items.length}</span></h3>
        {ids.length > 1 && <a className="small" href={"#chats/ids=" + ids.slice(0, 100).join(",")}>{T("Open all in Chats", "Fungua zote kwenye Chats")} →</a>}
      </div>
      {b.items.length === 0 && <div className="empty">{T("No chats match.", "Hakuna chat inayolingana.")}</div>}
      <div className="kito-chats">{items.map((c) => <ChatCard key={c.chat_id} c={c} ws={ws} />)}</div>
      {b.items.length > 8 && <button className="small" onClick={() => setAll(!all)}>{all ? T("Show less", "Onyesha machache") : T(`Show all ${b.items.length}`, `Onyesha zote ${b.items.length}`)}</button>}
    </div>
  );
}

type Draft = { draft_sw: string; draft_en: string; why: string; missing: string[] };

function ChatCard({ c, ws }: { c: ChatItem; ws: Workspace }) {
  const lang = ws.language;
  const T = (en: string, sw: string) => (lang === "sw" ? sw : en);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  // Hidden-number customers have an id like "KE.1858…" instead of a phone: no wa.me link for them.
  const wa = c.wa_id && /^\+?\d{9,15}$/.test(c.wa_id) ? c.wa_id.replace(/\D/g, "") : null;
  const draftText = draft ? (lang === "sw" ? draft.draft_sw : draft.draft_en) : "";

  async function makeDraft() {
    setBusy(true); setErr("");
    try { setDraft(await callFn<Draft>("kito", { workspace_id: ws.id, action: "draft_reply", conversation_id: c.chat_id })); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }
  async function copy() {
    try { await navigator.clipboard.writeText(draftText); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  }

  return (
    <div className="kito-chat">
      <div className="row between">
        <div className="row" style={{ gap: 6 }}>
          <b>{c.name ?? T("Customer", "Mteja")}</b>
          {c.temp && <span className={"temp " + c.temp}>{L[lang].temp[c.temp]}</span>}
          {Number(c.paid_orders) > 0 ? <span className="pill sold">{T("Paid", "Amelipa")}{c.paid_amount ? " · " + money(Number(c.paid_amount), ws.currency) : ""}</span>
            : c.payment_signal ? <span className="chip">{T("Payment detected, not confirmed", "Malipo yameonekana, hayajathibitishwa")}</span>
            : c.outcome ? <span className={"pill " + c.outcome}>{L[lang].outcome[c.outcome] ?? c.outcome}</span> : null}
          {c.label && <span className="chip">{L[lang].label[c.label] ?? c.label}</span>}
        </div>
        <span className="small muted">{c.last_dir === "in" ? T("Customer wrote ", "Mteja aliandika ") : T("We wrote ", "Tuliandika ")}{ago(c.last_message_at)}</span>
      </div>
      {(c.why || c.summary) && <div className="small">{c.why ?? c.summary}</div>}
      {c.why && c.summary && <div className="small muted">{c.summary}</div>}
      {c.next && <div className="small"><span className="muted">{T("Next step: ", "Hatua inayofuata: ")}</span>{c.next}</div>}
      <div className="row" style={{ gap: 6 }}>
        <a className="btn small" href={"#chats/ids=" + c.chat_id}>{T("Open chat", "Fungua chat")}</a>
        {wa && <a className="btn small" href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer">WhatsApp ↗</a>}
        {canEdit(ws) && !draft && <button className="small" disabled={busy} onClick={makeDraft}>{busy ? <><KitoLoader size="sm" />{T("Writing…", "Anaandika…")}</> : T("Draft a follow-up", "Andaa ujumbe wa kufuatilia")}</button>}
      </div>
      {err && <p className="err small" style={{ margin: 0 }}>{err}</p>}
      {draft && (
        <div className="evidence">
          <span className="draft-label">{T("Draft — review before sending", "Rasimu — kagua kabla ya kutuma")}</span>
          <span style={{ whiteSpace: "pre-wrap" }}>{draftText}</span>
          {draft.missing.length > 0 && <span className="small muted">{T("Fill in: ", "Jaza: ")}{draft.missing.join(", ")}</span>}
          <div className="row" style={{ gap: 6 }}>
            <button className="small" onClick={copy}>{copied ? T("Copied", "Imenakiliwa") : T("Copy", "Nakili")}</button>
            {wa && <a className="btn small" href={`https://wa.me/${wa}?text=${encodeURIComponent(draftText)}`} target="_blank" rel="noopener noreferrer">{T("Open in WhatsApp with this text ↗", "Fungua WhatsApp na ujumbe huu ↗")}</a>}
          </div>
        </div>
      )}
    </div>
  );
}

function AdsBlock({ b, ws }: { b: Extract<Block, { kind: "ads" }>; ws: Workspace }) {
  const T = (en: string, sw: string) => (ws.language === "sw" ? sw : en);
  const cur = b.spend_currency ?? ws.currency;
  return (
    <div className="kito-block">
      <h3>{b.title}</h3>
      <div className="scroll">
        <table>
          <thead><tr>
            <th>{T("Ad", "Tangazo")}</th><th className="n">{T("Spend 30d", "Matumizi siku 30")}</th><th className="n">Chats</th>
            <th className="n">{T("Priced", "Bei")}</th><th className="n">{T("Paid sales", "Mauzo")}</th><th className="n">{T("Revenue", "Mapato")}</th><th className="n">{T("Cost / sale", "Gharama / mauzo")}</th>
          </tr></thead>
          <tbody>{b.items.map((a) => (
            <tr key={a.ad_id}>
              <td><b>{a.name}</b>{a.campaign && <div className="small muted">{a.campaign}</div>}{a.why && <div className="small">{a.why}</div>}</td>
              <td className="n">{money(Number(a.spend_30d), cur)}</td><td className="n">{fmt(a.chats_30d)}</td><td className="n">{fmt(a.priced_30d)}</td>
              <td className="n">{fmt(a.sales_30d)}</td><td className="n">{money(Number(a.revenue_30d), ws.currency)}</td>
              <td className="n">{a.cost_per_sale_30d == null ? "–" : money(Number(a.cost_per_sale_30d), cur)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <span className="small muted">{T("Last 30 days. Paid sales are orders matched to chats from the ad (an estimate, not proof).", "Siku 30 zilizopita. Mauzo ni oda zilizounganishwa na chat za tangazo (makisio, si uthibitisho).")}</span>
      <a className="small" href="#dashboard">{T("See all ads on the Dashboard", "Ona matangazo yote kwenye Dashboard")} →</a>
    </div>
  );
}

const ORIGIN: Record<string, [string, string]> = {
  live: ["live WhatsApp", "WhatsApp hai"], export: ["uploaded chat export", "chat export zilizopakiwa"], csv: ["CSV import", "CSV"],
};

function DeleteBlock({ b, ws }: { b: Extract<Block, { kind: "delete_chats" }>; ws: Workspace }) {
  const T = (en: string, sw: string) => (ws.language === "sw" ? sw : en);
  const [state, setState] = useState<"ready" | "busy" | "done" | "cancelled">("ready");
  const [res, setRes] = useState<{ deleted: number; messages: number; orders_unlinked: number } | null>(null);
  const [err, setErr] = useState("");
  const origins = Object.entries(b.by_origin).map(([o, n]) => `${n} ${T(ORIGIN[o]?.[0] ?? o, ORIGIN[o]?.[1] ?? o)}`).join(" · ");
  const live = b.by_origin.live ?? 0;

  async function run() {
    const msg = T(`Delete ${b.count} chats and ${b.messages} messages for good? This cannot be undone.`, `Futa chat ${b.count} na ujumbe ${b.messages} kabisa? Haiwezi kurudishwa.`)
      + (live ? "\n\n" + T(`${live} of them came through your live WhatsApp connection and cannot be fetched again.`, `${live} kati yake zilikuja kupitia WhatsApp hai na haziwezi kupatikana tena.`) : "");
    if (!confirm(msg)) return;
    setState("busy"); setErr("");
    const { data, error } = await supabase.rpc("delete_chats", { p_ws: ws.id, p_ids: b.chat_ids, p_via: "kito", p_request: b.request });
    if (error) { setErr(error.message); setState("ready"); return; }
    setRes(data as any); setState("done");
  }

  return (
    <div className="kito-block kito-danger">
      <h3>{b.title || T("Delete chats", "Futa chat")} <span className="muted">· {b.count}</span></h3>
      {state === "done" && res ? (
        <p className="ok" style={{ margin: 0 }}>{T(`Deleted ${res.deleted} chats and ${res.messages} messages.`, `Chat ${res.deleted} na ujumbe ${res.messages} vimefutwa.`)}
          {res.orders_unlinked > 0 && " " + T(`${res.orders_unlinked} recorded orders were kept, now without a chat.`, `Oda ${res.orders_unlinked} zimebaki, sasa bila chat.`)}</p>
      ) : state === "cancelled" ? (
        <p className="small muted" style={{ margin: 0 }}>{T("Cancelled. Nothing was deleted.", "Imesitishwa. Hakuna kilichofutwa.")}</p>
      ) : (<>
        <div className="small">{T("Nothing is deleted yet.", "Bado hakuna kilichofutwa.")} {origins} · {b.messages} {T("messages", "ujumbe")}</div>
        {live > 0 && <div className="small warnt">{T(`${live} of these came through the live WhatsApp connection. Once deleted they cannot be fetched again.`, `${live} kati ya hizi zilikuja kupitia WhatsApp hai. Zikifutwa haziwezi kupatikana tena.`)}</div>}
        {b.with_orders > 0 && <div className="small muted">{T(`${b.with_orders} have recorded orders. The orders stay (your sales numbers don't change); they just lose the link to the chat.`, `${b.with_orders} zina oda zilizorekodiwa. Oda zitabaki (mauzo hayabadiliki); zitapoteza tu kiungo cha chat.`)}</div>}
        <div className="kito-del-list">
          {b.sample.map((c, i) => <span key={i} className="chip">{c.name ?? T("Customer", "Mteja")}<span className="muted"> · {T(ORIGIN[c.origin]?.[0] ?? c.origin, ORIGIN[c.origin]?.[1] ?? c.origin)}</span></span>)}
          {b.count > b.sample.length && <span className="small muted">+{b.count - b.sample.length} {T("more", "zaidi")}</span>}
        </div>
        {b.allowed ? (
          <div className="row" style={{ gap: 6 }}>
            <button className="small danger" disabled={state === "busy"} onClick={run}>{state === "busy" ? <><KitoLoader size="sm" />{T("Deleting…", "Inafuta…")}</> : T(`Delete ${b.count} chats`, `Futa chat ${b.count}`)}</button>
            <a className="btn small" href={"#chats/ids=" + b.chat_ids.slice(0, 100).join(",")}>{T("Review them first", "Zikague kwanza")}</a>
            <button className="small" disabled={state === "busy"} onClick={() => setState("cancelled")}>{T("Cancel", "Ghairi")}</button>
          </div>
        ) : <div className="small muted">{T("Only the owner or an admin can delete chats.", "Mmiliki au admin pekee ndiye anaweza kufuta chat.")}</div>}
        {err && <p className="err small" style={{ margin: 0 }}>{err}</p>}
      </>)}
    </div>
  );
}
