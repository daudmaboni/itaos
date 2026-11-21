/* Motion between pages inside the app (not the public homepage). Two weights:

   1. pageTransition — every ordinary page change. Light and fast (~250 ms) so it never makes anyone
      wait: the page changes at once, settles up into place, its headings rise through a mask (the
      Arch Studio touch), and a thin yellow line sweeps across under the top bar.

   2. curtainCover / curtainReveal — the full Arch Studio panel wipe (two panels sweep up, a word
      rises, then they lift off the top). Only for rare, big moments such as arriving in the app
      right after signing in, where a short pause feels deliberate.

   Under "reduce motion" everything just switches. */
import gsap from "gsap";
import { prefersReduced } from "./motion";

export type Area = { top: number; left: number; right: number; bottom: number };

/** Set by the phone swipe gesture (its direction, -1 or 1): PageView slides the new page in from that side
 *  instead of the tap crossfade. `busy` is true while a phone page change is still animating. */
export const navFlags: { swipe: number; fade: number | null; busy: boolean } = { swipe: 0, fade: null, busy: false };

function css() {
  if (document.getElementById("pt-style")) return;
  const s = document.createElement("style");
  s.id = "pt-style";
  s.textContent = `
.pt-line{position:fixed;height:2px;background:var(--pt-accent,#F7C948);pointer-events:none;transform-origin:left center;transform:scaleX(0);border-radius:2px;z-index:36}
.pt-wipe{position:fixed;inset:0;pointer-events:none;visibility:hidden;overflow:hidden;z-index:1000}
.pt-wipe.on{visibility:visible;pointer-events:auto}
.pt-wipe>i{position:absolute;inset:0;display:block;will-change:clip-path}
.pt-wipe .pt-a{background:var(--pt-accent,#F7C948)}
.pt-wipe .pt-b{background:var(--pt-panel,#16224A);display:grid;place-items:center;padding:24px}
.pt-lab{color:var(--pt-ink,#fff);font:600 clamp(30px,6vw,64px)/1.05 'Bricolage Grotesque','Instrument Sans',system-ui,sans-serif;letter-spacing:-.035em;overflow:hidden;padding-bottom:.08em}
.pt-lab span{display:inline-block;will-change:transform}
`;
  document.head.append(s);
}

/* ---------- 1. ordinary page change ---------- */

let line: HTMLDivElement | null = null;

export function pageTransition({ swap, area, stage }: {
  /** do the page change; must update the DOM synchronously (use flushSync) */
  swap: () => void;
  /** where the yellow line runs: its top edge, left and right (defaults to the top of the window) */
  area?: () => Partial<Area>;
  /** element holding the new page */
  stage?: () => HTMLElement | null;
}) {
  window.scrollTo({ top: 0 });
  swap();
  if (prefersReduced()) return;
  css();

  const s = stage?.();
  if (s) {
    gsap.killTweensOf(s);
    gsap.fromTo(s, { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.26, ease: "power3.out", clearProps: "transform,opacity" });
    const heads = Array.from(s.querySelectorAll<HTMLElement>("h1, h2")).filter((h) => h.offsetParent).slice(0, 2);
    if (heads.length) gsap.fromTo(heads, { clipPath: "inset(0% 0% 100% 0%)", y: 10 },
      { clipPath: "inset(0% 0% -20% 0%)", y: 0, duration: 0.32, ease: "expo.out", stagger: 0.04, delay: 0.03, clearProps: "clipPath,transform" });
  }

  if (!line || !line.isConnected) {
    line = document.createElement("div");
    line.className = "pt-line";
    line.setAttribute("aria-hidden", "true");
    document.body.append(line);
  }
  const r = { top: 0, left: 0, right: innerWidth, ...(area?.() ?? {}) };
  Object.assign(line.style, { top: `${Math.max(0, r.top)}px`, left: `${Math.max(0, r.left)}px`, width: `${Math.max(0, r.right - Math.max(0, r.left))}px` });
  gsap.killTweensOf(line);
  gsap.timeline()
    .set(line, { transformOrigin: "left center", scaleX: 0, opacity: 1 })
    .to(line, { scaleX: 1, duration: 0.2, ease: "power3.out" })
    .set(line, { transformOrigin: "right center" })
    .to(line, { scaleX: 0, duration: 0.22, ease: "power3.in" });
}

/* ---------- 2. full curtain for big moments ---------- */

let wipe: HTMLDivElement | null = null;
let covered = false;
const SHUT = "inset(100% 0% 0% 0%)", FULL = "inset(0% 0% 0% 0%)", GONE = "inset(0% 0% 100% 0%)";

function wipeEl() {
  css();
  if (wipe && wipe.isConnected) return wipe;
  wipe = document.createElement("div");
  wipe.className = "pt-wipe";
  wipe.setAttribute("aria-hidden", "true");
  wipe.innerHTML = `<i class="pt-a"></i><i class="pt-b"><div class="pt-lab"><span></span></div></i>`;
  document.body.append(wipe);
  return wipe;
}

/** The curtain's two colours (22 Nov 2026): black, white and the homepage green, mixed at random each
 *  time — the first panel is one of them, the main panel (with the word) another. The word is white on
 *  black or green, black on white. */
const CURTAIN = { black: "#121417", white: "#ffffff", green: "#0f7a4f" } as const;
function curtainColours(el: HTMLElement) {
  const names = Object.keys(CURTAIN) as (keyof typeof CURTAIN)[];
  const main = names[Math.floor(Math.random() * names.length)];
  const rest = names.filter((n) => n !== main);
  const lead = rest[Math.floor(Math.random() * rest.length)];
  el.style.setProperty("--pt-accent", CURTAIN[lead]);
  el.style.setProperty("--pt-panel", CURTAIN[main]);
  el.style.setProperty("--pt-ink", main === "white" ? CURTAIN.black : "#ffffff");
}

/** Panels sweep up over the whole screen and the word rises. Resolves once the screen is covered. */
export function curtainCover(word: string): Promise<void> {
  if (prefersReduced()) return Promise.resolve();
  const el = wipeEl();
  curtainColours(el);
  const [a, b] = Array.from(el.children) as HTMLElement[];
  const w = el.querySelector("span") as HTMLElement;
  w.textContent = word;
  gsap.killTweensOf([a, b, w]);
  gsap.set([a, b], { clipPath: SHUT });
  gsap.set(w, { yPercent: 110, opacity: 1 });
  el.classList.add("on");
  covered = true;
  return new Promise((done) => {
    gsap.timeline({ onComplete: () => done() })
      .to(a, { clipPath: FULL, duration: 0.4, ease: "power3.inOut" }, 0)
      .to(b, { clipPath: FULL, duration: 0.4, ease: "power3.inOut" }, 0.08)
      .to(w, { yPercent: 0, duration: 0.5, ease: "expo.out" }, 0.25);
  });
}

/** Word slips away and the panels lift off the top (main panel first, the other trailing). */
export function curtainReveal() {
  if (!covered || !wipe) return;
  covered = false;
  const el = wipe;
  const [a, b] = Array.from(el.children) as HTMLElement[];
  const w = el.querySelector("span") as HTMLElement;
  gsap.timeline({ onComplete: () => el.classList.remove("on") })
    .to(w, { yPercent: -110, opacity: 0, duration: 0.3, ease: "power3.in" }, 0)
    .to(b, { clipPath: GONE, duration: 0.55, ease: "expo.inOut" }, 0.08)
    .to(a, { clipPath: GONE, duration: 0.55, ease: "expo.inOut" }, 0.16);
}
