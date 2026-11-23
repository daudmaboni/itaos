import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./lib";

export type Badges = { chats_waiting: number; chats_waiting_new: number; chats_new: number; actions_due: number; actions_due_new: number };
const ZERO: Badges = { chats_waiting: 0, chats_waiting_new: 0, chats_new: 0, actions_due: 0, actions_due_new: 0 };

/**
 * Live counts for the nav badges. Refreshes on new messages / chat changes (realtime),
 * every 60 s, and when the tab comes back into view.
 * Badges tell the truth (23 Nov 2026, after The Glide Studio's "A badge should tell the truth"):
 *  1. clear on view — opening Chats or Actions marks it seen;
 *  2. count down — counts are live, so each customer you answer drops off;
 *  3. only what is new — the coloured number counts only what arrived since you last looked; what you've
 *     already seen but is still open shows as a quiet grey number.
 */
export function useNavBadges(wsId: string, view: string): Badges {
  const [b, setB] = useState<Badges>(ZERO);
  const viewRef = useRef(view);
  viewRef.current = view;

  const load = useCallback(async () => {
    if (!wsId) return;
    if (viewRef.current === "chats") await supabase.rpc("mark_nav_seen", { ws: wsId, what: "chats" });
    if (viewRef.current === "actions" || viewRef.current === "attention") await supabase.rpc("mark_nav_seen", { ws: wsId, what: "actions" });
    const { data, error } = await supabase.rpc("nav_badges", { ws: wsId });
    if (!error && data) setB({ ...ZERO, ...(data as Badges) });
  }, [wsId]);

  useEffect(() => { load(); }, [load, view]);

  useEffect(() => {
    if (!wsId) return;
    let t: number | undefined;
    // Throttled (one per 5 s) and only while the tab is visible; the visibility handler below catches up.
    const soon = () => { if (t !== undefined || document.visibilityState !== "visible") return; t = window.setTimeout(() => { t = undefined; load(); }, 5000); };
    const ch = supabase.channel(`badges-${wsId}-${Math.random().toString(36).slice(2, 10)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `workspace_id=eq.${wsId}` }, soon)
      .subscribe();
    const iv = window.setInterval(() => { if (document.visibilityState === "visible") load(); }, 60_000);
    const vis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", vis);
    const pulled = () => { load(); }; // pull-to-refresh
    window.addEventListener("itaos-refresh", pulled);
    return () => { window.clearTimeout(t); window.clearInterval(iv); document.removeEventListener("visibilitychange", vis); window.removeEventListener("itaos-refresh", pulled); supabase.removeChannel(ch); };
  }, [wsId, load]);

  return b;
}

type Tone = "red" | "green" | "grey";
/** Chats: red = customers waiting who wrote since you last opened Chats; green = new chats; grey = still waiting,
 *  but you've seen them. (An older database without the "_new" counts treats everything as new.) */
export function chatsBadge(b: Badges, sw: boolean): { n: number; tone: Tone; title: string } | null {
  const fresh = b.chats_waiting_new ?? b.chats_waiting;
  if (fresh > 0) return { n: fresh, tone: "red", title: sw ? `Wateja ${fresh} wapya wanasubiri jibu` : `${fresh} new customer${fresh === 1 ? "" : "s"} waiting for a reply` };
  if (b.chats_new > 0) return { n: b.chats_new, tone: "green", title: sw ? `Chats mpya ${b.chats_new}` : `${b.chats_new} new chat${b.chats_new === 1 ? "" : "s"}` };
  if (b.chats_waiting > 0) return { n: b.chats_waiting, tone: "grey", title: sw ? `Wateja ${b.chats_waiting} bado wanasubiri (umeshawaona)` : `${b.chats_waiting} still waiting (you've seen them)` };
  return null;
}
/** Actions: green = follow-ups that became due since you last opened Actions; grey = due, already seen. */
export function actionsBadge(b: Badges, sw: boolean): { n: number; tone: Tone; title: string } | null {
  const fresh = b.actions_due_new ?? b.actions_due;
  if (fresh > 0) return { n: fresh, tone: "green", title: sw ? `Ufuatiliaji mpya ${fresh} umefika muda` : `${fresh} new follow-up${fresh === 1 ? "" : "s"} due` };
  if (b.actions_due > 0) return { n: b.actions_due, tone: "grey", title: sw ? `Ufuatiliaji ${b.actions_due} bado (umeshaona)` : `${b.actions_due} follow-up${b.actions_due === 1 ? "" : "s"} still due (you've seen them)` };
  return null;
}

export function NavBadge({ badge }: { badge: { n: number; tone: Tone; title: string } | null }) {
  if (!badge) return null;
  // key = count, so the pop animation replays whenever the number changes.
  return <span key={badge.n} className={"navbadge " + badge.tone} title={badge.title} aria-label={badge.title}>{badge.n > 99 ? "99+" : badge.n}</span>;
}
