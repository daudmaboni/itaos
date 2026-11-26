// "Send in WhatsApp" (26 Nov 2026): one tap opens the customer's chat in the owner's WhatsApp with Kito's
// message already typed. The owner presses send there. This works while Meta has not verified the business
// (sending from itaOS is blocked until then) and has no 24-hour rule, because it's the owner's own phone.
// When the sent message comes back to itaOS (Coexistence echo), the card marks itself done: onSent runs.
// The tap is remembered in localStorage, so it still completes if the phone reloads the app on return.
import { useEffect, useRef, useState } from "react";
import { supabase } from "./lib";
import { phoneOf } from "./chatParts";

const KEY = (c: string) => "watap:" + c;
const WAIT = 30 * 60e3;          // stop watching 30 minutes after the tap
const CHECK = 5000;              // look for the echo every 5 s while visible

type Tap = { at: number; text: string };
function readTap(c: string): Tap | null {
  try { const x = JSON.parse(localStorage.getItem(KEY(c)) ?? "null"); return x && Date.now() - x.at < WAIT ? x : null; } catch { return null; }
}
function clearTap(c: string) { try { localStorage.removeItem(KEY(c)); } catch { /* private mode */ } }

const phones = new Map<string, string | null>();
async function phoneFor(conversationId: string): Promise<string | null> {
  if (phones.has(conversationId)) return phones.get(conversationId)!;
  const { data } = await supabase.from("conversations").select("contacts(wa_id)").eq("id", conversationId).maybeSingle();
  const p = phoneOf((data as any)?.contacts?.wa_id ?? undefined);
  phones.set(conversationId, p);
  return p;
}

export function waLink(phone: string, text: string | null | undefined) {
  return `https://wa.me/${phone}${text?.trim() ? "?text=" + encodeURIComponent(text.trim()) : ""}`;
}

export function WaTap({ conversationId, draft, T, onSent, primary = true }: {
  conversationId: string; draft: string | null | undefined;
  T: (en: string, sw: string) => string;
  /** runs once when the message the owner sent from WhatsApp reaches itaOS */
  onSent?: (sentText: string) => void | Promise<void>;
  primary?: boolean;
}) {
  const [phone, setPhone] = useState<string | null | undefined>(undefined);
  const [waiting, setWaiting] = useState(() => !!readTap(conversationId));
  const done = useRef(false);
  const sent = useRef(onSent); sent.current = onSent;

  useEffect(() => { let live = true; phoneFor(conversationId).then((p) => { if (live) setPhone(p); }); return () => { live = false; }; }, [conversationId]);

  // Watch for the owner's message to arrive back (echo from the WhatsApp app).
  useEffect(() => {
    if (!waiting) return;
    done.current = false;
    let stop = false;
    const look = async () => {
      const tap = readTap(conversationId);
      if (!tap) { setWaiting(false); return; }
      if (document.visibilityState !== "visible" || done.current) return;
      const { data } = await supabase.from("messages").select("body,sent_at").eq("conversation_id", conversationId).eq("direction", "out")
        .gte("sent_at", new Date(tap.at - 60e3).toISOString()).order("sent_at", { ascending: false }).limit(1);
      if (stop || done.current || !data?.length) return;
      done.current = true;
      clearTap(conversationId);
      setWaiting(false);
      await sent.current?.(String(data[0].body ?? tap.text));
    };
    void look();
    const t = window.setInterval(look, CHECK);
    const vis = () => { if (document.visibilityState === "visible") void look(); };
    document.addEventListener("visibilitychange", vis);
    return () => { stop = true; window.clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [waiting, conversationId]);

  if (phone === null) return null;   // no usable number on this contact
  const go = () => {
    if (!phone) return;
    try { localStorage.setItem(KEY(conversationId), JSON.stringify({ at: Date.now(), text: draft ?? "" })); } catch { /* private mode */ }
    setWaiting(true);
    window.open(waLink(phone, draft), "_blank", "noopener");
  };
  return (
    <span className="watap">
      <button className={primary ? "primary wa-go" : "pc-pick wa-go"} disabled={!phone} onClick={go}
        title={T("Opens their chat in your WhatsApp with the message typed. Press send there; itaOS marks it done by itself.", "Inafungua chat yake kwenye WhatsApp yako ujumbe ukiwa umeandikwa. Bonyeza tuma huko; itaOS itaweka imekamilika yenyewe.")}>
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.6 2.6 0 0 0 1.7-1.2 2.1 2.1 0 0 0 .1-1.2c0-.1-.2-.2-.4-.3Z" /></svg>
        {T("Send in WhatsApp", "Tuma WhatsApp")}
      </button>
      {waiting && <span className="small muted wa-wait">{T("Press send in WhatsApp. This card clears itself.", "Bonyeza tuma WhatsApp. Kadi hii itaondoka yenyewe.")}</span>}
    </span>
  );
}
