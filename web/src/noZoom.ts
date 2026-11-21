// itaOS doesn't zoom, like a native app: no pinch-zoom, no double-tap zoom, no zoom when a field is tapped.
// The one place you can zoom is the photo viewer (ImageViewer.tsx), which does it itself.
//
// - The viewport tag stops Android/Chrome zoom.
// - iPhone Safari ignores that for pinch, so its gesture events and two-finger moves are blocked here.
// - Double-tap zoom is off via `touch-action: manipulation` (styles.css), which also makes taps instant.
// - Text fields are 16px on phones (styles.css), so iPhone never zooms in when you tap one.

export function startNoZoom() {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (meta) meta.content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";

  const stop = (e: Event) => e.preventDefault();
  for (const ev of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(ev, stop, { passive: false });

  // Two fingers anywhere except the photo viewer (it handles its own pinch). iPhone only: Android already
  // obeys the viewport tag, and a blocking touchmove listener makes every Android scroll wait on the app.
  if (!("GestureEvent" in window)) return;
  document.addEventListener("touchmove", (e) => {
    if (e.touches.length > 1 && !(e.target as Element | null)?.closest?.("[data-zoom]")) e.preventDefault();
  }, { passive: false });
}
