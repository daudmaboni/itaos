// Home tiles in four looks (A ads hero + list, B list with meters, F health bars, I needs you / all good).
// Home opens on a random look and moves to another every 20 s with a short fade and slide. It pauses while
// the owner touches, hovers or focuses it, never rotates with "reduce motion" on, and the dots pick one by hand.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Workspace } from "./lib";
import { buildTiles, pickLook, LOOKS, type Look, type TileInput, type Tiles } from "./homeTiles";

const EVERY = 20000;

export default function HomeTiles({ ws, input, fixed }: { ws: Workspace; input: TileInput; /** show one look, no rotation (previews) */ fixed?: Look }) {
  const T = (en: string, sw: string) => (ws.language === "sw" ? sw : en);
  const t = useMemo(() => buildTiles(input, T), [JSON.stringify(input), ws.language]); // eslint-disable-line react-hooks/exhaustive-deps
  const [picked, setLook] = useState<Look>(() => pickLook(null));
  const look = fixed ?? picked;
  const paused = useRef(0);   // time until which rotation is paused
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (reduced || fixed) return;
    const id = window.setInterval(() => {
      if (document.hidden || Date.now() < paused.current) return;
      setLook((cur) => pickLook(cur));
    }, EVERY);
    return () => window.clearInterval(id);
  }, [reduced, fixed]);
  const hold = (ms: number) => () => { paused.current = Date.now() + ms; };

  return (
    <div className="ht" onPointerEnter={hold(60000)} onPointerLeave={hold(EVERY / 2)} onTouchStart={hold(30000)} onFocus={hold(60000)}>
      <div key={look} className={"ht-stage" + (reduced ? "" : " ht-anim")}>
        {look === "A" && <LookA t={t} T={T} />}
        {look === "B" && <LookB t={t} T={T} />}
        {look === "F" && <LookF t={t} T={T} />}
        {look === "I" && <LookI t={t} T={T} />}
      </div>
      <div className="ht-dots" role="group" aria-label={T("Tile style", "Mtindo wa vigae")}>
        {LOOKS.map((l, i) => (
          <button key={l} type="button" className={l === look ? "on" : ""} aria-pressed={l === look} aria-label={T(`Style ${i + 1}`, `Mtindo ${i + 1}`)}
            onClick={() => { paused.current = Date.now() + 60000; setLook(l); }} />
        ))}
      </div>
    </div>
  );
}

type P = { t: Tiles; T: (en: string, sw: string) => string };
const Chev = () => <svg className="ht-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>;
const Tick = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 9.8" /></svg>;
const ICON = {
  ads: "M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1ZM15 9a3 3 0 0 1 0 6M18 6a7 7 0 0 1 0 12",
  why: "M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z",
  pay: "M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3zM9 12l2 2 4-4",
  leak: "M12 2.7S6 9.5 6 14a6 6 0 0 0 12 0c0-4.5-6-11.3-6-11.3Z",
};
const Ico = ({ k }: { k: keyof typeof ICON }) => <span className={"ht-ico i-" + k} aria-hidden><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICON[k]} /></svg></span>;

/** Return on ads against break-even (the line at 1×). */
function AdsMeter({ fill, mark }: { fill: number; mark: number }) {
  return <span className="ht-m ht-m-ads" aria-hidden><i style={{ width: `${fill * 100}%` }} /><b style={{ left: `${mark * 100}%` }} /></span>;
}
/** Bought (green) vs didn't (peach). */
function BoughtMeter({ share }: { share: number }) {
  return <span className="ht-m ht-m-why" aria-hidden><i style={{ flex: `0 0 max(4px, ${share * 100}%)` }} /><i /></span>;
}
/** Share that's fine (green); the rest amber or red. */
function OkMeter({ share, red }: { share: number; red?: boolean }) {
  return <span className={"ht-m ht-m-ok" + (red ? " red" : "")} aria-hidden><i style={{ width: `${share * 100}%` }} /></span>;
}

const label = (T: P["T"]) => ({
  ads: T("Ads", "Matangazo"), why: T("Why they didn't buy", "Kwa nini hawakununua"),
  pay: T("Payment checks", "Ukaguzi wa malipo"), leak: T("Staff leak guard", "Kinga ya uvujaji"),
});

/** A · navy Ads tile with a button, then a list of the other three. */
function LookA({ t, T }: P) {
  const L = label(T);
  return (
    <div className="ht-A">
      <div className="ht-hero">
        <div className="ht-hero-top">
          <div><span className="ht-k">{L.ads}</span><b className="ht-big">{t.ads.value}</b><span className="ht-s">{t.ads.sub}</span></div>
          <a className="ht-btn yellow" href="#ads">{t.ads.todo ? T(`Do ${t.ads.todo} ${t.ads.todo === 1 ? "thing" : "things"}`, `Fanya ${t.ads.todo}`) : T("Open", "Fungua")}</a>
        </div>
        <AdsMeter fill={t.ads.fill} mark={t.ads.mark} />
        <span className="ht-s">{T("White line = break-even (1×)", "Mstari mweupe = kurudisha gharama (1×)")}</span>
      </div>
      <div className="ht-list">
        <a href="#why"><span className="ht-row"><span className="ht-name">{L.why}</span><b className="c-why">{t.why.value}</b><Chev /></span><BoughtMeter share={t.why.boughtShare} /><span className="ht-s">{t.why.sub}</span></a>
        <a href="#payments"><span className="ht-row"><span className="ht-name">{L.pay}</span><b className={t.pay.needs ? "c-bad" : "c-ok"}>{t.pay.value}</b><Chev /></span><OkMeter share={t.pay.okShare} red={t.pay.red} /><span className="ht-s">{t.pay.sub}</span></a>
        <a href="#leaks"><span className="ht-row"><span className="ht-name">{L.leak}</span><b className={t.leak.needs ? "c-bad" : "c-ok"}>{t.leak.value}</b><Chev /></span><OkMeter share={t.leak.okShare} /><span className="ht-s">{t.leak.sub}</span></a>
      </div>
    </div>
  );
}

/** B · one list card, icon + number + meter on every row. */
function LookB({ t, T }: P) {
  const L = label(T);
  return (
    <div className="ht-list ht-B">
      <a href="#ads"><Ico k="ads" /><span className="ht-col"><span className="ht-row"><span className="ht-name">{L.ads}</span><b>{t.ads.value}</b></span><AdsMeter fill={t.ads.fill} mark={t.ads.mark} />
        <span className="ht-row ht-s"><span>{t.ads.sub}</span>{t.ads.todo > 0 && <em className="c-warn">{T(`${t.ads.todo} to do →`, `${t.ads.todo} za kufanya →`)}</em>}</span></span></a>
      <a href="#why"><Ico k="why" /><span className="ht-col"><span className="ht-row"><span className="ht-name">{L.why}</span><b className="c-why">{t.why.value}</b></span><BoughtMeter share={t.why.boughtShare} />
        <span className="ht-row ht-s"><span>{t.why.sub}</span>{t.why.needs && <em className="c-why">{T("Fix →", "Rekebisha →")}</em>}</span></span></a>
      <a href="#payments"><Ico k="pay" /><span className="ht-col"><span className="ht-row"><span className="ht-name">{L.pay}</span><b className={t.pay.needs ? "c-bad" : "c-ok"}>{t.pay.value}</b></span><OkMeter share={t.pay.okShare} red={t.pay.red} /><span className="ht-s">{t.pay.sub}</span></span></a>
      <a href="#leaks"><Ico k="leak" /><span className="ht-col"><span className="ht-row"><span className="ht-name">{L.leak}</span><b className={t.leak.needs ? "c-bad" : "c-ok"}>{t.leak.value}</b></span><OkMeter share={t.leak.okShare} /><span className="ht-s">{t.leak.sub}</span></span></a>
    </div>
  );
}

/** F · "Business health": four labelled bars and one button for the most urgent. */
function LookF({ t, T }: P) {
  const L = label(T);
  const nextText = t.next ? { pay: T("Check a payment", "Kagua malipo"), ads: T(`${t.ads.todo || 1} thing to do: Ads`, `Jambo ${t.ads.todo || 1} la kufanya: Matangazo`), why: T("See what to fix", "Ona cha kurekebisha"), leak: T("Look at a leak", "Angalia uvujaji") }[t.next.key] : null;
  return (
    <div className="ht-F">
      <div className="ht-F-head"><b>{T("Business health", "Afya ya biashara")}</b><span className="ht-s">{T("tap a line to open it", "gusa mstari kuufungua")}</span></div>
      <div className="ht-F-grid">
        <a href="#ads"><span className="ht-row"><span className="ht-name">{T("Ads return", "Mapato ya matangazo")}</span><b>{t.ads.value}</b></span><AdsMeter fill={t.ads.fill} mark={t.ads.mark} /><span className="ht-s">{t.ads.sub}</span></a>
        <a href="#why"><span className="ht-row"><span className="ht-name">{T("Chats that bought", "Chats zilizonunua")}</span><b className="c-why">{t.why.bought}</b></span><BoughtMeter share={t.why.boughtShare} /><span className="ht-s">{T(`${t.why.value} didn't · 30 days`, `${t.why.value} hawakununua · siku 30`)}</span></a>
        <a href="#payments"><span className="ht-row"><span className="ht-name">{L.pay}</span><b className={t.pay.needs ? "c-bad" : "c-ok"}>{t.pay.value}</b></span><OkMeter share={t.pay.okShare} red={t.pay.red} /><span className="ht-s">{t.pay.sub}</span></a>
        <a href="#leaks"><span className="ht-row"><span className="ht-name">{L.leak}</span><b className={t.leak.needs ? "c-bad" : "c-ok"}>{t.leak.value}</b></span><OkMeter share={t.leak.okShare} /><span className="ht-s">{t.leak.sub}</span></a>
      </div>
      {t.next && nextText ? <a className="ht-btn dark wide" href={t.next.href}><span>{nextText}</span><span aria-hidden>→</span></a>
        : <span className="ht-clear">{T("All good. Nothing needs you here.", "Kila kitu sawa. Hakuna kinachokuhitaji hapa.")}</span>}
    </div>
  );
}

/** I · "Needs you" with buttons and meters, "All good" as short tick rows. */
function LookI({ t, T }: P) {
  const L = label(T);
  const need: JSX.Element[] = [], good: JSX.Element[] = [];
  (t.ads.needs ? need : good).push(t.ads.needs
    ? <div key="ads" className="ht-need"><span className="ht-col"><span className="ht-k">{L.ads}</span><b className="ht-mid">{t.ads.value} <small>{t.ads.sub}</small></b></span><a className="ht-btn dark" href="#ads">{t.ads.todo ? T(`Do ${t.ads.todo} ${t.ads.todo === 1 ? "thing" : "things"}`, `Fanya ${t.ads.todo}`) : T("Open", "Fungua")}</a><AdsMeter fill={t.ads.fill} mark={t.ads.mark} /></div>
    : <a key="ads" className="ht-good" href="#ads"><Tick /><span className="ht-name">{L.ads}</span><span className="ht-s">{t.ads.value} ›</span></a>);
  (t.why.needs ? need : good).push(t.why.needs
    ? <div key="why" className="ht-need"><span className="ht-col"><span className="ht-k">{L.why}</span><b className="ht-mid c-why">{t.why.value} <small>{t.why.sub}</small></b></span><a className="ht-btn dark" href="#why">{T("See fixes", "Ona marekebisho")}</a><BoughtMeter share={t.why.boughtShare} /></div>
    : <a key="why" className="ht-good" href="#why"><Tick /><span className="ht-name">{L.why}</span><span className="ht-s">{t.why.value} ›</span></a>);
  (t.pay.needs ? need : good).push(t.pay.needs
    ? <div key="pay" className="ht-need"><span className="ht-col"><span className="ht-k">{L.pay}</span><b className="ht-mid c-bad">{t.pay.sub}</b></span><a className={"ht-btn " + (t.pay.red ? "red" : "dark")} href="#payments">{T("Check", "Kagua")}</a><OkMeter share={t.pay.okShare} red={t.pay.red} /></div>
    : <a key="pay" className="ht-good" href="#payments"><Tick /><span className="ht-name">{T("Payments", "Malipo")}</span><span className="ht-s">{t.pay.value} {T("real", "halali")} ›</span></a>);
  (t.leak.needs ? need : good).push(t.leak.needs
    ? <div key="leak" className="ht-need"><span className="ht-col"><span className="ht-k">{L.leak}</span><b className="ht-mid c-bad">{t.leak.value} <small>{t.leak.sub}</small></b></span><a className="ht-btn dark" href="#leaks">{T("Look", "Angalia")}</a><OkMeter share={t.leak.okShare} /></div>
    : <a key="leak" className="ht-good" href="#leaks"><Tick /><span className="ht-name">{T("Staff leaks", "Uvujaji")}</span><span className="ht-s">{T("none", "hakuna")} ›</span></a>);
  return (
    <div className="ht-I">
      {need.length > 0 && <div className="ht-group"><span className="ht-gl c-warn">{T("NEEDS YOU", "INAKUHITAJI")}</span><div className="ht-list">{need}</div></div>}
      {good.length > 0 && <div className="ht-group"><span className="ht-gl c-ok">{T("ALL GOOD", "YOTE SAWA")}</span><div className="ht-list">{good}</div></div>}
    </div>
  );
}
