// Top bar, right side (23 Nov 2026): the owner's picture with their name and business, inside a ring that says
// how things stand. Tapping it opens a menu: language, Settings, My profile, (Pondi admin for staff), Sign out.
// The theme button stays outside, next to it. On phones only the picture shows and the menu opens as a sheet.
//   ring  green: nothing waiting · amber + number: things in "Do this now" · red + "!": a payment looks fake
//         or a connection is broken
import { useEffect, useRef, useState } from "react";
import { supabase, Workspace } from "./lib";
import { useKept } from "./keep";
import { useBackLayer } from "./backStack";
import { ringOf, type RingIn } from "./profileRing";

export const PROFILE_EVT = "itaos-profile";
type Me = { name: string; email: string; photo: string | null };

function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    const load = () => supabase.auth.getUser().then(({ data }) => {
      const u = data.user; if (!u) return;
      setMe({ name: String(u.user_metadata?.full_name ?? "").trim(), email: u.email ?? "", photo: (u.user_metadata?.avatar_url as string) || null });
    });
    void load();
    window.addEventListener(PROFILE_EVT, load);
    return () => window.removeEventListener(PROFILE_EVT, load);
  }, []);
  return me;
}

/** The counts behind the ring, refreshed every 5 minutes and when the app comes back to the front. */
function useRing(ws: Workspace) {
  const [x, setX] = useKept<RingIn | null>("ring:" + ws.id, null);
  useEffect(() => {
    let live = true;
    const load = async () => {
      const since = new Date(Date.now() - 3 * 864e5).toISOString(), now = new Date().toISOString();
      const [pay, w, o, a] = await Promise.all([
        supabase.rpc("payment_checks", { p_ws: ws.id, p_days: 14 }),
        supabase.from("conversations").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id).eq("last_dir", "in").gte("last_message_at", since).or("last_in_closing.is.null,last_in_closing.eq.false"),
        supabase.from("follow_up_tasks").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id).eq("source", "kito_promise").eq("status", "open").lt("due_at", now),
        supabase.from("connection_alerts").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id).is("resolved_at", null),
      ]);
      if (!live) return;
      const p = (pay.data ?? {}) as { to_check?: number; to_check_red?: number };
      setX({ payRed: p.to_check_red ?? 0, payAmber: (p.to_check ?? 0) - (p.to_check_red ?? 0), waiting: w.count ?? 0, overdue: o.count ?? 0, broken: a.error ? 0 : a.count ?? 0 });
    };
    void load();
    const id = window.setInterval(() => { if (!document.hidden) void load(); }, 5 * 60e3);
    const vis = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", vis);
    return () => { live = false; window.clearInterval(id); document.removeEventListener("visibilitychange", vis); };
  }, [ws.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return x;
}

export function Avatar({ me, size = 38 }: { me: Pick<Me, "name" | "email" | "photo">; size?: number }) {
  const letter = (me.name || me.email || "?").trim().slice(0, 1).toUpperCase();
  return me.photo
    ? <img className="pm-ava" src={me.photo} alt="" width={size} height={size} style={{ width: size, height: size }} />
    : <span className="pm-ava pm-letter" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden>{letter}</span>;
}

export default function ProfileMenu({ ws, staff, language, onLanguage }: {
  ws: Workspace; staff: boolean; language: "sw" | "en"; onLanguage: (l: "sw" | "en") => void;
}) {
  const T = (en: string, sw: string) => (ws.language === "sw" ? sw : en);
  const me = useMe();
  const ringIn = useRing(ws);
  const ring = ringOf(ringIn);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useBackLayer(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  // Phones: hide the floating nav while the sheet is up (CSS slides it down).
  useEffect(() => {
    document.documentElement.classList.toggle("pm-open", open);
    return () => document.documentElement.classList.remove("pm-open");
  }, [open]);
  const go = (hash: string) => { setOpen(false); location.hash = hash; };

  const name = me?.name || me?.email.split("@")[0] || T("You", "Wewe");
  const ringLabel = ring.tone === "red" ? T("Something needs you now", "Kuna jambo linalokuhitaji sasa")
    : ring.tone === "amber" ? T(`${ring.count} ${ring.count === 1 ? "thing needs" : "things need"} you`, `Mambo ${ring.count} yanakuhitaji`)
    : ring.tone === "green" ? T("All clear", "Kila kitu sawa") : "";

  return (
    <div className="pm" ref={box}>
      <button type="button" className="pm-pill" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((x) => !x)}
        aria-label={T(`${name}, ${ws.name}. ${ringLabel}. Open menu`, `${name}, ${ws.name}. ${ringLabel}. Fungua menyu`)}>
        <span className={"pm-ring t-" + ring.tone}>
          {me ? <Avatar me={me} /> : <span className="pm-ava pm-letter" style={{ width: 38, height: 38 }} />}
          {ring.badge && <span className="pm-badge">{ring.badge}</span>}
        </span>
        <span className="pm-who"><b>{name}</b><small>{ws.name}</small></span>
        <svg className="pm-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && <>
        <div className="pm-scrim" aria-hidden onClick={() => setOpen(false)} />
        <div className="pm-menu" role="menu" aria-label={T("Your menu", "Menyu yako")}>
          <span className="pm-grip" aria-hidden />
          <div className="pm-head">
            {me && <Avatar me={me} size={48} />}
            <span><b>{name}</b><small>{me?.email}</small><small>{ws.name}</small></span>
          </div>
          {ring.tone !== "none" && (
            <a role="menuitem" href="#dashboard" className={"pm-status t-" + ring.tone} onClick={(e) => { e.preventDefault(); go("#dashboard"); }}>
              <i aria-hidden />{ringLabel}{ring.tone !== "green" && <span aria-hidden> ›</span>}
            </a>
          )}
          <div className="pm-row">
            <span>{T("Language", "Lugha")}</span>
            <span className="pm-seg" role="group" aria-label={T("Language", "Lugha")}>
              {(["sw", "en"] as const).map((l) => <button key={l} type="button" className={language === l ? "on" : ""} aria-pressed={language === l} onClick={() => { setOpen(false); onLanguage(l); }}>{l === "sw" ? "Kiswahili" : "English"}</button>)}
            </span>
          </div>
          <a role="menuitem" href="#settings" onClick={(e) => { e.preventDefault(); go("#settings"); }}>{T("Settings", "Mipangilio")}</a>
          <a role="menuitem" href="#settings/account" onClick={(e) => { e.preventDefault(); go("#settings/account"); }}>{T("My profile and photo", "Wasifu wangu na picha")}</a>
          {staff && <a role="menuitem" href="/app/admin">{T("Pondi admin", "Pondi admin")} <small>{T("staff only", "wafanyakazi tu")}</small></a>}
          <button role="menuitem" type="button" className="pm-out" onClick={() => { setOpen(false); void supabase.auth.signOut({ scope: "local" }); }}>{T("Sign out", "Toka")}</button>
        </div>
      </>}
    </div>
  );
}
