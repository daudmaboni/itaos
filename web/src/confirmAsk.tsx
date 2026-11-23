// Named-button confirm (23 Nov 2026), after The Glide Studio's "Which of these buttons deletes everything?":
// one clear main action, danger looks different, and the buttons say what they do. Replaces the browser's
// grey confirm() box (OK / Cancel) everywhere in the owner app.
//
//   if (!(await askConfirm({ title: "Delete 42 chats?", yes: "Delete 42 chats", no: "Keep chats", danger: true }))) return;
//
// Esc, a tap outside and the phone's Back all mean "no".
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBackLayer } from "./backStack";

export type Ask = {
  title: string;
  body?: string;
  /** Extra warning line, shown in red under the body. */
  warn?: string;
  yes: string;
  no: string;
  /** The "yes" button is red (deleting, disconnecting, anything that can't be undone). */
  danger?: boolean;
};
type Open = Ask & { id: number; done: (ok: boolean) => void };

let next = 1;
let cur: Open | null = null;
const subs = new Set<(o: Open | null) => void>();
const emit = () => subs.forEach((f) => f(cur));

export function askConfirm(a: Ask): Promise<boolean> {
  if (cur) cur.done(false); // a second ask replaces the first
  return new Promise((resolve) => {
    const me: Open = { ...a, id: next++, done: (ok) => { if (cur === me) { cur = null; emit(); } resolve(ok); } };
    cur = me; emit();
    // No host on screen (shouldn't happen): fall back to the browser box so the action is never blocked.
    if (subs.size === 0) { cur = null; resolve(window.confirm([a.title, a.body, a.warn].filter(Boolean).join("\n\n"))); }
  });
}

export function ConfirmHost() {
  const [o, setO] = useState<Open | null>(cur);
  const [closing, setClosing] = useState(false);
  const yesRef = useRef<HTMLButtonElement>(null);
  const noRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { subs.add(setO); return () => { subs.delete(setO); }; }, []);
  useEffect(() => { setClosing(false); }, [o?.id]);

  const finish = (ok: boolean) => {
    if (!o || closing) return;
    setClosing(true);
    window.setTimeout(() => o.done(ok), 170); // let the box leave the way it came
  };
  useBackLayer(!!o, () => finish(false));

  useEffect(() => {
    if (!o) return;
    // Danger: focus "keep" so a stray Enter never deletes. Safe: focus the main action.
    (o.danger ? noRef : yesRef).current?.focus();
    // Capture phase: Esc closes only this box, not the popup underneath it.
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); finish(false); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });

  if (!o) return null;
  return createPortal(
    <div className={"dr-layer ask-layer" + (closing ? " closing" : "")} data-noswipe role="alertdialog" aria-modal="true" aria-labelledby="ask-h" aria-describedby={o.body ? "ask-b" : undefined}>
      <div className="dr-scrim" onClick={() => finish(false)} aria-hidden />
      <div className="confirm-modal dr-modal">
        <h2 id="ask-h">{o.title}</h2>
        {o.body && <p id="ask-b" style={{ margin: 0 }}>{o.body}</p>}
        {o.warn && <p className="err small" style={{ margin: 0 }}>{o.warn}</p>}
        <div className="row ask-btns">
          <button type="button" ref={noRef} onClick={() => finish(false)}>{o.no}</button>
          <button type="button" ref={yesRef} className={o.danger ? "danger-solid" : "primary"} onClick={() => finish(true)}>{o.yes}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
