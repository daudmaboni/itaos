// Dynamic-Island-style pop-up for new WhatsApp messages while itaOS is open.
// A black pill drops from the top, grows into a card (customer, message preview), and opens the chat on tap.
// Phone notifications (push) still cover the app when it is closed; this covers the app when it is open.
import { useEffect, useRef, useState } from "react";
import { supabase } from "./lib";
import type { Workspace } from "./lib";
import "./island.css";

type Note = { id: string; name: string; text: string; count: number };
type Phase = "hidden" | "pill" | "open" | "leaving";

const KEY = "itaos-island";
export const islandOn = () => { try { return localStorage.getItem(KEY) !== "off"; } catch { return true; } };
export const setIslandOn = (on: boolean) => { try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* ignore */ } };
/** Show a sample pop-up (Settings → Phone app → "Show me"). */
export const islandPreview = (sw: boolean) => window.dispatchEvent(new CustomEvent("itaos:island", {
  detail: { id: "", name: sw ? "Mteja (mfano)" : "Customer (example)", text: sw ? "Habari, bidhaa hii inapatikana bei gani?" : "Hi, how much is this one?", count: 1 } satisfies Note,
}));

const SHOW_MS = 5500;

function preview(type: string, body: string | null, sw: boolean) {
  const T = (en: string, s: string) => (sw ? s : en);
  switch (type) {
    case "image": return "📷 " + (body && body !== "[image]" ? body : T("Photo", "Picha"));
    case "audio": return "🎤 " + T("Voice note", "Ujumbe wa sauti");
    case "video": return "🎥 " + (body && body !== "[video]" ? body : T("Video", "Video"));
    case "document": return "📄 " + (body && body !== "[document]" ? body : T("File", "Faili"));
    case "location": return "📍 " + T("Location", "Mahali");
    case "sticker": return T("Sticker", "Stika");
    default: { const t = (body ?? "").replace(/\s+/g, " ").trim(); return t.length > 120 ? t.slice(0, 119) + "…" : t || T("New message", "Ujumbe mpya"); }
  }
}

const openChatId = () => location.hash.match(/#chats\/open=([0-9a-f-]+)/i)?.[1] ?? null;

export default function Island({ ws }: { ws: Workspace }) {
  const sw = ws.language === "sw";
  const [note, setNote] = useState<Note | null>(null);
  const [phase, setPhase] = useState<Phase>("hidden");
  const phaseRef = useRef<Phase>("hidden");
  phaseRef.current = phase;
  const seen = useRef(new Map<string, string>()); // chat id → last_message_at already handled
  const timers = useRef<number[]>([]);
  const hideAt = useRef<number | undefined>(undefined);
  const paused = useRef(false);
  const burst = useRef<{ start: number; n: number }>({ start: 0, n: 0 });
  const touchY = useRef<number | null>(null);

  const clearTimers = () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; window.clearTimeout(hideAt.current); };
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };
  const scheduleHide = () => {
    window.clearTimeout(hideAt.current);
    hideAt.current = window.setTimeout(() => { if (!paused.current) dismiss(); else scheduleHide(); }, SHOW_MS);
  };
  const dismiss = () => {
    clearTimers();
    if (phaseRef.current === "hidden") return;
    setPhase("leaving");
    later(() => { setPhase("hidden"); setNote(null); }, 420);
  };

  const show = (n: Note) => {
    clearTimers();
    const showing = phaseRef.current === "open" || phaseRef.current === "pill";
    setNote(n);
    setPhase("pill");
    later(() => setPhase("open"), showing ? 160 : 380); // already up: quick squeeze, then the new card; else pill first, then it grows
    try { if (document.visibilityState === "visible") navigator.vibrate?.(18); } catch { /* not supported */ }
    scheduleHide();
  };

  // Settings preview
  useEffect(() => {
    const onPreview = (e: Event) => show((e as CustomEvent<Note>).detail);
    window.addEventListener("itaos:island", onPreview);
    return () => window.removeEventListener("itaos:island", onPreview);
  }, []);

  // Live: a chat's summary changes whenever a message lands, so watch chats (messages aren't streamed).
  useEffect(() => {
    seen.current.clear();
    const ch = supabase.channel("island-" + ws.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `workspace_id=eq.${ws.id}` }, async (p: any) => {
        const c = p?.new;
        if (!c?.id || c.last_dir !== "in" || !c.last_message_at || c.phone_number_id === "import") return;
        if (seen.current.get(c.id) === c.last_message_at) return; // Kito's label updates, re-analysis etc.
        seen.current.set(c.id, c.last_message_at);
        if (Date.now() - Date.parse(c.last_message_at) > 3 * 60_000) return; // backfills / history, not fresh news
        if (!islandOn() || document.visibilityState !== "visible") return; // phone notification covers a hidden app
        if (openChatId() === c.id) return; // already reading this chat

        // A newly connected number can flood in: after 3 in 4 s, show one "N new messages" card instead.
        const now = Date.now();
        if (now - burst.current.start > 4000) burst.current = { start: now, n: 0 };
        burst.current.n += 1;
        if (burst.current.n > 3) {
          show({ id: "", name: sw ? "Ujumbe mpya" : "New messages", text: sw ? `Wateja ${burst.current.n} wameandika` : `${burst.current.n} customers wrote`, count: burst.current.n });
          return;
        }

        const [{ data: row }, { data: msg }] = await Promise.all([
          supabase.from("conversation_outcomes").select("contact_name").eq("workspace_id", ws.id).eq("id", c.id).maybeSingle(),
          supabase.from("messages").select("type,body").eq("conversation_id", c.id).eq("direction", "in").order("sent_at", { ascending: false }).limit(1).maybeSingle(),
        ]);
        if (burst.current.n > 3) return; // a flood started while we were loading
        const name = String(row?.contact_name ?? "").replace(/✅/g, "").trim() || (sw ? "Mteja" : "Customer");
        show({ id: c.id, name, text: preview(msg?.type ?? "text", msg?.body ?? null, sw), count: 1 });
      })
      .subscribe();
    return () => { clearTimers(); supabase.removeChannel(ch); };
  }, [ws.id, sw]);

  // Opening the chat some other way hides its pop-up.
  useEffect(() => {
    const onHash = () => { if (note?.id && openChatId() === note.id) dismiss(); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [note?.id]);

  if (phase === "hidden" || !note) return null;

  const open = () => {
    location.hash = note.id ? "#chats/open=" + note.id : "#chats";
    dismiss();
  };

  return (
    <div className="isl-wrap" role="status" aria-live="polite">
      <div
        className={"isl " + phase}
        onMouseEnter={() => { paused.current = true; }}
        onMouseLeave={() => { paused.current = false; }}
        onTouchStart={(e) => { touchY.current = e.touches[0].clientY; paused.current = true; }}
        onTouchMove={(e) => { if (touchY.current !== null && e.touches[0].clientY - touchY.current < -24) { touchY.current = null; dismiss(); } }}
        onTouchEnd={() => { touchY.current = null; paused.current = false; }}
      >
        <button type="button" className="isl-main" onClick={open} aria-label={(sw ? "Fungua chat ya " : "Open chat with ") + note.name}>
          <span className="isl-av" aria-hidden="true">{note.count > 1 ? note.count : note.name.slice(0, 1).toUpperCase()}<i className="isl-wa" /></span>
          <span className="isl-txt">
            <span className="isl-top"><b>{note.name}</b><em>{sw ? "sasa hivi" : "now"}</em></span>
            <span className="isl-msg">{note.text}</span>
          </span>
          <span className="isl-cta">{note.id ? (sw ? "Jibu" : "Reply") : (sw ? "Fungua" : "Open")}</span>
        </button>
        <button type="button" className="isl-x" onClick={dismiss} aria-label={sw ? "Funga" : "Close"}>×</button>
        <span className="isl-dot" aria-hidden="true" />
      </div>
    </div>
  );
}
