import { moneyInput, moneyText } from "./lib";
// itaOS staff admin — Performance, AI usage, Data quality pages and the drawer's performance + staff-task
// sections. Reads the 0031_admin_insights RPCs; rules live in adminInsights.ts (unit-tested).
// Aggregated only: no message bodies, contact names or Kito questions ever reach this page.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  FUNNEL, FEATURE_LABEL, coverage, dataGaps, delta, diagnoseWs, explainToday, nextSupportAction, projectMonth, sumPeriods, usageAlerts, usd,
  type ApiUsage, type FunnelKey, type PerfWs, type Performance,
} from './adminInsights';

const nf = new Intl.NumberFormat('en-US');
const fmt = (v: number | null | undefined) => (v == null ? '–' : nf.format(Math.round(v)));
const TZ = 'Africa/Dar_es_Salaam';
const pct = (v: number | null) => (v == null ? '–' : `${Math.round(v * 100)}%`);
const money = (v: number, cur: string) => `${cur === 'USD' ? '$' : cur + ' '}${nf.format(Math.round(v))}`;
function ago(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return s < 60 ? 'just now' : `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d < 30 ? (d === 1 ? 'yesterday' : `${d} days ago`) : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: TZ });
}
const dayLabel = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const needsUpdate = (e: string) => /function .* does not exist|schema cache|could not find the function/i.test(e);

export function useRpc<T>(supabase: SupabaseClient, fn: string, args: Record<string, unknown> | undefined, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc(fn, args);
    if (error) setError(error.message); else { setError(null); setData(data as T); }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, fn, ...deps]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load };
}

function Delta({ cur, prev, invert }: { cur: number; prev: number; invert?: boolean }) {
  const d = delta(cur, prev);
  if (d == null) return <em className="ix-d new">new</em>;
  if (Math.abs(d) < 0.005) return <em className="ix-d">±0%</em>;
  // Coloured by direction everywhere (26 Nov 2026, Daud): ↑ green, ↓ red — `invert` no longer flips it.
  void invert;
  return <em className={`ix-d ${d > 0 ? 'up' : 'down'}`}>{d > 0 ? '▲' : '▼'} {Math.abs(Math.round(d * 100))}%</em>;
}

function PeriodSeg({ v, set, opts = [7, 30, 90] }: { v: number; set: (n: number) => void; opts?: number[] }) {
  return (
    <div className="ia-seg" role="radiogroup" aria-label="Period">
      {opts.map((d) => <button key={d} role="radio" aria-checked={v === d} className={v === d ? 'on' : ''} onClick={() => set(d)}>{d === 0 ? 'Today' : `Last ${d} days`}</button>)}
    </div>
  );
}

function MiniBars({ v, label }: { v: number[]; label: string }) {
  const max = Math.max(1, ...v);
  return (
    <svg className="ix-bars" viewBox={`0 0 ${v.length * 6} 40`} preserveAspectRatio="none" role="img" aria-label={label}>
      {v.map((x, i) => <rect key={i} x={i * 6} y={40 - (x / max) * 38 - 1} width={4.2} height={(x / max) * 38 + 1} rx={1} className={x ? 'on' : ''} />)}
    </svg>
  );
}

/* ================= Performance ================= */
export function PerformancePage({ supabase, tick, onOpen }: { supabase: SupabaseClient; tick: number; onOpen: (id: string) => void }) {
  const [days, setDays] = useState(30);
  const { data, error, loading } = useRpc<Performance>(supabase, 'admin_performance', { p_days: days }, [days, tick]);
  const list = useMemo(() => (data?.workspaces ?? []).filter((w) => w.status !== 'suspended' || w.cur.chats > 0), [data]);
  const cur = list.map((w) => w.cur), prev = list.map((w) => w.prev);
  const revenueBy = useMemo(() => {
    const m: Record<string, [number, number]> = {};
    for (const w of list) { const r = (m[w.currency] ??= [0, 0]); r[0] += w.cur.revenue; r[1] += w.prev.revenue; }
    return m;
  }, [list]);
  const ranked = useMemo(() => list.map((w) => ({ w, f: diagnoseWs(w), next: nextSupportAction(w) }))
    .sort((a, b) => rank(a.next.tone) - rank(b.next.tone) || (b.f[0]?.score ?? 0) - (a.f[0]?.score ?? 0)), [list]);
  const issueCounts = useMemo(() => {
    const m: Record<string, { title: string; n: number; bad: number }> = {};
    for (const r of ranked) for (const f of r.f) if (f.severity !== 'good') {
      const k = (m[f.kind] ??= { title: KIND[f.kind] ?? f.kind, n: 0, bad: 0 }); k.n++; if (f.severity === 'bad') k.bad++;
    }
    return Object.values(m).sort((a, b) => b.bad - a.bad || b.n - a.n);
  }, [ranked]);

  return (
    <div>
      <header className="ia-pagehead"><h1>Business performance</h1>
        <p>What businesses see in itaOS, added up across all of them and compared with the previous {days} days. Counts only: no message text or customer names.</p></header>
      <div className="ia-tools"><PeriodSeg v={days} set={setDays} /></div>
      {error && <div className="ia-alert">{needsUpdate(error) ? 'This page needs the latest database update (0031_admin_insights).' : error}</div>}
      {loading && !data && <div className="ia-skel" style={{ height: 160 }} />}
      {data && (
        <>
          <section className="ix-funnel" aria-label="Funnel across all businesses">
            {FUNNEL.map((s, i) => {
              const c = sumPeriods(cur, s.key), p = sumPeriods(prev, s.key);
              const base = sumPeriods(cur, 'chats');
              return (
                <div key={s.key} className={`ix-step k-${s.kind}`} title={s.hint}>
                  <span className="ix-kind">{s.kind === 'inferred' ? 'inferred' : s.kind === 'confirmed' ? 'confirmed' : 'observed'}</span>
                  <dt>{s.label}</dt><dd>{fmt(c)}</dd>
                  <span className="ix-sub">{i > 0 && base ? `${pct(c / base)} of chats · ` : ''}<Delta cur={c} prev={p} /></span>
                  <MiniBars v={(data.daily as any)[s.key] ?? []} label={`${s.label} per day`} />
                </div>
              );
            })}
            <div className="ix-step k-confirmed">
              <span className="ix-kind">confirmed</span><dt>Revenue</dt>
              <dd className="ix-rev">{Object.keys(revenueBy).length === 0 ? '0' : Object.entries(revenueBy).map(([c, [v]]) => <span key={c}>{money(v, c)}</span>)}</dd>
              <span className="ix-sub">{Object.entries(revenueBy).map(([c, [v, pv]]) => <Delta key={c} cur={v} prev={pv} />)}</span>
            </div>
          </section>
          <p className="ia-faint small ix-note">Payment signals are inferred from words, screenshots, Kito and ✅ marks; only recorded paid orders count as confirmed. Ad-linked sales elsewhere in itaOS are estimates, not proof an ad caused the purchase.</p>

          {issueCounts.length > 0 && (
            <section className="ia-panel ix-issues">
              <div className="ia-panel-h"><h2>Where chats stall, across businesses</h2></div>
              <ul className="ix-chipsrow">
                {issueCounts.map((x) => <li key={x.title} className={x.bad ? 't-bad' : 't-warn'}>{x.title}<b>{x.n}</b></li>)}
              </ul>
            </section>
          )}

          <div className="ia-tablecard" style={{ marginTop: 18 }}>
            <table className="ia-table ix-perf">
              <thead><tr>
                <th>Business</th><th className="r">Chats</th><th className="r">Replied</th><th className="r">Qualified</th>
                <th className="r">Signals</th><th className="r">Orders</th><th className="r">Revenue</th><th>Data coverage</th><th>Next support action</th>
              </tr></thead>
              <tbody>
                {ranked.length === 0 && <tr><td colSpan={9} className="ia-empty">No businesses yet.</td></tr>}
                {ranked.map(({ w, f, next }) => {
                  const cv = coverage(w), gaps = dataGaps(w);
                  return (
                    <tr key={w.id} data-opens tabIndex={0} onClick={() => onOpen(w.id)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(w.id); }}>
                      <td><strong>{w.name}</strong>
                        {f.filter((x) => x.severity !== 'good' && x.kind !== 'data_gap').slice(0, 2).map((x) => <span key={x.kind} className={`ia-health t-${x.severity === 'info' ? 'idle' : x.severity}`}><i />{x.title}</span>)}
                        {f[0]?.kind === 'healthy' && <span className="ia-health t-ok"><i />No major leak</span>}</td>
                      {(['chats', 'replied', 'qualified', 'signals', 'orders'] as FunnelKey[]).map((k) => (
                        <td key={k} className="r num">{fmt(w.cur[k])}<small><Delta cur={w.cur[k]} prev={w.prev[k]} /></small></td>
                      ))}
                      <td className="r num"><span className="nowrap">{money(w.cur.revenue, w.currency)}</span><small><Delta cur={w.cur.revenue} prev={w.prev.revenue} /></small></td>
                      <td><div className="ix-cov" title="Share of this period's chats that Kito has read / whose source (ad or organic) is known">
                          <span>Kito {pct(cv.kito)}</span><span>Source {pct(cv.source)}</span></div>
                        {gaps.length > 0 && <small className="ia-faint" title={gaps.join('; ')}>{gaps.length === 1 ? gaps[0] : `${gaps.length} gaps: ${gaps[0]}…`}</small>}</td>
                      <td><span className={`ix-next t-${next.tone}`}>{next.text}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
const rank = (t: string) => ({ bad: 0, warn: 1, info: 2, good: 3 } as Record<string, number>)[t] ?? 4;
const KIND: Record<string, string> = {
  unanswered: 'Unanswered chats', slow_reply: 'Slow first replies', price: 'Silence after price', no_follow_up: 'No follow-up on warm chats',
  payment_friction: 'Payment friction', unconfirmed: 'Unconfirmed payments', fulfilment: 'Refunds / returns', data_gap: 'Missing data',
};

/** Compact performance block for the business drawer. */
export function DrawerPerformance({ supabase, id }: { supabase: SupabaseClient; id: string }) {
  const { data, error } = useRpc<Performance>(supabase, 'admin_performance', { p_days: 30 }, [id]);
  const w = data?.workspaces.find((x) => x.id === id);
  if (error) return needsUpdate(error) ? null : <p className="ia-bad small">{error}</p>;
  if (!w) return <div className="ia-skel" style={{ height: 80 }} />;
  const f = diagnoseWs(w), next = nextSupportAction(w);
  return (
    <section className="ia-dsec">
      <h3>Performance, last 30 days</h3>
      <div className="ix-dfunnel">
        {FUNNEL.map((s) => <div key={s.key}><dd>{fmt(w.cur[s.key])}</dd><dt>{s.label}</dt><Delta cur={w.cur[s.key]} prev={w.prev[s.key]} /></div>)}
        <div><dd>{money(w.cur.revenue, w.currency)}</dd><dt>Revenue</dt><Delta cur={w.cur.revenue} prev={w.prev.revenue} /></div>
      </div>
      <p className={`ix-next t-${next.tone}`} style={{ marginTop: 10 }}><b>Next:</b> {next.text}</p>
      <ul className="ix-findings">
        {f.filter((x) => x.kind !== 'healthy').map((x) => <li key={x.kind} className={`t-${x.severity}`}><strong>{x.title}</strong><span>{x.detail}</span></li>)}
      </ul>
    </section>
  );
}

/* Per-business monthly AI limit: alert only, or pause Kito for that business until next month. */
type LimitRow = { workspace_id: string; name: string; ai_monthly_usd: number | null; ai_limit_action: 'alert' | 'pause'; month_cost: number };
function BusinessLimits({ supabase, tick }: { supabase: SupabaseClient; tick: number }) {
  const [t, setT] = useState(0);
  const { data: rows, error } = useRpc<LimitRow[]>(supabase, 'admin_ai_limits', {}, [tick, t]);
  const [edit, setEdit] = useState<{ id: string; usd: string; action: 'alert' | 'pause' } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!edit) return;
    const usd = edit.usd.trim() === '' ? null : Number(edit.usd.replace(/,/g, ''));
    if (usd !== null && !(usd >= 0)) { setMsg({ ok: false, text: 'Type a number of dollars, or leave it empty for no limit.' }); return; }
    setBusy(true); setMsg(null);
    const { error: e } = await supabase.rpc('admin_set_ai_limit', { p_ws: edit.id, p_usd: usd, p_action: edit.action });
    setBusy(false);
    if (e) setMsg({ ok: false, text: e.message }); else { setMsg({ ok: true, text: 'Limit saved' }); setEdit(null); setT((x) => x + 1); }
  }
  const tone = (r: LimitRow) => r.ai_monthly_usd == null ? '' : r.month_cost >= r.ai_monthly_usd ? ' t-bad' : r.month_cost >= r.ai_monthly_usd * 0.8 ? ' t-warn' : '';
  const over = (rows ?? []).filter((r) => r.ai_monthly_usd != null && r.month_cost >= r.ai_monthly_usd * 0.8);
  return (
    <section className="ia-panel">
      <div className="ia-panel-h"><h2>Monthly AI limit per business</h2></div>
      <p className="ia-faint small">This month's estimated cost per business. "Alert" only warns here at 80% and when passed. "Pause" also stops Kito (labelling, Ask Kito, drafts) for that business until next month or until you raise the limit. Empty = no limit.</p>
      {over.map((r) => (
        <p key={r.workspace_id} className={r.month_cost >= (r.ai_monthly_usd ?? 0) ? 'ia-bad small' : 'ia-warn small'}>
          {r.name}: {usd(r.month_cost)} of {usd(r.ai_monthly_usd ?? 0)} this month{r.month_cost >= (r.ai_monthly_usd ?? 0) ? (r.ai_limit_action === 'pause' ? ' · Kito is paused for them' : ' · over the limit (alert only)') : ' · 80% used'}</p>
      ))}
      {error && <p className="ia-bad small">{error}</p>}
      <table className="ix-tbl">
        <thead><tr><th>Business</th><th className="r">This month</th><th className="r">Limit</th><th>When passed</th><th /></tr></thead>
        <tbody>
          {(rows ?? []).map((r) => edit?.id === r.workspace_id ? (
            <tr key={r.workspace_id}><td><strong>{r.name}</strong></td><td className="r num">{usd(r.month_cost)}</td>
              <td className="r"><input inputMode="decimal" style={{ width: 90 }} value={edit.usd} placeholder="none" onChange={(e) => setEdit({ ...edit, usd: e.target.value })} /></td>
              <td><select value={edit.action} onChange={(e) => setEdit({ ...edit, action: e.target.value as 'alert' | 'pause' })}><option value="alert">Alert only</option><option value="pause">Pause Kito</option></select></td>
              <td className="r"><button className="ia-btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button> <button className="ia-textbtn" onClick={() => setEdit(null)}>Cancel</button></td></tr>
          ) : (
            <tr key={r.workspace_id} className={tone(r)}><td><strong>{r.name}</strong></td><td className="r num">{usd(r.month_cost)}</td>
              <td className="r num">{r.ai_monthly_usd == null ? '–' : usd(r.ai_monthly_usd)}</td><td>{r.ai_monthly_usd == null ? '' : r.ai_limit_action === 'pause' ? 'Pause Kito' : 'Alert only'}</td>
              <td className="r"><button className="ia-textbtn" onClick={() => setEdit({ id: r.workspace_id, usd: r.ai_monthly_usd == null ? '' : String(r.ai_monthly_usd), action: r.ai_limit_action })}>Edit</button></td></tr>
          ))}
        </tbody>
      </table>
      {msg && <p className={msg.ok ? 'ia-faint small' : 'ia-bad small'}>{msg.text}</p>}
    </section>
  );
}

/* ================= AI usage & cost ================= */
type PriceForm = { model: string; input: string; output: string; cache_read: string; cache_write: string; long_over: string; long_multiplier: string };
export function UsagePage({ supabase, tick }: { supabase: SupabaseClient; tick: number }) {
  const [days, setDays] = useState(30);
  const [t, setT] = useState(0);
  const { data: u, error, loading } = useRpc<ApiUsage>(supabase, 'admin_api_usage', { p_days: days }, [days, tick, t]);
  const [view, setView] = useState<'workspace' | 'feature' | 'model'>('workspace');
  const [budget, setBudget] = useState({ monthly: '', daily: '', spike: '3' });
  const [price, setPrice] = useState<PriceForm | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (u?.budget) setBudget({ monthly: moneyText(u.budget.monthly_usd), daily: moneyText(u.budget.daily_usd), spike: (u.budget.spike_multiplier ?? 3).toString() }); }, [u?.budget]);

  const alerts = u ? usageAlerts(u) : [];
  const why = u && days === 0 ? explainToday(u) : null;
  async function rpc(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) setMsg({ ok: false, text: error.message }); else { setMsg({ ok: true, text: ok }); setT((x) => x + 1); setPrice(null); }
  }
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/,/g, '')));

  return (
    <div>
      <header className="ia-pagehead"><h1>AI usage and cost</h1>
        <p>Every call itaOS makes to the Anthropic API, by business, feature and model. Costs are <b>estimates</b> from recorded token counts and the prices below; Anthropic's invoice is the real figure. The API key is never shown here.</p></header>
      <div className="ia-tools"><PeriodSeg v={days} set={setDays} opts={[0, 7, 30, 90]} /></div>
      {error && <div className="ia-alert">{needsUpdate(error) ? 'This page needs the latest database update (0031_admin_insights).' : error}</div>}
      {loading && !u && <div className="ia-skel" style={{ height: 160 }} />}
      {u && (
        <>
          {alerts.length > 0 && <ul className="ix-alerts">{alerts.map((a, i) => <li key={i} className={`t-${a.tone}`}>{a.text}</li>)}</ul>}
          <dl className="ia-strip ix-strip5">
            <div className="ia-stat"><dt>Estimated cost, {days === 0 ? 'today' : `${days} days`}</dt><dd>{usd(u.totals.cost)}</dd><span>{fmt(u.totals.calls)} calls · {fmt(u.totals.errors)} failed · {fmt(u.totals.retries)} retries</span></div>
            <div className="ia-stat"><dt>Today</dt><dd>{usd(u.today.cost)}</dd><span>{fmt(u.today.calls)} calls · normal day ≈ {usd(u.baseline.avg_cost)}{days !== 0 && u.today.cost > 0 && <> · <button className="ia-textbtn" onClick={() => setDays(0)}>Why?</button></>}</span></div>
            <div className={`ia-stat${u.budget?.monthly_usd && projectMonth(u.month.cost, u.month.day_of_month, u.month.days_in_month) > u.budget.monthly_usd ? ' t-warn' : ''}`}>
              <dt>This month</dt><dd>{usd(u.month.cost)}</dd>
              <span>≈ {usd(projectMonth(u.month.cost, u.month.day_of_month, u.month.days_in_month))} by month end{u.budget?.monthly_usd ? ` · budget ${usd(u.budget.monthly_usd)}` : ''}</span></div>
            <div className="ia-stat"><dt>Tokens in</dt><dd>{short(u.totals.input_tokens + u.totals.cache_read_tokens + u.totals.cache_write_tokens)}</dd>
              <span>{short(u.totals.cache_read_tokens)} from cache · {short(u.totals.cache_write_tokens)} written to cache</span></div>
            <div className="ia-stat"><dt>Tokens out</dt><dd>{short(u.totals.output_tokens)}</dd><span>output is the expensive part</span></div>
          </dl>

          {why && (
            <section className="ia-panel ix-why">
              <div className="ia-panel-h"><h2>Why today costs what it does</h2></div>
              <p className="ix-why-head">{why.headline}</p>
              <p className="ix-why-verdict">{why.verdict}</p>
              {why.lines.length > 0 && (
                <ul className="ix-why-list">
                  {why.lines.map((l) => (
                    <li key={l.feature} className={`t-${l.tone}`}>
                      <div className="ix-why-row"><strong>{l.title}</strong><b className="num">{usd(l.cost)}</b></div>
                      <p>{l.why}</p>
                      {l.advice && <p className="ix-why-advice">{l.advice}</p>}
                    </li>
                  ))}
                </ul>
              )}
              {why.caveat && <p className="ia-faint small">{why.caveat}</p>}
            </section>
          )}

          <section className="ia-panel" style={why ? { marginTop: 18 } : undefined}>
            <div className="ia-panel-h"><h2>{days === 0 ? 'Estimated cost per hour, today' : 'Estimated cost per day'}</h2><span className="ia-faint small">East Africa time</span></div>
            {days === 0 && u.today_hourly
              ? <CostChart series={{ labels: u.today_hourly.cost.map((_, h) => `${String(h).padStart(2, '0')}:00`), cost: u.today_hourly.cost, calls: u.today_hourly.calls, errors: u.today_hourly.errors }} unit="hour" />
              : <CostChart series={{ labels: u.daily.days.map(dayLabel), cost: u.daily.cost, calls: u.daily.calls, errors: u.daily.errors }} unit="day" />}
            {u.first_logged_at == null
              ? <p className="ia-faint small">Per-call logging starts with the next Kito run. Until then only Ask Kito history is shown (copied from its question log).</p>
              : <p className="ia-faint small">Per-call logging since {ago(u.first_logged_at)}. Earlier days show Ask Kito history only; Kito labels and screenshot reading weren't counted before then.</p>}
          </section>

          <section className="ia-panel" style={{ marginTop: 18 }}>
            <div className="ia-panel-h"><h2>Breakdown</h2>
              <div className="ia-seg">{(['workspace', 'feature', 'model'] as const).map((k) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>By {k === 'workspace' ? 'business' : k}</button>)}</div></div>
            <table className="ix-tbl">
              <thead><tr><th>{view === 'workspace' ? 'Business' : view === 'feature' ? 'Feature' : 'Model'}</th><th className="r">Calls</th><th className="r">Failed</th><th className="r">Tokens in</th><th className="r">Tokens out</th><th className="r">Est. cost</th><th className="r">Share</th></tr></thead>
              <tbody>
                {(view === 'workspace' ? u.by_workspace.map((r) => ({ ...r, k: r.workspace_id ?? 'none', name: r.name ?? 'Not linked to a business', sub: Object.entries(r.by_feature).sort((a, b) => b[1] - a[1]).map(([f, c]) => `${FEATURE_LABEL[f] ?? f} ${usd(c)}`).join(' · ') }))
                  : view === 'feature' ? u.by_feature.map((r) => ({ ...r, k: r.feature, name: FEATURE_LABEL[r.feature] ?? r.feature, sub: r.retries ? `${r.retries} retries` : '' }))
                  : u.by_model.map((r) => ({ ...r, k: r.model, name: r.model, sub: r.priced ? `${short(r.cache_read_tokens)} cache reads` : 'no price set: counted as $0', input_tokens: r.input_tokens + r.cache_read_tokens + r.cache_write_tokens })))
                  .map((r) => (
                    <tr key={r.k}><td><strong>{r.name}</strong>{r.sub && <small className="ia-faint">{r.sub}</small>}</td>
                      <td className="r num">{fmt(r.calls)}</td><td className={`r num${r.errors ? ' ia-bad' : ''}`}>{fmt(r.errors)}</td>
                      <td className="r num">{short(r.input_tokens)}</td><td className="r num">{short(r.output_tokens)}</td>
                      <td className="r num"><b>{usd(r.cost)}</b></td><td className="r num">{u.totals.cost ? pct(r.cost / u.totals.cost) : '–'}</td></tr>
                  ))}
                {u.totals.calls === 0 && <tr><td colSpan={7} className="ia-empty">No API calls in this period.</td></tr>}
              </tbody>
            </table>
          </section>

          {u.recent_errors.length > 0 && (
            <section className="ia-panel" style={{ marginTop: 18 }}>
              <div className="ia-panel-h"><h2>Recent failed calls</h2></div>
              <ol className="ia-timeline compact">
                {u.recent_errors.map((e, i) => <li key={i}><time>{ago(e.at)}</time><div><strong>{FEATURE_LABEL[e.feature] ?? e.feature}{e.workspace_name ? ` · ${e.workspace_name}` : ''}</strong>
                  <span>{e.status ?? 'network'}: {e.error ?? 'failed'}{e.attempt > 1 ? ` (retry ${e.attempt})` : ''} · {e.model}</span></div></li>)}
              </ol>
            </section>
          )}

          <BusinessLimits supabase={supabase} tick={tick + t} />

          <div className="ix-two">
            <section className="ia-panel">
              <div className="ia-panel-h"><h2>Budget and alerts</h2></div>
              <form className="ia-form" onSubmit={(e) => { e.preventDefault(); void rpc('admin_set_api_budget', { p_monthly_usd: num(budget.monthly), p_daily_usd: num(budget.daily), p_spike_multiplier: num(budget.spike) ?? 3 }, 'Budget saved'); }}>
                <label className="ia-field"><span>Monthly budget (USD)</span><input inputMode="decimal" value={budget.monthly} onChange={moneyInput((v) => setBudget({ ...budget, monthly: v }))} placeholder="none" /></label>
                <label className="ia-field"><span>Alert when a day passes (USD)</span><input inputMode="decimal" value={budget.daily} onChange={moneyInput((v) => setBudget({ ...budget, daily: v }))} placeholder="none" /></label>
                <label className="ia-field"><span>Flag a spike at × a normal day</span><input inputMode="decimal" value={budget.spike} onChange={(e) => setBudget({ ...budget, spike: e.target.value })} /></label>
                <div className="ia-actions wide"><button className="ia-btn primary" disabled={busy}>Save budget</button></div>
              </form>
              <p className="ia-faint small">Alerts show at the top of this page and on Today. Leave a box empty for no limit.</p>
            </section>
            <section className="ia-panel">
              <div className="ia-panel-h"><h2>Model prices (USD per million tokens)</h2>
                <button className="ia-textbtn" onClick={() => setPrice({ model: '', input: '', output: '', cache_read: '0', cache_write: '0', long_over: '', long_multiplier: '1' })}>Add model</button></div>
              <table className="ix-tbl">
                <thead><tr><th>Model</th><th className="r">In</th><th className="r">Out</th><th className="r">Cache read</th><th className="r">Cache write</th><th /></tr></thead>
                <tbody>
                  {u.pricing.map((p) => (
                    <tr key={p.model}><td><strong>{p.model}</strong><small className="ia-faint">{p.long_over_tokens ? `×${p.long_multiplier} over ${short(p.long_over_tokens)} tokens · ` : ''}updated {ago(p.updated_at)}{p.updated_by_email ? ` by ${p.updated_by_email}` : ''}</small></td>
                      <td className="r num">{p.input_per_mtok}</td><td className="r num">{p.output_per_mtok}</td><td className="r num">{p.cache_read_per_mtok}</td><td className="r num">{p.cache_write_per_mtok}</td>
                      <td className="r"><button className="ia-textbtn" onClick={() => setPrice({ model: p.model, input: String(p.input_per_mtok), output: String(p.output_per_mtok), cache_read: String(p.cache_read_per_mtok), cache_write: String(p.cache_write_per_mtok), long_over: p.long_over_tokens?.toString() ?? '', long_multiplier: String(p.long_multiplier) })}>Edit</button></td></tr>
                  ))}
                </tbody>
              </table>
              {price && (
                <form className="ia-form ix-priceform" onSubmit={(e) => { e.preventDefault(); void rpc('admin_set_api_price', { p_model: price.model, p_input: num(price.input), p_output: num(price.output), p_cache_read: num(price.cache_read) ?? 0, p_cache_write: num(price.cache_write) ?? 0, p_long_over: price.long_over ? Number(price.long_over) : null, p_long_multiplier: num(price.long_multiplier) ?? 1 }, `Price for ${price.model} saved`); }}>
                  <label className="ia-field wide"><span>Model id (exactly as the API uses it)</span><input value={price.model} onChange={(e) => setPrice({ ...price, model: e.target.value })} placeholder="claude-sonnet-5-5" /></label>
                  {([['input', 'Input'], ['output', 'Output'], ['cache_read', 'Cache read'], ['cache_write', 'Cache write'], ['long_over', 'Long prompt over (tokens)'], ['long_multiplier', 'Long prompt ×']] as const).map(([k, l]) => (
                    <label key={k} className="ia-field"><span>{l}</span><input inputMode="decimal" value={price[k]} onChange={(e) => setPrice({ ...price, [k]: e.target.value })} /></label>
                  ))}
                  <div className="ia-actions wide"><button className="ia-btn primary" disabled={busy || !price.model.trim() || price.input === '' || price.output === ''}>Save price</button><button type="button" className="ia-btn" onClick={() => setPrice(null)}>Cancel</button></div>
                </form>
              )}
              <p className="ia-faint small">Prices change: check Anthropic's pricing page and update here. Changes apply to past calls too, and are written to the audit log.</p>
            </section>
          </div>
          {msg && <p className={msg.ok ? 'ia-ok' : 'ia-bad'} role="status">{msg.text}</p>}
        </>
      )}
    </div>
  );
}
const short = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k` : fmt(v));

type Series = { labels: string[]; cost: number[]; calls: number[]; errors: number[] };
function CostChart({ series: d, unit }: { series: Series; unit: 'day' | 'hour' }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = d.labels.length, W = 1000, H = 220, P = { l: 52, r: 8, t: 10, b: 26 };
  const max = Math.max(0.01, ...d.cost), bw = (W - P.l - P.r) / Math.max(1, n);
  const y = (v: number) => H - P.b - (v / max) * (H - P.t - P.b);
  const ticks = [0, max / 2, max];
  return (
    <div className="ia-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Estimated cost per ${unit}`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t, i) => <g key={i}><line className="grid" x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} /><text className="ax" x={P.l - 6} y={y(t) + 4} textAnchor="end">{usd(t)}</text></g>)}
        {d.cost.map((c, i) => (
          <g key={i} onMouseEnter={() => setHover(i)}>
            <rect x={P.l + i * bw} y={P.t} width={bw} height={H - P.t - P.b} fill="transparent" />
            <rect className={`ia-bar${hover === i ? ' hi' : ''}`} x={P.l + i * bw + bw * 0.15} y={y(c)} width={bw * 0.7} height={Math.max(c ? 1.5 : 0, H - P.b - y(c))} rx={2} />
            {d.errors[i]! > 0 && <circle cx={P.l + i * bw + bw / 2} cy={H - P.b + 8} r={2.5} fill="var(--bad)" />}
          </g>
        ))}
        {d.labels.map((lb, i) => (i % Math.ceil(n / 8) === 0 ? <text key={i} className="ax" x={P.l + i * bw + bw / 2} y={H - 4} textAnchor="middle">{lb}</text> : null))}
      </svg>
      <div className="ia-tip">{hover != null ? `${d.labels[hover]}: ${usd(d.cost[hover]!)} · ${fmt(d.calls[hover]!)} calls${d.errors[hover] ? ` · ${d.errors[hover]} failed` : ''}` : `Hover ${unit === 'day' ? 'a day' : 'an hour'} for details. Red dots mark ${unit}s with failed calls.`}</div>
    </div>
  );
}

/* ================= Data quality ================= */
type DQ = {
  imports: { at: string; workspace_id: string; workspace_name: string; kind: string; created: number; skipped: number; rejected: number;
             total: number | null; duplicates: number | null; matched: number | null; unmatched: number | null; by: string | null }[];
  workspaces: { id: string; name: string; imported_chats: number; imported_chats_also_live: number; chats_without_messages: number;
                unknown_source_30d: number; chats_30d: number; paid_unlinked: number; paid_no_cost: number; paid_total: number;
                unconfirmed_signals: number; kito_errors: number; media_errors_30d: number; missing: string[] }[];
};
export function QualityPage({ supabase, tick, onOpen }: { supabase: SupabaseClient; tick: number; onOpen: (id: string) => void }) {
  const [days, setDays] = useState(30);
  const { data, error, loading } = useRpc<DQ>(supabase, 'admin_data_quality', { p_days: days }, [days, tick]);
  const issues = (w: DQ['workspaces'][number]) => {
    const out: { tone: 'bad' | 'warn' | 'info'; text: string }[] = [];
    if (w.unconfirmed_signals) out.push({ tone: w.unconfirmed_signals >= 5 ? 'warn' : 'info', text: `${fmt(w.unconfirmed_signals)} payments detected, not recorded as orders` });
    if (w.paid_no_cost) out.push({ tone: 'info', text: `${fmt(w.paid_no_cost)} of ${fmt(w.paid_total)} paid orders have no cost (no profit figure)` });
    if (w.paid_unlinked) out.push({ tone: 'info', text: `${fmt(w.paid_unlinked)} paid orders not linked to a chat (can't be tied to an ad)` });
    if (w.chats_30d >= 5 && w.unknown_source_30d / w.chats_30d >= 0.5) out.push({ tone: 'warn', text: `${pct(w.unknown_source_30d / w.chats_30d)} of recent chats have no known source` });
    if (w.imported_chats_also_live) out.push({ tone: 'warn', text: `${fmt(w.imported_chats_also_live)} imported chats duplicate a live chat with the same customer` });
    if (w.chats_without_messages) out.push({ tone: 'info', text: `${fmt(w.chats_without_messages)} ${w.chats_without_messages === 1 ? 'chat' : 'chats'} with no messages` });
    if (w.kito_errors) out.push({ tone: 'warn', text: `${fmt(w.kito_errors)} ${w.kito_errors === 1 ? 'chat' : 'chats'} Kito couldn't read` });
    if (w.media_errors_30d) out.push({ tone: 'warn', text: `${fmt(w.media_errors_30d)} customer photos couldn't be saved or read (30 days)` });
    return out;
  };
  return (
    <div>
      <header className="ia-pagehead"><h1>Imports and data quality</h1><p>Recent file imports across every business, and the data problems that make their numbers incomplete.</p></header>
      {error && <div className="ia-alert">{needsUpdate(error) ? 'This page needs the latest database update (0031_admin_insights).' : error}</div>}
      {loading && !data && <div className="ia-skel" style={{ height: 160 }} />}
      {data && (
        <>
          <section className="ia-panel">
            <div className="ia-panel-h"><h2>By business</h2></div>
            <ul className="ix-dq">
              {data.workspaces.map((w) => {
                const list = issues(w);
                return (
                  <li key={w.id}>
                    <button className="ia-textbtn" onClick={() => onOpen(w.id)}><strong>{w.name}</strong></button>
                    {w.missing.length > 0 && <span className="ix-miss">Missing settings: {w.missing.join(', ')}</span>}
                    {list.length === 0 && w.missing.length === 0 ? <span className="ia-health t-ok"><i />No data problems found</span>
                      : list.map((x, i) => <span key={i} className={`ia-health t-${x.tone === 'info' ? 'idle' : x.tone}`}><i />{x.text}</span>)}
                    {w.imported_chats > 0 && <small className="ia-faint">{fmt(w.imported_chats)} chats from uploaded WhatsApp files</small>}
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="ia-panel" style={{ marginTop: 18 }}>
            <div className="ia-panel-h"><h2>CSV imports</h2><PeriodSeg v={days} set={setDays} opts={[30, 90, 365]} /></div>
            {data.imports.length === 0 ? <p className="ia-empty">No CSV imports (orders, expenses, past inquiries) in this period.</p> : (
              <table className="ix-tbl">
                <thead><tr><th>When</th><th>Business</th><th>Kind</th><th className="r">Rows</th><th className="r">Added</th><th className="r">Duplicates</th><th className="r">Rejected</th><th className="r">Unmatched</th><th>By</th></tr></thead>
                <tbody>
                  {data.imports.map((b, i) => (
                    <tr key={i} data-opens onClick={() => onOpen(b.workspace_id)} style={{ cursor: 'pointer' }}>
                      <td className="nowrap">{ago(b.at)}</td><td>{b.workspace_name}</td><td>{b.kind}</td>
                      <td className="r num">{fmt(b.total)}</td><td className="r num">{fmt(b.created)}</td>
                      <td className={`r num${b.duplicates ? ' ia-warn' : ''}`}>{fmt(b.duplicates)}</td>
                      <td className={`r num${b.rejected ? ' ia-bad' : ''}`}>{fmt(b.rejected)}</td>
                      <td className="r num" title="Rows that couldn't be matched to a chat in itaOS">{fmt(b.unmatched)}</td>
                      <td className="ia-trunc">{b.by ?? '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="ia-faint small">Rejected and duplicate rows are never written. Row contents (names, phones) aren't kept, only these counts.</p>
          </section>
        </>
      )}
    </div>
  );
}

/* ================= Staff follow-up tasks (drawer) ================= */
type Task = { id: string; title: string; due_on: string | null; done_at: string | null; created_at: string; created_by_email: string | null; done_by_email: string | null };
export function DrawerTasks({ supabase, id, suggestion, onChanged }: { supabase: SupabaseClient; id: string; suggestion?: string | null; onChanged: () => void }) {
  const [t, setT] = useState(0);
  const { data, error } = useRpc<Task[]>(supabase, 'admin_tasks_list', { p_ws: id, p_include_done: true }, [id, t]);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run(fn: string, args: Record<string, unknown>) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) setErr(error.message); else { setT((x) => x + 1); onChanged(); }
  }
  if (error && needsUpdate(error)) return null;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const open = (data ?? []).filter((x) => !x.done_at), done = (data ?? []).filter((x) => x.done_at).slice(0, 5);
  return (
    <section className="ia-dsec">
      <h3>Staff follow-ups</h3>
      {open.length === 0 && <p className="ia-faint small">No open follow-ups. Only Pondi staff see these.</p>}
      <ul className="ix-tasks">
        {open.map((x) => (
          <li key={x.id}><input type="checkbox" aria-label={`Mark done: ${x.title}`} disabled={busy} onChange={() => run('admin_set_task_done', { p_task: x.id, p_done: true })} />
            <div><span>{x.title}</span><small className={x.due_on && x.due_on < today ? 'ia-bad' : 'ia-faint'}>{x.due_on ? `due ${dayLabel(x.due_on)}${x.due_on < today ? ' (overdue)' : ''} · ` : ''}{x.created_by_email ?? ''} {ago(x.created_at)}</small></div></li>
        ))}
        {done.map((x) => (
          <li key={x.id} className="done"><input type="checkbox" checked aria-label={`Reopen: ${x.title}`} disabled={busy} onChange={() => run('admin_set_task_done', { p_task: x.id, p_done: false })} />
            <div><span>{x.title}</span><small className="ia-faint">done {ago(x.done_at)}{x.done_by_email ? ` by ${x.done_by_email}` : ''}</small></div></li>
        ))}
      </ul>
      <form className="ix-taskform" onSubmit={(e) => { e.preventDefault(); if (title.trim()) { void run('admin_add_task', { p_ws: id, p_title: title, p_due: due || null }); setTitle(''); setDue(''); } }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={suggestion ? `e.g. ${suggestion}` : 'e.g. Call owner to connect Meta Ads'} aria-label="New follow-up" />
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
        <button className="ia-btn" disabled={busy || !title.trim()}>Add</button>
        {suggestion && !title && <button type="button" className="ia-textbtn" onClick={() => setTitle(suggestion)}>Use suggestion</button>}
      </form>
      {err && <p className="ia-bad small">{err}</p>}
    </section>
  );
}

export const INSIGHTS_CSS = `
.ix-funnel{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden}
.ix-step{padding:16px 16px 10px;border-left:1px solid var(--line);position:relative;display:flex;flex-direction:column}.ix-step:first-child{border-left:0}
.ix-step dt{font-size:12.5px;color:var(--muted);font-weight:500}.ix-step dd{margin:2px 0;font:700 26px/1.15 var(--display);font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.ix-step dd.ix-rev{font-size:19px;display:grid}
.ix-kind{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);font-weight:600;margin-bottom:2px}
.ix-step.k-inferred .ix-kind{color:var(--warn)}.ix-step.k-confirmed .ix-kind{color:var(--ok)}
.ix-sub{font-size:12px;color:var(--faint);display:flex;gap:6px;flex-wrap:wrap}
.ix-bars{width:100%;height:30px;margin-top:8px}.ix-bars rect{fill:#DCE0EA}.ix-bars rect.on{fill:var(--navy)}
.ix-d{font-style:normal;font-size:11.5px;font-weight:600;color:var(--faint)}.ix-d.up{color:var(--ok)}.ix-d.down{color:var(--bad)}.ix-d.new{color:var(--info)}
.ix-note{margin:8px 2px 18px}
.ix-chipsrow{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:8px}
.ix-chipsrow li{display:flex;gap:8px;align-items:center;border:1px solid var(--line);border-radius:20px;padding:5px 6px 5px 12px;font-size:13px}
.ix-chipsrow li b{background:#EEF0F5;border-radius:12px;padding:0 8px;font-size:12px}.ix-chipsrow li.t-bad b{background:#FBE3E1;color:var(--bad)}.ix-chipsrow li.t-warn b{background:#FCEFD9;color:var(--warn)}
.ix-perf td:first-child{min-width:230px}.ix-perf td small{display:block}
.ix-cov{display:flex;gap:10px;font-size:12.5px;white-space:nowrap}
.ix-next{font-size:13px;line-height:1.4;display:block;max-width:300px}.ix-next.t-bad{color:var(--bad)}.ix-next.t-warn{color:var(--warn)}.ix-next.t-good{color:var(--ok)}
.ix-dfunnel{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 14px}
.ix-dfunnel dd{margin:0;font:700 18px/1.2 var(--display);font-variant-numeric:tabular-nums}.ix-dfunnel dt{font-size:12px;color:var(--muted)}
.ix-findings{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:8px}
.ix-findings li{border-left:3px solid var(--line);padding:2px 0 2px 10px;display:grid}.ix-findings li span{font-size:12.5px;color:var(--muted)}
.ix-findings li.t-bad{border-color:var(--bad)}.ix-findings li.t-warn{border-color:var(--warn)}.ix-findings li.t-info{border-color:var(--info)}
.ix-alerts{list-style:none;margin:0 0 16px;padding:0;display:grid;gap:8px}
.ix-alerts li{border-radius:var(--r);padding:10px 14px;font-weight:500;background:#EAF0F8;color:var(--info)}
.ix-alerts li.t-bad{background:#FBE3E1;color:var(--bad)}.ix-alerts li.t-warn{background:#FCEFD9;color:var(--warn)}
.ix-why{margin-bottom:18px}
.ix-why-head{margin:0 0 4px;font-size:16px;font-weight:600}
.ix-why-verdict{margin:0 0 10px;color:var(--muted)}
.ix-why-list{list-style:none;margin:0;padding:0}
.ix-why-list li{padding:12px 0;border-top:1px solid var(--line)}
.ix-why-list li p{margin:4px 0 0;font-size:13.5px;line-height:1.5;color:var(--muted)}
.ix-why-row{display:flex;justify-content:space-between;gap:12px;align-items:baseline}
.ix-why-list li.t-warn .ix-why-row strong{color:var(--warn)}.ix-why-list li.t-bad .ix-why-row strong{color:var(--bad)}
.ix-why-advice{color:var(--ink)!important;font-weight:500}
.ix-why-advice::before{content:'What to do: ';font-weight:600}
.ix-strip5{grid-template-columns:repeat(5,minmax(0,1fr))}
.ix-tbl{width:100%;border-collapse:collapse;font-size:13.5px}
.ix-tbl th{text-align:left;font-size:12px;font-weight:500;color:var(--muted);padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
.ix-tbl td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}.ix-tbl tr:last-child td{border-bottom:0}
.ix-tbl .r{text-align:right}.ix-tbl small{display:block;font-size:12px}
.ix-two{display:grid;grid-template-columns:1fr 1.3fr;gap:18px;margin-top:18px}
.ix-priceform{margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
.ix-dq{list-style:none;margin:0;padding:0;display:grid}
.ix-dq li{display:grid;gap:3px;padding:12px 0;border-bottom:1px solid var(--line)}.ix-dq li:last-child{border-bottom:0}
.ix-dq .ia-textbtn{justify-self:start;padding:0}
.ix-miss{font-size:12.5px;color:var(--warn)}
.ix-tasks{list-style:none;margin:0 0 10px;padding:0;display:grid;gap:8px}
.ix-tasks li{display:flex;gap:10px;align-items:flex-start}.ix-tasks li div{display:grid}.ix-tasks li small{font-size:12px}
.ix-tasks li.done span{text-decoration:line-through;color:var(--faint)}.ix-tasks input[type=checkbox]{margin-top:4px;accent-color:var(--navy)}
.ix-taskform{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.ix-taskform input{border:1px solid var(--line);border-radius:var(--r-sm);padding:8px 10px;font:inherit;background:#fff}
.ix-taskform input:first-child{flex:1;min-width:200px}
.ia-board .ix-stuck{font-size:11.5px;font-weight:600;color:var(--faint);white-space:nowrap}
.ia-board .ix-stuck.t-warn{color:var(--warn)}.ia-board .ix-stuck.t-bad{color:var(--bad)}
.ix-recovery{margin-top:10px;border-top:1px dashed var(--line);padding-top:10px;font-size:13px}
.ix-recovery p{margin:0 0 4px}.ix-recovery ol{margin:0;padding-left:18px;color:var(--muted)}
@media (max-width:1100px){.ix-funnel{grid-template-columns:repeat(3,minmax(0,1fr))}.ix-step:nth-child(4){border-left:0}.ix-step{border-top:1px solid var(--line)}
  .ix-strip5{grid-template-columns:repeat(2,minmax(0,1fr))}.ix-two{grid-template-columns:1fr}}
@media (max-width:640px){.ix-funnel{grid-template-columns:repeat(2,minmax(0,1fr))}.ix-step{border-left:0!important}}
`;
