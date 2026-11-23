// Green Insight card on Home (23 Nov 2026), after the soft-cards design Daud picked: one fact per slide,
// ‹ › arrows, dots and swipe (data-noswipe: a swipe here moves the insight, never the page tabs). The facts come from this period's numbers (insights.ts).
import { useRef, useState } from "react";
import type { Insight as Slide } from "./insights";
import { CardMenu, copyText, refreshPage } from "./CardMenu";

type T = (en: string, sw: string) => string;

export default function Insight({ slides, period, T }: { slides: Slide[]; period: string; T: T }) {
  const [i, setI] = useState(0);
  const x0 = useRef<number | null>(null);
  if (!slides.length) return null;
  const n = slides.length, k = Math.min(i, n - 1), s = slides[k]!;
  const go = (d: number) => setI((v) => (v + d + n) % n);
  return (
    <section className="card insight" aria-roledescription="carousel" aria-label={T("Insight", "Maarifa")}
      onTouchStart={(e) => { x0.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => { if (x0.current == null) return; const dx = e.changedTouches[0].clientX - x0.current; x0.current = null; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); }}
      data-noptr data-noswipe>
      <div className="in-head">
        <span className="in-ico" aria-hidden><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" /></svg></span>
        <b>{T("Insight", "Maarifa")}</b>
        <span className="in-period">{period}</span>
        <CardMenu label={T("Insight options", "Chaguo za maarifa")} light items={[
          { label: T("Copy this insight", "Nakili maarifa haya"), done: T("Copied ✓", "Imenakiliwa ✓"), onClick: () => copyText(`${s.big} ${s.line} ${s.note}`) },
          { label: T("Refresh numbers", "Sasisha namba"), onClick: refreshPage },
          { label: T("See why people didn't buy", "Ona kwa nini hawakununua"), href: "#why" },
        ]} />
      </div>
      <div className="in-body" key={s.key} aria-live="polite">
        <div className={"in-big t-" + s.tone}>{s.big}</div>
        <p className="in-line">{s.line}</p>
        <p className="in-note">{s.note}</p>
      </div>
      {n > 1 && <div className="in-foot">
        <button type="button" className="in-arrow" onClick={() => go(-1)} aria-label={T("Previous", "Iliyopita")}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg></button>
        <div className="in-dots" role="group" aria-label={T("Pick an insight", "Chagua maarifa")}>
          {slides.map((x, j) => <button key={x.key} type="button" className={j === k ? "on" : ""} aria-label={`${j + 1} / ${n}`} aria-current={j === k || undefined} onClick={() => setI(j)} />)}
        </div>
        <button type="button" className="in-arrow" onClick={() => go(1)} aria-label={T("Next", "Inayofuata")}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg></button>
      </div>}
    </section>
  );
}
