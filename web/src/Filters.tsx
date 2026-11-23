// Report filter bar for Dashboard and Diagnosis: source, campaign, ad, product. Remembered per page.
import { useState } from "react";
import type { Filters, FilterOptions } from "./data";
import { activeFilters } from "./data";
import { useBackLayer } from "./backStack";

const KEY = (page: string) => "itaos-filters-" + page;
export function useFilters(page: string): [Filters, (f: Filters) => void] {
  const [f, setF] = useState<Filters>(() => { try { return JSON.parse(localStorage.getItem(KEY(page)) ?? "{}") ?? {}; } catch { return {}; } });
  return [f, (n: Filters) => {
    const clean = Object.fromEntries(Object.entries(n).filter(([, v]) => v)) as Filters;
    setF(clean);
    try { localStorage.setItem(KEY(page), JSON.stringify(clean)); } catch { /* storage off */ }
  }];
}

export function FilterBar({ value, onChange, options, lang }: { value: Filters; onChange: (f: Filters) => void; options: FilterOptions; lang: "sw" | "en" | string }) {
  const T = (en: string, sw: string) => (lang === "sw" ? sw : en);
  const [open, setOpen] = useState(false);
  useBackLayer(open, () => setOpen(false)); // phone Back closes the Filters sheet
  const ads = value.campaign ? options.ads.filter((a) => a.campaign === value.campaign) : options.ads;
  const on = activeFilters(value);
  const adsOk = value.source !== "organic" && value.source !== "unknown";
  const srcName: Record<string, string> = { ad: T("From ads", "Kutoka matangazo"), organic: T("Organic", "Bila tangazo"), unknown: T("Unknown source", "Chanzo hakijulikani") };
  // What's set, as removable chips (shown on phones next to the Filters button).
  const chips: [string, string, Filters][] = [];
  if (value.source) chips.push(["source", srcName[value.source] ?? value.source, { ...value, source: undefined }]);
  if (value.campaign) chips.push(["campaign", value.campaign, { ...value, campaign: undefined, ad: undefined }]);
  if (value.ad) chips.push(["ad", options.ads.find((a) => a.id === value.ad)?.name ?? T("1 ad", "Tangazo 1"), { ...value, ad: undefined }]);
  if (value.product) chips.push(["product", value.product, { ...value, product: undefined }]);

  const field = (label: string, el: JSX.Element) => <label className="fb-field"><span className="fb-label">{label}</span>{el}</label>;
  return (
    <div className={"filterbar" + (open ? " open" : "")} role="group" aria-label={T("Filters", "Vichujio")}>
      <div className="fb-phone">
        <button type="button" className={"fb-toggle" + (chips.length ? " on" : " all")} onClick={() => setOpen(true)} aria-expanded={open}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M4 6h16M7 12h10M10 18h4" /></svg>
          {T("Filters", "Vichujio")}{chips.length > 0 && <span className="fb-count">{chips.length}</span>}
          {chips.length === 0 && <><span className="fb-sum">{T("Showing everything", "Inaonyesha vyote")}</span>
            <svg className="fb-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg></>}
        </button>
        {chips.length > 0 && <div className="fb-chips">
          {chips.map(([k, label, next]) => (
              <button type="button" key={k} className="fb-chip" onClick={() => onChange(next)} aria-label={T(`Remove ${label}`, `Ondoa ${label}`)}>
                <span>{label}</span><span aria-hidden>✕</span>
              </button>
            ))}
        </div>}
      </div>
      {open && <div className="fb-scrim" onClick={() => setOpen(false)} aria-hidden />}
      <div className="fb-fields">
        <div className="fb-sheet-head"><b>{T("Filters", "Vichujio")}</b><button type="button" className="icon" onClick={() => setOpen(false)} aria-label={T("Close", "Funga")}>✕</button></div>
        {field(T("Source", "Chanzo"),
          <select aria-label={T("Source", "Chanzo")} value={value.source ?? ""} onChange={(e) => onChange({ ...value, source: (e.target.value || undefined) as Filters["source"], ...(e.target.value && e.target.value !== "ad" ? { campaign: undefined, ad: undefined } : {}) })}>
            <option value="">{T("All sources", "Vyanzo vyote")}</option>
            <option value="ad">{srcName.ad}</option>
            <option value="organic">{srcName.organic}</option>
            <option value="unknown">{srcName.unknown}</option>
          </select>)}
        {options.campaigns.length > 0 && adsOk && field(T("Campaign", "Kampeni"),
          <select aria-label={T("Campaign", "Kampeni")} value={value.campaign ?? ""} onChange={(e) => onChange({ ...value, campaign: e.target.value || undefined, ad: undefined })}>
            <option value="">{T("All campaigns", "Kampeni zote")}</option>
            {options.campaigns.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>)}
        {ads.length > 0 && adsOk && field(T("Ad", "Tangazo"),
          <select aria-label={T("Ad", "Tangazo")} value={value.ad ?? ""} onChange={(e) => onChange({ ...value, ad: e.target.value || undefined })}>
            <option value="">{T("All ads", "Matangazo yote")}</option>
            {ads.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>)}
        {options.products.length > 0 && field(T("Product", "Bidhaa"),
          <select aria-label={T("Product", "Bidhaa")} value={value.product ?? ""} onChange={(e) => onChange({ ...value, product: e.target.value || undefined })}>
            <option value="">{T("All products", "Bidhaa zote")}</option>
            {options.products.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>)}
        {on && <button type="button" className="small linkish fb-clear" onClick={() => onChange({})}>{T("Clear filters", "Ondoa vichujio")}</button>}
        <button type="button" className="primary fb-done" onClick={() => setOpen(false)}>{T("Show results", "Onyesha matokeo")}</button>
      </div>
      {on && <span className="small muted filternote">{[
        value.product ? T("Product filters orders and revenue only (chats have no product).", "Bidhaa inachuja oda na mapato tu (chats hazina bidhaa).") : "",
        value.source && value.source !== "ad" ? T("No ad spend for non-ad chats.", "Hakuna matumizi ya matangazo kwa chats zisizo za tangazo.") : "",
        value.ad || value.campaign ? T("Ad-linked sales are estimates, not proof the ad caused them.", "Mauzo yaliyounganishwa na tangazo ni makadirio, si uthibitisho.") : "",
      ].filter(Boolean).join(" ")}</span>}
    </div>
  );
}
