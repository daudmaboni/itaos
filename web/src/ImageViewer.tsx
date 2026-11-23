import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBackLayer } from "./backStack";

/**
 * Full-screen photo viewer: the one place in itaOS you can zoom (the rest of the app is locked, see noZoom.ts).
 * Pinch or double-tap to zoom, drag to move around, tap outside / ✕ / Esc to close. Mouse wheel zooms on a computer.
 * Used for customer photos and payment screenshots in chats, and product photos.
 */
export function ImageViewer({ src, alt, onClose, sw }: { src: string; alt: string; onClose: () => void; sw?: boolean }) {
  const [t, setT] = useState({ s: 1, x: 0, y: 0 });
  const cur = useRef(t); cur.current = t;
  const g = useRef<{ d0: number; s0: number; x0: number; y0: number; px: number; py: number; moved: boolean; lastTap: number }>({ d0: 0, s0: 1, x0: 0, y0: 0, px: 0, py: 0, moved: false, lastTap: 0 });
  const MAX = 5;
  const clamp = (s: number) => Math.min(MAX, Math.max(1, s));
  useBackLayer(true, onClose); // phone Back closes the photo

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";   // page behind doesn't scroll (and pull-to-refresh stays off)
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = prev; };
  }, [onClose]);

  const dist = (a: React.Touch, b: React.Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  const onTouchStart = (e: React.TouchEvent) => {
    const c = cur.current, k = g.current;
    k.moved = false;
    if (e.touches.length === 2) { k.d0 = dist(e.touches[0], e.touches[1]); k.s0 = c.s; }
    else if (e.touches.length === 1) { k.px = e.touches[0].clientX; k.py = e.touches[0].clientY; k.x0 = c.x; k.y0 = c.y; }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const k = g.current;
    if (e.touches.length === 2 && k.d0) {
      k.moved = true;
      const s = clamp(k.s0 * dist(e.touches[0], e.touches[1]) / k.d0);
      setT((p) => (s === 1 ? { s: 1, x: 0, y: 0 } : { ...p, s }));
    } else if (e.touches.length === 1 && cur.current.s > 1) {
      const dx = e.touches[0].clientX - k.px, dy = e.touches[0].clientY - k.py;
      if (Math.abs(dx) + Math.abs(dy) > 4) k.moved = true;
      setT((p) => ({ ...p, x: k.x0 + dx, y: k.y0 + dy }));
    }
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const k = g.current;
    if (e.touches.length === 1) { k.px = e.touches[0].clientX; k.py = e.touches[0].clientY; k.x0 = cur.current.x; k.y0 = cur.current.y; k.d0 = 0; return; }
    if (e.touches.length || k.moved) return;
    const now = Date.now();
    if (now - k.lastTap < 300) { k.lastTap = 0; toggle(); } else k.lastTap = now;
  };
  const toggle = () => setT((p) => (p.s > 1 ? { s: 1, x: 0, y: 0 } : { s: 2.5, x: 0, y: 0 }));
  const onWheel = (e: React.WheelEvent) => {
    const s = clamp(cur.current.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    setT((p) => (s === 1 ? { s: 1, x: 0, y: 0 } : { ...p, s }));
  };

  return createPortal(
    <div className="iv" role="dialog" aria-modal="true" aria-label={alt} data-zoom data-noptr
      onClick={(e) => { if (e.target === e.currentTarget && cur.current.s === 1) onClose(); }}>
      <div className="iv-bar">
        <a className="iv-btn" href={src} target="_blank" rel="noopener noreferrer">{sw ? "Fungua picha asili" : "Open original"}</a>
        <button type="button" className="iv-btn iv-x" aria-label={sw ? "Funga" : "Close"} onClick={onClose}>✕</button>
      </div>
      <div className="iv-stage" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onWheel={onWheel}
        onDoubleClick={toggle} onClick={(e) => { if (e.target === e.currentTarget && cur.current.s === 1) onClose(); }}>
        <img src={src} alt={alt} draggable={false}
          style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})`, cursor: t.s > 1 ? "grab" : "zoom-in" }} />
      </div>
      <p className="iv-hint">{sw ? "Bana kwa vidole viwili au gusa mara mbili kukuza" : "Pinch or double-tap to zoom"}</p>
    </div>,
    document.body,
  );
}
