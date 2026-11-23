// The "…" button on a card (23 Nov 2026): a small menu of things that actually work for that card.
import { useEffect, useRef, useState } from "react";
import { useBackLayer } from "./backStack";

export type MenuItem = { label: string; href?: string; onClick?: () => void | Promise<void>; done?: string };

export function CardMenu({ items, label, light }: { items: MenuItem[]; label: string; light?: boolean }) {
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useBackLayer(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className={"cm" + (light ? " cm-light" : "")} ref={box} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="cm-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="19" cy="12" r="1.9" /></svg>
      </button>
      {open && (
        <div className="cm-menu" role="menu">
          {items.map((it) => it.href
            ? <a key={it.label} role="menuitem" href={it.href} onClick={() => setOpen(false)}>{it.label}</a>
            : <button key={it.label} type="button" role="menuitem" onClick={async () => {
                await it.onClick?.();
                if (it.done) { setFlash(it.label); window.setTimeout(() => { setFlash(null); setOpen(false); }, 900); } else setOpen(false);
              }}>{flash === it.label && it.done ? it.done : it.label}</button>)}
        </div>
      )}
    </div>
  );
}

/** Copy text; falls back to the share sheet on phones that block the clipboard. */
export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return; } catch { /* blocked */ }
  try { await (navigator as Navigator & { share?: (d: { text: string }) => Promise<void> }).share?.({ text }); } catch { /* cancelled */ }
}
/** Ask the open page to reload its numbers (same as a pull-to-refresh, without the pill). */
export function refreshPage() { window.dispatchEvent(new CustomEvent("itaos-refresh", { cancelable: true })); }
