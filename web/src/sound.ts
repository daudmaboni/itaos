// Soft UI sounds (23 Nov 2026), after The Glide Studio's "Sound is half of motion: small, soft, and on time".
// A press gets a soft click, a sheet or card arriving gets a quiet whoosh. Made on the fly with Web Audio
// (no sound files), very quiet, and off with one switch in Settings → App (saved on this device).
const KEY = "itaos-sounds";
let ctx: AudioContext | null = null;

export function soundsOn(): boolean {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}
export function setSounds(on: boolean) { try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* storage blocked */ } }

function ac(): AudioContext | null {
  if (!soundsOn() || typeof window === "undefined") return null;
  if (matchMedia?.("(prefers-reduced-motion: reduce)").matches) return null;
  try {
    ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch { return null; }
}

function noise(c: AudioContext, secs: number) {
  const b = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * secs)), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource(); s.buffer = b; return s;
}

/** A soft click for a press: a tiny filtered tick. */
export function click() {
  const c = ac(); if (!c) return;
  const t = c.currentTime, s = noise(c, 0.03), f = c.createBiquadFilter(), g = c.createGain();
  f.type = "bandpass"; f.frequency.value = 2400; f.Q.value = 1.2;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
  s.connect(f).connect(g).connect(c.destination); s.start(t); s.stop(t + 0.03);
}

/** A quiet whoosh for something arriving (a sheet opening, a card sliding in). */
export function whoosh() {
  const c = ac(); if (!c) return;
  const t = c.currentTime, s = noise(c, 0.22), f = c.createBiquadFilter(), g = c.createGain();
  f.type = "bandpass"; f.Q.value = 0.9; f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(1800, t + 0.18);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.035, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  s.connect(f).connect(g).connect(c.destination); s.start(t); s.stop(t + 0.22);
}

/** Presses anywhere in the app get the click: buttons, tabs and links that act like buttons. */
export function installPressSounds() {
  if (typeof document === "undefined") return;
  document.addEventListener("pointerdown", (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.("button:not(:disabled), [role=tab], .bottomnav a, .seg a, a.btn");
    if (el && !(el as HTMLElement).closest(".hp")) click();   // not on the public homepage
  }, { passive: true, capture: true });
}
