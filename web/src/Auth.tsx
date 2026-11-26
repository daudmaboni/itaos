import { useEffect, useState } from "react";
import { supabase, AUTH_LINK_ERROR } from "./lib";
import { rememberThisDevice, setRememberThisDevice } from "./authStore";
import { enterTiles, enterCards, shake, usePageEnter, select } from "./motion";
import Logo from "./Logo";

/* ---------- language (before a workspace exists) ---------- */
export type Lang = "sw" | "en";
const LANG_KEY = "itaos-lang";
export function initialLang(): Lang {
  try { const v = localStorage.getItem(LANG_KEY); if (v === "sw" || v === "en") return v; } catch { /* storage unavailable */ }
  return "sw";
}
/** Sign-in pages sit on the grey page colour, so the phone status bar should too (see pwa.ts). */
function useAuthScreen() {
  useEffect(() => {
    document.documentElement.dataset.screen = "auth";
    return () => { delete document.documentElement.dataset.screen; };
  }, []);
}
function saveLang(l: Lang) { try { localStorage.setItem(LANG_KEY, l); } catch { /* storage unavailable */ } }

const T = {
  tagline: { en: "See which ads bring paying customers, not just chats.", sw: "Ona matangazo yapi yanaleta wateja wanaolipa, si gumzo tu." },
  signIn: { en: "Sign in", sw: "Ingia" },
  createAccount: { en: "Create account", sw: "Fungua akaunti" },
  business: { en: "Business name", sw: "Jina la biashara" },
  businessPh: { en: "e.g. Mama Neema Shop", sw: "mf. Duka la Mama Neema" },
  email: { en: "Email", sw: "Barua pepe" },
  password: { en: "Password", sw: "Nenosiri" },
  newPassword: { en: "New password", sw: "Nenosiri jipya" },
  pwHint: { en: "At least 8 characters", sw: "Angalau herufi 8" },
  pwMore: { en: "{n} more characters", sw: "Herufi {n} zaidi" },
  pwOk: { en: "✓ Long enough", sw: "✓ Inatosha" },
  emailOk: { en: "✓ Looks right", sw: "✓ Iko sawa" },
  show: { en: "Show", sw: "Onyesha" }, hide: { en: "Hide", sw: "Ficha" },
  forgot: { en: "Forgot password?", sw: "Umesahau nenosiri?" },
  keep: { en: "Keep me signed in on this device", sw: "Nibaki nimeingia kwenye kifaa hiki" },
  keepHint: { en: "Untick on a shared or borrowed phone.", sw: "Ondoa tiki kama ni simu ya kuazima au ya pamoja." },
  useLink: { en: "Email me a sign-in link instead", sw: "Nitumie kiungo cha kuingia kwa barua pepe" },
  usePassword: { en: "Sign in with password instead", sw: "Ingia kwa nenosiri badala yake" },
  sendLink: { en: "Email me a sign-in link", sw: "Nitumie kiungo cha kuingia" },
  sendReset: { en: "Email me a reset link", sw: "Nitumie kiungo cha kubadilisha" },
  resetTitle: { en: "Reset your password", sw: "Badilisha nenosiri lako" },
  resetBody: { en: "Enter the email you signed up with. We'll send a link to set a new password.", sw: "Weka barua pepe uliyojisajili nayo. Tutakutumia kiungo cha kuweka nenosiri jipya." },
  back: { en: "Back to sign in", sw: "Rudi kuingia" },
  wait: { en: "Please wait…", sw: "Subiri kidogo…" },
  noAccount: { en: "New to itaOS?", sw: "Mgeni kwenye itaOS?" },
  haveAccount: { en: "Already have an account?", sw: "Tayari una akaunti?" },
  terms: { en: "By creating an account you agree to our", sw: "Kwa kufungua akaunti unakubali" },
  termsLink: { en: "terms", sw: "masharti yetu" },
  home: { en: "← Back to home", sw: "← Rudi mwanzo" },
  google: { en: "Sign in with Google", sw: "Ingia kwa Google" },
  googleUp: { en: "Sign up with Google", sw: "Jisajili kwa Google" },
  or: { en: "or with email", sw: "au kwa barua pepe" },
  inApp: { en: "Google sign-in doesn't work inside WhatsApp, Instagram or Facebook. Open this page in Chrome or Safari, or use your email below.", sw: "Kuingia kwa Google hakufanyi kazi ndani ya WhatsApp, Instagram au Facebook. Fungua ukurasa huu kwenye Chrome au Safari, au tumia barua pepe hapa chini." },
  providerOff: { en: "Google sign-in isn't available right now. Use your email instead.", sw: "Kuingia kwa Google hakupatikani sasa hivi. Tumia barua pepe badala yake." },
  staff: { en: "Pondi staff? Staff sign-in", sw: "Mfanyakazi wa Pondi? Ingia hapa" },
  staffAccount: { en: "This is a Pondi staff account. Staff sign in on the staff page.", sw: "Hii ni akaunti ya wafanyakazi wa Pondi. Wafanyakazi huingia kwenye ukurasa wa wafanyakazi." },
  openStaff: { en: "Go to staff sign-in", sw: "Nenda kwa wafanyakazi" },
  // results
  checkTitle: { en: "Check your email", sw: "Angalia barua pepe yako" },
  checkSignup: { en: "We sent a confirmation link to {e}. Open it to finish creating your account. Your business will be ready when you come back.", sw: "Tumetuma kiungo cha uthibitisho kwa {e}. Kifungue ili kumaliza kufungua akaunti. Biashara yako itakuwa tayari ukirudi." },
  checkLink: { en: "We sent a sign-in link to {e}. Open it on this phone or computer.", sw: "Tumetuma kiungo cha kuingia kwa {e}. Kifungue kwenye simu au kompyuta hii." },
  checkReset: { en: "If {e} has an itaOS account, a reset link is on its way. Open it to set a new password.", sw: "Kama {e} ina akaunti ya itaOS, kiungo cha kubadilisha kiko njiani. Kifungue uweke nenosiri jipya." },
  spam: { en: "Not there after a minute? Check Spam or Promotions.", sw: "Hukioni baada ya dakika moja? Angalia Spam au Promotions." },
  resend: { en: "Send it again", sw: "Tuma tena" },
  resent: { en: "Sent again.", sw: "Imetumwa tena." },
  // errors
  wrong: { en: "Wrong email or password.", sw: "Barua pepe au nenosiri si sahihi." },
  unconfirmed: { en: "Confirm your email first. We can send the confirmation link again.", sw: "Thibitisha barua pepe yako kwanza. Tunaweza kutuma kiungo cha uthibitisho tena." },
  exists: { en: "An account with this email already exists. Sign in instead.", sw: "Akaunti yenye barua pepe hii tayari ipo. Ingia badala yake." },
  noSuchAccount: { en: "No itaOS account uses this email. Check the spelling or create an account.", sw: "Hakuna akaunti ya itaOS yenye barua pepe hii. Hakiki tahajia au fungua akaunti." },
  short: { en: "Use at least 8 characters for your password.", sw: "Tumia angalau herufi 8 kwa nenosiri." },
  needName: { en: "Enter your business name.", sw: "Weka jina la biashara yako." },
  needEmail: { en: "Enter a valid email address, like you@business.co.tz.", sw: "Weka barua pepe sahihi, mf. wewe@biashara.co.tz." },
  needPassword: { en: "Enter your password.", sw: "Weka nenosiri lako." },
  rate: { en: "Too many emails were sent just now. Wait a few minutes, or sign in with your password.", sw: "Barua pepe nyingi zimetumwa sasa hivi. Subiri dakika chache, au ingia kwa nenosiri." },
  offline: { en: "Couldn't reach itaOS. Check your internet connection and try again.", sw: "Imeshindwa kufikia itaOS. Hakiki intaneti yako ujaribu tena." },
  linkExpired: { en: "That email link has expired or was already used. Sign in, or ask for a new link.", sw: "Kiungo hicho kimeisha muda au kimeshatumika. Ingia, au omba kiungo kipya." },
  // set new password
  setTitle: { en: "Set a new password", sw: "Weka nenosiri jipya" },
  setBody: { en: "Choose a new password for {e}.", sw: "Chagua nenosiri jipya la {e}." },
  save: { en: "Save password", sw: "Hifadhi nenosiri" },
  saved: { en: "Password saved. Opening your business…", sw: "Nenosiri limehifadhiwa. Tunafungua biashara yako…" },
  // workspace
  wsTitle: { en: "Name your business", sw: "Taja jina la biashara yako" },
  wsBody: { en: "This is the workspace your ads and WhatsApp connect to.", sw: "Hapa ndipo matangazo yako na WhatsApp vitaunganishwa." },
  wsCreate: { en: "Create workspace", sw: "Fungua biashara" },
  wsCreating: { en: "Creating…", sw: "Tunafungua…" },
  wsFail: { en: "Couldn't create the workspace. Please try again.", sw: "Imeshindwa kufungua biashara. Tafadhali jaribu tena." },
  wsLost: { en: "Your email is confirmed, but this browser lost your sign-in. Please sign in again to continue.", sw: "Barua pepe yako imethibitishwa, ila kivinjari hiki kimepoteza uingiaji wako. Tafadhali ingia tena uendelee." },
  signInAgain: { en: "Sign in again", sw: "Ingia tena" },
  // new layout
  welcomeBack: { en: "Welcome back", sw: "Karibu tena" },
  welcomeSub: { en: "Sign in to see which ads are bringing you sales.", sw: "Ingia uone matangazo yapi yanakuletea mauzo." },
  newTitle: { en: "Create your account", sw: "Fungua akaunti yako" },
  newSub: { en: "Takes less than a minute. Then connect your WhatsApp.", sw: "Inachukua chini ya dakika moja. Kisha unganisha WhatsApp yako." },
  close: { en: "Back to the itaOS homepage", sw: "Rudi ukurasa wa mwanzo wa itaOS" },
  // celebration after sign-up
  stepDone: { en: "{b}, your first step is done!", sw: "{b}, hatua ya kwanza imekamilika!" },
  stepDoneNoName: { en: "Your first step is done!", sw: "Hatua ya kwanza imekamilika!" },
  s1: { en: "Account", sw: "Akaunti" },
  s2: { en: "Confirm email", sw: "Thibitisha barua pepe" },
  s3: { en: "Connect WhatsApp", sw: "Unganisha WhatsApp" },
  s4: { en: "First sale", sw: "Mauzo ya kwanza" },
  // showcase panel
  flow: { en: "Ads → WhatsApp → Sales", sw: "Matangazo → WhatsApp → Mauzo" },
  chatMsg: { en: "Hi, how much is it? I saw your ad on Instagram.", sw: "Habari, bei ni ngapi? Nimeona tangazo lenu Instagram." },
  fromAd: { en: "From ad: Friday offer", sw: "Kutoka tangazo: Ofa ya Ijumaa" },
  paid: { en: "Order paid", sw: "Oda imelipwa" },
  paidSub: { en: "Instagram ad → WhatsApp", sw: "Tangazo Instagram → WhatsApp" },
  week: { en: "Sales, last 7 days", sw: "Mauzo, siku 7 zilizopita" },
  weekAds: { en: "Sales from ads, last 7 days", sw: "Mauzo kutoka matangazo, siku 7" },
  newChats: { en: "+12 new chats today", sw: "+12 gumzo mpya leo" },
  kito: { en: "Kito replied in 8 seconds", sw: "Kito amejibu ndani ya sekunde 8" },
  legal: { en: "Terms & privacy", sw: "Masharti na faragha" },
} as const;
type Key = keyof typeof T;
export const tr = (lang: Lang, k: Key, vars: Record<string, string> = {}) =>
  Object.entries(vars).reduce<string>((s, [n, v]) => s.replace(`{${n}}`, v), T[k][lang]);

export function LangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="seg auth-lang" role="group" aria-label="Language / Lugha">
      {(["sw", "en"] as const).map((l) => (
        <button key={l} type="button" className={lang === l ? "on" : ""} aria-pressed={lang === l} onClick={() => { saveLang(l); onChange(l); }}>
          {l === "sw" ? "Kiswahili" : "English"}
        </button>
      ))}
    </div>
  );
}

function friendly(lang: Lang, msg: string): string {
  if (/invalid login credentials/i.test(msg)) return tr(lang, "wrong");
  if (/email not confirmed/i.test(msg)) return tr(lang, "unconfirmed");
  if (/already registered|already exists/i.test(msg)) return tr(lang, "exists");
  if (/signups? not allowed|user not found/i.test(msg)) return tr(lang, "noSuchAccount");
  if (/rate limit|too many|security purposes/i.test(msg)) return tr(lang, "rate");
  if (/password should be at least|weak password/i.test(msg)) return tr(lang, "short");
  if (/failed to fetch|network/i.test(msg)) return tr(lang, "offline");
  if (/provider is not enabled|unsupported provider/i.test(msg)) return tr(lang, "providerOff");
  return msg;
}

/* ---------- Google ---------- */
/** In-app browsers (WhatsApp, Instagram, Facebook, Android WebViews) where Google blocks sign-in. */
const IN_APP = typeof navigator !== "undefined" && /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|; wv\)/i.test(navigator.userAgent);

/** Shows the Google button only once Google is switched on in Supabase (Authentication → Providers). */
function useGoogleEnabled(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY } })
      .then((r) => r.json()).then((j) => { if (live) setOn(j?.external?.google === true); }).catch(() => { /* hide on error */ });
    return () => { live = false; };
  }, []);
  return on;
}

/** Google's "G" mark, built in (no download), so it never flickers or goes missing on a slow connection. */
function GoogleMark() {
  return (
    <span className="auth-g-wrap" aria-hidden="true">
      <svg className="auth-g" viewBox="0 0 48 48" width={18} height={18}>
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
    </span>
  );
}

/* ---------- layout: form panel + itaOS showcase ---------- */
const Icon = {
  biz: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9.5 4.6 4h14.8L21 9.5M3 9.5h18M3 9.5c0 1.4 1.1 2.5 2.5 2.5S8 10.9 8 9.5m0 0c0 1.4 1.1 2.5 2.5 2.5h3c1.4 0 2.5-1.1 2.5-2.5m0 0c0 1.4 1.1 2.5 2.5 2.5S21 10.9 21 9.5M4.5 12v8h15v-8M9.5 20v-5h5v5" /></svg>,
  mail: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></svg>,
  lock: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="3" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /><circle cx="12" cy="15.5" r="1.2" /></svg>,
  eye: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></svg>,
  eyeOff: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 5.6c.5-.1.9-.1 1.4-.1 6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.7M6.6 6.6C3.9 8.3 2.5 12 2.5 12S6 18.5 12 18.5c1.8 0 3.3-.5 4.6-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>,
  x: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>,
  check: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>,
};

/** The right-hand panel (top banner on phones): what itaOS does, shown as floating product cards. */
function Showcase({ lang, setLang }: { lang: Lang; setLang?: (l: Lang) => void }) {
  const t = (k: Key) => tr(lang, k);
  const ref = usePageEnter<HTMLDivElement>((el) => { enterCards(select(el, ".ax-float"), { y: 30, stagger: 0.09, delay: 0.15 }); });
  const bars = [38, 52, 30, 86, 44, 70, 60];
  return (
    <aside className="ax-show" ref={ref}>
      {setLang && (
        <div className="ax-show-top">
          <a className="ax-show-logo" href="/" aria-label={t("close")} title={t("close")}><Logo size={34} variant="white" /></a>
          <LangToggle lang={lang} onChange={setLang} />
        </div>
      )}
      <div className="ax-show-copy" aria-hidden="true">
        <span className="ax-eyebrow">itaOS · {t("flow")}</span>
        <p className="ax-headline">{t("tagline")}</p>
      </div>
      <div className="ax-big" aria-hidden="true">
        <div className="ax-big-txt"><span>{t("weekAds")}</span><b>TZS 1.2M</b></div>
        <div className="ax-big-bars">{bars.map((h, i) => <i key={i} className={i === 3 ? "hi" : ""} style={{ height: h + "%" }} />)}</div>
      </div>
      <div className="ax-mini" aria-hidden="true">
        <span className="ax-tick">{Icon.check}</span>
        <span className="ax-mini-l">{t("paid")}</span>
        <b className="ax-mini-v">TZS 45,000</b>
        <span className="ax-mini-s">{t("paidSub")}</span>
      </div>
      <div className="ax-stage" aria-hidden="true">
        <div className="ax-float ax-chat">
          <div className="ax-chat-head"><span className="ax-av" style={{ background: "#ffd84d", color: "#0a3d29" }}>AM</span>
            <div><b>Asha M.</b><span className="ax-wa">● WhatsApp · 09:41</span></div></div>
          <p className="ax-bubble">{t("chatMsg")}</p>
          <div className="ax-chat-foot"><span className="ax-src">{t("fromAd")}</span><span className="ax-kito"><span className="ax-kito-dot" />{t("kito")}</span></div>
        </div>
        <div className="ax-float ax-order">
          <div className="ax-order-ghost" />
          <div className="ax-order-card">
            <span className="ax-tick">{Icon.check}</span>
            <div><span className="ax-order-l">{t("paid")}</span><b className="ax-order-v">TZS 45,000</b><span className="ax-order-s">{t("paidSub")}</span></div>
          </div>
        </div>
        <div className="ax-float ax-week">
          <span className="ax-week-l">{t("week")}</span>
          <b className="ax-week-v">TZS 1.2M</b>
          <div className="ax-bars">{bars.map((h, i) => <i key={i} className={i === 3 ? "hi" : ""} style={{ height: h + "%" }} />)}</div>
        </div>
        <div className="ax-float ax-people">
          <div className="ax-stack"><span className="ax-av" style={{ background: "#ffd9a8" }}>JK</span><span className="ax-av" style={{ background: "#c9e7d6" }}>NS</span><span className="ax-av" style={{ background: "#d9dcff" }}>RM</span></div>
          <span>{t("newChats")}</span>
        </div>
      </div>
    </aside>
  );
}

/** Shared frame for every sign-in screen (sign in, create account, emails sent, new password, name your business). */
export function AuthShell({ lang, setLang, children, showcase = true }: { lang: Lang; setLang?: (l: Lang) => void; children: React.ReactNode; showcase?: boolean }) {
  useAuthScreen();
  return (
    <div className="ax">
      <div className={"ax-split" + (showcase ? "" : " solo")}>
        <section className="ax-side">{children}</section>
        {showcase && <Showcase lang={lang} setLang={setLang} />}
        <a className="ax-notch" href="/" aria-label={tr(lang, "close")} title={tr(lang, "close")}><span>{Icon.x}</span></a>
      </div>
    </div>
  );
}

function Brand({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="auth-top">
      <a className="row ax-brand" href="/" aria-label={tr(lang, "close")} title={tr(lang, "close")}><Logo size={36} variant="white" /><b className="auth-brand">itaOS</b></a>
      <LangToggle lang={lang} onChange={setLang} />
    </div>
  );
}

/** note: the problem with THIS field, shown right under it (Glide: "point at the fix", not a message at the end). */
function Field({ id, label, icon, children, extra, note }: { id: string; label: string; icon: React.ReactNode; children: React.ReactNode; extra?: React.ReactNode; note?: string }) {
  return (
    <div className={"ax-field" + (note ? " is-bad" : "")}>
      <div className="auth-label-row"><label htmlFor={id}>{label}</label>{extra}</div>
      <div className="ax-input"><span className="ax-ico">{icon}</span>{children}</div>
      {note && <p className="err small ax-note" id={id + "-note"} role="alert">{note}</p>}
    </div>
  );
}

/** The hexagon badge on the "first step" screen, in the homepage mint and green. */
function StepBadge() {
  return (
    <svg className="ax-badge" viewBox="0 0 120 132" aria-hidden="true">
      <defs>
        <linearGradient id="axHex" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#9af7cb" /><stop offset=".5" stopColor="#5ef0ae" /><stop offset="1" stopColor="#0f7a4f" /></linearGradient>
      </defs>
      <path d="M60 4c3 0 6 .8 8.6 2.3l37 21.4c5.3 3 8.4 8.6 8.4 14.7v47.2c0 6-3.1 11.6-8.4 14.7l-37 21.4a17.2 17.2 0 0 1-17.2 0l-37-21.4C9.1 101.2 6 95.6 6 89.6V42.4c0-6 3.1-11.6 8.4-14.7l37-21.4C54 4.8 57 4 60 4Z" fill="url(#axHex)" />
      <g fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="1.6">{[0, 60, 120].map((r) => <ellipse key={r} cx="60" cy="66" rx="30" ry="14" transform={`rotate(${r} 60 66)`} />)}</g>
      <path d="m44 67 11 11 22-24" fill="none" stroke="#0a3d29" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------- sign in / create account ---------- */
type Mode = "signin" | "signup" | "link" | "forgot";
type Sent = { kind: "signup" | "link" | "reset"; email: string; business?: string } | null;

export function AuthScreen() {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [mode, setMode] = useState<Mode>(() => (/[?&]signup\b/.test(location.search) ? "signup" : "signin"));
  const [business, setBusiness] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [keep, setKeep] = useState(rememberThisDevice);
  const [err, setErr] = useState(AUTH_LINK_ERROR ? "LINK" : "");
  const [canResend, setCanResend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Sent>(null);
  const [resent, setResent] = useState(false);
  const formRef = usePageEnter<HTMLFormElement>((f) => { enterTiles(select(f, ":scope > *"), { stagger: 0.04 }); }, [mode, !!sent]);
  const t = (k: Key, v?: Record<string, string>) => tr(lang, k, v);
  const redirect = location.origin + "/app";
  const googleOn = useGoogleEnabled();

  async function google() {
    setErr(""); setBusy(true);
    setRememberThisDevice(mode === "signup" || keep);
    try { localStorage.setItem("itaos-lang", lang); } catch { /* storage unavailable */ }
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirect, queryParams: { prompt: "select_account" } } });
    if (error) fail(error.message); // on success the browser leaves for Google
  }

  const [bad, setBad] = useState<"" | "biz" | "email" | "pw">(""); // which field the last check failed on
  const go = (m: Mode) => { setMode(m); setErr(""); setBad(""); setCanResend(false); };
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const fail = (msg: string) => {
    setBusy(false); shake(formRef.current);
    setCanResend(/email not confirmed/i.test(msg));
    setErr(friendly(lang, msg));
    if (/already registered|already exists/i.test(msg)) setMode("signin");
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setBad(""); setCanResend(false);
    const em = email.trim().toLowerCase();
    const at = (f: "biz" | "email" | "pw", m: string) => { setBad(f); fail(m); document.getElementById(f === "pw" ? "pw" : f)?.focus(); };
    if (mode === "signup" && !business.trim()) return at("biz", t("needName"));
    if (!EMAIL_RE.test(em)) return at("email", t("needEmail"));
    if (mode === "signin" && !password) return at("pw", t("needPassword"));
    if (mode === "signup" && password.length < 8) return at("pw", t("short"));
    setBusy(true);
    setRememberThisDevice(mode === "signup" || keep); // new accounts are on their own phone: keep them signed in
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: em, password });
        if (error) return fail(error.message);
        return; // App takes over on the auth event
      }
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email: em, password,
          options: { emailRedirectTo: redirect, data: { business_name: business.trim(), language: lang } } });
        if (error) return fail(error.message);
        // With email confirmation on, an existing address comes back as a user with no identities.
        if (data.user && (data.user.identities?.length ?? 0) === 0) return fail("already registered");
        setBusy(false);
        if (!data.session) setSent({ kind: "signup", email: em, business: business.trim() });
        return;
      }
      if (mode === "link") {
        const { error } = await supabase.auth.signInWithOtp({ email: em, options: { shouldCreateUser: false, emailRedirectTo: redirect } });
        if (error) return fail(error.message);
        setBusy(false); setSent({ kind: "link", email: em }); return;
      }
      const { error } = await supabase.auth.resetPasswordForEmail(em, { redirectTo: redirect });
      if (error && !/user not found/i.test(error.message)) return fail(error.message);
      setBusy(false); setSent({ kind: "reset", email: em });
    } catch (x) { fail(x instanceof Error ? x.message : String(x)); }
  }

  async function resend(target: string) {
    setResent(false); setBusy(true);
    const { error } = await supabase.auth.resend({ type: "signup", email: target, options: { emailRedirectTo: redirect } });
    setBusy(false);
    if (error) setErr(friendly(lang, error.message)); else { setResent(true); setErr(""); }
  }

  if (sent) {
    const body = sent.kind === "signup" ? "checkSignup" : sent.kind === "link" ? "checkLink" : "checkReset";
    const celebrate = sent.kind === "signup";
    return (
      <AuthShell lang={lang} setLang={setLang}>
        <form className="ax-form ax-done" ref={formRef} onSubmit={(e) => e.preventDefault()}>
          <Brand lang={lang} setLang={setLang} />
          {celebrate ? <StepBadge /> : <div className="auth-mail" aria-hidden="true">{Icon.mail}</div>}
          <div className="ax-head">
            <h2>{celebrate ? (sent.business ? t("stepDone", { b: sent.business }) : t("stepDoneNoName")) : t("checkTitle")}</h2>
            <p>{t(body, { e: sent.email })}</p>
          </div>
          {celebrate && (
            <ol className="ax-steps">
              {(["s1", "s2", "s3", "s4"] as const).map((k, i) => (
                <li key={k} className={i === 0 ? "done" : i === 1 ? "now" : ""}><span>{i === 0 ? Icon.check : i + 1}</span>{t(k)}</li>
              ))}
            </ol>
          )}
          <p className="muted small" style={{ margin: 0 }}>{t("spam")}</p>
          {celebrate && <button type="button" className="ax-ghost" disabled={busy} onClick={() => resend(sent.email)}>{t("resend")}</button>}
          {resent && <p className="ok" role="status" style={{ margin: 0 }}>{t("resent")}</p>}
          {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
          <div className="ax-foot"><button type="button" className="link-btn small" onClick={() => { setSent(null); setResent(false); go("signin"); }}>{t("back")}</button></div>
        </form>
      </AuthShell>
    );
  }

  const tabbed = mode === "signin" || mode === "signup";
  const title = mode === "signin" ? t("welcomeBack") : mode === "signup" ? t("newTitle") : mode === "forgot" ? t("resetTitle") : t("sendLink");
  const sub = mode === "signin" ? t("welcomeSub") : mode === "signup" ? t("newSub") : mode === "forgot" ? t("resetBody") : "";
  return (
    <AuthShell lang={lang} setLang={setLang}>
      <form className="ax-form" ref={formRef} onSubmit={submit} noValidate>
        <Brand lang={lang} setLang={setLang} />
        <div className="ax-head"><h2>{title}</h2>{sub && <p className={mode === "signin" ? "ax-sub-opt" : undefined}>{sub}</p>}</div>

        {mode === "signup" && (
          <Field id="biz" label={t("business")} icon={Icon.biz} note={bad === "biz" ? err : undefined}>
            <input id="biz" required autoComplete="organization" aria-invalid={bad === "biz" || undefined} value={business} onChange={(e) => { setBusiness(e.target.value); if (bad === "biz") setBad(""); }} placeholder={t("businessPh")} />
          </Field>
        )}
        <Field id="email" label={t("email")} icon={Icon.mail} note={bad === "email" ? err : undefined}
          extra={mode === "signup" && EMAIL_RE.test(email.trim()) ? <span className="ok small ax-yes">{t("emailOk")}</span> : undefined}>
          <input id="email" type="email" required autoComplete="email" inputMode="email" aria-invalid={bad === "email" || undefined} value={email} onChange={(e) => { setEmail(e.target.value); if (bad === "email") setBad(""); }} placeholder="you@business.co.tz" />
        </Field>
        {tabbed && (
          <Field id="pw" label={t("password")} icon={Icon.lock} note={bad === "pw" ? err : undefined}
            extra={mode === "signin" ? <button type="button" className="link-btn small" onClick={() => go("forgot")}>{t("forgot")}</button>
              : password.length >= 8 ? <span className="ok small ax-yes">{t("pwOk")}</span>
              : <span className="muted small" aria-live="polite">{password ? t("pwMore").replace("{n}", String(8 - password.length)) : t("pwHint")}</span>}>
            <input id="pw" type={showPw ? "text" : "password"} placeholder="••••••••" aria-invalid={bad === "pw" || undefined}
              autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => { setPassword(e.target.value); if (bad === "pw") setBad(""); }} />
            <button type="button" className="ax-eye" aria-pressed={showPw} aria-label={showPw ? t("hide") : t("show")} title={showPw ? t("hide") : t("show")} onClick={() => setShowPw(!showPw)}>{showPw ? Icon.eyeOff : Icon.eye}</button>
          </Field>
        )}

        {(mode === "signin" || mode === "link") && (
          <label className="ax-keep">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            <span>{t("keep")}<small>{t("keepHint")}</small></span>
          </label>
        )}
        <button className="primary ax-cta" disabled={busy}>
          {busy ? t("wait") : mode === "signin" ? t("signIn") : mode === "signup" ? t("createAccount") : mode === "link" ? t("sendLink") : t("sendReset")}
        </button>
        {err && !bad && <p className="err" role="alert" style={{ margin: 0 }}>{err === "LINK" ? t("linkExpired") : err}</p>}
        {canResend && <button type="button" className="ax-ghost" disabled={busy} onClick={() => resend(email.trim().toLowerCase())}>{t("resend")}</button>}
        {resent && <p className="ok" role="status" style={{ margin: 0 }}>{t("resent")}</p>}

        {tabbed && googleOn && (<>
          <div className="auth-or"><span>{lang === "sw" ? "au" : "or"}</span></div>
          <button type="button" className="auth-google" disabled={busy} onClick={google}><GoogleMark /><span>{mode === "signup" ? t("googleUp") : t("google")}</span></button>
          {IN_APP && <p className="muted small" style={{ margin: 0 }}>{t("inApp")}</p>}
        </>)}

        {mode === "signin" && <button type="button" className="link-btn small ax-center" onClick={() => go("link")}>{t("useLink")}</button>}
        {mode === "signup" && <p className="muted small ax-center" style={{ margin: 0 }}>{t("terms")} <a href="https://ponditech.com/#terms" target="_blank" rel="noreferrer">{t("termsLink")}</a>.</p>}
        {!tabbed && <button type="button" className="link-btn small ax-center" onClick={() => go("signin")}>{mode === "link" ? t("usePassword") : t("back")}</button>}

        {tabbed && (
          <p className="ax-switch">{mode === "signin" ? t("noAccount") : t("haveAccount")} <button type="button" className="link-btn" onClick={() => go(mode === "signin" ? "signup" : "signin")}>{mode === "signin" ? t("createAccount") : t("signIn")}</button></p>
        )}
        <div className="ax-foot">
          {!tabbed && <a href="/" className="small muted">{t("home")}</a>}
          <a href="/app/admin" className="small muted">{t("staff")}</a>
          <a href="https://ponditech.com/#terms" target="_blank" rel="noreferrer" className="small muted">© Pondi Technologies · {t("legal")}</a>
        </div>
      </form>
    </AuthShell>
  );
}

/* ---------- after a reset link ---------- */
export function SetNewPassword({ email, onDone }: { email: string; onDone: () => void }) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const formRef = usePageEnter<HTMLFormElement>((f) => { enterTiles(select(f, ":scope > *"), { stagger: 0.05 }); });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    if (password.length < 8) { shake(formRef.current); return setErr(tr(lang, "short")); }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) { shake(formRef.current); return setErr(friendly(lang, error.message)); }
    setOk(true); setTimeout(onDone, 900);
  }
  return (
    <AuthShell lang={lang} setLang={setLang}>
      <form className="ax-form" ref={formRef} onSubmit={submit} noValidate>
        <Brand lang={lang} setLang={setLang} />
        <div className="ax-head"><h2>{tr(lang, "setTitle")}</h2><p>{tr(lang, "setBody", { e: email })}</p></div>
        <Field id="npw" label={tr(lang, "newPassword")} icon={Icon.lock} extra={<span className="muted small">{tr(lang, "pwHint")}</span>}>
          <input id="npw" type={show ? "text" : "password"} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="button" className="ax-eye" aria-pressed={show} aria-label={show ? tr(lang, "hide") : tr(lang, "show")} onClick={() => setShow(!show)}>{show ? Icon.eyeOff : Icon.eye}</button>
        </Field>
        <button className="primary ax-cta" disabled={busy || ok}>{busy ? tr(lang, "wait") : tr(lang, "save")}</button>
        {ok && <p className="ok" role="status" style={{ margin: 0 }}>{tr(lang, "saved")}</p>}
        {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
      </form>
    </AuthShell>
  );
}

/** Building blocks App.tsx uses for "Name your business". */
export { Brand as AuthBrand, Field as AuthField, Icon as AuthIcon };
