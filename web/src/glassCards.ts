/* Glass cards (iPhone style) — the small bit of script behind glass.css's "Glass cards" section.
   1. Weak phones get html.glass-lite: same see-through look, but no live blur (blur is what makes
      cheap Androids stutter when scrolling). Owners can force either way with
      localStorage "itaos-glass" = "full" | "lite".
   2. On computers, a soft light follows the mouse across the card under it (--mx / --my),
      like light catching a sheet of glass. Phones skip this: there is no hover on a touch screen. */

function isWeakDevice(): boolean {
  try {
    const forced = localStorage.getItem("itaos-glass");
    if (forced === "full") return false;
    if (forced === "lite") return true;
  } catch { /* storage unavailable */ }
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (nav.connection?.saveData) return true;
  // Phones and tablets (23 Nov 2026): live blur under every card and the top bar is redrawn on each scroll
  // frame, and most Android GPUs can't keep up (WhatsApp uses solid bars for the same reason). The
  // see-through look stays; only the live blur goes. "itaos-glass" = "full" brings it back.
  if (matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) <= 900) return true;
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory <= 4) return true;
  if (typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency <= 4) return true;
  return false;
}

export function startGlassCards(): void {
  const root = document.documentElement;
  if (isWeakDevice()) root.classList.add("glass-lite");

  if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  let lit: HTMLElement | null = null;
  let frame = 0;
  let last: PointerEvent | null = null;

  const paint = () => {
    frame = 0;
    const e = last; if (!e) return;
    const card = (e.target as Element | null)?.closest?.(".card, .kpi") as HTMLElement | null;
    if (lit && lit !== card) { lit.style.removeProperty("--mx"); lit.style.removeProperty("--my"); }
    lit = card;
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", (e.clientX - r.left).toFixed(0) + "px");
    card.style.setProperty("--my", (e.clientY - r.top).toFixed(0) + "px");
  };

  document.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    last = e;
    if (!frame) frame = requestAnimationFrame(paint);
  }, { passive: true });
  document.addEventListener("pointerleave", () => {
    if (lit) { lit.style.removeProperty("--mx"); lit.style.removeProperty("--my"); lit = null; }
  });
}
