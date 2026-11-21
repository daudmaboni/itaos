// Pull down from the top of the page to reload itaOS — like WhatsApp or Instagram.
// Chrome's own pull-to-refresh doesn't fire reliably here (and the installed app has none),
// so the app does it itself, the same way everywhere. Phones/touch only.

const PULL = 72; // how far (px) to pull before letting go reloads

export function startPullRefresh() {
  if (!("ontouchstart" in window)) return;
  // Our own pull replaces the browser's, so the page doesn't reload twice.
  document.documentElement.style.overscrollBehaviorY = "contain";

  const el = document.createElement("div");
  el.className = "ptr";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg>`;
  document.body.appendChild(el);

  let y0 = 0, x0 = 0, dy = 0, on = false, busy = false;

  // Only start when the page is at the very top and nothing on top of it (open chat, sheet, popup) is scrolled.
  const canStart = (t: EventTarget | null) => {
    if (busy || window.scrollY > 0) return false;
    if (document.documentElement.dataset.screen === "auth") return false;   // sign-in screen is locked: no pull-to-refresh
    if (document.body.style.overflow === "hidden" || document.body.classList.contains("wa-open") || document.documentElement.classList.contains("sheet-open")) return false;
    for (let n = t as HTMLElement | null; n && n !== document.body; n = n.parentElement) {
      if (n.matches?.("input, textarea, select, [data-noptr], .wa-pane, .sheet, .dr-layer, .paid-modal, .bottomnav")) return false;
      const oy = getComputedStyle(n).overflowY;
      if ((oy === "auto" || oy === "scroll") && n.scrollTop > 0) return false;
    }
    return true;
  };
  const paint = (d: number) => {
    const p = Math.min(1, d / PULL);
    el.style.opacity = String(Math.min(1, p * 1.4));
    el.style.transform = `translate(-50%, ${Math.min(d, PULL + 24) * 0.9 - 56}px) rotate(${p * 300}deg)`;
    el.classList.toggle("ready", p >= 1);
  };
  const reset = () => {
    el.classList.add("back"); el.classList.remove("ready"); paint(0); el.style.opacity = "0";
    window.setTimeout(() => el.classList.remove("back"), 260);
  };

  window.addEventListener("touchstart", (e) => {
    on = e.touches.length === 1 && canStart(e.target);
    if (!on) return;
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; dy = 0;
  }, { passive: true });

  window.addEventListener("touchmove", (e) => {
    if (!on) return;
    const d = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0;
    if (window.scrollY > 0 || d <= 0 || (dy === 0 && Math.abs(dx) > Math.abs(d))) { if (dy) reset(); on = false; dy = 0; return; }
    dy = d * 0.55; // resistance, so it feels like a pull
    paint(dy);
  }, { passive: true });

  const end = () => {
    if (!on) return;
    on = false;
    if (dy >= PULL) {
      busy = true;
      el.classList.add("spin");
      el.style.transform = `translate(-50%, ${PULL * 0.9 - 40}px)`;
      navigator.vibrate?.(8);
      window.setTimeout(() => location.reload(), 150);
    } else if (dy > 0) reset();
    dy = 0;
  };
  window.addEventListener("touchend", end);
  window.addEventListener("touchcancel", end);
}
