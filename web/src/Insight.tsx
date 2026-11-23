// Green Insight card on Home (23 Nov 2026), after the soft-cards design Daud picked: one fact per slide.
// Moving between facts copies the "slide to approve" motion from Divan Raj's Proposal approval shot (Dribbble):
// a white pill track with a round knob; drag the knob (or swipe the card) to the right and a light fill follows it,
// let go past ~65% and the knob runs to the end, turns into a tick, the next fact comes in with its big number
// popping like the approval stamp, and the knob springs back. Swiping the card left goes back one.
// data-noswipe: a swipe here moves the insight, never the page tabs. Facts come from insights.ts.
import { useEffect, useRef, useState } from "react";
import type { Insight as Slide } from "./insights";
import { CardMenu, copyText, refreshPage } from "./CardMenu";

type T = (en: string, sw: string) => string;
const KNOB = 44, PAD = 4, DONE = 0.65;

export default function Insight({ slides, period, T }: { slides: Slide[]; period: string; T: T }) {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [p, setP] = useState(0);              // knob position 0..1
  const [phase, setPhase] = useState<"idle" | "drag" | "run" | "done" | "back">("idle");
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x0: number; y0: number; from: "knob" | "card"; axis: "" | "h" | "v" } | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  if (!slides.length) return null;
  const n = slides.length, k = Math.min(i, n - 1), s = slides[k]!;
  const later = (ms: number, f: () => void) => { timers.current.push(window.setTimeout(f, ms)); };
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const span = () => Math.max(1, (track.current?.clientWidth ?? 300) - KNOB - PAD * 2);

  const next = () => {
    if (n < 2 || phase === "run" || phase === "done") return;
    if (reduced) { setDir(1); setI((v) => (v + 1) % n); setP(0); return; }
    setPhase("run"); setP(1);
    later(220, () => { setPhase("done"); setDir(1); setI((v) => (v + 1) % n); });
    later(650, () => { setPhase("back"); setP(0); });
    later(1000, () => setPhase("idle"));
  };
  const prev = () => { if (n < 2) return; setDir(-1); setI((v) => (v - 1 + n) % n); };
  const release = () => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (p >= DONE) next(); else { setPhase("back"); setP(0); later(320, () => setPhase("idle")); }
  };

  const onDown = (from: "knob" | "card") => (e: React.PointerEvent) => {
    if (n < 2 || phase === "run" || phase === "done") return;
    if (from === "card" && (e.target as HTMLElement).closest("button, a, .cm")) return;
    drag.current = { x0: e.clientX, y0: e.clientY, from, axis: from === "knob" ? "h" : "" };
    if (from === "knob") { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); setPhase("drag"); }
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      d.axis = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      if (d.axis === "v") { drag.current = null; return; }   // let the page scroll
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); setPhase("drag");
    }
    if (d.from === "card" && dx < -50) { drag.current = null; setP(0); setPhase("idle"); prev(); return; }
    setP(Math.max(0, Math.min(1, dx / span())));
  };

  const x = PAD + p * span();
  const moving = phase === "drag" ? "" : " anim";
  return (
    <section className="card insight" aria-roledescription="carousel" aria-label={T("Insight", "Maarifa")}
      onPointerDown={onDown("card")} onPointerMove={onMove} onPointerUp={release} onPointerCancel={release}
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
      <div className={"in-body " + (dir > 0 ? "fwd" : "bck")} key={s.key} aria-live="polite">
        <div className={"in-big t-" + s.tone}>{s.big}</div>
        <p className="in-line">{s.line}</p>
        <p className="in-note">{s.note}</p>
      </div>
      {n > 1 && (
        <div className={"in-track" + (phase === "done" ? " is-done" : "")} ref={track}>
          <span className={"in-fill" + moving} style={{ width: x + KNOB }} aria-hidden />
          <span className="in-label" style={{ opacity: 1 - Math.min(1, p * 1.6) }}>
            {T("Slide for the next insight", "Telezesha kwa maarifa yanayofuata")} <em>{k + 1}/{n}</em>
          </span>
          <button type="button" className={"in-knob" + moving} style={{ transform: `translateX(${x}px)` }}
            aria-label={T(`Next insight (${k + 1} of ${n})`, `Maarifa yanayofuata (${k + 1} kati ya ${n})`)}
            onPointerDown={(e) => { e.stopPropagation(); onDown("knob")(e); }} onPointerMove={onMove} onPointerUp={(e) => { e.stopPropagation(); if (drag.current && p < 0.05) { drag.current = null; setPhase("idle"); next(); } else release(); }}
            onPointerCancel={release} onKeyDown={(e) => { if (e.key === "ArrowLeft") { e.preventDefault(); prev(); } }}
            onClick={(e) => { if (e.detail === 0) next(); }}>
            {phase === "done"
              ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>}
          </button>
        </div>
      )}
    </section>
  );
}
