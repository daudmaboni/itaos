// The page's own scrollbar on computers (23 Nov 2026): the browser's bar and its lane are hidden, and a thin
// floating pill is drawn over the page instead. It shows while you scroll or bring the pointer to the right edge,
// fades away when you stop, turns green when grabbed, and can be dragged or clicked like a normal scrollbar.
// Phones and touch screens keep their own bar.
export function startPageScrollbar() {
  if (typeof window === "undefined" || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  const root = document.documentElement;
  root.classList.add("ps-on");
  const bar = document.createElement("div");
  bar.className = "ps";
  bar.setAttribute("aria-hidden", "true");
  const thumb = document.createElement("i");
  bar.appendChild(thumb);
  document.body.appendChild(bar);

  let hideT = 0, dragging = false, near = false, startY = 0, startScroll = 0, frame = 0;
  const PAD = 6, MIN = 44;
  const metrics = () => {
    const view = innerHeight, full = root.scrollHeight, track = view - PAD * 2;
    const th = Math.max(MIN, Math.round((view / full) * track));
    return { view, full, track, th, max: full - view };
  };
  const draw = () => {
    frame = 0;
    const m = metrics();
    if (m.max <= 2) { bar.classList.add("none"); return; }
    bar.classList.remove("none");
    const top = PAD + (scrollY / m.max) * (m.track - m.th);
    thumb.style.height = m.th + "px";
    thumb.style.transform = `translateY(${Math.round(top)}px)`;
  };
  const queue = () => { if (!frame) frame = requestAnimationFrame(draw); };
  const show = () => {
    bar.classList.add("show");
    clearTimeout(hideT);
    if (!dragging && !near) hideT = window.setTimeout(() => bar.classList.remove("show"), 1100);
  };

  addEventListener("scroll", () => { queue(); show(); }, { passive: true });
  addEventListener("resize", queue);
  new ResizeObserver(queue).observe(document.body);
  addEventListener("pointermove", (e) => {
    const was = near;
    near = e.pointerType === "mouse" && innerWidth - e.clientX < 28;
    if (near) { bar.classList.add("near"); show(); }
    else if (was) { bar.classList.remove("near"); show(); }
  }, { passive: true });
  document.addEventListener("mouseleave", () => { near = false; bar.classList.remove("near"); show(); });

  thumb.addEventListener("pointerdown", (e) => {
    e.preventDefault(); e.stopPropagation();
    dragging = true; startY = e.clientY; startScroll = scrollY;
    thumb.setPointerCapture(e.pointerId);
    bar.classList.add("drag"); show();
  });
  thumb.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const m = metrics();
    scrollTo({ top: startScroll + ((e.clientY - startY) / (m.track - m.th)) * m.max, behavior: "instant" as ScrollBehavior });
  });
  const stop = () => { if (!dragging) return; dragging = false; bar.classList.remove("drag"); show(); };
  thumb.addEventListener("pointerup", stop);
  thumb.addEventListener("pointercancel", stop);
  // Clicking the empty lane moves one screen towards the click, like a normal bar.
  bar.addEventListener("pointerdown", (e) => {
    if (e.target !== bar) return;
    const r = thumb.getBoundingClientRect();
    scrollBy({ top: (e.clientY < r.top ? -1 : 1) * innerHeight * 0.9, behavior: "smooth" });
  });
  queue();
}
