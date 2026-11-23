// Pull down from the top of the page to refresh itaOS — like WhatsApp or Instagram. Phones/touch only.
// Chrome's own pull-to-refresh doesn't fire reliably here (and the installed app has none), so the app does it itself.
//
// How it behaves (23 Nov 2026), following the four rules of a good pull-to-refresh:
//  1. Respond at once: a pill drops in under your finger the moment you pull.
//  2. Say when: while you pull it says how old the page is ("Updated 12 min ago"), then "Let go to refresh".
//  3. Refresh in place: the open page reloads its data behind what's on screen (App.tsx remounts it; every
//     page keeps its last data, so nothing blanks). The whole app only reloads if no page answers.
//  4. Tell them it worked: the pill turns into "✓ Updated just now", then slides away.

const PULL = 72; // how far (px) to pull before letting go refreshes
export const REFRESH_EVT = "itaos-refresh";

// Count requests in flight, so we know when the refreshed page has finished loading.
let inflight = 0;
function trackFetch() {
  const f = window.fetch.bind(window);
  window.fetch = (...a: Parameters<typeof fetch>) => { inflight++; return f(...a).finally(() => { inflight = Math.max(0, inflight - 1); }); };
}
function settled(minMs: number, maxMs: number) {
  const t0 = Date.now();
  return new Promise<void>((done) => {
    let quiet = 0;
    const tick = () => {
      const dt = Date.now() - t0;
      quiet = inflight === 0 ? quiet + 100 : 0;
      if ((dt >= minMs && quiet >= 300) || dt >= maxMs) return done();
      window.setTimeout(tick, 100);
    };
    window.setTimeout(tick, 100);
  });
}

const sw = () => document.documentElement.lang === "sw";
function ago(ms: number) {
  const m = Math.floor(ms / 60000);
  if (sw()) return m < 1 ? "Imesasishwa sasa hivi" : m < 60 ? `Imesasishwa dakika ${m} zilizopita` : `Imesasishwa saa ${Math.floor(m / 60)} zilizopita`;
  return m < 1 ? "Updated just now" : m < 60 ? `Updated ${m} min ago` : `Updated ${Math.floor(m / 60)} h ago`;
}

export function startPullRefresh() {
  if (!("ontouchstart" in window)) return;
  // Our own pull replaces the browser's, so the page doesn't reload twice.
  document.documentElement.style.overscrollBehaviorY = "contain";
  trackFetch();

  const el = document.createElement("div");
  el.className = "ptr";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.innerHTML = `<span class="ptr-ico" aria-hidden="true"><svg class="ptr-arc" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 3a9 9 0 1 1-9 9"/></svg><svg class="ptr-ok" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span class="ptr-txt"></span>`;
  document.body.appendChild(el);
  const txt = el.querySelector<HTMLSpanElement>(".ptr-txt")!;
  const arc = el.querySelector<SVGElement>(".ptr-arc")!;

  let y0 = 0, x0 = 0, dy = 0, on = false, busy = false, updated = Date.now();

  // Only start when the page is at the very top and nothing on top of it (open chat, sheet, popup) is scrolled.
  const canStart = (t: EventTarget | null) => {
    if (busy || window.scrollY > 0) return false;
    if (document.documentElement.dataset.screen === "auth") return false;   // sign-in screen is locked: no pull-to-refresh
    if (document.body.style.overflow === "hidden" || document.body.classList.contains("wa-open") || document.documentElement.classList.contains("sheet-open") || document.documentElement.classList.contains("pm-open")) return false;
    for (let n = t as HTMLElement | null; n && n !== document.body; n = n.parentElement) {
      if (n.matches?.("input, textarea, select, [data-noptr], .wa-pane, .sheet, .dr-layer, .paid-modal, .bottomnav")) return false;
      const oy = getComputedStyle(n).overflowY;
      if ((oy === "auto" || oy === "scroll") && n.scrollTop > 0) return false;
    }
    return true;
  };
  const setState = (s: "" | "pull" | "ready" | "spin" | "done") => { el.dataset.s = s; };
  const paint = (d: number) => {
    const p = Math.min(1, d / PULL);
    el.style.opacity = String(Math.min(1, p * 2));
    el.style.transform = `translate(-50%, ${Math.min(d, PULL + 24) * 0.9 - 52}px)`;
    arc.style.transform = `rotate(${p * 270}deg)`;
    const ready = p >= 1;
    if (ready && el.dataset.s !== "ready") { setState("ready"); txt.textContent = sw() ? "Achia kusasisha" : "Let go to refresh"; navigator.vibrate?.(6); }
    else if (!ready && el.dataset.s !== "pull") { setState("pull"); txt.textContent = ago(Date.now() - updated); }
  };
  const hide = () => {
    el.classList.add("back"); el.style.opacity = "0"; el.style.transform = "translate(-50%, -52px)";
    window.setTimeout(() => { el.classList.remove("back"); setState(""); }, 300);
  };

  async function refresh() {
    busy = true;
    setState("spin"); txt.textContent = sw() ? "Inasasisha…" : "Refreshing…";
    el.classList.add("back"); el.style.transform = `translate(-50%, ${PULL * 0.9 - 44}px)`;
    // Ask the app to reload the open page in place. If nothing answers (sign-in, error screens), reload everything.
    const ev = new CustomEvent(REFRESH_EVT, { cancelable: true });
    window.dispatchEvent(ev);
    if (!ev.defaultPrevented) { window.setTimeout(() => location.reload(), 150); return; }
    await settled(700, 10_000);
    updated = Date.now();
    setState("done"); txt.textContent = ago(0);
    navigator.vibrate?.(10);
    window.setTimeout(() => { hide(); busy = false; }, 1300);
  }

  window.addEventListener("touchstart", (e) => {
    on = e.touches.length === 1 && canStart(e.target);
    if (!on) return;
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; dy = 0;
    el.classList.remove("back");
  }, { passive: true });

  window.addEventListener("touchmove", (e) => {
    if (!on) return;
    const d = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0;
    if (window.scrollY > 0 || d <= 0 || (dy === 0 && Math.abs(dx) > Math.abs(d))) { if (dy) hide(); on = false; dy = 0; return; }
    dy = d * 0.55; // resistance, so it feels like a pull
    paint(dy);
  }, { passive: true });

  const end = () => {
    if (!on) return;
    on = false;
    if (dy >= PULL) void refresh();
    else if (dy > 0) hide();
    dy = 0;
  };
  window.addEventListener("touchend", end);
  window.addEventListener("touchcancel", end);
}
