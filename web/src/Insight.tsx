// Green Insight card on Home (23 Nov 2026), after the soft-cards design Daud picked: one fact per slide.
// Swiping copies the Pool widgets size swipe (60fps.design): the facts sit side by side, the next one peeking in
// from the right edge, smaller and faded. The row follows the finger; let go and it springs onto the nearest fact
// (a short flick is enough), the one in front grows to full size while the others shrink back, and the dots
// update, the active one stretching into a pill. Stops at the first and last fact with a soft rubber band.
// data-noswipe: a swipe here moves the insight, never the page tabs. Facts come from insights.ts.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Insight as Slide } from "./insights";
import { CardMenu, copyText, refreshPage } from "./CardMenu";
import { whoosh } from "./sound";

type T = (en: string, sw: string) => string;
const PEEK = 0.86, GAP = 14, SPRING = "transform .6s cubic-bezier(.2, 1.25, .35, 1), opacity .45s ease";

export default function Insight({ slides, period, T }: { slides: Slide[]; period: string; T: T }) {
  const [i, setI] = useState(0);
  const view = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLDivElement | null)[]>([]);
  const drag = useRef<{ x0: number; y0: number; axis: "" | "h" | "v"; dx: number; t: number; x: number; v: number } | null>(null);
  const n = slides.length, k = Math.min(i, Math.max(0, n - 1));

  /** Place the row at slide k moved by dx pixels; size and fade each slide by its distance from the front. */
  const layout = useCallback((dx: number, animate: boolean) => {
    const w = (view.current?.clientWidth ?? 320) * PEEK, step = w + GAP;
    const pos = k * step - dx;
    if (row.current) { row.current.style.transition = animate ? SPRING : "none"; row.current.style.transform = `translate3d(${-pos}px,0,0)`; }
    items.current.forEach((el, j) => {
      if (!el) return;
      const d = Math.min(1, Math.abs(j * step - pos) / step);
      el.style.width = `${w}px`;
      el.style.transition = animate ? SPRING : "none";
      el.style.transform = `scale(${1 - 0.12 * d})`;
      el.style.opacity = String(1 - 0.6 * d);
    });
  }, [k]);
  useLayoutEffect(() => { layout(0, true); }, [layout, n]);
  useEffect(() => { const f = () => layout(0, false); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, [layout]);

  if (!n) return null;
  const s = slides[k]!;
  const go = (j: number) => { const to = Math.max(0, Math.min(n - 1, j)); if (to !== k) whoosh(); setI(to); };

  const down = (e: React.PointerEvent) => {
    if (n < 2 || (e.target as HTMLElement).closest("button, a, .cm")) return;
    drag.current = { x0: e.clientX, y0: e.clientY, axis: "", dx: 0, t: e.timeStamp, x: e.clientX, v: 0 };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.axis) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      d.axis = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      if (d.axis === "v") { drag.current = null; return; }   // let the page scroll
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    const dt = Math.max(1, e.timeStamp - d.t);
    d.v = 0.7 * d.v + 0.3 * ((e.clientX - d.x) / dt); d.t = e.timeStamp; d.x = e.clientX;
    // rubber band past the first and last fact
    const edge = (k === 0 && dx > 0) || (k === n - 1 && dx < 0);
    d.dx = edge ? dx * 0.3 : dx;
    layout(d.dx, false);
  };
  const up = () => {
    const d = drag.current; drag.current = null;
    if (!d || d.axis !== "h") return;
    const w = (view.current?.clientWidth ?? 320) * PEEK;
    const to = d.dx < -w * 0.22 || d.v < -0.35 ? k + 1 : d.dx > w * 0.22 || d.v > 0.35 ? k - 1 : k;
    const j = Math.max(0, Math.min(n - 1, to));
    if (j === k) layout(0, true); else go(j);
  };

  return (
    <section className="card insight" aria-roledescription="carousel" aria-label={T("Insight", "Maarifa")}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onKeyDown={(e) => { if (e.key === "ArrowRight") go(k + 1); if (e.key === "ArrowLeft") go(k - 1); }}
      style={{ touchAction: "pan-y" }} data-noptr data-noswipe>
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
      <div className="in-view" ref={view}>
        <div className="in-row" ref={row}>
          {slides.map((x, j) => (
            <div key={x.key} className={"in-body" + (j === k ? " on" : "")} ref={(el) => { items.current[j] = el; }}
              aria-hidden={j !== k} aria-live={j === k ? "polite" : undefined} onClick={() => { if (j !== k) go(j); }}>
              <div className={"in-big t-" + x.tone}>{x.big}</div>
              <p className="in-line">{x.line}</p>
              <p className="in-note">{x.note}</p>
            </div>
          ))}
        </div>
      </div>
      {n > 1 && <div className="in-dots" role="group" aria-label={T("Pick an insight", "Chagua maarifa")}>
        {slides.map((x, j) => <button key={x.key} type="button" className={j === k ? "on" : ""} aria-label={`${j + 1} / ${n}`} aria-current={j === k || undefined} onClick={() => go(j)} />)}
      </div>}
    </section>
  );
}
