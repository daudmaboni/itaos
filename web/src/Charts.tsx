import { useId } from "react";
import { fmt } from "./lib";

export const COLORS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)"];

/** Area chart of a daily series, with the previous period as a dashed line on the same scale. */
export function TrendChart({ days, cur, prev, weekly = false, partialLast = false }: { days: string[]; cur: number[]; prev: number[]; weekly?: boolean; partialLast?: boolean }) {
  const W = 720, H = 220, L = 46, R = 10, T = 12, B = 26;
  const max = Math.max(0.01, ...cur, ...prev);
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const x = (i: number) => L + (days.length <= 1 ? 0 : (i * (W - L - R)) / (days.length - 1));
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const line = (a: number[]) => a.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const every = Math.max(1, Math.ceil(days.length / 7));
  const last = cur.length - 1;
  // Line coloured by height (23 Nov 2026, the soft-cards look): yellow at the top of the chart, green at the bottom.
  const id = useId().replace(/:/g, "");
  return (
    <svg className="chart chart-soft" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${weekly ? "Weekly" : "Daily"} ad spend, this period against the previous one`}>
      <defs>
        <linearGradient id={"gl" + id} gradientUnits="userSpaceOnUse" x1="0" y1={T} x2="0" y2={H - B}>
          <stop offset="0" stopColor="#F7C23C" /><stop offset="0.55" stopColor="#9ED049" /><stop offset="1" stopColor="#1DB97A" />
        </linearGradient>
        <filter id={"gs" + id} x="-5%" y="-20%" width="110%" height="140%"><feDropShadow dx="0" dy="6" stdDeviation="5" floodColor="#1DB97A" floodOpacity="0.22" /></filter>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" opacity="0.6" />
          <text x={L - 10} y={y(t) + 4} textAnchor="end">{short(t)}</text>
        </g>
      ))}
      {days.map((d, i) => (i % every === 0 ? <text key={d} x={x(i)} y={H - 6} textAnchor="middle">{label(d)}</text> : null))}
      {/* Drawn in order (Glide: "Draw the old line first. Then the one that matters. Then mark one point."):
          the dashed last period, then this period, then the latest point with its figure. */}
      {prev.some((v) => v > 0) && <path className="ch-old" d={line(prev)} fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="4 5" opacity="0.6" />}
      {cur.length > 0 && <>
        <path className="ch-new" d={line(partialLast && last > 0 ? cur.slice(0, last) : cur)} fill="none" stroke={`url(#gl${id})`} strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" filter={`url(#gs${id})`} />
        {/* Today is still filling up: dotted last step and a hollow dot, so a low "so far" figure doesn't look like a crash. */}
        {partialLast && last > 0 && <path className="ch-new" d={`M${x(last - 1).toFixed(1)},${y(cur[last - 1]).toFixed(1)} L${x(last).toFixed(1)},${y(cur[last]).toFixed(1)}`} fill="none" stroke={`url(#gl${id})`} strokeWidth="2.5" strokeDasharray="2 5" strokeLinecap="round" opacity="0.9" />}
        <text className="ch-mark" x={Math.min(x(last), W - R - 4)} y={Math.max(y(cur[last]) - 14, T + 10)} textAnchor="end" style={{ fontWeight: 700, fill: "var(--ink)", opacity: 1 }}>{short(Math.round(cur[last]))}</text>
        <circle className="ch-mark" cx={x(last)} cy={y(cur[last])} r="5" fill={partialLast ? "var(--card)" : `url(#gl${id})`} stroke={partialLast ? "#1DB97A" : "var(--card)"} strokeWidth="2.5"><title>{partialLast ? "Today, so far" : ""}</title></circle>
      </>}
    </svg>
  );
}
function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 0.01))));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
function short(v: number) { return v > 0 && v < 10 ? String(+v.toFixed(1)) : v >= 1e6 ? (v / 1e6).toFixed(v % 1e6 ? 1 : 0) + "M" : v >= 1e3 ? Math.round(v / 1e3) + "k" : String(v); }
function label(d: string) { return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }

/** One stacked bar plus legend: how the spend splits across ads. */
export function SpendSplit({ items, total, f = fmt }: { items: { name: string; value: number }[]; total: number; f?: (n: number) => string }) {
  const top = items.slice(0, 5);
  const rest = items.slice(5).reduce((s, i) => s + i.value, 0);
  const rows = rest > 0 ? [...top, { name: `Other (${items.length - 5})`, value: rest }] : top;
  return (
    <>
      <div className="split" aria-hidden="true">{rows.map((r, i) => <i key={r.name} style={{ width: `${total ? (r.value / total) * 100 : 0}%`, background: COLORS[i % 6] }} />)}</div>
      <div className="legend">{rows.map((r, i) => (
        <div className="li" key={r.name}>
          <span className="sw" style={{ background: COLORS[i % 6] }} /><span className="nm" title={r.name}>{r.name}</span>
          <span className="num muted">{f(r.value)}</span><b className="num">{total ? Math.round((r.value / total) * 100) : 0}%</b>
        </div>
      ))}</div>
    </>
  );
}

/** Horizontal bars, cheapest first. Shorter is cheaper. */
export function CostBars({ items, bestLabel, f = fmt }: { items: { name: string; cost: number; note: string }[]; bestLabel: string; f?: (n: number) => string }) {
  const max = Math.max(1e-9, ...items.map((i) => i.cost));
  return (
    <div style={{ display: "grid", gap: 12 }}>{items.map((r, i) => (
      <div className="costrow" key={r.name}>
        <span className="nm" title={r.name}>{r.name}{i === 0 && items.length > 1 && <> <span className="chip ok">{bestLabel}</span></>}<div className="small muted">{r.note}</div></span>
        <div className="bar"><i style={{ width: `${(r.cost / max) * 100}%`, background: i === 0 ? "var(--good)" : "var(--c2)" }} /></div>
        <span className="val">{f(r.cost)}</span>
      </div>
    ))}</div>
  );
}
