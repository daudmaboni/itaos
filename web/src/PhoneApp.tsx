// Settings → Phone app: put itaOS on the home screen and turn on notifications for new WhatsApp messages.
import { useEffect, useState } from "react";
import type { Workspace } from "./lib";
import { islandOn, setIslandOn, islandPreview } from "./Island";
import { canPromptInstall, isInstalled, isIOS, onPwaChange, promptInstall, pushState, turnOnPush, turnOffPush, sendTestPush, type PushState } from "./pwa";

type Tr = (en: string, sw: string) => string;

/** A computer (mouse, no touch screen) rather than a phone or tablet. */
const isComputer = () => !!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches && !window.matchMedia?.("(pointer: coarse)").matches;

export default function PhoneApp({ ws, T }: { ws: Workspace; T: Tr }) {
  return <><Install T={T} /><Notifications ws={ws} T={T} /><InAppPopup ws={ws} T={T} /></>;
}

function Install({ T }: { T: Tr }) {
  const [, tick] = useState(0);
  useEffect(() => onPwaChange(() => tick((n) => n + 1)), []);
  const installed = isInstalled();
  const ios = isIOS();
  const computer = isComputer();
  return (
    <section className="card">
      <div><h2>{computer ? T("Install itaOS on this computer", "Sakinisha itaOS kwenye kompyuta hii") : T("Install itaOS on this phone", "Sakinisha itaOS kwenye simu hii")}</h2>
        <span className="small muted">{computer
          ? T("itaOS opens in its own window, with its own icon in your dock or taskbar, like any other app. Nothing to download from a store.", "itaOS inafunguka kwenye dirisha lake, na alama yake kwenye dock au taskbar, kama app nyingine. Huhitaji kupakua kutoka store.")
          : T("itaOS gets its own icon on your home screen and opens full screen, like any other app. Nothing to download from the Play Store or App Store.", "itaOS inapata alama yake kwenye skrini ya simu na inafunguka skrini nzima, kama app nyingine. Huhitaji kupakua kutoka Play Store au App Store.")}</span></div>
      {installed ? (
        <p className="small">✅ {T("You're using the itaOS app on this device.", "Unatumia app ya itaOS kwenye kifaa hiki.")}</p>
      ) : canPromptInstall() ? (
        <div><button type="button" className="primary" onClick={() => promptInstall()}>{T("Install itaOS", "Sakinisha itaOS")}</button></div>
      ) : computer ? (
        <ol className="small" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
          <li>{T("Open itaos.app in Chrome or Edge.", "Fungua itaos.app kwenye Chrome au Edge.")}</li>
          <li>{T("Click the install icon at the right end of the address bar (a screen with a down arrow).", "Bonyeza alama ya kusakinisha mwisho wa kulia wa sehemu ya anwani (skrini yenye mshale wa chini).")}</li>
          <li>{T("Click \"Install\". itaOS opens in its own window.", "Bonyeza \"Install\". itaOS itafunguka kwenye dirisha lake.")}</li>
        </ol>
      ) : ios ? (
        <ol className="small" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
          <li>{T("Open itaos.app in Safari.", "Fungua itaos.app kwenye Safari.")}</li>
          <li>{T("Tap the Share button (the square with an arrow pointing up).", "Bonyeza kitufe cha Share (kiboksi chenye mshale wa juu).")}</li>
          <li>{T("Scroll down and tap \"Add to Home Screen\", then \"Add\".", "Shuka chini, bonyeza \"Add to Home Screen\", kisha \"Add\".")}</li>
          <li>{T("Open itaOS from the new icon on your home screen.", "Fungua itaOS kwa alama mpya kwenye skrini yako.")}</li>
        </ol>
      ) : (
        <ol className="small" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
          <li>{T("Open itaos.app in Chrome.", "Fungua itaos.app kwenye Chrome.")}</li>
          <li>{T("Tap the menu (⋮) at the top right.", "Bonyeza menyu (⋮) juu kulia.")}</li>
          <li>{T("Tap \"Install app\" or \"Add to Home screen\".", "Bonyeza \"Install app\" au \"Add to Home screen\".")}</li>
        </ol>
      )}
    </section>
  );
}

function Notifications({ ws, T }: { ws: Workspace; T: Tr }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const refresh = () => pushState().then(setState).catch(() => setState("unsupported"));
  useEffect(() => { refresh(); }, []);

  async function on() {
    setBusy(true); setMsg({});
    const err = await turnOnPush(ws.id).catch((e) => String(e?.message ?? e));
    setBusy(false);
    if (err === "blocked") setMsg({ err: T("Notifications are blocked for itaOS. Allow them in your phone's settings for this app or site, then try again.", "Arifa zimezuiwa kwa itaOS. Ziruhusu kwenye mipangilio ya simu kwa app hii, kisha jaribu tena.") });
    else if (err === "not-allowed") setMsg({ err: T("You didn't allow notifications.", "Hukuruhusu arifa.") });
    else if (err) setMsg({ err });
    else setMsg({ ok: T("Done. You'll get a notification when a customer writes.", "Tayari. Utapata arifa mteja akiandika.") });
    refresh();
  }
  async function off() {
    setBusy(true); setMsg({});
    await turnOffPush().catch(() => {});
    setBusy(false); refresh();
  }
  async function test() {
    setBusy(true); setMsg({});
    const err = await sendTestPush(ws.id);
    setBusy(false);
    setMsg(err ? { err } : { ok: T("Test sent. It should arrive in a few seconds.", "Jaribio limetumwa. Litafika baada ya sekunde chache.") });
  }

  return (
    <section className="card">
      <div><h2>{T("Notifications", "Arifa")}</h2>
        <span className="small muted">{T("Get a notification on this device when a customer sends a WhatsApp message. Tap it to open the chat. Turn it on separately on each phone or computer.", "Pata arifa kwenye kifaa hiki mteja akituma ujumbe wa WhatsApp. Bonyeza kufungua chat. Washa kwenye kila simu au kompyuta.")}</span></div>
      {state === null ? <span className="small muted">{T("Checking…", "Inakagua…")}</span>
        : state === "needs-install" ? <p className="small">{T("On iPhone, notifications work only after you add itaOS to your home screen (see above). Then open it from the icon and come back here.", "Kwenye iPhone, arifa zinafanya kazi tu ukiweka itaOS kwenye skrini ya simu (tazama juu). Kisha ifungue kwa alama hiyo na urudi hapa.")}</p>
        : state === "unsupported" ? <p className="small">{T("This browser can't show notifications. Try Chrome on Android, or Safari on iPhone after adding itaOS to the home screen.", "Kivinjari hiki hakiwezi kuonyesha arifa. Jaribu Chrome kwenye Android, au Safari kwenye iPhone baada ya kuweka itaOS kwenye skrini.")}</p>
        : state === "blocked" ? <p className="small err">{T("Notifications are blocked for itaOS on this device. Allow them in the phone's settings (or the padlock next to the address in the browser), then reload.", "Arifa zimezuiwa kwa itaOS kwenye kifaa hiki. Ziruhusu kwenye mipangilio ya simu (au kufuli karibu na anwani kwenye kivinjari), kisha pakia upya.")}</p>
        : state === "on" ? (
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="small">✅ {T("On for this device", "Imewashwa kwa kifaa hiki")}</span>
            <button type="button" className="small" disabled={busy} onClick={test}>{T("Send a test", "Tuma jaribio")}</button>
            <button type="button" className="small" disabled={busy} onClick={off}>{T("Turn off", "Zima")}</button>
          </div>
        ) : (
          <div><button type="button" className="primary" disabled={busy} onClick={on}>{busy ? T("Turning on…", "Inawasha…") : T("Turn on notifications", "Washa arifa")}</button></div>
        )}
      {msg.ok && <span className="small savemsg">{msg.ok}</span>}
      {msg.err && <span className="small err">{msg.err}</span>}
    </section>
  );
}

function InAppPopup({ ws, T }: { ws: Workspace; T: Tr }) {
  const [on, setOn] = useState(islandOn());
  const flip = () => { setIslandOn(!on); setOn(!on); };
  return (
    <section className="card">
      <div><h2>{T("Pop-up inside the app", "Arifa ndani ya app")}</h2>
        <span className="small muted">{T("While itaOS is open, a black pop-up drops from the top when a customer writes. Tap it to open the chat. Swipe up or tap × to close it.", "itaOS ikiwa wazi, kidirisha cheusi kinashuka juu mteja akiandika. Kibonyeze kufungua chat. Telezesha juu au bonyeza × kukifunga.")}</span></div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <span className="small">{on ? "✅ " + T("On for this device", "Imewashwa kwa kifaa hiki") : T("Off for this device", "Imezimwa kwa kifaa hiki")}</span>
        <button type="button" className="small" onClick={() => islandPreview(ws.language === "sw")}>{T("Show me", "Nionyeshe")}</button>
        <button type="button" className="small" onClick={flip}>{on ? T("Turn off", "Zima") : T("Turn on", "Washa")}</button>
      </div>
    </section>
  );
}

/** One small, dismissible nudge on the dashboard until this device has the app and notifications. */
export function AppTip({ sw }: { sw: boolean }) {
  const T: Tr = (en, s) => (sw ? s : en);
  const [show, setShow] = useState(false);
  const computer = isComputer();
  useEffect(() => {
    let gone = false;
    try { gone = localStorage.getItem("itaos-app-tip") === "hide"; } catch { /* storage unavailable */ }
    if (gone) return;
    const touch = window.matchMedia?.("(pointer: coarse)").matches;
    pushState().then((p) => setShow((touch && !isInstalled()) || p === "off" || p === "needs-install")).catch(() => {});
  }, []);
  if (!show) return null;
  const hide = () => { setShow(false); try { localStorage.setItem("itaos-app-tip", "hide"); } catch { /* ignore */ } };
  return (
    <div className="card app-tip" role="note">
      <span>{computer
        ? "🔔 " + T("Know the moment a customer writes: turn on notifications on this computer.", "Jua papo hapo mteja akiandika: washa arifa kwenye kompyuta hii.")
        : "📲 " + T("Know the moment a customer writes: add itaOS to this phone and turn on notifications.", "Jua papo hapo mteja akiandika: weka itaOS kwenye simu hii na uwashe arifa.")}</span>
      <a className="btn small primary" href="#settings/app" onClick={hide}>{computer ? T("Turn on", "Washa") : T("Set up", "Weka")}</a>
      <button type="button" className="small" aria-label={T("Hide", "Ficha")} onClick={hide}>×</button>
    </div>
  );
}
