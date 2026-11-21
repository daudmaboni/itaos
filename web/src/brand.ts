// A business's own receipt look (migration 0059): main colour, second colour, logo, town, payment method.
// Nothing here is Kayani's: a business that hasn't chosen colours gets itaOS's plain default.
export type Brand = { color?: string | null; accent?: string | null; logo?: string | null; town?: string | null; pay_method?: string | null };

export const DEFAULT_MAIN = "#1f2a44";   // itaOS navy
export const DEFAULT_ACCENT = "#f2b705"; // itaOS yellow

const valid = (v?: string | null) => (v && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c: number[]) => "#" + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("");
/** Mix colour a toward b by t (0..1). */
export const mix = (a: string, b: string, t: number) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i]! - v) * t)); };
const lum = (h: string) => { const [r, g, b] = rgb(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!; };

/** The receipt colours for one business. Keys keep the names the receipt designs were drawn with. */
export function palette(b: Brand | null | undefined) {
  let main = valid(b?.color) ?? DEFAULT_MAIN;
  // White text sits on the main colour: darken a very light choice until it reads.
  for (let i = 0; i < 8 && lum(main) > 0.35; i++) main = mix(main, "#000000", 0.15);
  let text = main;
  for (let i = 0; i < 8 && lum(text) > 0.12; i++) text = mix(text, "#000000", 0.12);
  return {
    green: main,                         // main fills (total bar, badge, mark)
    greenText: text,                     // main colour as text on light paper
    forest: mix(main, "#000000", 0.6),   // deep shade
    honey: valid(b?.accent) ?? DEFAULT_ACCENT,
    mint: mix(main, "#ffffff", 0.85),    // light tint
  };
}

/** Read a picked image, shrink it to at most 256 px and return a small data URL (PNG keeps transparency). */
export function readLogo(file: File, max = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 8_000_000) { reject(new Error("type")); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let out = c.toDataURL("image/png");
      if (out.length > 150_000) out = c.toDataURL("image/jpeg", 0.85);
      out.length <= 190_000 ? resolve(out) : reject(new Error("size"));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("read")); };
    img.src = url;
  });
}
