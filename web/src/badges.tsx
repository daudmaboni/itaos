import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./lib";

export type Badges = { chats_waiting: number; chats_new: number; actions_due: number };
const ZERO: Badges = { chats_waiting: 0, chats_new: 0, actions_due: 0 };

/**
 * Live counts for the nav badges. Refreshes on new messages / chat changes (realtime),
 * every 60 s, and when the tab comes back into view. Opening Chats marks it seen, which
 * clears the green "new chats" count; the red "waiting" count only clears when someone replies.
 */
export function useNavBadges(wsId: string, view: string): Badges {
  const [b, setB] = useState<Badges>(ZERO);
  const viewRef = useRef(view);
  viewRef.current = view;

  const load = useCallback(async () => {
    if (!wsId) return;
    if (viewRef.current === "chats") await supabase.rpc("mark_nav_seen", { ws: wsId, what: "chats" });
    const { data, error } = await supabase.rpc("nav_badges", { ws: wsId });
    if (!error && data) setB({ ...ZERO, ...(data as Badges) });
  }, [wsId]);

  useEffect(() => { load(); }, [load, view]);

  useEffect(() => {
    if (!wsId) return;
    let t: number | undefined;
    // Throttled (one per 5 s) and only while the tab is visible; the visibility handler below catches up.
    const soon = () => { if (t !== undefined || document.visibilityState !== "visible") return; t = window.setTimeout(() => { t = undefined; load(); }, 5000); };
    const ch = supabase.channel("badges-" + wsId)
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

/** One WhatsApp-style count. Red when customers are waiting, else green for new chats. */
export function chatsBadge(b: Badges, sw: boolean): { n: number; tone: "red" | "green"; title: string } | null {
  if (b.chats_waiting > 0) return { n: b.chats_waiting, tone: "red", title: sw ? `Wateja ${b.chats_waiting} wanasubiri jibu` : `${b.chats_waiting} customer${b.chats_waiting === 1 ? "" : "s"} waiting for a reply` };
  if (b.chats_new > 0) return { n: b.chats_new, tone: "green", title: sw ? `Chats mpya ${b.chats_new}` : `${b.chats_new} new chat${b.chats_new === 1 ? "" : "s"}` };
  return null;
}
export function actionsBadge(b: Badges, sw: boolean) {
  return b.actions_due > 0 ? { n: b.actions_due, tone: "green" as const, title: sw ? `Ufuatiliaji ${b.actions_due} umefika muda` : `${b.actions_due} follow-up${b.actions_due === 1 ? "" : "s"} due` } : null;
}

export function NavBadge({ badge }: { badge: { n: number; tone: "red" | "green"; title: string } | null }) {
  if (!badge) return null;
  // key = count, so the pop animation replays whenever the number changes.
  return <span key={badge.n} className={"navbadge " + badge.tone} title={badge.title} aria-label={badge.title}>{badge.n > 99 ? "99+" : badge.n}</span>;
}
