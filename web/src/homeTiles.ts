// Home tiles (23 Nov 2026): the four summaries under "Do this now" — Ads, Why people didn't buy, Payment checks,
// Staff leak guard — drawn in one of four looks picked from the design canvas (A, B, F, I). Pure, so it's tested.

export type Look = "A" | "B" | "F" | "I";
export const LOOKS: Look[] = ["A", "B", "F", "I"];

export type TileInput = {
  roas: number | null; spend: string; adTodo: number;
  lost: number | null; sold: number | null; topReason: string | null;
  checked: number | null; toCheck: number | null; toCheckRed: number | null;
  leaks: number | null; messages: number | null;
};

export type Tiles = {
  ads: { value: string; sub: string; fill: number; mark: number; todo: number; needs: boolean };
  why: { value: string; sub: string; bought: string; boughtShare: number; needs: boolean };
  pay: { value: string; sub: string; okShare: number; needs: boolean; red: boolean };
  leak: { value: string; sub: string; okShare: number; needs: boolean };
  /** the one button F shows, and which tile "Needs you" opens with */
  next: { key: "pay" | "ads" | "why" | "leak"; href: string } | null;
};

/** Return on ads drawn on a 0–5× scale, so break-even (1×) sits at 20%. */
export const ROAS_MAX = 5;

export function buildTiles(x: TileInput, T: (en: string, sw: string) => string): Tiles {
  const n = (v: number | null) => (v == null ? "–" : v.toLocaleString("en-US"));
  const roasFill = x.roas == null ? 0 : Math.max(0, Math.min(1, x.roas / ROAS_MAX));
  const total = (x.lost ?? 0) + (x.sold ?? 0);
  const checked = x.checked ?? 0, toCheck = x.toCheck ?? 0;
  const ads = {
    value: x.roas == null ? x.spend : `${x.roas.toFixed(1)}×`,
    sub: x.roas == null ? T("spent on ads", "zimetumika kwa matangazo") : T(`return on ${x.spend}`, `mapato kwa ${x.spend}`),
    fill: roasFill, mark: 1 / ROAS_MAX, todo: x.adTodo,
    needs: x.adTodo > 0 || (x.roas != null && x.roas < 1),
  };
  const why = {
    value: n(x.lost),
    sub: x.sold == null ? T("didn't buy · 30 days", "hawakununua · siku 30") : T(`${n(x.sold)} bought · 30 days`, `${n(x.sold)} walinunua · siku 30`),
    bought: n(x.sold),
    boughtShare: total > 0 ? (x.sold ?? 0) / total : 0,
    needs: (x.lost ?? 0) > 0,
  };
  const pay = {
    value: x.checked == null ? "–" : `${n(checked - toCheck)} / ${n(checked)}`,
    sub: toCheck > 0 ? T(`${n(toCheck)} to look at`, `${n(toCheck)} za kuangalia`) : checked > 0 ? T("all look real", "zote zinaonekana halali") : T("no screenshots yet", "bado hakuna picha"),
    okShare: checked > 0 ? (checked - toCheck) / checked : 1,
    needs: toCheck > 0, red: (x.toCheckRed ?? 0) > 0,
  };
  const leak = {
    value: n(x.leaks),
    sub: (x.leaks ?? 0) > 0 ? T("to look at · 30 days", "za kuangalia · siku 30")
      : x.messages ? T(`of ${n(x.messages)} messages`, `kati ya jumbe ${n(x.messages)}`) : T("no leaks found", "hakuna uvujaji"),
    okShare: (x.leaks ?? 0) > 0 ? 0.85 : 1,
    needs: (x.leaks ?? 0) > 0,
  };
  const next = pay.red ? { key: "pay" as const, href: "#payments" }
    : ads.needs ? { key: "ads" as const, href: "#ads" }
    : pay.needs ? { key: "pay" as const, href: "#payments" }
    : leak.needs ? { key: "leak" as const, href: "#leaks" }
    : why.needs ? { key: "why" as const, href: "#why" } : null;
  return { ads, why, pay, leak, next };
}

/** A random look other than the current one (the first visit picks any). */
export function pickLook(cur: Look | null, rnd: () => number = Math.random): Look {
  const pool = cur ? LOOKS.filter((l) => l !== cur) : LOOKS;
  return pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))]!;
}
