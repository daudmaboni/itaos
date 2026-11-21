// The open chat on the Chats page: messages, reply box, payment confirmation and photos (moved out of Chats.tsx, unchanged).
import { select } from "./motion";
import { useEffect, useRef, useState } from "react";
import { supabase, callFn, Workspace, Outcome, Task, dur, L, when, canEdit, canManage, money, amt, moneyInput, moneyText } from "./lib";
import { AssignChat } from "./team";
import { useProducts, ProductPicker, itemsCost, itemsLabel, productPhotosReady, itemsFromMatches, type Item, type ProductMatch } from "./Products";
import { OrderForm, OrderList, inferredFrom, usePaymentMoment, toLocalInput, fromLocalInput, momentWhy } from "./Orders";
import { KitoLogo } from "./Logo";
import { ImageViewer } from "./ImageViewer";
import { KitoLoader } from "./KitoLoader";
import { Msg, Tr, waLink, agoT, statusOf, kitoStale, PARTY, markNotCustomer, nameOf, fromOf, prettyPhone, hiddenNote, special, whySource, lostWhy, lastPriceSent, interest } from "./chatParts";

/** Kito thinks this person isn't a customer (e.g. Hassan the bodaboda talks money but doesn't buy). */
export function PartyHint({ r, T, onChange }: { r: Outcome; T: Tr; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const p = r.kito_party;
  if (!p || p === "customer" || r.not_customer || r.party_decided || Number(r.paid_orders) > 0) return null;
  const who = PARTY[p] ?? PARTY.other;
  const set = async (v: boolean) => { setBusy(true); await markNotCustomer(r, v, p); setBusy(false); onChange(); };
  return (
    <div className="cc-party small" onClick={(e) => e.stopPropagation()}>
      <span>✦ {T(`Kito thinks this is ${who[0]}, not a customer.`, `Kito anadhani huyu ni ${who[1]}, si mteja.`)}</span>
      <span className="row" style={{ gap: 6 }}>
        <button className="small primary" disabled={busy} onClick={() => set(true)}>{T("Not a customer", "Si mteja")}</button>
        <button className="small" disabled={busy} onClick={() => set(false)}>{T("They're a customer", "Ni mteja")}</button>
      </span>
    </div>
  );
}
/** The open chat, laid out like WhatsApp: header with ✕, the whole conversation as bubbles grouped by
 *  day, and beside it what to do about this customer (a sheet on smaller screens). itaOS never sends,
 *  so the bottom bar hands over to WhatsApp. */
export function ChatPane({ r, ws, T, adName, phone, task, onChange, onClose, startConfirm }: { r: Outcome; ws: Workspace; T: Tr; adName?: string; phone: string | null; task?: Task; onChange: () => void; onClose: () => void; startConfirm?: boolean }) {
  const lang = ws.language;
  const tz = ws.timezone || "Africa/Dar_es_Salaam";
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [recording, setRecording] = useState(false);
  const [confirming, setConfirming] = useState(!!startConfirm);
  const [salesKey, setSalesKey] = useState(0);   // bumped after a sale is saved here, so the sales list reloads
  const [side, setSide] = useState(!!startConfirm);   // details sheet on smaller screens
  // On a wide screen the customer panel sits beside the chat; the owner can hide it (remembered).
  const [hideSide, setHideSide] = useState(() => { try { return localStorage.getItem("itaos:chats:hideside") === "1"; } catch { return false; } });
  const wide = () => window.innerWidth >= 1280;
  const toggleSide = () => {
    if (!wide()) { setSide(!side); return; }
    const v = !hideSide; setHideSide(v);
    try { localStorage.setItem("itaos:chats:hideside", v ? "1" : "0"); } catch { /* private mode */ }
  };
  useEffect(() => { if (startConfirm && hideSide) setHideSide(false); }, [r.id]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const thread = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const editor = canEdit(ws);
  const st = statusOf(r, T, ws.currency);
  const confirmed = Number(r.paid_orders) > 0;
  const name = nameOf(r, T);
  // On a computer, bring the whole chat (down to the reply bar) into view when it opens.
  useEffect(() => {
    const el = pane.current;
    if (!el || window.innerWidth < 900) return;
    const b = el.getBoundingClientRect();
    if (b.top < 0 || b.bottom > window.innerHeight) window.scrollBy({ top: b.top - 12, behavior: "smooth" });
  }, []);
  const why = r.kito_temp && !kitoStale(r) ? r.kito_blocker : (r.objections ?? [])[0] ?? null;

  async function loadMsgs() {
    const { data } = await supabase.from("messages").select("id,direction,sent_at,body,origin,type,media").eq("conversation_id", r.id).order("sent_at", { ascending: false }).limit(1000);
    setMsgs(((data as Msg[]) ?? []).reverse());
  }
  useEffect(() => {
    loadMsgs();
    const on = () => loadMsgs();
    window.addEventListener("itaos:live", on);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target as HTMLElement)?.closest?.("input,textarea,select")) onClose(); };
    window.addEventListener("keydown", esc);
    document.body.classList.add("wa-open");
    return () => { window.removeEventListener("itaos:live", on); window.removeEventListener("keydown", esc); document.body.classList.remove("wa-open"); };
  }, [r.id]);
  // Newest message in view, like WhatsApp.
  useEffect(() => { const el = thread.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs?.length]);

  /** The owner's answer to "came from an ad?" wins over the automatic checks (ad_signal = 'owner'). */
  // Shown at once when tapped; falls back to the saved value if the save fails.
  const [src, setSrc] = useState(r.source);
  useEffect(() => setSrc(r.source), [r.id, r.source]);
  async function setFromAd(yes: boolean) {
    if ((r.source === "ad") === yes && r.ad_signal === "owner") return;
    setSrc(yes ? "ad" : "organic");
    setBusy(true); setErr("");
    let { error } = await supabase.from("conversations").update({ source: yes ? "ad" : "organic", ad_signal: "owner" }).eq("id", r.id);
    // Until migration 0032 is on the database, 'owner' isn't an allowed ad_signal: save the answer without it.
    if (error?.code === "23514") ({ error } = await supabase.from("conversations").update({ source: yes ? "ad" : "organic", ...(yes ? {} : { ad_signal: null }) }).eq("id", r.id));
    setBusy(false); if (error) { setSrc(r.source); setErr(error.message); } else onChange();
  }
  async function setOverride(v: "lost" | "open" | null) {
    setBusy(true); setErr("");
    const { error } = await supabase.from("conversations").update({ outcome_override: v, override_note: null }).eq("id", r.id);
    if (!error && v === "lost" && task) await supabase.from("follow_up_tasks").update({ status: "dismissed" }).eq("id", task.id).eq("workspace_id", ws.id);
    setBusy(false); if (error) setErr(error.message); else onChange();
  }
  async function remind() {
    setBusy(true); setErr("");
    const { data: user } = await supabase.auth.getUser();
    const { error } = await supabase.from("follow_up_tasks").insert({
      workspace_id: ws.id, conversation_id: r.id, title: `Follow up with ${name}`,
      draft: r.kito_next ?? null, draft_source: r.kito_next ? "kito" : null, due_at: new Date().toISOString(), created_by: user.user?.id,
    });
    setBusy(false); if (error) setErr(error.code === "23505" ? T("A reminder already exists.", "Tayari kuna kikumbusho.") : error.message); else onChange();
  }

  const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const today = dayKey(new Date().toISOString()), yest = dayKey(new Date(Date.now() - 864e5).toISOString());
  const dayLabel = (k: string) => k === today ? T("Today", "Leo") : k === yest ? T("Yesterday", "Jana")
    : new Date(k + "T12:00:00Z").toLocaleDateString(lang === "sw" ? "sw-TZ" : "en-GB", { weekday: Date.now() - Date.parse(k) < 6 * 864e5 ? "long" : undefined, day: "numeric", month: "long", year: k.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric", timeZone: "UTC" });
  const hhmm = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  const [copied, setCopied] = useState(false);
  const sideLabel = st.key === "check" ? T("Check payment", "Hakiki malipo") : confirmed ? T("Sale", "Mauzo") : T("Did they buy?", "Amenunua?");

  // Messages are drawn in runs, like a modern chat: one time under the last bubble of a run
  // (same side, under a minute apart), and "WhatsApp didn't share it" placeholders
  // shown as one small grey note in the middle instead of fake bubbles.
  type Row = { kind: "day"; key: string; label: string } | { kind: "note"; key: string; text: string; count: number; dir: string }
    | { kind: "msg"; key: string; m: Msg; first: boolean; last: boolean };
  const rows: Row[] = [];
  if (msgs) {
    let lastDay = "";
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      const k = dayKey(m.sent_at);
      if (k !== lastDay) { rows.push({ kind: "day", key: "d" + k, label: dayLabel(k) }); lastDay = k; }
      const note = hiddenNote(m);
      if (note) {
        const prev = rows[rows.length - 1];
        if (prev?.kind === "note" && prev.text === note) prev.count++;
        else rows.push({ kind: "note", key: m.id, text: note, count: 1, dir: m.direction });
        continue;
      }
      const prev = rows[rows.length - 1];
      const joins = prev?.kind === "msg" && prev.m.direction === m.direction && Date.parse(m.sent_at) - Date.parse(prev.m.sent_at) < 60e3;
      if (joins) prev.last = false;
      rows.push({ kind: "msg", key: m.id, m, first: !joins, last: true });
    }
  }
  const noteText = (r: { text: string; count: number; dir: string }) => {
    const who = r.dir === "out" ? T("You sent", "Ulituma") : T("They sent", "Walituma");
    return r.text === "media"
      ? T(`${who} ${r.count > 1 ? `${r.count} photos, voice notes or files` : "a photo, voice note or file"} · WhatsApp didn't share ${r.count > 1 ? "them" : "it"}`,
        `${who} ${r.count > 1 ? `picha/sauti/faili ${r.count}` : "picha, sauti au faili"} · WhatsApp haikushiriki`)
      : T(`${who} ${r.count > 1 ? `${r.count} messages` : "a message"} WhatsApp didn't share (a poll, view-once or new type)`,
        `${who} ${r.count > 1 ? `ujumbe ${r.count}` : "ujumbe"} ambao WhatsApp haikushiriki (kura, view-once au aina mpya)`);
  };

  return (
    <div ref={pane} className={"wa-pane" + (side ? " side-open" : "") + (hideSide ? " side-hidden" : "")} role="dialog" aria-label={T(`Chat with ${name}`, `Chat na ${name}`)}>
      <header className="wa-head">
        <button className="wa-back" onClick={onClose} aria-label={T("Back to chats", "Rudi kwenye chats")}>←</button>
        <div className="cc-avatar" aria-hidden>{name.slice(0, 1).toUpperCase()}</div>
        <div className="wa-head-main">
          <span className="wa-head-kicker">{T("Chat with", "Chat na")}</span>
          <b>{name}</b>
          <span className="small muted">{[phone ? prettyPhone(phone) : null, r.last_message_at ? T(`last message ${agoT(r.last_message_at, T)}`, `ujumbe wa mwisho ${agoT(r.last_message_at, T)}`) : null].filter(Boolean).join(" · ")}</span>
        </div>
        <div className="wa-head-act">
          {phone && <a className="btn small primary wa-reply" href={waLink(phone)} target="_blank" rel="noopener noreferrer">{T("Reply on WhatsApp ↗", "Mjibu WhatsApp ↗")}</a>}
          <button className={"small wa-side-btn" + (st.key === "check" ? " warn" : " quiet") + (hideSide ? "" : " is-on")} aria-label={sideLabel} onClick={toggleSide} aria-expanded={side || !hideSide}
            title={T("Show or hide the customer panel", "Onyesha au ficha taarifa za mteja")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M15 4v16" /></svg>
            <span>{sideLabel}</span>
          </button>
          <button className="icon wa-x" onClick={onClose} aria-label={T("Close chat", "Funga chat")} title={T("Close (Esc)", "Funga (Esc)")}>✕</button>
        </div>
      </header>
      <div className="wa-body">
        <div className="wa-chat">
          <div className="wa-thread" ref={thread}>
            {!msgs ? <div className="wa-sys">{T("Loading the chat…", "Inapakia chat…")}</div>
              : msgs.length === 0 ? <div className="wa-sys">{T("No messages saved for this customer.", "Hakuna ujumbe uliohifadhiwa kwa mteja huyu.")}</div>
              : rows.map((row) => row.kind === "day" ? <div key={row.key} className="wa-day"><span>{row.label}</span></div>
                : row.kind === "note" ? <div key={row.key} className="wa-note">{noteText(row)}</div>
                : (() => {
                  const m = row.m;
                  return (
                    <div key={row.key} className={"wa-msg " + m.direction + (row.first ? " tail first" : "") + (row.last ? " last" : "")}>
                      <div className="wa-bub">
                        {m.media?.path ? <MediaView m={m} ws={ws} T={T} /> : <span className={"wa-text" + (special(m) ? " wa-special" : "")}>{special(m) ?? m.body ?? ""}</span>}
                      </div>
                      {row.last && <span className="wa-stamp">{m.origin === "itaos" && <span className="wa-via" title={T("Sent from itaOS", "Imetumwa kutoka itaOS")}>itaOS · </span>}{hhmm(m.sent_at)}{m.direction === "out" && <span className="wa-ticks" aria-hidden> ✓✓</span>}</span>}
                    </div>
                  );
                })())}
          </div>
          <Composer r={r} ws={ws} T={T} phone={phone} msgs={msgs} onSent={loadMsgs} />
        </div>
        <aside className="wa-side" aria-label={T("About this customer", "Kuhusu mteja huyu")}>
          <div className="wa-side-head"><b>{T("This customer", "Mteja huyu")}</b><button className="icon wa-side-x" onClick={() => setSide(false)} aria-label={T("Hide", "Ficha")}>✕</button></div>
          {/* Who: one compact row (the big centred avatar is gone) */}
          <div className="wa-who">
            <div className="cc-avatar" aria-hidden>{name.slice(0, 1).toUpperCase()}</div>
            <div className="wa-who-main">
              <b>{name}</b>
              {phone && <span className="small muted">{prettyPhone(phone)}
                <button type="button" className="linkish small wa-copy" onClick={() => { navigator.clipboard?.writeText("+" + phone.replace(/^\+/, "")).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}>
                  {copied ? T("Copied", "Imenakiliwa") : T("Copy", "Nakili")}</button></span>}
            </div>
          </div>

          {/* Kito says: the most useful part, first */}
          {!r.not_customer && (r.kito_summary || kitoStale(r)) && (
            <div className="wa-kito-box">
              <span className="wa-kito-k">✦ {T("Kito says", "Kito anasema")}</span>
              {kitoStale(r) && <p className="wa-sum cc-reading">{T("New messages since Kito's last read. Kito is reading them now; this updates by itself.", "Kuna ujumbe mpya tangu Kito asome. Kito anausoma sasa; hii itajisasisha yenyewe.")}</p>}
              {r.kito_summary && <p className={"wa-sum" + (kitoStale(r) ? " stale" : "")}>{r.kito_summary}</p>}
              {r.kito_next && st.key !== "bought" && <p className={"cc-next" + (kitoStale(r) ? " stale" : "")}><b>{T("Next:", "Fanya:")}</b> {r.kito_next}</p>}
            </div>
          )}

          {/* The one main action */}
          {editor && st.key === "check" && (confirming || !recording) && <ConfirmPayment r={r} ws={ws} T={T} msgs={msgs} onDone={() => { setConfirming(false); setSide(false); setSalesKey((k) => k + 1); onChange(); }} onLater={() => { setConfirming(false); setSide(false); }} />}
          {editor && !confirmed && !r.not_customer && st.key !== "check" && !recording && (
            <div className="cc-ask">
              <b>{T("Did they buy?", "Amenunua?")}</b>
              <div className="cc-ask-btns">
                <button className="small primary" disabled={busy} onClick={() => setRecording(true)}>{T("Yes, record sale", "Ndiyo, rekodi mauzo")}</button>
                <button className={"small" + (r.outcome === "open" ? " on" : "")} disabled={busy} onClick={() => setOverride("open")}>{T("Not yet", "Bado")}</button>
                <button className={"small" + (r.outcome === "lost" ? " on" : "")} disabled={busy} onClick={() => setOverride("lost")}>{T("No", "Hapana")}</button>
              </div>
              {r.outcome_override && r.override_by && <button className="linkish small" disabled={busy} onClick={() => setOverride(null)}>{T("Undo my answer", "Futa jibu langu")}</button>}
            </div>
          )}
          {recording && <OrderForm ws={ws} r={r} onDone={() => { setRecording(false); setSalesKey((k) => k + 1); onChange(); }} onCancel={() => setRecording(false)} />}

          {/* Details: plain rows with thin lines */}
          <div className="wa-facts">
            <div className="wa-fact"><span className="small muted">{T("Status", "Hali")}</span>
              <div className={"cc-status " + st.tone}>{st.icon === "●" ? <span className="cc-dot" /> : <span className="cc-ico">{st.icon}</span>}{st.text}{st.key === "lost" && why ? ` · ${lostWhy(why, T)}` : ""}</div></div>
            {!r.not_customer && <div className="wa-fact"><span className="small muted">{T("From", "Kutoka")}</span><span className="small">{fromOf(r, T, adName)}</span></div>}
            {editor && !confirmed && !r.not_customer && <TempFix r={r} T={T} onChange={onChange} />}
            {editor && !r.not_customer && (
              <div className="cc-fromad">
                <span className="small">{T("Came from an ad?", "Ametoka kwenye tangazo?")}</span>
                <div className="seg" role="group" aria-label={T("Came from an ad?", "Ametoka kwenye tangazo?")}>
                  <button type="button" className={"yes" + (src === "ad" ? " on" : "")} aria-pressed={src === "ad"} disabled={busy} onClick={() => setFromAd(true)}>{src === "ad" && "✓ "}{T("Yes", "Ndiyo")}</button>
                  <button type="button" className={"no" + (src === "organic" ? " on" : "")} aria-pressed={src === "organic"} disabled={busy} onClick={() => setFromAd(false)}>{src === "organic" && "✓ "}{T("No", "Hapana")}</button>
                </div>
              </div>
            )}
            <div className="wa-fact wa-fact-col"><span className="small muted">{T("Sales from this customer", "Mauzo kwa mteja huyu")}</span>
              <OrderList key={`${salesKey}-${r.paid_orders ?? 0}`} ws={ws} conversationId={r.id} onChange={onChange} /></div>
            <AssignChat ws={ws} conversationId={r.id} />
          </div>

          {/* Quiet links at the bottom */}
          <div className="wa-foot">
            {editor && !task && !confirmed && !r.not_customer && st.key !== "lost" && <button className="linkish small" disabled={busy} onClick={remind}>⏰ {T("Remind me to follow up", "Nikumbushe kumfuatilia")}</button>}
            {task && <span className="small cc-task">⏰ {T("Reminder set", "Kikumbusho kipo")} · <a href="#actions">{T("see reminders", "ona vikumbusho")}</a></span>}
            {editor && !confirmed && <NotCustomer r={r} T={T} busy={busy} setBusy={setBusy} onChange={onChange} />}
            {editor && !confirmed && !r.not_customer && <PartyHint r={r} T={T} onChange={onChange} />}
            <details className="cc-why">
              <summary className="small muted">{T("How itaOS decided this", "itaOS imeamuaje hili")}</summary>
              <div className="small muted" style={{ display: "grid", gap: 4, marginTop: 6 }}>
                <span>{whySource(r, T)}</span>
                {r.first_response_sec != null && <span>{T("You first replied after", "Ulijibu mara ya kwanza baada ya")} {dur(r.first_response_sec)}</span>}
                {r.kito_outcome && <span>Kito: {L[lang].outcome[r.kito_outcome]} ({T("sure", "uhakika")}: {r.kito_confidence}){r.kito_label ? ` · ${L[lang].label[r.kito_label]}` : ""}</span>}
                {r.stage && <span>{T("Keyword check", "Ukaguzi wa maneno")}: {L[lang].stage[r.stage] ?? r.stage}</span>}
                {(r.kito_evidence ?? []).length > 0 && <span>{T("Messages Kito based this on:", "Ujumbe aliotumia Kito:")} {(r.kito_evidence ?? []).map((q, i) => <q key={i} style={{ display: "block" }}>{q}</q>)}</span>}
                {(r.kito_tags ?? []).length > 0 && <span>{(r.kito_tags ?? []).map((t) => L[lang].tag[t] ?? t).join(" · ")}</span>}
              </div>
            </details>
          </div>
          {err && <div className="err small">{err}</div>}
        </aside>
      </div>
    </div>
  );
}

/** Reply box at the bottom of the chat, like WhatsApp's. Sends from the business's own number through
 *  the wa-send function. WhatsApp allows free replies only within 24 h of the customer's last message. */
export function Composer({ r, ws, T, phone, msgs, onSent }: { r: Outcome; ws: Workspace; T: Tr; phone: string | null; msgs: Msg[] | null; onSent: () => Promise<void> | void }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [err, setErr] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setText(""); setErr(""); }, [r.id]);
  useEffect(() => { const el = box.current; if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 160) + "px"; } }, [text]);

  const openWa = phone && <a className="btn small" href={waLink(phone)} target="_blank" rel="noopener noreferrer">{T("Open WhatsApp ↗", "Fungua WhatsApp ↗")}</a>;
  if (!canManage(ws) || ws.send_enabled === false || (r as any).phone_number_id === "import") {
    return (
      <div className="wa-compose">
        <span>{(r as any).phone_number_id === "import" ? T("This chat came from an uploaded file. Reply from WhatsApp.", "Chat hii imetoka kwenye faili. Jibu kupitia WhatsApp.")
          : !canManage(ws) ? T("Only the owner or an admin can reply from itaOS.", "Mmiliki au admin pekee anaweza kujibu kutoka itaOS.")
          : T("Replying from itaOS is turned off in Settings.", "Kujibu kutoka itaOS kumezimwa kwenye Mipangilio.")}</span>
        {openWa}
      </div>
    );
  }
  const lastIn = msgs ? [...msgs].reverse().find((m) => m.direction === "in") : null;
  const left = lastIn ? 24 * 3600e3 - (Date.now() - Date.parse(lastIn.sent_at)) : -1;
  if (msgs && left <= 0) {
    return (
      <div className="wa-compose closed">
        <span>{T("24 hours have passed since their last message, so WhatsApp only allows approved template messages. Reply from the WhatsApp app.", "Zimepita saa 24 tangu ujumbe wake wa mwisho, kwa hiyo WhatsApp inaruhusu ujumbe wa template tu. Jibu kupitia app ya WhatsApp.")}</span>
        {openWa}
      </div>
    );
  }
  async function send() {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true); setErr("");
    try {
      await callFn("wa-send", { workspace_id: ws.id, conversation_id: r.id, text: t });
      setText(""); await onSent();
    } catch (e) { setErr((e as Error).message); }
    setSending(false); box.current?.focus();
  }
  async function draft() {
    setDrafting(true); setErr("");
    try {
      // Write in the customer's language (Kito detects it from their messages), not the app's language.
      const d = await callFn<{ draft_sw: string; draft_en: string; chat_lang?: "sw" | "en" }>("kito", { workspace_id: ws.id, action: "draft_reply", conversation_id: r.id });
      const lang = d.chat_lang ?? (ws.language === "en" ? "en" : "sw");
      setText(lang === "en" ? d.draft_en || d.draft_sw : d.draft_sw || d.draft_en); box.current?.focus();
    } catch (e) { setErr((e as Error).message); }
    setDrafting(false);
  }
  const hours = Math.floor(left / 3600e3), mins = Math.max(1, Math.round((left % 3600e3) / 60000));
  return (
    <div className="wa-compose open">
      {(err || (msgs && left < 3 * 3600e3)) && (
        <div className={"wa-compose-note small" + (err ? " err" : "")}>{err || T(`The 24-hour window closes in ${hours ? `${hours} h ` : ""}${mins} min. After that, only template messages.`, `Dirisha la saa 24 linafungwa baada ya ${hours ? `saa ${hours} ` : ""}dakika ${mins}. Baada ya hapo, template tu.`)}</div>
      )}
      <div className="wa-compose-row wa-line">
        <div className="wa-me" aria-hidden title={ws.name}>{(ws.name || "?").slice(0, 1).toUpperCase()}</div>
        <textarea ref={box} rows={1} value={text} placeholder={T("Type your message", "Andika ujumbe wako")} aria-label={T("Message", "Ujumbe")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && window.innerWidth >= 900) { e.preventDefault(); send(); } }} />
        <button className="wa-kito" onClick={draft} disabled={drafting || sending} aria-label={T("Kito, write a reply", "Kito, niandikie jibu")} title={T("Kito writes a reply from this chat. You check it before sending.", "Kito anaandika jibu kutoka chat hii. Unaliangalia kabla ya kutuma.")}>
          {drafting ? <KitoLoader size="sm" className="flush" /> : <KitoLogo size={18} />}<span>{drafting ? T("Writing…", "Anaandika…") : "Kito"}</span>
        </button>
        <button className="wa-send" onClick={send} disabled={!text.trim() || sending} aria-label={T("Send", "Tuma")} title={T("Send from your WhatsApp number", "Tuma kutoka namba yako ya WhatsApp")}>
          {sending ? <span className="wa-spin" /> : <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M21.4 2.6 2.9 10.3c-.8.3-.8 1.5.1 1.8l7 2.2 2.2 7c.3.9 1.5.9 1.8.1l7.7-18.5c.3-.6-.3-1.2-.9-.9z" /></svg>}
        </button>
      </div>
    </div>
  );
}

/** "Says they paid": the owner checks their own M-Pesa / bank, then confirms in one tap. */
export function ConfirmPayment({ r, ws, T, msgs, onDone, onLater }: { r: Outcome; ws: Workspace; T: Tr; msgs: Msg[] | null; onDone: () => void; onLater: () => void }) {
  const rc = [...(msgs ?? [])].reverse().find((m) => m.direction === "in" && m.media?.receipt?.is_receipt);
  const receipt = rc?.media?.receipt ?? null;
  const guess = receipt?.amount ?? r.kito_amount ?? r.payment_amount ?? lastPriceSent(msgs);
  const priced = lastPriceSent(msgs);
  const [amount, setAmount] = useState("");
  const [code, setCode] = useState("");
  useEffect(() => { if (!code && receipt?.txn_code) setCode(receipt.txn_code); }, [receipt?.txn_code]);
  // Fraud checks: the same receipt sent in another chat, or already used for a recorded sale.
  const [reused, setReused] = useState<{ otherChats: number; usedInSale: boolean }>({ otherChats: 0, usedInSale: false });
  useEffect(() => {
    const c = receipt?.txn_code; if (!c) return;
    Promise.all([
      supabase.from("messages").select("conversation_id").eq("workspace_id", ws.id).eq("direction", "in").ilike("body", `%${c.replace(/[%_]/g, "")}%`).neq("conversation_id", r.id).limit(50),
      supabase.from("orders").select("id").eq("workspace_id", ws.id).eq("external_ref", "txn:" + c.toUpperCase()).limit(1),
    ]).then(([m, o]) => setReused({ otherChats: new Set((m.data ?? []).map((x: any) => x.conversation_id)).size, usedInSale: !!o.data?.length }));
  }, [receipt?.txn_code, r.id]);
  const receiptDay = (() => {   // "14/08/2026, 04:52 Pm" → Date (day first, as Tanzanian receipts print it)
    const m = receipt?.paid_at?.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/); if (!m) return null;
    const y = Number(m[3].length === 2 ? "20" + m[3] : m[3]); const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])));
    return isNaN(d.getTime()) ? null : d;
  })();
  const sentAt = rc ? Date.parse(rc.sent_at) : Date.now();
  const daysOld = receiptDay ? Math.floor((sentAt - receiptDay.getTime()) / 864e5) : null;
  const notDone = !!receipt?.notes && /(kuchakatwa|processing|pending|inasubiri|not (yet )?complete|failed|imeshindwa)/i.test(receipt.notes);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (!amount && guess) setAmount(Math.round(Number(guess)).toLocaleString("en-US")); }, [guess]);
  // The day the customer paid, read from the chat (receipt, "nimetuma", your delivery-details message…).
  const pm = usePaymentMoment(r.id);
  const [paidOn, setPaidOn] = useState("");
  useEffect(() => { if (!paidOn && pm !== undefined) setPaidOn(toLocalInput(pm?.at ?? rc?.sent_at ?? r.last_message_at ?? new Date().toISOString())); }, [pm, rc?.sent_at]);
  const [cost, setCost] = useState("");
  // What the customer bought (My products): the cost fills in from the products picked, still editable.
  const { products } = useProducts(ws.id);
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => { const c = itemsCost(items); if (c != null) setCost(moneyText(c)); }, [items]);
  const [prePicked, setPrePicked] = useState(false);
  const [fromPhotos, setFromPhotos] = useState(false);
  useEffect(() => {   // photos in this chat that itaOS recognised as your products are picked for you (change them freely)
    if (!products?.length || prePicked) return;
    supabase.from("messages").select("media").eq("workspace_id", ws.id).eq("conversation_id", r.id).eq("direction", "in").not("media->product_match", "is", null).order("sent_at", { ascending: false }).limit(20)
      .then(({ data }) => {
        const found = itemsFromMatches(((data ?? []) as any[]).map((x) => x.media?.product_match).filter(Boolean), products);
        setPrePicked(true);
        if (found.length) setItems((cur) => { if (cur.length) return cur; setFromPhotos(true); return found; });
      });
  }, [products, r.id]);
  const [dupOk, setDupOk] = useState(false);
  const [dup, setDup] = useState<string | null>(null);
  const [paidDone, setPaidDone] = useState(false);   // the button turns green once the sale is saved

  async function yes() {
    const a = Number(amount.replace(/[^\d.]/g, ""));
    if (!(a > 0)) return setErr(T("Enter the amount that came in.", "Weka kiasi kilichoingia."));
    const c = cost.trim() ? Number(cost.replace(/[^\d.]/g, "")) : null;
    if (c != null && !(c >= 0)) return setErr(T("Cost must be a number.", "Gharama iwe namba."));
    if (!paidOn) return setErr(T("Enter the day they paid.", "Weka siku aliyolipa."));
    const paidAt = fromLocalInput(paidOn);
    if (!(Date.parse(paidAt) <= Date.now() + 3600e3)) return setErr(T("The payment day can't be in the future.", "Siku ya malipo haiwezi kuwa baadaye."));
    const txn = code.trim().toUpperCase().replace(/\s+/g, "");
    setBusy(true); setErr("");
    // Same customer, same amount, within 3 days of this payment: probably already recorded (e.g. from your ✅ message).
    // The same payment saved twice (same customer, same amount, paid within an hour of each other) is refused outright.
    {
      const t = Date.parse(paidAt);
      const { data: twin } = await supabase.from("orders").select("id").eq("workspace_id", ws.id).eq("conversation_id", r.id).eq("status", "paid").eq("amount", a)
        .gte("paid_at", new Date(t - 3600e3).toISOString()).lte("paid_at", new Date(t + 3600e3).toISOString()).limit(1);
      if (twin?.length) { setBusy(false); setPaidDone(true); return setDup(T("This payment is already saved for this customer, so it wasn't saved again.", "Malipo haya tayari yamehifadhiwa kwa mteja huyu, hayajahifadhiwa tena.")); }
    }
    if (!dupOk) {
      const t = Date.parse(paidAt);
      const { data: near } = await supabase.from("orders").select("id,paid_at,amount").eq("workspace_id", ws.id).eq("conversation_id", r.id).eq("status", "paid")
        .gte("paid_at", new Date(t - 3 * 864e5).toISOString()).lte("paid_at", new Date(t + 3 * 864e5).toISOString());
      const same = (near ?? []).find((o: any) => Math.round(Number(o.amount)) === Math.round(a));
      if (same) {
        setBusy(false); setDupOk(true);
        return setDup(T(`A sale of ${money(a, ws.currency)} is already recorded for this customer on ${new Date(same.paid_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Dar_es_Salaam" })}. If this is a second payment, press "Yes" again.`,
          `Mauzo ya ${money(a, ws.currency)} tayari yamerekodiwa kwa mteja huyu tarehe ${new Date(same.paid_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Dar_es_Salaam" })}. Kama ni malipo ya pili, bonyeza "Ndiyo" tena.`));
      }
    }
    const { data: user } = await supabase.auth.getUser();
    const { error } = await supabase.from("orders").insert({
      workspace_id: ws.id, conversation_id: r.id, amount: a, discount: 0, currency: ws.currency, status: "paid",
      // Products picked = the goods have left you (sent / handed over). None picked = paid, still to be sent (e.g. upcountry).
      fulfillment_status: items.length ? "shipped" : "not_shipped",
      occurred_at: paidAt, paid_at: paidAt, provenance: "manual", inferred_from: inferredFrom(r), created_by: user.user?.id, cost: c,
      items, product: items.length ? itemsLabel(items) : null,
      external_ref: txn ? "txn:" + txn : null,
      notes: [txn ? `Transaction ${txn}` : null, pm ? `Paid date read from the chat (${pm.kind}): "${pm.snippet.slice(0, 80)}"` : null].filter(Boolean).join("\n") || null,
    });
    setBusy(false);
    if (error) setErr(error.code === "23505" ? T(`Transaction ${txn} is already recorded for another sale. The same payment can't count twice.`, `Muamala ${txn} tayari umerekodiwa kwa mauzo mengine. Malipo hayo hayawezi kuhesabiwa mara mbili.`) : error.message);
    else { setPaidDone(true); setTimeout(onDone, 1100); }
  }
  // "No, they never paid": take the chat off Check payment for good (back to All). The word-rules and Kito
  // won't put it back; "Undo my answer" in the chat brings it back if you change your mind.
  async function never() {
    setBusy(true); setErr("");
    const { error } = await supabase.from("conversations").update({ outcome_override: "open", override_note: "never paid" }).eq("id", r.id);
    setBusy(false); if (error) setErr(error.message); else onDone();
  }

  return (
    <div className="cc-ask cc-pay">
      <b>{T("Did the money really come in?", "Pesa imeingia kweli?")}</b>
      {receipt && (
        <div className="cc-receipt small">
          <b>{T("Kito read the screenshot:", "Kito amesoma picha:")}</b>
          <span>{[receipt.provider, receipt.amount ? money(receipt.amount, receipt.currency ?? ws.currency) : null, receipt.txn_code ? T(`code ${receipt.txn_code}`, `muamala ${receipt.txn_code}`) : null].filter(Boolean).join(" · ")}</span>
          {receipt.paid_to && <span>{T("Paid to", "Imelipwa kwa")}: {receipt.paid_to}</span>}
          {receipt.paid_at && <span>{T("Time on receipt", "Muda kwenye risiti")}: {receipt.paid_at}</span>}
          {priced && receipt.amount && Math.round(receipt.amount) !== priced && <span className="warnt">⚠ {T(`Amount differs from the price you sent (${money(priced, ws.currency)}).`, `Kiasi ni tofauti na bei uliyotuma (${money(priced, ws.currency)}).`)}</span>}
          {daysOld != null && daysOld >= 2 && <span className="err">⚠ {T(`This receipt is dated ${daysOld} days before the customer sent it. It may be an old screenshot.`, `Risiti hii ni ya siku ${daysOld} kabla mteja hajaituma. Inaweza kuwa picha ya zamani.`)}</span>}
          {reused.usedInSale && <span className="err">⚠ {T("This transaction code is already recorded for another sale.", "Namba hii ya muamala tayari imerekodiwa kwa mauzo mengine.")}</span>}
          {reused.otherChats > 0 && <span className="err">⚠ {T(`The same receipt was also sent in ${reused.otherChats} other chat${reused.otherChats > 1 ? "s" : ""}.`, `Risiti hiyo hiyo imetumwa pia kwenye chat ${reused.otherChats} nyingine.`)}</span>}
          {notDone && <span className="warnt">⚠ {T("The receipt doesn't show the payment as completed.", "Risiti haionyeshi kwamba malipo yamekamilika.")}</span>}
          {receipt.confidence === "low" && <span className="warnt">⚠ {T("Hard to read — check carefully.", "Haisomeki vizuri — kagua kwa makini.")}</span>}
          {receipt.notes && <span className="muted">{receipt.notes}</span>}
        </div>
      )}
      <ol className="small cc-steps">
        <li>{T("A screenshot can be edited or reused. Open your own M-Pesa / Lipa namba / bank messages or app — not the customer's screenshot.", "Picha inaweza kughushiwa au kutumwa tena. Fungua ujumbe au app YAKO ya M-Pesa / Lipa namba / benki — si picha ya mteja.")}</li>
        <li>{T("Find a payment with the same amount, around the same time, from this customer's name or number.", "Tafuta malipo ya kiasi hicho, muda huo huo, kutoka jina au namba ya mteja huyu.")}</li>
        <li>{T("Copy its transaction code (e.g. QK41ABC9XY) below.", "Nakili namba ya muamala (mf. QK41ABC9XY) hapa chini.")}</li>
      </ol>
      <div className="cc-pay-fields">
        <label className="small">{T("Amount received", "Kiasi kilichoingia")} ({ws.currency})<input inputMode="decimal" value={amount} onChange={(e) => { moneyInput(setAmount)(e); setDupOk(false); setDup(null); }} placeholder="155,000" /></label>
        <label className="small">{T("Transaction code", "Namba ya muamala")}<input value={code} maxLength={40} onChange={(e) => setCode(e.target.value)} placeholder="QK41ABC9XY" /></label>
        <label className="small">{T("Paid on", "Alilipa lini")}<input type="datetime-local" value={paidOn} onChange={(e) => { setPaidOn(e.target.value); setDupOk(false); setDup(null); }} />
          {pm && <span className="muted">{T("From", "Kutoka")} {momentWhy(pm.kind, T)}{pm.snippet ? `: “${pm.snippet.slice(0, 60)}${pm.snippet.length > 60 ? "…" : ""}”` : ""}</span>}</label>
        {products && products.some((p) => p.active) && <div style={{ gridColumn: "1 / -1" }}><ProductPicker ws={ws} products={products} items={items} onChange={setItems} T={T} />
          <span className="small muted">{items.length ? T("Picking products marks this order as sent.", "Ukichagua bidhaa, oda inahesabiwa imetumwa.") : T("Still have to send it (e.g. upcountry)? Leave products empty — pick them later when you send.", "Bado hujatuma (mf. mkoani)? Acha bidhaa wazi — utazichagua ukizituma.")}</span></div>}
        <label className="small">{T("What this order cost you", "Oda hii imekugharimu")} ({ws.currency})<input inputMode="decimal" value={cost} onChange={moneyInput(setCost)} placeholder={ws.unit_cost != null ? T(`empty = default ${amt(Number(ws.unit_cost), ws.currency)}`, `wazi = kawaida ${amt(Number(ws.unit_cost), ws.currency)}`) : T("product + delivery", "bidhaa + usafiri")} />
          {fromPhotos && items.length > 0 && <span className="muted">{T("Products picked from the customer's photos — check they're right.", "Bidhaa zimechaguliwa kutoka picha za mteja — hakikisha ni sahihi.")}</span>}
          <span className="muted">{items.length ? T("Filled in from the products picked. You can change it.", "Imejazwa kutoka bidhaa ulizochagua. Unaweza kuibadilisha.") : T("Used to work out your profit. You can add it later.", "Inatumika kukokotoa faida. Unaweza kuiongeza baadaye.")}</span></label>
      </div>
      {dup && <span className="warnt small">⚠ {dup}</span>}
      <div className="cc-ask-btns">
        <button className={"small pay-yes" + (paidDone ? " done" : "")} disabled={busy || paidDone} onClick={yes}>{paidDone ? "✓ " : ""}{paidDone ? T("Money received — saved", "Pesa imeingia — imehifadhiwa") : T("Yes, money received", "Ndiyo, pesa imeingia")}</button>
        <button className="small" disabled={busy || paidDone} onClick={onLater}>{T("Nothing in yet — check later", "Bado haijaingia — nitaangalia baadaye")}</button>
      </div>
      <button className="small pay-never" disabled={busy || paidDone} onClick={never}>✗ {T("No, they never paid", "Hapana, hajalipa kabisa")}</button>
      <span className="small muted">{T("\"Yes\" records the sale and moves them to Bought. \"Never paid\" takes them off Check payment and back to All. \"Check later\" keeps them here.",
        "\"Ndiyo\" inarekodi mauzo na kumhamishia Amenunua. \"Hajalipa kabisa\" inamtoa Hakiki malipo na kumrudisha Zote. \"Baadaye\" inamwacha hapa.")}</span>
      {err && <span className="err small">{err}</span>}
    </div>
  );
}

/** A saved image or PDF from the customer, with what Kito read from it. */
export function MediaView({ m, ws, T }: { m: Msg; ws: Workspace; T: Tr }) {
  const [url, setUrl] = useState<string | null>(null);
  // Which of My products is in a customer's photo (asked once per photo; a suggestion, not a sale).
  const [pm, setPm] = useState<ProductMatch | null>(m.media?.product_match ?? null);
  const [matching, setMatching] = useState(false);
  useEffect(() => {
    const md = m.media;
    if (m.direction !== "in" || !md?.path || !/^image\//.test(md.mime ?? "") || md.receipt?.is_receipt || md.product_match) return;
    let live = true;
    productPhotosReady(ws.id).then((ok) => {
      if (!ok || !live) return;
      setMatching(true);
      callFn<{ match: ProductMatch | null }>("product-match", { workspace_id: ws.id, message_id: m.id })
        .then((r) => { if (live) setPm(r.match ?? null); }).catch(() => {}).finally(() => { if (live) setMatching(false); });
    });
    return () => { live = false; };
  }, [m.id, m.media?.receipt?.is_receipt]);
  const [big, setBig] = useState(false);
  useEffect(() => {
    if (!m.media?.path) return;
    supabase.storage.from("wa-media").createSignedUrl(m.media.path, 3600).then(({ data }) => setUrl(data?.signedUrl ?? null));
  }, [m.media?.path]);
  const r = m.media?.receipt;
  const isPdf = m.media?.mime === "application/pdf";
  const isAudio = /^audio\//.test(m.media?.mime ?? "") || m.type === "audio";
  // A voice note Kito has turned into text: body is "[voice note] <what was said>".
  const heard = (m.body ?? "").startsWith("[voice note] ") ? (m.body ?? "").slice(13).trim() : "";
  const caption = heard ? "" : (m.body ?? "").split("\n").filter((l) => !l.startsWith("[picha") && l !== "[image]" && l !== "[document]" && l !== "[voice note]").join("\n");
  return (
    <span className="mv">
      {url && (isAudio
        ? <span className="mv-audio"><audio controls preload="metadata" src={url}>{T("This browser can't play it.", "Kivinjari hiki hakiwezi kuicheza.")}</audio>
            <a className="small" href={url} target="_blank" rel="noopener noreferrer">{T("Open / download", "Fungua / pakua")}</a></span>
        : isPdf
        ? <a href={url} target="_blank" rel="noopener noreferrer">📄 {T("Open PDF", "Fungua PDF")}</a>
        : <img src={url} alt={m.direction === "in" ? T("Image from customer", "Picha kutoka kwa mteja") : T("Image you sent", "Picha uliyotuma")} onClick={() => setBig(true)} style={{ cursor: "zoom-in" }} />)}
      {big && url && <ImageViewer src={url} alt={m.direction === "in" ? T("Image from customer", "Picha kutoka kwa mteja") : T("Image you sent", "Picha uliyotuma")} sw={ws.language === "sw"} onClose={() => setBig(false)} />}
      {caption && <span>{caption}</span>}
      {heard && <span className="mv-heard"><b>{T("Voice note says:", "Sauti inasema:")}</b> {heard}</span>}
      {r?.is_receipt ? <span className="mv-tag">🧾 {T("Payment screenshot", "Picha ya malipo")}{r.amount ? ` · ${Math.round(r.amount).toLocaleString("en-US")}` : ""}{r.txn_code ? ` · ${r.txn_code}` : ""}</span>
        : pm?.is_product_photo && pm.name ? <span className="mv-tag" title={pm.notes ?? ""}>🏷 {pm.confidence === "low" ? T("Maybe", "Huenda ni") : T("Looks like", "Inaonekana ni")} {pm.name}{pm.alternatives.length ? ` (${T("or", "au")} ${pm.alternatives.map((a) => a.name).join(", ")})` : ""} <span className={"chip conf-" + pm.confidence}>{pm.confidence === "high" ? T("sure", "uhakika") : pm.confidence === "medium" ? T("fairly sure", "karibu uhakika") : T("not sure", "sina uhakika")}</span></span>
        : pm?.is_product_photo ? <span className="mv-tag muted">🏷 {T("A product, but not one of yours I recognise", "Ni bidhaa, lakini siitambui kati ya zako")}</span>
        : matching ? <span className="mv-tag muted">{T("Checking which product…", "Inaangalia ni bidhaa gani…")}</span>
        : r ? <span className="mv-tag muted">{r.notes ?? T("Not a payment", "Si malipo")}</span> : null}
    </span>
  );
}

/** "Not a customer": you on another phone, staff, delivery, a supplier, family… Takes the chat out of labelling
 *  for good — Kito stops reading it, no sale labels, no follow-ups, not counted — until you undo it. */
function NotCustomer({ r, T, busy, setBusy, onChange }: { r: Outcome; T: Tr; busy: boolean; setBusy: (b: boolean) => void; onChange: () => void }) {
  const set = async (v: boolean) => { setBusy(true); await markNotCustomer(r, v, v ? (r.kito_party && r.kito_party !== "customer" ? r.kito_party : "other") : undefined); setBusy(false); onChange(); };
  if (r.not_customer) return (
    <div className="cc-party small">
      <span>{r.not_customer_note && PARTY[r.not_customer_note] ? `${T(PARTY[r.not_customer_note][0], PARTY[r.not_customer_note][1])}. ` : ""}{T("No labels, no follow-ups, not in your numbers. Kito doesn't read this chat.", "Hakuna lebo, hakuna ufuatiliaji, hayumo kwenye takwimu. Kito hasomi chat hii.")}</span>
      <button className="small" disabled={busy} onClick={() => set(false)}>{busy ? T("Saving…", "Inahifadhi…") : T("Undo: they're a customer", "Rudisha: ni mteja")}</button>
    </div>
  );
  return (
    <button className="small cc-notcust" disabled={busy} title={T("You on another phone, staff, delivery, a supplier or family. The chat stops being labelled for good.", "Wewe kwa simu nyingine, mfanyakazi, msafirishaji, msambazaji au familia. Chat haitawekewa lebo tena.")}
      onClick={() => set(true)}>⊘ {busy ? T("Saving…", "Inahifadhi…") : T("Not a customer — stop labelling", "Si mteja — acha kuweka lebo")}</button>
  );
}


/** One-tap correction of Kito's hot / warm / cold. Kept until the customer writes again (migration 0052). */
function TempFix({ r, T, onChange }: { r: Outcome; T: Tr; onChange: () => void }) {
  const cur = interest(r);
  const [saving, setSaving] = useState<string | null>(null);
  const [note, setNote] = useState("");
  async function set(v: "hot" | "warm" | "cold") {
    if (v === cur) return;
    setSaving(v); setNote("");
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("conversations").update({ kito_temp: v, temp_override: v, temp_override_at: new Date().toISOString(), temp_override_by: u.user?.id ?? null }).eq("id", r.id);
    setSaving(null);
    if (error) setNote(error.message);
    else { setNote(T("Saved. Kito keeps your answer until the customer writes again.", "Imehifadhiwa. Kito atabaki na jibu lako hadi mteja aandike tena.")); onChange(); }
  }
  const opts: ["hot" | "warm" | "cold", string][] = [["hot", T("Very", "Sana")], ["warm", T("Some", "Kiasi")], ["cold", T("Not very", "Kidogo")]];
  return (
    <div className="cc-fromad">
      <span className="small">{T("How interested?", "Ana hamu kiasi gani?")}</span>
      <div className="seg" role="group" aria-label={T("How interested?", "Ana hamu kiasi gani?")}>
        {opts.map(([k, label]) => (
          <button key={k} type="button" className={k + (cur === k ? " on" : "")} aria-pressed={cur === k} disabled={!!saving} onClick={() => set(k)}>
            {saving === k ? <span className="kito-spin sm" aria-hidden /> : cur === k ? "✓ " : ""}{label}</button>
        ))}
      </div>
      {note && <span className={"small " + (/Saved|Imehifadhiwa/.test(note) ? "muted" : "err")} style={{ flexBasis: "100%" }}>{note}</span>}
    </div>
  );
}
