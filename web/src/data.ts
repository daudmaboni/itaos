// Loads everything the dashboard and the weekly report need for a period plus its comparison
// period, then runs the central metrics. One place, so both views agree.
import { useEffect, useRef, useState } from "react";
import { supabase, Workspace, Outcome, AdPerf, Order, localDay, callFn } from "./lib";
import { diagnose, Finding } from "./diagnosis";
import { computeFunnel, comparisonOf, FunnelMetrics, DailyInsight, Expense } from "./metrics";
import { RangeSel, resolveRange, daysBetween, addDays } from "./ranges";

// Ad spend is read from a local copy of Meta's daily numbers. When a chosen range (with its
// comparison period) reaches further back than that copy, pull the missing days from Meta once,
// so "Last 90 days" here matches "Last 90 days" in Ads Manager.
const BACKFILL_KEY = (ws: string) => "itaos:ads-backfill:" + ws;
const backfilling = new Set<string>();
async function backfillAds(ws: string, from: string, today: string, earliest: string | null): Promise<boolean> {
  if (earliest && earliest <= from) return false;
  let asked: string | null = null;
  try { asked = localStorage.getItem(BACKFILL_KEY(ws)); } catch { /* storage off */ }
  if (asked && asked <= from) return false; // already fetched this far back; Meta had nothing older
  if (backfilling.has(ws)) return false;
  backfilling.add(ws);
  try {
    const r = await callFn<{ synced: { rows?: number; error?: string }[] }>("ads-sync", { workspace_id: ws, days: Math.min(daysBetween(from, today) + 2, 400) });
    if (r.synced.some((x) => x.error)) return false;
    try { localStorage.setItem(BACKFILL_KEY(ws), from); } catch { /* storage off */ }
    return true;
  } catch { return false; }
  finally { backfilling.delete(ws); }
}

/** First day with data: the first WhatsApp chat or the first day of ad data, whichever is earlier. Kept for 10 minutes. */
const startCache = new Map<string, { at: number; day: string | null }>();
async function dataStartOf(ws: string, tz: string): Promise<string | null> {
  const hit = startCache.get(ws);
  if (hit && Date.now() - hit.at < 600_000) return hit.day;
  const [c, a] = await Promise.all([
    supabase.from("conversations").select("started_at").eq("workspace_id", ws).not("started_at", "is", null).order("started_at", { ascending: true }).limit(1),
    supabase.from("ad_insights_daily").select("day").eq("workspace_id", ws).order("day", { ascending: true }).limit(1),
  ]);
  const chat = ((c.data as any[]) ?? [])[0]?.started_at as string | undefined;
  const ad = ((a.data as any[]) ?? [])[0]?.day as string | undefined;
  const days = [chat ? localDay(chat, tz) : null, ad ?? null].filter(Boolean) as string[];
  const day = days.length ? days.sort()[0] : null;
  startCache.set(ws, { at: Date.now(), day });
  return day;
}

export type Conn = { id: string; provider: string; external_id: string; label: string | null; status: string; last_sync_at: string | null; last_error: string | null };
export type Num = { phone_number_id: string; display_phone: string | null; history_status: string | null; history_requested_at: string | null };
export type Health = { status: string; events: number; oldest: string | null; newest: string | null; exhausted: number };

/** Report filters (Dashboard and Diagnosis). Applied to chats, orders, ads and spend before the
 *  metrics run, so every number on the page agrees with the filter. Product filters orders only:
 *  chats don't carry a product. */
export type Filters = { source?: "ad" | "organic" | "unknown"; campaign?: string; ad?: string; product?: string };
export type FilterOptions = { campaigns: string[]; ads: { id: string; name: string; campaign: string | null }[]; products: string[] };
export const activeFilters = (f?: Filters) => !!f && !!(f.source || f.campaign || f.ad || f.product);

/** Pure: narrow the loaded rows to the filter (exported for tests). */
export function applyFilters<T extends { conversations: Outcome[]; orders: Order[]; daily: (DailyInsight & { ad_id?: string })[]; ads: AdPerf[]; adsPrev: AdPerf[] }>(
  d: T, f: Filters | undefined, campaignOf: Record<string, string | null>): T {
  if (!activeFilters(f)) return d;
  const wantAd = (id: string | null | undefined) => {
    if (f!.ad) return id === f!.ad;
    if (f!.campaign) return !!id && campaignOf[id] === f!.campaign;
    return true;
  };
  const byAd = !!(f!.ad || f!.campaign);
  const nonAdSource = f!.source && f!.source !== "ad";
  const prod = f!.product?.trim().toLowerCase();
  return {
    ...d,
    conversations: d.conversations.filter((c) => (!f!.source || c.source === f!.source) && (!byAd || wantAd(c.ad_id))),
    orders: d.orders.filter((o) => (!f!.source || o.conv_source === f!.source) && (!byAd || wantAd(o.ad_id)) && (!prod || (o.product ?? "").toLowerCase() === prod)),
    // Spend belongs to ads: none for organic/unknown chats; only the chosen ads' spend otherwise.
    daily: nonAdSource ? [] : byAd ? d.daily.filter((x) => wantAd(x.ad_id)) : d.daily,
    ads: nonAdSource ? [] : d.ads.filter((a) => wantAd(a.ad_id)),
    adsPrev: nonAdSource ? [] : d.adsPrev.filter((a) => wantAd(a.ad_id)),
  };
}

export type GrowthData = {
  loading: boolean; err: string;
  mx: FunnelMetrics | null; prev: FunnelMetrics | null;
  convs: Outcome[]; ads: AdPerf[]; adsPrev: AdPerf[]; orders: Order[]; daily: DailyInsight[]; expenses: Expense[];
  conns: Conn[]; nums: Num[]; health: Health[]; importBatches: { kind: string; created_at: string; created_count: number }[];
  today: string;
  findings: Finding[];                       // top of the weekly diagnosis for this period
  objections: [string, number][];            // objections in unsold chats started this period
  objByAd?: AdObjections[];                  // the same, split by the ad the chat came from
  allTime: { orders: number; revenue: number; chats: number } | null;   // every recorded sale, any date
  dataStart: string | null;                  // first day with a chat or ad data (start of "All time")
  cached: boolean;                           // numbers shown are from the last visit; fresh ones are loading
  options: FilterOptions;                    // choices for the filter bar (from all data, not the filtered view)
};

// Only the columns the metrics, diagnosis and dashboard read. Leaves out Kito's long text
// (summary, next step, evidence, error) and override notes, which made each page several times heavier.
const OUTCOME_COLS = [
  "id", "contact_id", "contact_name", "started_at", "last_message_at", "source", "source_label", "ad_id", "ad_signal",
  "first_response_sec", "price_asked", "price_shared", "replied_after_price", "payment_signal", "payment_amount", "objections",
  "followed_up", "warm", "stage", "auto_outcome", "outcome_override", "label", "kito_outcome", "kito_label", "kito_amount",
  "kito_objections", "kito_tags", "kito_temp", "kito_blocker", "last_dir", "last_in_closing", "kito_confidence", "kito_checked_at", "outcome",
  "sale_amount", "sale_provenance", "override_by", "override_at", "paid_orders", "first_paid_at", "last_paid_at", "last_out_at",
  "pay_instructions",
].join(",");

// One request: the database scans once and returns columns as arrays (migrations 0026, 0028).
// v2 sends only the columns the dashboard reads, times as epoch seconds, and leaves out people
// marked "not a customer". Falls back to v1, then to paging the view.
const EPOCH_COLS = new Set(["started_at", "last_message_at", "kito_checked_at", "first_paid_at", "last_out_at"]);
function zip(cols: Record<string, unknown[]>): Outcome[] {
  const keys = Object.keys(cols).filter((k) => Array.isArray(cols[k]));
  const n = cols.id.length;
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    const r: Record<string, unknown> = {};
    for (const k of keys) {
      const v = cols[k][i];
      r[k] = EPOCH_COLS.has(k) && typeof v === "number" ? new Date(v * 1000).toISOString() : v;
    }
    rows[i] = r;
  }
  return rows as Outcome[];
}
/** Meta's daily ad numbers for a span. The database hands back at most 1,000 rows per request
 *  (one row per ad per day), so a long range is read page by page — otherwise some days come back
 *  missing, the spend chart drops to 0 on random days and the total is too low. */
async function loadDailyInsights(ws: string, from: string, to: string) {
  const rows: any[] = [];
  for (let at = 0; ; at += 1000) {
    const r = await supabase.from("ad_insights_daily").select("ad_id,day,spend,currency,impressions,clicks,messaging_conversations")
      .eq("workspace_id", ws).gte("day", from).lte("day", to).order("day", { ascending: true }).order("ad_id", { ascending: true }).range(at, at + 999);
    if (r.error) return { data: rows.length ? rows : null, error: r.error };
    rows.push(...(r.data ?? []));
    if (!r.data || r.data.length < 1000 || at > 200000) return { data: rows, error: null };
  }
}

export async function loadConversations(ws: string, fromIso: string): Promise<Outcome[]> {
  const v2 = await supabase.rpc("dashboard_conversations2", { p_ws: ws, p_from: fromIso });
  if (!v2.error && v2.data && Array.isArray((v2.data as any).id)) return zip(v2.data as Record<string, unknown[]>);
  const { data, error } = await supabase.rpc("dashboard_conversations", { p_ws: ws, p_from: fromIso });
  if (!error && data && Array.isArray((data as any).id)) return zip(data as Record<string, unknown[]>);
  return loadConversationsPaged(ws, fromIso);
}

// Old path: pages fetched 4 at a time.
async function loadConversationsPaged(ws: string, fromIso: string) {
  const PAGE = 1000, WAVE = 4;
  const rows: Outcome[] = [];
  const page = (start: number) => supabase.from("conversation_outcomes").select(OUTCOME_COLS)
    .eq("workspace_id", ws).gte("started_at", fromIso)
    .order("started_at", { ascending: true }).order("id", { ascending: true }).range(start, start + PAGE - 1);
  for (let start = 0; ; start += PAGE * WAVE) {
    const res = await Promise.all(Array.from({ length: WAVE }, (_, i) => page(start + i * PAGE)));
    let done = false;
    for (const r of res) {
      if (r.error) throw r.error;
      const data = ((r.data as unknown) as Outcome[]) ?? [];
      rows.push(...data);
      if (data.length < PAGE) { done = true; break; }
    }
    if (done) break;
  }
  return rows;
}

// The last numbers shown for a workspace + period, kept in the browser so the dashboard opens
// instantly; fresh numbers replace them a moment later. Chats themselves are not kept (too big).
const CACHE_V = 1;
const cacheKey = (ws: string, rk: string) => `itaos:dash:${CACHE_V}:${ws}:${rk}`;
function readCache(key: string): Partial<GrowthData> | null {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function writeCache(key: string, g: GrowthData) {
  const { convs: _c, orders, loading: _l, err: _e, cached: _x, ...rest } = g;
  try { localStorage.setItem(key, JSON.stringify({ ...rest, orders: orders.slice(0, 300) })); }
  catch { try { localStorage.removeItem(key); } catch { /* storage full or blocked */ } }
}

export type AdObjections = { ad_id: string; chats: number; sold: number; unsold: number; counts: Record<string, number> };
/** Per ad: chats started this period, how many bought, and the objections raised in the ones that didn't.
 *  Ads with fewer than `min` chats are left out (too few to say anything). Most chats first. */
export function objectionsByAd(convs: Outcome[], period: { from: string; to: string }, tz: string, min = 8): AdObjections[] {
  const by = new Map<string, AdObjections>();
  for (const c of convs) {
    if (!c.ad_id || !c.started_at) continue;
    const d = localDay(c.started_at, tz);
    if (d < period.from || d > period.to) continue;
    const r = by.get(c.ad_id) ?? { ad_id: c.ad_id, chats: 0, sold: 0, unsold: 0, counts: {} };
    r.chats++;
    if (c.outcome === "sold") r.sold++;
    else {
      r.unsold++;
      const kinds = new Set([...(c.objections ?? []), ...(c.kito_objections ?? []), ...(c.kito_blocker && c.kito_blocker !== "business_slow" ? [c.kito_blocker] : [])]);
      for (const o of kinds) r.counts[o as string] = (r.counts[o as string] ?? 0) + 1;
    }
    by.set(c.ad_id, r);
  }
  return [...by.values()].filter((r) => r.chats >= min).sort((a, b) => b.chats - a.chats);
}

/** Objections raised in chats started this period that didn't end in a sale, most common first. */
export function objectionTally(convs: Outcome[], period: { from: string; to: string }, tz: string): [string, number][] {
  const tally: Record<string, number> = {};
  for (const c of convs) {
    if (!c.started_at || c.outcome === "sold") continue;
    const d = localDay(c.started_at, tz);
    if (d < period.from || d > period.to) continue;
    for (const o of new Set([...(c.objections ?? []), ...(c.kito_objections ?? [])])) tally[o as string] = (tally[o as string] ?? 0) + 1;
  }
  return Object.entries(tally).sort((a, b) => b[1] - a[1]);
}

const EMPTY = (tz: string): GrowthData => ({ loading: true, err: "", mx: null, prev: null, convs: [], ads: [], adsPrev: [], orders: [], daily: [], expenses: [], conns: [], nums: [], health: [], importBatches: [], today: localDay(new Date(), tz), findings: [], objections: [], allTime: null, dataStart: null, cached: false, options: { campaigns: [], ads: [], products: [] } });

export function useGrowthData(ws: Workspace, range: RangeSel, opts: { cache?: boolean; filters?: Filters } = {}): GrowthData {
  const fkey = activeFilters(opts.filters) ? JSON.stringify(opts.filters) : "";
  const [state, setState] = useState<GrowthData>(() => {
    const hit = opts.cache ? readCache(cacheKey(ws.id, JSON.stringify(range) + fkey)) : null;
    return hit?.mx ? { ...EMPTY(ws.timezone), ...hit, loading: false, cached: true } : EMPTY(ws.timezone);
  });
  // Background refresh: re-read every 2 min and whenever the tab comes back into view.
  // Refreshes are silent (no skeletons); only a new workspace or period shows the loading state.
  const [tick, setTick] = useState(0);
  const loadedKey = useRef("");
  useEffect(() => {
    const bump = () => { if (document.visibilityState === "visible") setTick((t) => t + 1); };
    const id = window.setInterval(bump, 120_000);
    document.addEventListener("visibilitychange", bump);
    window.addEventListener("focus", bump);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", bump); window.removeEventListener("focus", bump); };
  }, []);
  // Live: a new chat message, a Kito label or a recorded sale refreshes the numbers right away.
  useEffect(() => {
    let t: number | undefined;
    // Throttled, not debounced: at most one refresh per 5 s, however many chats change.
    // A tab in the background doesn't reload; it catches up when it comes back into view.
    const soon = () => { if (t !== undefined || document.visibilityState !== "visible") return; t = window.setTimeout(() => { t = undefined; setTick((x) => x + 1); }, 5000); };
    const ch = supabase.channel("growth-" + ws.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `workspace_id=eq.${ws.id}` }, soon)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `workspace_id=eq.${ws.id}` }, soon)
      .subscribe();
    return () => { window.clearTimeout(t); supabase.removeChannel(ch); };
  }, [ws.id]);
  // A refresh that arrives while a load is running no longer cancels it (that kept the cards on
  // skeletons while chats were changing every few seconds). It waits and runs once afterwards.
  const reqKey = useRef("");
  const busy = useRef(false);
  const again = useRef(false);
  useEffect(() => () => { reqKey.current = ""; }, []);
  useEffect(() => {
    const rk = JSON.stringify(range) + fkey;
    const key = ws.id + "|" + rk + "|" + ws.timezone;
    const keyChanged = reqKey.current !== key;
    reqKey.current = key;
    if (!keyChanged && busy.current) { again.current = true; return; }
    const live = () => reqKey.current === key;
    const silent = loadedKey.current === key;
    busy.current = true;
    again.current = false;
    const tz = ws.timezone || "Africa/Dar_es_Salaam";
    const today = localDay(new Date(), tz);
    const ck = cacheKey(ws.id, rk);
    if (!silent) {
      // Show the last numbers for this period straight away (if we have them) while fresh ones load.
      const hit = opts.cache ? readCache(ck) : null;
      if (hit?.mx) setState({ ...EMPTY(tz), ...hit, loading: false, err: "", cached: true });
      else setState((s) => ({ ...s, loading: true, err: "", cached: false }));
    }
    (async () => {
      try {
        const dataStart = await dataStartOf(ws.id, tz);
        if (!live()) return;
        const period = resolveRange(range, today, dataStart);
        const prevP = comparisonOf(period);
        const fromIso = new Date(new Date(prevP.from + "T00:00:00Z").getTime() - 2 * 864e5).toISOString(); // generous: filtered precisely by local day later
        const [a, ap, c, d, o, e, cn, nm, h, ib, all, first, adList, adSt] = await Promise.all([
          supabase.rpc("ad_performance", { p_ws: ws.id, p_from: period.from, p_to: period.to }),
          supabase.rpc("ad_performance", { p_ws: ws.id, p_from: prevP.from, p_to: prevP.to }),
          loadConversations(ws.id, fromIso),
          loadDailyInsights(ws.id, prevP.from, period.to),
          supabase.from("orders").select("*, conv:conversations!orders_conversation_workspace_fk(source)").eq("workspace_id", ws.id).gte("occurred_at", fromIso).order("occurred_at", { ascending: false }).limit(5000),
          supabase.from("expenses").select("day,amount,currency,category").eq("workspace_id", ws.id).gte("day", prevP.from).lte("day", period.to).limit(5000),
          supabase.from("connections").select("id,provider,external_id,label,status,last_sync_at,last_error").eq("workspace_id", ws.id),
          supabase.from("wa_numbers").select("phone_number_id,display_phone,history_status,history_requested_at").eq("workspace_id", ws.id),
          supabase.rpc("webhook_health", { p_ws: ws.id }),
          supabase.from("import_batches").select("kind,created_at,created_count").eq("workspace_id", ws.id).order("created_at", { ascending: false }).limit(5),
          // Every recorded sale, any date, so the Revenue card can be checked against the Bought tab.
          supabase.from("orders").select("conversation_id,amount,discount,refund_amount").eq("workspace_id", ws.id).eq("status", "paid").limit(10000),
          supabase.from("ad_insights_daily").select("day").eq("workspace_id", ws.id).order("day", { ascending: true }).limit(1),
          supabase.from("ads").select("ad_id,name,campaign_name").eq("workspace_id", ws.id).limit(5000),
          // Separate so an older database without the status column still loads everything else.
          supabase.from("ads").select("ad_id,effective_status").eq("workspace_id", ws.id).limit(5000),
        ]);
        if (!live()) return;
        // If the chat-source join is ever refused, fall back to plain orders so revenue still shows.
        let o2: any = o;
        if (o.error) o2 = await supabase.from("orders").select("*").eq("workspace_id", ws.id).gte("occurred_at", fromIso).order("occurred_at", { ascending: false }).limit(5000);
        if (!live()) return;
        loadedKey.current = key;
        const firstErr = [a, ap, d, o2, e, cn, nm, h, ib].find((r) => r.error)?.error;
        const daily0 = ((d.data as any[]) ?? []).map((r) => ({ ad_id: r.ad_id as string, day: r.day, spend: Number(r.spend), currency: r.currency, impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0), messaging_conversations: Number(r.messaging_conversations ?? 0) }));
        const orders0 = (((o2.data as any[]) ?? []).map(({ conv, ...r }) => ({ ...r, conv_source: conv?.source ?? null }))) as Order[];
        // Filter choices come from everything loaded; the numbers below use the filtered rows.
        const adMeta = ((adList.data as any[]) ?? []);
        const campaignOf: Record<string, string | null> = {};
        for (const x of adMeta) campaignOf[x.ad_id] = x.campaign_name ?? null;
        for (const x of [...((a.data as AdPerf[]) ?? []), ...((ap.data as AdPerf[]) ?? [])]) if (!(x.ad_id in campaignOf)) campaignOf[x.ad_id] = x.campaign_name ?? null;
        const usedAds = new Set<string>([...daily0.map((x) => x.ad_id), ...c.map((x) => x.ad_id).filter(Boolean) as string[]]);
        const options: FilterOptions = {
          campaigns: [...new Set(Object.entries(campaignOf).filter(([id, n]) => n && usedAds.has(id)).map(([, n]) => n as string))].sort(),
          ads: [...usedAds].map((id) => ({ id, name: adMeta.find((x) => x.ad_id === id)?.name ?? ((a.data as AdPerf[]) ?? []).find((x) => x.ad_id === id)?.ad_name ?? id, campaign: campaignOf[id] ?? null }))
            .sort((x, y) => x.name.localeCompare(y.name)),
          products: [...new Set(orders0.map((x) => (x.product ?? "").trim()).filter(Boolean))].sort(),
        };
        const fd = applyFilters({ conversations: c, orders: orders0, daily: daily0, ads: (a.data as AdPerf[]) ?? [], adsPrev: (ap.data as AdPerf[]) ?? [] }, opts.filters, campaignOf);
        const statusOf: Record<string, string | null> = {};
        if (!adSt.error) for (const x of (adSt.data as any[]) ?? []) statusOf[x.ad_id] = x.effective_status ?? null;
        fd.ads = fd.ads.map((x) => ({ ...x, status: statusOf[x.ad_id] ?? null }));
        const daily = fd.daily, orders = fd.orders;
        const expenses = ((e.data as any[]) ?? []).map((x) => ({ day: x.day, amount: Number(x.amount), currency: x.currency, category: x.category }));
        const base = { ws, conversations: fd.conversations, daily, orders, expenses };
        const mx = computeFunnel({ ...base, period, ads: fd.ads });
        const prev = computeFunnel({ ...base, period: prevP, ads: fd.adsPrev });
        const allRows = ((all.data as any[]) ?? []);
        const allTime = all.error ? null : {
          orders: allRows.length,
          revenue: allRows.reduce((s, x) => s + Number(x.amount) - Number(x.discount ?? 0) - Number(x.refund_amount ?? 0), 0),
          chats: new Set(allRows.map((x) => x.conversation_id).filter(Boolean)).size,
        };
        const next: GrowthData = {
          loading: false, err: firstErr ? "Some data could not be loaded: " + firstErr.message : "",
          mx, prev, convs: fd.conversations, ads: fd.ads, adsPrev: fd.adsPrev, orders, daily, expenses,
          conns: (cn.data as Conn[]) ?? [], nums: (nm.data as Num[]) ?? [], health: (h.data as Health[]) ?? [], importBatches: (ib.data as any[]) ?? [], today,
          findings: diagnose(mx, fd.conversations, orders, tz).slice(0, 4), objections: objectionTally(fd.conversations, period, tz), objByAd: objectionsByAd(fd.conversations, period, tz), allTime, dataStart, cached: false, options,
        };
        setState(next);
        if (opts.cache) writeCache(ck, next);
        // Range reaches past the synced ad data: fetch the older days from Meta, then reload.
        const hasAds = ((cn.data as Conn[]) ?? []).some((x) => x.provider === "meta_ads" && x.status !== "disconnected");
        if (hasAds && !first.error) {
          const earliest = ((first.data as any[]) ?? [])[0]?.day ?? null;
          // "All time" asks Meta for as far back as the sync allows; other ranges only what they show.
          backfillAds(ws.id, range.key === "all" ? addDays(today, -398) : prevP.from, today, earliest).then((got) => { if (got && live()) setTick((x) => x + 1); });
        }
      } catch (err) {
        if (live() && !silent) setState((s) => ({ ...s, loading: false, cached: false, err: (err as Error).message }));
      } finally {
        if (live()) {
          busy.current = false;
          if (again.current) { again.current = false; setTick((x) => x + 1); }
        }
      }
    })();
  }, [ws.id, ws.timezone, ws.fx_rate, ws.unit_cost, ws.display_currency, ws.conversion_window_days, ws.follow_up_hours, JSON.stringify(range), fkey, tick]);
  return state;
}
