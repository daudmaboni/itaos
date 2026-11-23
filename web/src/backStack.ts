// Phone Back button / gesture for the whole app (23 Nov 2026).
//
// Every history entry itaOS makes is numbered with `itaDepth` (0 = the entry the app opened on). That lets:
//  - the Home tab step straight back to the first entry, so Back from Home always leaves the app;
//  - every popup (sheets, dialogs, photo viewer, receipt …) add one entry of its own (`itaLayer`), so the
//    phone's Back closes the popup instead of the page or the app behind it;
//  - closing a popup with ✕ / Esc / a tap outside remove that entry again, so history never piles up.
// Plain links (href="#…") and `location.hash = …` still add an entry as usual; it is numbered when it lands.
import { useEffect, useRef } from "react";

type St = { itaDepth?: number; itaLayer?: boolean; itaChat?: boolean; itaFrom?: string; iaPage?: number };
const st = (): St => (history.state && typeof history.state === "object" ? history.state : {}) as St;
/** How many app entries sit above the one the app opened on. */
export const depth = () => st().itaDepth ?? 0;
/** True when the current entry belongs to an open popup. */
export const onLayer = () => !!st().itaLayer;
/** The page a link came from, when the current entry was made by a link (e.g. "#buyers"). */
export const cameFrom = () => st().itaFrom ?? null;

type Layer = { d: number; close: () => void; popped: boolean };
const layers: Layer[] = [];
let pending = 0;                  // history.back() calls we made after a popup closed itself
let waiting: (() => void)[] = []; // run once the next Back lands

function onPop() {
  if (pending > 0) pending--;
  else {
    const nd = depth();
    // Close every popup above the entry we're now on, top one first.
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (l.d > nd) { layers.splice(i, 1); l.popped = true; l.close(); }
    }
    // A leftover popup entry whose popup is already gone (e.g. a link was followed from inside it): step over it.
    if (onLayer() && !layers.some((l) => l.d === nd)) { history.back(); return; }
  }
  const w = waiting; waiting = [];
  w.forEach((f) => f());
}

/** Step back out of any open popups, then run `fn` (e.g. change page). Runs `fn` at once if none are open. */
export function leaveLayers(fn: () => void) {
  if (!onLayer()) { fn(); return; }
  const target = layers.length ? Math.min(...layers.map((l) => l.d)) - 1 : depth() - 1;
  layers.forEach((l) => { l.popped = true; });
  waiting.push(fn);
  history.go(Math.min(-1, target - depth()));
}

/** Run `fn` once the next Back (or history.go) lands. */
export function afterBack(fn: () => void) { waiting.push(fn); }

/** Add one history entry for a sub-view that changes the address (e.g. an open chat). */
export function pushEntry(url: string, extra: St = {}) {
  history.pushState({ ...extra, itaDepth: depth() + 1 }, "", url);
}
/** Change the address without adding an entry, keeping this entry's number and marks. */
export function replaceEntry(url: string) {
  history.replaceState(history.state, "", url);
}

/** While `open` is true, the phone's Back closes this popup (calls `close`) instead of leaving the page. */
export function useBackLayer(open: boolean, close: () => void) {
  const ref = useRef(close); ref.current = close;
  useEffect(() => {
    if (!open) return;
    const l: Layer = { d: 0, close: () => ref.current(), popped: false };
    let pushed = false, gone = false;
    const push = () => {
      if (gone) return;
      l.d = depth() + 1;
      history.pushState({ itaDepth: l.d, itaLayer: true, ...(st().iaPage ? { iaPage: st().iaPage } : {}) }, "");
      layers.push(l); pushed = true;
    };
    if (pending > 0) waiting.push(push); else push(); // a Back we started is still on its way: wait for it
    return () => {
      gone = true;
      const i = layers.indexOf(l); if (i >= 0) layers.splice(i, 1);
      // Closed with ✕ / Esc / outside tap: take its entry away again (only if it's still the top one).
      if (pushed && !l.popped && depth() === l.d && onLayer()) { pending++; history.back(); }
    };
  }, [open]);
}

let last = 0;
export function startBackStack() {
  if (st().itaDepth == null) history.replaceState({ ...st(), itaDepth: 0 }, "");
  last = depth();
  window.addEventListener("popstate", () => {
    // Chrome also fires popstate (with no state) when a plain link changes the hash: that's not a Back.
    // The hashchange listener below numbers that new entry.
    if (history.state == null) return;
    last = depth(); onPop();
  });
  // A link or `location.hash = …` made a new entry with no state: number it, and note where it came from.
  window.addEventListener("hashchange", (e) => {
    if (history.state == null) {
      let from = "";
      try { from = new URL(e.oldURL).hash; } catch { /* ignore */ }
      history.replaceState({ itaDepth: last + 1, itaFrom: from || "#dashboard" }, "");
    }
    last = depth();
  });
  // A link tapped inside an open popup: close the popup's entry first, then follow the link, so Back
  // from the new page doesn't land on a dead popup entry.
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || !onLayer() || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.("a[href^='#']") as HTMLAnchorElement | null;
    const href = a?.getAttribute("href");
    if (!a || !href || href === "#" || a.target) return;
    e.preventDefault();
    leaveLayers(() => { if (location.hash !== href) location.hash = href; });
  });
}
