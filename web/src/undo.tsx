// Undo toast (23 Nov 2026), after The Glide Studio's "One swipe. Gone for good. People slip. Design for it."
// Any action that takes a card away (Not interested, Dismiss, Done, Not now …) can call showUndo(): a dark pill
// appears at the bottom for 6 seconds with an Undo button that puts the card back.
import { useEffect, useState } from "react";

type U = { id: number; text: string; undoLabel: string; undo: () => Promise<unknown> | void };
let next = 1;
const subs = new Set<(u: U | null) => void>();
let cur: U | null = null;
let timer: number | undefined;

export function showUndo(text: string, undo: U["undo"], undoLabel = "Undo") {
  cur = { id: next++, text, undoLabel, undo };
  subs.forEach((f) => f(cur));
  window.clearTimeout(timer);
  timer = window.setTimeout(() => { cur = null; subs.forEach((f) => f(null)); }, 6000);
}

export function UndoToast() {
  const [u, setU] = useState<U | null>(cur);
  const [busy, setBusy] = useState(false);
  useEffect(() => { subs.add(setU); return () => { subs.delete(setU); }; }, []);
  if (!u) return null;
  return (
    <div className="undo-toast" role="status" key={u.id}>
      <span>{u.text}</span>
      <button type="button" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await u.undo(); } finally { setBusy(false); cur = null; window.clearTimeout(timer); subs.forEach((f) => f(null)); }
      }}>{u.undoLabel}</button>
    </div>
  );
}
