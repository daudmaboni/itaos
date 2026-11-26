// Phone app (PWA): service worker, "Install itaOS" button, push notifications.
// Supabase is loaded only when needed, so the public homepage stays light.
const db = async () => (await import("./lib")).supabase;

/** Public half of the VAPID key pair. The private half is the VAPID_PRIVATE_KEY Edge Function secret. */
export const VAPID_PUBLIC_KEY = "BKxMcuarzjl5x6fGfsPnmySAi2XKYUl7gj5oD21thQtHPyJXHOm-dIRtjOTbsuuL_yj1DN_QJ58btb7QKMjj2no";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

/** Called once from main.tsx. Never throws: the app works the same without a service worker. */
export function startPwa() {
  if (!("serviceWorker" in navigator) || import.meta.env.DEV) { keepStatusBarInStep(); return; }
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("service worker", e)); });
  // A tapped notification in an open window that the worker can't navigate.
  navigator.serviceWorker.addEventListener("message", (e) => { if (e.data?.type === "open" && typeof e.data.url === "string") location.href = e.data.url; });
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as InstallEvent; notify(); setTimeout(installPopup, 1500); });
  window.addEventListener("appinstalled", () => { deferred = null; notify(); document.getElementById("itaos-install")?.remove(); });
  // iPhone has no install prompt: show the Add to Home Screen steps instead (Safari only).
  if (isIOS() && !isInstalled() && /safari/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent)) setTimeout(installPopup, 2500);
  keepStatusBarInStep();
}

const POPUP_KEY = "itaos-install-popup";
const POPUP_QUIET_DAYS = 3;

/** Bottom pop-up on any page (homepage, login, app) inviting the visitor to install itaOS.
 *  Plain DOM so it works on the homepage too. "Not now" hides it for a few days. */
function installPopup() {
  if (isInstalled() || document.getElementById("itaos-install") || location.pathname.startsWith("/app/admin") || location.pathname.startsWith("/r/")) return; // not on customer receipt pages
  if (!deferred && !isIOS()) return;
  try { const t = Number(localStorage.getItem(POPUP_KEY) || 0); if (Date.now() - t < POPUP_QUIET_DAYS * 864e5) return; } catch { /* storage unavailable */ }
  let lang: string | null = null;
  try { lang = localStorage.getItem("itaos-lang"); } catch { /* ignore */ }
  const sw = lang ? lang === "sw" : location.pathname.startsWith("/app");
  const T = (en: string, s: string) => (sw ? s : en);
  const dark = document.documentElement.dataset.theme === "dark";
  const bg = dark ? "#16181c" : "#ffffff", fg = dark ? "#f2f3f5" : "#131a2a", muted = dark ? "#a3a8b3" : "#5b6170", line = dark ? "#2a2d33" : "#e6e8ec";
  const ios = !deferred;
  const el = document.createElement("div");
  el.id = "itaos-install";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", T("Install itaOS", "Sakinisha itaOS"));
  el.style.cssText = `position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:10000;max-width:440px;margin:0 auto;background:${bg};color:${fg};border:1px solid ${line};border-radius:20px;box-shadow:0 18px 50px rgba(0,0,0,.22);padding:16px;font:15px/1.4 Geist,Inter,system-ui,sans-serif;transform:translateY(130%);transition:transform .45s cubic-bezier(.22,1,.36,1)`;
  el.innerHTML = `
    <button type="button" data-x aria-label="${T("Close", "Funga")}" style="position:absolute;top:10px;right:10px;width:32px;height:32px;border-radius:50%;border:0;background:${dark ? "#ffffff14" : "#0f1c2a0d"};color:${muted};font:600 18px/1 system-ui;cursor:pointer;display:grid;place-items:center">×</button>
    <div style="display:flex;gap:12px;align-items:center;padding-right:28px">
      <img src="/icons/icon-192.png" alt="" width="48" height="48" style="border-radius:12px;flex:none">
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:16px">${T("Get the itaOS app", "Pakua app ya itaOS")}</div>
        <div style="color:${muted};font-size:13px">${ios
          ? T("Tap <b>Share</b> (the square with an up arrow), then <b>Add to Home Screen</b>. That way you stay signed in: Safari forgets websites you haven't opened for a week.", "Bonyeza <b>Share</b> (kiboksi chenye mshale wa juu), kisha <b>Add to Home Screen</b>. Hivyo utabaki umeingia: Safari husahau tovuti usizofungua kwa wiki moja.")
          : matchMedia("(hover: hover) and (pointer: fine)").matches && !matchMedia("(pointer: coarse)").matches
            ? T("Open it in its own window, right from your dock or taskbar, and know the moment a customer writes.", "Ifungue kwenye dirisha lake moja kwa moja kutoka dock au taskbar, na ujue papo hapo mteja akiandika.")
            : T("Open it from your home screen and know the moment a customer writes.", "Ifungue kutoka skrini ya simu na ujue papo hapo mteja akiandika.")}</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <button type="button" data-x style="font-family:inherit;font-weight:600;font-size:14px;padding:9px 16px;border-radius:999px;border:1px solid ${line};background:transparent;color:${fg};cursor:pointer">${T("Not now", "Baadaye")}</button>
      ${ios ? "" : `<button type="button" data-go style="font-family:inherit;font-weight:600;font-size:14px;padding:9px 18px;border-radius:999px;border:0;background:#131a2a;color:#fff;cursor:pointer;${dark ? "background:#f5c84c;color:#131a2a;" : ""}">${T("Install", "Sakinisha")}</button>`}
    </div>`;
  const close = (quiet: boolean) => {
    if (quiet) { try { localStorage.setItem(POPUP_KEY, String(Date.now())); } catch { /* ignore */ } }
    el.style.transform = "translateY(130%)";
    setTimeout(() => el.remove(), 500);
  };
  // A popup is a guest, so show it the door: × in the corner, "Not now", and the Esc key all close it.
  el.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", () => close(true)));
  const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { close(true); window.removeEventListener("keydown", esc); } };
  window.addEventListener("keydown", esc);
  el.querySelector("[data-go]")?.addEventListener("click", async () => { const ok = await promptInstall(); close(!ok); });
  document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transform = "none"; }));
}

/** The phone's status bar follows the itaOS theme (light/dark), not the system. */
function keepStatusBarInStep() {
  const set = () => {
    const m = document.querySelector('meta[name="theme-color"]');
    const d = document.documentElement.dataset;
    // Sign-in pages open with the navy banner on phones, so the status bar is the same green there.
    // An open chat: same colour as the chat header (WhatsApp's near-black in dark), so the top of the phone and the header are one surface.
    if (m) m.setAttribute("content", d.screen === "auth" ? "#0f7a4f" : d.screen === "chat" ? (d.theme === "dark" ? "#0b141a" : "#ffffff") : d.theme === "dark" ? "#0d0e10" : "#ffffff");
  };
  set();
  new MutationObserver(set).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-screen"] });
}

export function onPwaChange(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }

export const isInstalled = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const canPromptInstall = () => !!deferred;

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null; notify();
  return outcome === "accepted";
}

// ---- Push ----
export type PushState = "unsupported" | "needs-install" | "blocked" | "off" | "on";

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return isIOS() && !isInstalled() ? "needs-install" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

function keyBytes(b64: string) {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** Ask permission, subscribe this device and save it for the workspace. Returns an error message or null. */
export async function turnOnPush(workspaceId: string): Promise<string | null> {
  if (!pushSupported()) return "This browser can't show notifications.";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "blocked" : "not-allowed";
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  const supabase = await db();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return "Sign in first.";
  const { error } = await supabase.rpc("save_push_subscription", {
    p_workspace: workspaceId, p_endpoint: sub.endpoint, p_p256dh: j.keys?.p256dh ?? "", p_auth: j.keys?.auth ?? "", p_user_agent: navigator.userAgent,
  });
  return error ? error.message : null;
}

export async function turnOffPush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await (await db()).from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}

/** Ask the server to send a test notification to this signed-in user's devices. */
export async function sendTestPush(workspaceId: string): Promise<string | null> {
  const { error } = await (await db()).functions.invoke("push-send", { body: { test: true, workspace_id: workspaceId } });
  return error ? error.message : null;
}
