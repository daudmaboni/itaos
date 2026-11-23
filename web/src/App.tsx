import { useNavBadges, chatsBadge, actionsBadge, NavBadge, Badges } from "./badges";
import { AppTip } from "./PhoneApp";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { pageTransition, navFlags, curtainCover, curtainReveal } from "./pageTransition";
import { enterShell, enterTiles, shake, switchTheme, applyThemeMode, usePageEnter, select, type ThemeMode } from "./motion";
import type { Session } from "@supabase/supabase-js";
import { supabase, Workspace, WS_COLUMNS, Role, PASSWORD_RECOVERY } from "./lib";
import { AuthScreen, SetNewPassword, initialLang, tr, AuthShell, AuthBrand, AuthField, AuthIcon } from "./Auth";
import Dashboard from "./Dashboard";
import ProfileMenu from "./ProfileMenu";
import Chats from "./Chats";
import Connect from "./Connect";
import Settings from "./Settings";
import Actions from "./Actions";
import Receipts from "./Receipts";
import PaymentGuard from "./PaymentGuard";
import LeakGuard from "./LeakGuard";
import Buyers from "./Buyers";
import Kito from "./Kito";
import Island from "./Island";
import Products from "./Products";
import Logo, { KitoLogo } from "./Logo";
import { hidePreloader } from "./preloader";
import { depth, onLayer, leaveLayers, afterBack, pushEntry, replaceEntry, useBackLayer } from "./backStack";
import { useIsPlatformAdmin } from "./adminAccess";

type View = "dashboard" | "kito" | "attention" | "report" | "actions" | "receipts" | "payments" | "ads" | "why" | "leaks" | "buyers" | "chats" | "products" | "connect" | "settings";
const VIEWS: View[] = ["dashboard", "kito", "attention", "report", "actions", "receipts", "payments", "ads", "why", "leaks", "buyers", "chats", "products", "connect", "settings"];
const viewFromHash = (): View => {
  const h = location.hash.replace("#", "").split("/")[0];
  return (VIEWS as string[]).includes(h) ? (h as View) : "dashboard";
};

/** Phone page change without piling up history (22 Nov 2026; numbered entries 23 Nov 2026, see backStack.ts).
 *  Leaving Home adds one entry, every other tab/swipe move replaces the current one, and the Home tab steps
 *  straight back to the first entry. So Back from any page goes Home, and Back from Home leaves the app,
 *  like a native app, even after following links between pages. An open popup is closed first. */
export function phoneGo(v: View) {
  if (onLayer()) { leaveLayers(() => phoneGo(v)); return; }
  const cur = viewFromHash();
  if (v === cur) return;
  const d = depth();
  if (v === "dashboard" && d > 0) {
    // fires hashchange; if the app was opened on another page, that first entry becomes Home
    afterBack(() => { if (viewFromHash() !== "dashboard") { replaceEntry("#dashboard"); window.dispatchEvent(new HashChangeEvent("hashchange")); } });
    history.go(-d);
    return;
  }
  if (cur === "dashboard" && d === 0) pushEntry("#" + v);
  else history.replaceState({ itaDepth: d }, "", "#" + v);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [ws, setWs] = useState<Workspace | null | undefined>(undefined);
  const [recovering, setRecovering] = useState(PASSWORD_RECOVERY);
  const [view, setView] = useState<View>(viewFromHash());
  setViewRef.current = setView;
  const viewRef = useRef<View>(view);
  const hadSession = useRef<boolean | null>(null); // null until the first check: a reload never plays the curtain
  const curtainPending = useRef(false);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try { const t = localStorage.getItem("itaos-theme"); return t === "dark" || t === "graphite" ? "graphite" : "light"; } catch { return "light"; } // light is the default
  });
  useEffect(() => { applyThemeMode(theme); }, []);
  const themeBtn = useRef<HTMLButtonElement>(null);
  const setThemeFrom = (n: ThemeMode, from?: HTMLElement | null) => {
    if (n === theme) return;
    switchTheme(n, from ?? themeBtn.current); // circular wipe from the button, then the attribute + storage are set
    setTheme(n);
  };
  // One button flips light ↔ dark (graphite). The navy dark was removed (21 Nov); anyone who had it now gets graphite.
  const NEXT: Record<ThemeMode, ThemeMode> = { light: "graphite", graphite: "light", dark: "light" };
  const toggleTheme = () => setThemeFrom(NEXT[theme]);
  // Language switch = the same curtain wipe as the itaos.app homepage: the pill slides, a green panel
  // sweeps up over the app, the language changes behind it, then the panel lifts off the top.
  const [langPill, setLangPill] = useState<"sw" | "en" | null>(null);
  const [curtain, setCurtain] = useState<{ phase: "idle" | "cover" | "reveal"; label: string }>({ phase: "idle", label: "" });
  const saveLanguage = async (l: "sw" | "en") => {
    if (!ws) return;
    setWs({ ...ws, language: l }); // everyone in the workspace sees the new default
    const { error } = await supabase.from("workspaces").update({ language: l }).eq("id", ws.id);
    if (error) setWs(ws);
  };
  const setLanguage = (l: "sw" | "en") => {
    if (!ws || ws.language === l || curtain.phase !== "idle") return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { void saveLanguage(l); return; }
    setLangPill(l);
    setCurtain({ phase: "cover", label: l === "sw" ? "Kiswahili" : "English" });
    window.setTimeout(() => {
      void saveLanguage(l);
      window.setTimeout(() => setCurtain((c) => ({ ...c, phase: "reveal" })), 120);
      window.setTimeout(() => { setCurtain({ phase: "idle", label: "" }); setLangPill(null); }, 120 + 700);
    }, 620);
  };
  const isPlatformAdmin = useIsPlatformAdmin(session ? session.user.id : null);
  const [staffOnly, setStaffOnly] = useState(false); // a Pondi staff account with no business of its own
  const [paused, setPaused] = useState(false); // Pondi set this business to "suspended" in admin
  const shellRef = usePageEnter<HTMLDivElement>((root) => { enterShell(root); }, [!!session && !!ws]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { hadSession.current = !!data.session; setSession(data.session); });
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => {
      // Just signed in from the login screen: the full panel curtain carries them into the app (a big
      // moment, so the short pause feels deliberate). It lifts once the business has loaded.
      if (e === "SIGNED_IN" && s && hadSession.current === false) { curtainPending.current = true; void curtainCover(initialLang() === "en" ? "Welcome" : "Karibu"); }
      // Signing out (or a fresh sign-in) always starts on the dashboard: the page the last person was on
      // (e.g. #settings, where Sign out lives) must not carry over to the next account on this device.
      if (e === "SIGNED_OUT" || (e === "SIGNED_IN" && s && hadSession.current === false)) {
        if (location.hash) history.replaceState({ itaDepth: depth() }, "", location.pathname + location.search);
        viewRef.current = "dashboard"; setView("dashboard");
      }
      hadSession.current = !!s;
      setSession(s); if (e === "PASSWORD_RECOVERY") setRecovering(true);
    });
    const onHash = () => {
      const next = viewFromHash();
      if (next === viewRef.current) return;
      if (!document.querySelector(".page-view")) { viewRef.current = next; setView(next); return; }
      const from = viewRef.current;
      viewRef.current = next;
      // Phone swipe: the page already leaned with the finger; PageView slides the new one in from that side.
      if (navFlags.swipe && window.matchMedia(PHONE_NAV).matches) { window.scrollTo({ top: 0 }); flushSync(() => setView(next)); return; }
      navFlags.swipe = 0;
      if (window.matchMedia(PHONE_NAV).matches && phoneSwitch(from, next)) return;
      pageTransition({
        swap: () => flushSync(() => setView(next)),
        area: () => { // the yellow line runs along the bottom edge of the top bar
          const bar = document.querySelector(".topbar")?.getBoundingClientRect();
          return { top: bar && bar.bottom > 0 ? bar.bottom - 1 : 0 };
        },
        stage: () => document.querySelector<HTMLElement>(".page-view"),
      });
    };
    window.addEventListener("hashchange", onHash);
    return () => { sub.subscription.unsubscribe(); window.removeEventListener("hashchange", onHash); };
  }, []);

  useEffect(() => {
    if (!session) { setWs(undefined); return; }
    supabase.from("workspaces").select(WS_COLUMNS).order("created_at").limit(1).then(async ({ data }) => {
      let w: Workspace | null = (data?.[0] as unknown as Workspace) ?? null;
      if (!w) {
        const { data: staff } = await supabase.rpc("is_platform_admin");
        if (staff === true) { setStaffOnly(true); setWs(null); return; }
      }
      setStaffOnly(false);
      // New accounts carry the business name from "Create account": set the workspace up for them.
      if (!w && typeof session.user.user_metadata?.business_name === "string" && session.user.user_metadata.business_name.trim()) {
        w = await createFromSignup(session.user.user_metadata.business_name.trim(), session.user.user_metadata.language === "en" ? "en" : "sw");
      }
      if (w) {
        const [{ data: role }, { data: status }, { data: blocked }] = await Promise.all([
          supabase.rpc("member_role", { ws: w.id }),
          supabase.rpc("workspace_status", { p_ws: w.id }), // errors (older database) count as active
          supabase.rpc("send_blocked_by_staff", { p_ws: w.id }), // staff-only switch (0067); errors count as not blocked
        ]);
        w.role = (role as Role) ?? "viewer";
        w.send_blocked = blocked === true;
        setPaused(status === "suspended");
      }
      setWs(w);
    });
  }, [session]);

  // Lift the sign-in curtain once there's something to show (dashboard, setup or a notice), at least a beat after it closed.
  useEffect(() => {
    if (!curtainPending.current || !session || ws === undefined) return;
    curtainPending.current = false;
    const t = window.setTimeout(curtainReveal, 350);
    return () => window.clearTimeout(t);
  }, [session, ws]);
  useEffect(() => { if (session === null && curtainPending.current) { curtainPending.current = false; curtainReveal(); } }, [session]);

  // Keep the bouncing dots up until we know whether to show login, workspace setup or the dashboard.
  useEffect(() => { if (session === null || (session && ws !== undefined)) hidePreloader(); }, [session, ws]);

  const badges = useNavBadges(ws?.id ?? "", view);

  if (session === undefined) return <div className="center muted">Loading…</div>;
  if (!session) return <AuthScreen />;
  if (recovering) return <SetNewPassword email={session.user.email ?? ""} onDone={() => setRecovering(false)} />;
  if (ws === undefined) return <div className="center muted">{tr(initialLang(), "wait")}</div>;
  if (ws === null && staffOnly) return <StaffAccountNotice />;
  if (ws === null) return <CreateWorkspace onDone={setWs} />;
  if (paused) return <PausedNotice name={ws.name} sw={ws.language === "sw"} />;

  return (
    <div className={"shell view-" + view + (view === "chats" ? "" : " dash-ia")} ref={shellRef}>
      {createPortal(<div className={"app-curtain " + curtain.phase} aria-hidden="true">
        <div className="app-curtain-in"><Logo size={44} /><span>{curtain.label}</span></div>
      </div>, document.body)}
      <header className="topbar">
        <div className="brand"><a className="home" href="#dashboard" aria-label="itaOS, go to dashboard" onClick={() => window.scrollTo({ top: 0 })}><Logo size={34} /><span className="brand-text"><h1>itaOS</h1><span className="ws" title={ws.name}>{ws.name}</span></span></a></div>
        <GlassTabs view={view}>
          <a data-tab href="#dashboard" className={view === "dashboard" ? "on" : ""}>Dashboard</a>
          <a data-tab href="#chats" className={view === "chats" ? "on" : ""}>Chats<NavBadge badge={chatsBadge(badges, ws.language === "sw")} /></a>
          <a data-tab href="#kito" className={view === "kito" ? "on" : ""}>{ws.language === "sw" ? "Muulize Kito" : "Ask Kito"}</a>
          <TopMore view={view} sw={ws.language === "sw"} badges={badges} />
        </GlassTabs>
        <div className="actions">
          <button ref={themeBtn} className="icon" onClick={toggleTheme}
            aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            title={theme === "light" ? "Light · tap for dark" : "Dark · tap for light"}>{theme === "light" ? "☾" : "☀"}</button>
          <ProfileMenu ws={ws} staff={!!isPlatformAdmin} language={langPill ?? ws.language} onLanguage={setLanguage} />
        </div>
      </header>
      <Island ws={ws} />
      <BottomNav view={view} sw={ws.language === "sw"} badges={badges} />
      <PageView view={view}>
      {view === "dashboard" && <><AppTip sw={ws.language === "sw"} /><Dashboard ws={ws} onWs={setWs} /></>}
      {view === "kito" && <Kito ws={ws} staff={isPlatformAdmin} />}
      {view === "attention" && <Actions ws={ws} />}
      {view === "report" && <Dashboard ws={ws} onWs={setWs} page="why" />}
      {view === "actions" && <Actions ws={ws} />}
      {view === "receipts" && <Receipts ws={ws} />}
      {view === "payments" && <PaymentGuard ws={ws} />}
      {view === "ads" && <Dashboard ws={ws} onWs={setWs} page="ads" />}
      {view === "why" && <Dashboard ws={ws} onWs={setWs} page="why" />}
      {view === "leaks" && <div className="stack" style={{ display: "grid", gap: 16 }}><a className="small muted" href="#dashboard" style={{ textDecoration: "none" }}>← {ws.language === "sw" ? "Dashibodi" : "Dashboard"}</a><LeakGuard ws={ws} /></div>}
      {view === "buyers" && <Buyers ws={ws} />}
      {view === "chats" && <Chats ws={ws} />}
      {view === "products" && <Products key={ws.id} ws={ws} />}
      {view === "connect" && <Connect ws={ws} />}
      {view === "settings" && <Settings ws={ws} onWs={setWs} theme={theme} onTheme={setThemeFrom} />}
      </PageView>
    </div>
  );
}

function AdminIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" /><path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

function PausedNotice({ name, sw }: { name: string; sw: boolean }) {
  return (
    <div className="center">
      <div className="card auth">
        <div className="row"><Logo size={36} /><b className="auth-brand">itaOS</b></div>
        <p style={{ margin: 0 }}>
          {sw ? `Akaunti ya ${name} imesimamishwa kwa muda. Wasiliana na Pondi Technologies (hello@ponditech.com) ili kuiwasha tena.`
              : `${name}'s itaOS account is paused. Contact Pondi Technologies (hello@ponditech.com) to turn it back on.`}
        </p>
        <button type="button" className="primary" onClick={() => { void supabase.auth.signOut({ scope: "local" }); }}>{sw ? "Toka" : "Sign out"}</button>
      </div>
    </div>
  );
}

function StaffAccountNotice() {
  const lang = initialLang();
  return (
    <div className="center">
      <div className="card auth">
        <div className="row"><Logo size={36} /><b className="auth-brand">itaOS</b></div>
        <p style={{ margin: 0 }}>{tr(lang, "staffAccount")}</p>
        <button type="button" className="primary" onClick={async () => { await supabase.auth.signOut({ scope: "local" }); location.href = "/app/admin"; }}>{tr(lang, "openStaff")}</button>
      </div>
    </div>
  );
}

// One attempt per page load, so a token refresh can't create a second workspace.
let signupCreate: Promise<Workspace | null> | null = null;
function createFromSignup(name: string, language: "sw" | "en"): Promise<Workspace | null> {
  signupCreate ??= (async () => {
    const { data: id, error } = await supabase.rpc("create_workspace", { p_name: name });
    if (error || !id) return null; // fall back to the "Name your business" screen
    if (language === "en") await supabase.from("workspaces").update({ language: "en" }).eq("id", id);
    const { data } = await supabase.from("workspaces").select(WS_COLUMNS).eq("id", id).single();
    return data ? ({ ...(data as unknown as Workspace) }) : null;
  })();
  return signupCreate;
}

function CreateWorkspace({ onDone }: { onDone: (w: Workspace) => void }) {
  const [lang, setLang] = useState(initialLang);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [lost, setLost] = useState(false);
  const formRef = usePageEnter<HTMLFormElement>((f) => { enterTiles(select(f, ":scope > *"), { stagger: 0.06 }); });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setBusy(true);
    // Make sure the sign-in is still there (some phone browsers drop it after opening the email link).
    let { data: { session } } = await supabase.auth.getSession();
    if (!session) session = (await supabase.auth.refreshSession()).data.session;
    if (!session) { setBusy(false); setLost(true); return; }
    const { data: id, error } = await supabase.rpc("create_workspace", { p_name: name.trim() });
    if (error) {
      setBusy(false);
      if (error.code === "42501" || /permission denied|not signed in|JWT/i.test(error.message)) { setLost(true); return; }
      shake(formRef.current);
      return setErr(tr(lang, "wsFail"));
    }
    if (lang === "en") await supabase.from("workspaces").update({ language: "en" }).eq("id", id);
    const { data } = await supabase.from("workspaces").select(WS_COLUMNS).eq("id", id).single();
    onDone({ ...(data as unknown as Workspace), role: "owner" });
  }
  return (
    <AuthShell lang={lang}>
      <form className="ax-form" ref={formRef} onSubmit={submit}>
        <AuthBrand lang={lang} setLang={setLang} />
        <div className="ax-head"><h2>{tr(lang, "wsTitle")}</h2><p>{tr(lang, "wsBody")}</p></div>
        <AuthField id="wsname" label={tr(lang, "business")} icon={AuthIcon.biz}>
          <input id="wsname" required autoComplete="organization" value={name} onChange={(e) => setName(e.target.value)} placeholder={tr(lang, "businessPh")} />
        </AuthField>
        {lost ? (<>
          <p className="err" style={{ margin: 0 }}>{tr(lang, "wsLost")}</p>
          <button type="button" className="primary ax-cta" onClick={() => supabase.auth.signOut({ scope: "local" })}>{tr(lang, "signInAgain")}</button>
        </>) : (<>
          <button className="primary ax-cta" disabled={busy}>{busy ? tr(lang, "wsCreating") : tr(lang, "wsCreate")}</button>
          {err && <p className="err" style={{ margin: 0 }}>{err}</p>}
        </>)}
      </form>
    </AuthShell>
  );
}

const ORDER: View[] = ["dashboard", "kito", "chats"];
const SLOTS = ORDER.length + 1; // + More

// The nav bars (computer top bar and phone bottom bar) get their own colour so they stand out from the
// page: picked at random on each visit, the same for both. "green" is the homepage green; "alt" is black
// in light mode and white in dark mode (see styles.css).
const NAV_TONE = Math.random() < 0.5 ? "green" : "alt";

/** Top tabs with the ponditech.com "liquid glass" pill: it rests on the current page and glides
 *  to whichever tab the pointer is over. */
function GlassTabs({ view, children }: { view: string; children: import("react").ReactNode }) {
  const nav = useRef<HTMLElement>(null);
  const glass = useRef<HTMLSpanElement>(null);
  const hovering = useRef(false);
  const place = (a: HTMLElement | null) => {
    const g = glass.current; if (!g) return;
    // the tab the pill sits under gets the "on pill" text colour
    nav.current?.querySelectorAll("[data-tab].lensed").forEach((el) => el !== a && el.classList.remove("lensed"));
    a?.classList.add("lensed");
    if (!a) { g.classList.remove("on"); return; }
    // Layout position inside the bar, summed up the offsetParent chain (the More button sits inside its own
    // positioned wrapper, so its own offsetLeft is 0). Layout numbers ignore CSS transforms: screen-based
    // getBoundingClientRect read short while the page was still animating in on first load, leaving the
    // pill ~20px left, half under "Ask Kito".
    let left = 0;
    for (let el: HTMLElement | null = a; el && el !== nav.current; el = el.offsetParent as HTMLElement | null) {
      left += el.offsetLeft + (el !== a ? el.clientLeft : 0);
    }
    g.style.width = a.offsetWidth + "px";
    g.style.transform = `translateX(${left}px)`;
    g.classList.add("on");
  };
  const current = () => nav.current?.querySelector<HTMLElement>("[data-tab].on") ?? null;
  const tone = NAV_TONE;
  useEffect(() => {
    if (!hovering.current) place(current());
    const onResize = () => { if (!hovering.current) place(current()); };
    window.addEventListener("resize", onResize);
    document.fonts?.ready.then(onResize);
    // On first load the tabs keep shifting after the first measure (fonts, the Kito logo, labels and badges
    // arrive late), which left the pill half under "Ask Kito". Re-measure whenever the bar or any tab changes size.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    if (ro && nav.current) { ro.observe(nav.current); nav.current.querySelectorAll("[data-tab]").forEach((el) => ro.observe(el)); }
    // and when a tab's label or contents change (language switch, a tab appearing)
    const mo = nav.current ? new MutationObserver(onResize) : null;
    if (mo && nav.current) mo.observe(nav.current, { childList: true, subtree: true, characterData: true });
    return () => { window.removeEventListener("resize", onResize); ro?.disconnect(); mo?.disconnect(); };
  }, [view]);
  return (
    <nav className="tabs glass-tabs" aria-label="Sections" ref={nav} data-tone={tone}
      onMouseOver={(e) => { const a = (e.target as HTMLElement).closest("[data-tab]"); if (a) { hovering.current = true; place(a as HTMLElement); } }}
      onMouseMove={(e) => { const a = (e.target as HTMLElement).closest("[data-tab]"); if (a && glass.current) { const r = a.getBoundingClientRect(); glass.current.style.setProperty("--gx", (((e.clientX - r.left) / r.width) * 100).toFixed(0) + "%"); } }}
      onMouseLeave={() => { hovering.current = false; glass.current?.style.setProperty("--gx", "50%"); place(current()); }}>
      <span className="glass" ref={glass} aria-hidden />
      {children}
    </nav>
  );
}

/** Sections that live under "More" (top bar on computers, sheet on phones). */
function moreItems(sw: boolean): [View, string, string, JSX.Element][] {
  const L = (en: string, s: string) => (sw ? s : en);
  return [
    ["why", L("Why people didn't buy", "Kwa nini hawakununua"), L("Reasons, diagnosis and what to fix", "Sababu, uchunguzi na cha kurekebisha"), <Ico d="M3 12h4l3-8 4 16 3-8h4" />],
    ["actions", L("Actions", "Vitendo"), L("Today, payments, deliveries, promises", "Leo, malipo, usafirishaji, ahadi"), <Ico d="M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" />],
    ["buyers", L("Buyers", "Wateja walionunua"), L("Names, phones and locations of everyone who paid", "Majina, simu na mahali pa waliolipa"), <Ico d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM22 19v-1a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8" />],
    ["receipts", L("Find a payment", "Tafuta malipo"), L("Receipt no. or transaction code", "Kumbukumbu Na. au muamala"), <Ico d="M4 3h16v18l-3-2-3 2-2-2-2 2-3-2-3 2V3ZM8 8h8M8 12h8M8 16h5" />],
    ["products", L("My products", "Bidhaa zangu"), L("Prices, photos, what sells", "Bei, picha, zinazouzwa"), <Ico d="M21 8 12 3 3 8v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8" />],
    ["connect", L("Connections", "Miunganisho"), L("Ads and WhatsApp", "Matangazo, WhatsApp"), <Ico d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />],
    ["settings", L("Settings", "Mipangilio"), L("Business and rules", "Biashara na kanuni"), <GearIcon />],
  ];
}

/** Computer top bar: "More" button with a drop-down for Diagnosis, Actions and Connections.
 *  While one of those pages is open the button shows its name. */
function TopMore({ view, sw, badges }: { view: View; sw: boolean; badges: Badges }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => { setOpen(false); }, [view]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc); };
  }, [open]);
  const items = moreItems(sw).filter(([v]) => v !== "settings"); // Settings keeps its gear button
  const cur = items.find(([v]) => v === view);
  return (
    <span className="more-wrap" ref={wrap}>
      <button type="button" data-tab className={"more-btn" + (cur ? " on" : "")} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {cur ? cur[1] : sw ? "Zaidi" : "More"}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        {!open && <NavBadge badge={actionsBadge(badges, sw)} />}
      </button>
      {/* Blur everything behind the open menu; the bar and menu stay sharp above it (nav.tabs is z-index 30). */}
      {open && createPortal(<div className="more-back" aria-hidden="true" onClick={() => setOpen(false)} />, document.body)}
      {open && (
        <div className="more-menu" role="menu">
          {items.map(([v, label, note, icon]) => (
            <a key={v} role="menuitem" href={"#" + v} className={"more-item" + (view === v ? " on" : "")} onClick={() => { setOpen(false); window.scrollTo({ top: 0 }); }}>
              <span className="more-ico">{icon}</span>
              <span><b>{label}</b><span className="small muted">{note}</span></span>
              {v === "actions" && <NavBadge badge={actionsBadge(badges, sw)} />}
            </a>
          ))}
        </div>
      )}
    </span>
  );
}

const PHONE_NAV = "(max-width: 760px)";
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const pageEl = () => document.querySelector<HTMLElement>(".page-view");

/** Phone tab change, Facebook-style: a quick crossfade where the new page drifts in from the side of its tab
 *  (bars stay still). Returns false when it didn't handle it (the caller then does the ordinary page change). */
function phoneSwitch(from: View, next: View): boolean {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
  const html = document.documentElement;
  const seq = swipeOrder(false); // only the order matters, not the labels
  const dir = Math.sign(seq.indexOf(next) - seq.indexOf(from)) || 1; // More pages sit to the right of Chats
  const swap = () => { window.scrollTo({ top: 0 }); flushSync(() => setViewRef.current?.(next)); };
  if (reducedMotion()) { swap(); return true; }
  if (!doc.startViewTransition) { navFlags.fade = dir; swap(); return true; } // PageView fades it in
  html.style.setProperty("--vt-dir", String(dir));
  html.classList.add("vt-phone");
  navFlags.busy = true; // no swipe can start while the browser is mid-transition (it would cut it short)
  const done = () => { html.classList.remove("vt-phone"); html.style.removeProperty("--vt-dir"); navFlags.busy = false; };
  try {
    const vt = (doc.startViewTransition as any)(swap) as LiveVT;
    liveVT = vt;
    vt.finished.then(done, done).then(() => { if (liveVT === vt) liveVT = null; });
  } catch { done(); swap(); }
  return true;
}

/* Taps during a page change (22 Nov 2026). While the browser animates a View Transition, every tap lands on
   <html> instead of the button under the finger (checked in Chromium), so a tab pressed while the previous
   page was still sliding in did nothing and needed a second press, mostly on slower Android phones. Now a
   tap that lands on <html> mid-transition ends the animation at once and is passed on to whatever is under
   the finger. */
type LiveVT = { skipTransition: () => void; finished: Promise<void> };
let liveVT: LiveVT | null = null;
if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    const vt = liveVT;
    if (!vt || e.target !== document.documentElement) return;
    e.preventDefault(); e.stopPropagation();
    const x = e.clientX, y = e.clientY;
    liveVT = null;
    try { vt.skipTransition(); } catch { /* already over */ }
    const replay = () => requestAnimationFrame(() => {
      const el = document.elementFromPoint(x, y);
      if (el && el !== document.documentElement) el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
    });
    vt.finished.then(replay, replay);
  }, true);
}
const setViewRef: { current: ((v: View) => void) | null } = { current: null };
/** Every page in bar order: Home, Kito, Chats, then the More menu's pages top to bottom. */
const swipeOrder = (sw: boolean): View[] => [...ORDER, ...moreItems(sw).map(([v]) => v)];

/** Wraps the current page. On phones, a new section slides in from the side it lives on
 *  (iOS-style), or rises in gently when it isn't one of the bottom-nav sections. */
export function PageView({ view, children }: { view: View; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef(view);
  useLayoutEffect(() => {
    const el = ref.current, from = prev.current; prev.current = view;
    if (!el || from === view) return;
    el.style.transition = ""; el.style.transform = ""; el.style.opacity = ""; el.classList.remove("swiping");
    const fade = navFlags.fade; navFlags.fade = null;
    if (fade !== null && !reducedMotion()) { // phone tap without View Transitions: quick fade in from the tab's side
      el.animate([{ transform: `translateX(${fade * 22}px)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 220, easing: "cubic-bezier(.2, .8, .3, 1)" });
      return;
    }
    const dir = navFlags.swipe; navFlags.swipe = 0;
    if (!dir || !window.matchMedia(PHONE_NAV).matches || reducedMotion()) return; // taps/clicks use the crossfade instead
    // Swipe: the new page comes in from the side the finger pushed toward, continuing the lean.
    navFlags.busy = true;
    const anim = el.animate([{ transform: `translate3d(${dir * 22}%,0,0)`, opacity: 0.4 }, { transform: "translate3d(0,0,0)", opacity: 1 }],
      { duration: 240, easing: "cubic-bezier(.2, .9, .3, 1)" });
    const done = () => { navFlags.busy = false; };
    anim.finished.then(done, done);
  }, [view]);
  return <div className="page-view" ref={ref}>{children}</div>;
}

/** Phone navigation: four main sections plus "More". Hidden on wider screens, where the top tabs show. */
export function BottomNav({ view, sw, badges }: { view: View; sw: boolean; badges?: Badges }) {
  const [open, setOpen] = useState(false);
  useBackLayer(open, () => setOpen(false)); // phone Back closes the More sheet
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener("hashchange", close);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("hashchange", close); window.removeEventListener("keydown", esc); };
  }, []);
  const L = (en: string, s: string) => (sw ? s : en);
  const main: [View, string, JSX.Element][] = [
    ["dashboard", L("Home", "Nyumbani"), <Ico d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />],
    ["kito", "Kito", <KitoLogo size={22} />],
    ["chats", "Chats", <Ico d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5A8 8 0 1 1 21 12z" />],
  ];
  const more = moreItems(sw);
  const moreOn = more.some(([v]) => v === view);
  const idx = open || moreOn ? SLOTS - 1 : Math.max(0, ORDER.indexOf(view));
  const navRef = useRef<HTMLElement>(null);
  const suppressClick = useRef(false);
  const setLens = (i: number, dragging: boolean) => {
    const n = navRef.current; if (!n) return;
    n.style.setProperty("--i", String(i));
    n.classList.toggle("dragging", dragging);
  };
  useEffect(() => { setLens(idx, false); }, [idx]);
  const go = (i: number) => {
    if (i >= SLOTS - 1) { setOpen(true); setLens(SLOTS - 1, false); return; }
    setOpen(false); // always close the More sheet first, so the tab works on the first tap
    if (ORDER[i] !== view) { setLens(i, false); window.scrollTo({ top: 0 }); phoneGo(ORDER[i]); } // pill moves at once, even if the page takes a moment
    else setLens(i, false);
  };

  // Drag along the bar: the lens follows the finger and snaps to the tab where it is released.
  const onBarDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const n = navRef.current; if (!n) return;
    const r = n.getBoundingClientRect(), slot = (r.width - 10) / SLOTS, x0 = e.clientX; // 5px padding each side
    let moved = false, frac = idx;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 8) return;
      moved = true;
      frac = Math.min(SLOTS - 1, Math.max(0, (ev.clientX - r.left - 5 - slot / 2) / slot));
      setLens(frac, true);
    };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      if (!moved) return;
      suppressClick.current = true; setTimeout(() => (suppressClick.current = false), 350);
      go(Math.round(frac));
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  };

  // Swipe the page left/right to move through every page in bar order (Home, Kito, Chats, then the More pages);
  // the lens tracks the swipe and the page leans with the finger, then the new page slides in from that side.
  //
  // Android fixes (22 Nov 2026):
  // - Up/down scrolling is left entirely to the browser: the page area is `touch-action: pan-y` (styles.css),
  //   so sideways drags never scroll the page and these listeners can be passive (no scroll waits on us).
  // - If the browser starts scrolling up/down anyway (a diagonal drag), the swipe is dropped, not fought.
  // - Touches starting within EDGE px of either side are left to Android's Back gesture.
  // - A cancelled touch (Android or the browser took the gesture over) springs back; it never changes page.
  // - Flick speed comes from the last ~100 ms of movement, so a quick flick counts even after a slow start.
  // - No swipe starts while a page change is still animating.
  useEffect(() => {
    const seq = swipeOrder(sw);
    const cur = seq.indexOf(view);
    if (cur < 0 || open) return;
    const EDGE = 24;
    const slotOf = (f: number) => Math.min(SLOTS - 1, f); // pages past Chats live under More
    let x0 = 0, y0 = 0, sy0 = 0, mode: "" | "h" | "v" = "", dx = 0, target: EventTarget | null = null;
    let samples: [number, number][] = []; // [time, x] of recent moves, for flick speed
    const blocked = (el: EventTarget | null) => {
      for (let n = el as HTMLElement | null; n && n !== document.body; n = n.parentElement) {
        if (n.matches("input, textarea, select, .seg, .bottomnav, .sheet, .wa-pane, .dr-layer, .paid-modal, [data-noswipe], [data-zoom]")) return true;
        const ox = getComputedStyle(n).overflowX;
        if ((ox === "auto" || ox === "scroll") && n.scrollWidth > n.clientWidth + 2) return true;
      }
      return false;
    };
    const springBack = () => {
      setLens(slotOf(cur), false);
      const page = pageEl();
      if (!page || !page.classList.contains("swiping")) return;
      page.style.transition = "transform .32s cubic-bezier(.3, 1.3, .5, 1), opacity .2s ease";
      page.style.transform = ""; page.style.opacity = "";
      window.setTimeout(() => { page.style.transition = ""; page.classList.remove("swiping"); }, 340);
    };
    const start = (e: TouchEvent) => {
      mode = "v"; // until proven otherwise
      if (e.touches.length !== 1 || navFlags.busy) return;
      const t = e.touches[0];
      if (t.clientX < EDGE || t.clientX > window.innerWidth - EDGE) return; // Android Back gesture zone
      if (document.body.style.overflow === "hidden" || document.body.classList.contains("wa-open")) return; // a popup is open
      x0 = t.clientX; y0 = t.clientY; sy0 = window.scrollY; dx = 0; mode = ""; target = e.target;
      samples = [[e.timeStamp, x0]];
    };
    const move = (e: TouchEvent) => {
      if (mode === "v") return;
      const t = e.touches[0]; if (!t) return;
      dx = t.clientX - x0; const dy = t.clientY - y0;
      if (!mode) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        // sideways only when clearly sideways and the page hasn't started scrolling; the overflow check
        // (walks up the tree) runs once here instead of on every touch
        if (Math.abs(dx) < Math.abs(dy) * 1.2 || window.scrollY !== sy0 || blocked(target)) { mode = "v"; return; }
        mode = "h"; x0 += dx > 0 ? 10 : -10; dx = t.clientX - x0;
      }
      if (window.scrollY !== sy0) { mode = "v"; springBack(); return; } // the browser took it as a scroll after all
      samples.push([e.timeStamp, t.clientX]);
      while (samples.length > 2 && e.timeStamp - samples[0][0] > 100) samples.shift();
      const w = window.innerWidth;
      setLens(slotOf(Math.min(seq.length - 1, Math.max(0, cur - dx / w))), true);
      const page = pageEl();
      if (page && !reducedMotion()) {
        const edge = (dx > 0 && cur === 0) || (dx < 0 && cur === seq.length - 1);
        page.classList.add("swiping");
        page.style.transition = "none";
        page.style.transform = `translate3d(${dx * (edge ? 0.12 : 0.35)}px,0,0)`;
        page.style.opacity = String(1 - Math.min(1, Math.abs(dx) / w) * 0.35);
      }
    };
    const end = (e: TouchEvent) => {
      const was = mode; mode = "";
      if (was !== "h") return;
      const [tA, xA] = samples[0], [tB, xB] = samples[samples.length - 1];
      const v = tB > tA ? (xB - xA) / (tB - tA) : 0; // px/ms, sign = direction
      const fling = Math.abs(v) > 0.35 && Math.abs(dx) > 30 && Math.sign(v) === Math.sign(dx);
      const next = Math.abs(dx) > window.innerWidth * 0.22 || fling ? cur + (dx < 0 ? 1 : -1) : cur;
      if (e.type === "touchcancel" || next < 0 || next >= seq.length || next === cur) { springBack(); return; }
      // Swiping past Chats (23 Nov 2026): open the More sheet so the person picks the page, instead of
      // dropping them on whichever More page happens to be first.
      if (cur < ORDER.length && next >= ORDER.length) {
        navigator.vibrate?.(8);
        springBack();
        setLens(SLOTS - 1, false);
        setOpen(true);
        return;
      }
      navigator.vibrate?.(8);
      setLens(slotOf(next), false);
      navFlags.swipe = dx < 0 ? 1 : -1;
      phoneGo(seq[next]);
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end, { passive: true });
    window.addEventListener("touchcancel", end, { passive: true });
    return () => { window.removeEventListener("touchstart", start); window.removeEventListener("touchmove", move); window.removeEventListener("touchend", end); window.removeEventListener("touchcancel", end); };
  }, [view, open, sw]);

  return (
    <>
      {open && <div className="sheet-back" onClick={() => setOpen(false)} />}
      {open && (
        <div className="sheet" role="dialog" aria-label={L("More", "Zaidi")}>
          <span className="sheet-grip" aria-hidden="true" />
          {more.map(([v, label, note, icon]) => (
            <a key={v} href={"#" + v} className={"sheet-item" + (view === v ? " on" : "")} onClick={(e) => { e.preventDefault(); setOpen(false); window.scrollTo({ top: 0 }); phoneGo(v); }}>
              <span className="sheet-ico">{icon}</span>
              <span className="sheet-text"><b>{label}</b><span className="small muted">{note}</span></span>
              {v === "actions" && badges && <NavBadge badge={actionsBadge(badges, sw)} />}
            </a>
          ))}
        </div>
      )}
      <nav className="bottomnav" aria-label="Sections" ref={navRef} data-tone={NAV_TONE} style={{ ["--n" as any]: SLOTS }} onPointerDown={onBarDown}
        onClickCapture={(e) => { if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); } }}>
        <span className="lens" aria-hidden="true" />
        {main.map(([v, label, icon]) => (
          <a key={v} href={"#" + v} className={view === v && !open ? "on" : ""} aria-current={view === v ? "page" : undefined}
            aria-label={label} onClick={(e) => { e.preventDefault(); go(ORDER.indexOf(v)); }}>{icon}<span className="bn-label">{label}</span>{v === "chats" && badges && <NavBadge badge={chatsBadge(badges, sw)} />}</a>
        ))}
        <button type="button" className={moreOn || open ? "on" : ""} aria-expanded={open} onClick={() => (open ? (setOpen(false), setLens(Math.max(0, ORDER.indexOf(view)), false)) : setOpen(true))}>
          <Ico d="M5 12h.01M12 12h.01M19 12h.01" w={3} /><span className="bn-label">{L("More", "Zaidi")}</span>{badges && <NavBadge badge={actionsBadge(badges, sw)} />}
        </button>
      </nav>
    </>
  );
}

function Ico({ d, w = 2 }: { d: string; w?: number }) {
  return <svg className="ico" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}
