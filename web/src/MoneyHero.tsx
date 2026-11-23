// The big money card(s) at the top of Home. Four looks, picked in Settings → Appearance (saved on this device):
//  A  one card: revenue big, the from-ads split, then ad spend · profit · return in a row
//  B  two big cards: navy ad spend, green revenue with the from-ads split   (default)
//  C  two tiles side by side, the split in a small card under them
//  E  one block: green "money in" joined to navy "money out", the return as a badge on the join
import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";

export type HeroStyle = "A" | "B" | "C" | "E";
export const HERO_STYLES: HeroStyle[] = ["B", "A", "C", "E"];
const KEY = "itaos-hero";
const EVT = "itaos-hero";

export function readHeroStyle(): HeroStyle {
  try { const v = localStorage.getItem(KEY); return v === "A" || v === "C" || v === "E" ? v : "B"; } catch { return "B"; }
}
export function saveHeroStyle(s: HeroStyle) {
  try { localStorage.setItem(KEY, s); } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVT));
}
export function useHeroStyle(): HeroStyle {
  const [s, set] = useState(readHeroStyle);
  useEffect(() => { const f = () => set(readHeroStyle()); window.addEventListener(EVT, f); window.addEventListener("storage", f); return () => { window.removeEventListener(EVT, f); window.removeEventListener("storage", f); }; }, []);
  return s;
}
/** Which cards the hero already shows, so the grid under it doesn't repeat them. */
export function heroCovers(s: HeroStyle) {
  // Profit sits in the top right of the revenue card in every look (23 Nov 2026), so never as its own card.
  return { spend: true, revenue: true, roas: s === "A" || s === "E", profit: true };
}

type T = (en: string, sw: string) => string;
export type HeroData = {
  revenue: string; revenueD: number | null; revenueSub: string;
  spend: string; spendD: number | null; spendSub: string;
  /** money from ad customers vs the rest, in the same currency; null when nothing was sold */
  split: { ads: number; other: number; adsText: string; otherText: string } | null;
  roas: string | null; profit: string | null; profitSub?: string; profitNeg?: boolean;
};

function Delta({ d, good }: { d: number | null; good: boolean | null }) {
  if (d == null) return null;
  return <span className={"mh-d " + (good ? "good" : "bad")}>{d > 0 ? "↑" : "↓"} {Math.abs(Math.round(d * 100))}%</span>;
}

function Split({ s, T }: { s: HeroData["split"]; T: T }) {
  if (!s || s.ads + s.other <= 0) return null;
  return (
    <div className="mh-split">
      <div className="mh-bar" aria-hidden><span style={{ flex: Math.max(s.ads, 0) || 0.0001 }} /><span style={{ flex: Math.max(s.other, 0) || 0.0001 }} /></div>
      <div className="mh-legend"><span><b>{s.adsText}</b> {T("from ads", "kutoka matangazo")}</span><span><b>{s.otherText}</b> {T("not from ads", "si matangazo")}</span></div>
    </div>
  );
}

export default function MoneyHero({ style, data: x, T, onRevenue, revenueOpen }: { style: HeroStyle; data: HeroData; T: T; onRevenue?: () => void; revenueOpen?: boolean }) {
  // Spending less is shown as good; earning more is good.
  const spendGood = x.spendD == null ? null : x.spendD < 0;
  const revGood = x.revenueD == null ? null : x.revenueD > 0;
  const click = onRevenue ? { role: "button", tabIndex: 0, "aria-expanded": !!revenueOpen, onClick: onRevenue, onKeyDown: (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRevenue(); } } } : {};
  const rev = (big: boolean) => (
    <div className="mh-revrow">
      <div className="mh-num">
        <span className="mh-k">{style === "E" ? T("Money in · Revenue", "Pesa iliyoingia · Mapato") : T("Revenue", "Mapato")}</span>
        <span className="mh-vrow"><b className={big ? "mh-v" : "mh-v sm"}>{x.revenue}</b><Delta d={x.revenueD} good={revGood} /></span>
        <span className="mh-s">{x.revenueSub}</span>
      </div>
      {style !== "A" && (
        <div className={"mh-profit" + (x.profitNeg ? " neg" : "")} title={T("After ad spend and the cost of what was sold", "Baada ya matangazo na gharama ya bidhaa zilizouzwa")}>
          <span className="mh-k">{x.profitNeg ? T("Loss", "Hasara") : T("Profit", "Faida")}</span>
          <b>{x.profit ?? "–"}</b>
          <span className="mh-s">{x.profitSub ?? T("after ads & costs", "baada ya gharama")}</span>
        </div>
      )}
    </div>
  );
  const spend = (big: boolean) => (
    <div className="mh-num">
      <span className="mh-k">{style === "E" ? T("Money out · Ad spend", "Pesa iliyotoka · Matangazo") : T("Ad spend", "Matumizi ya matangazo")}</span>
      <span className="mh-vrow"><b className={big ? "mh-v" : "mh-v sm"}>{x.spend}</b><Delta d={x.spendD} good={spendGood} /></span>
      <span className="mh-s">{x.spendSub}</span>
    </div>
  );

  if (style === "A") return (
    <div className="mh mh-A">
      <div className="mh-card navy">
        <div className="mh-click" {...click}>{rev(true)}</div>
        <Split s={x.split} T={T} />
        <div className="mh-trio">
          <div><span className="mh-k">{T("Ad spend", "Matangazo")}</span><b>{x.spend}</b><Delta d={x.spendD} good={spendGood} /></div>
          <div><span className="mh-k">{T("Profit (est.)", "Faida (makadirio)")}</span><b className={x.profitNeg ? "neg" : "pos"}>{x.profit ?? "–"}</b><span className="mh-s">{x.profitSub ?? T("after costs", "baada ya gharama")}</span></div>
          <div><span className="mh-k">{T("Return on ads", "Mapato kwa tangazo")}</span><b>{x.roas ?? "–"}</b><span className="mh-s">{T("per 1 spent", "kwa kila 1")}</span></div>
        </div>
      </div>
    </div>
  );

  if (style === "C") return (
    <div className="mh mh-C">
      <div className="mh-tiles">
        <div className="mh-card green mh-click" {...click}>{rev(false)}</div>
        <div className="mh-card navy">{spend(false)}</div>
      </div>
      {x.split && <div className="mh-card plain"><span className="mh-k">{T("Where the money came from", "Pesa imetoka wapi")}</span><Split s={x.split} T={T} /></div>}
    </div>
  );

  if (style === "E") return (
    <div className="mh mh-E">
      <div className="mh-joined">
        <div className="mh-card green mh-click" {...click}>{rev(true)}<Split s={x.split} T={T} /></div>
        {x.roas && <span className="mh-badge">{x.roas} {T("return", "faida ya tangazo")}</span>}
        <div className="mh-card navy">{spend(false)}</div>
      </div>
    </div>
  );

  // B
  return (
    <div className="mh mh-B">
      <div className="mh-card navy">{spend(true)}</div>
      <div className="mh-card green mh-click" {...click}>{rev(true)}<Split s={x.split} T={T} /></div>
    </div>
  );
}

/** The made-up numbers the Settings previews use. */
export const SAMPLE: HeroData = {
  revenue: "TZS 310,000", revenueD: -0.17, revenueSub: "2 paid orders",
  spend: "TZS 12,779", spendD: -0.82, spendSub: "15 chats (Meta)",
  split: { ads: 175000, other: 135000, adsText: "175,000", otherText: "135,000" },
  roas: "13.7×", profit: "TZS 280,521",
};
