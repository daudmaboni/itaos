// Staff admin pages: Today, Businesses, Errors, Audit and Staff (moved out of Admin.tsx, unchanged).
import { useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { daysOnStep, stepAction, recoveryFor, type OnboardingRow } from './adminInsights';
import { Overview, WsRow, Activity, ErrRow, AuditRow, Staff, Tone, fmt, TZ, ago, stamp, hoursSince, plural, money, short, revenueText, tileColor, initials, healthOf, viaName, STEPS, stuckAt, useRpc, ACTION, describe, ICON } from "./adminParts";

export type Item = { tone: 'bad' | 'warn' | 'info'; ws: string | null; title: string; body: string; at: string | null };

export function buildItems(rows: WsRow[], errors: ErrRow[], onb: Record<string, OnboardingRow> = {}, costAlerts: { tone: string; text: string }[] = []): Item[] {
  const out: Item[] = [];
  for (const a of costAlerts.filter((x) => x.tone !== 'info'))
    out.push({ tone: a.tone === 'bad' ? 'bad' : 'warn', ws: null, title: 'AI cost', body: a.text, at: new Date().toISOString() });
  for (const w of rows) {
    const h = healthOf(w);
    if (h.tone === 'bad' || h.tone === 'warn') out.push({ tone: h.tone, ws: w.id, title: w.name, body: h.text, at: w.last_message_at ?? w.created_at });
    if (w.members === 0) continue; // health already says "No owner"
    if (hoursSince(w.created_at) < 72 && stuckAt(w) === 0)
      out.push({ tone: 'info', ws: w.id, title: `${w.name} just signed up`, body: `${w.owner_email ?? 'Owner'} joined ${ago(w.created_at)} and hasn't connected anything. A quick WhatsApp hello helps.`, at: w.created_at });
    else if (w.status !== 'suspended' && hoursSince(w.owner_last_sign_in) > 24 * 7)
      out.push({ tone: 'warn', ws: w.id, title: `${w.name} has gone quiet`, body: `Owner last signed in ${ago(w.owner_last_sign_in)}.`, at: w.owner_last_sign_in });
    const o = onb[w.id];
    if (o && o.overdue_tasks > 0)
      out.push({ tone: 'warn', ws: w.id, title: `Follow-up overdue for ${w.name}`, body: `${o.next_task ?? 'A staff follow-up'}${o.overdue_tasks > 1 ? ` (+${o.overdue_tasks - 1} more)` : ''}`, at: o.next_due });
    const st = stuckAt(w), days = daysOnStep(o, st);
    if (w.status !== 'suspended' && st < STEPS.length && days != null && days >= 14 && !(hoursSince(w.created_at) < 72))
      out.push({ tone: 'info', ws: w.id, title: `${w.name}: ${days} days on "${STEPS[st]!.label}"`, body: stepAction(st, days)!.text, at: null });
    if (w.wa_status === 'active' && w.wa_via === 'dualhook' && w.send_key === false && w.status !== 'suspended')
      out.push({ tone: 'info', ws: w.id, title: `${w.name} can't reply from itaOS yet`, body: 'No Dualhook API key saved yet (add it in their details → WhatsApp setup), so the Chats inbox is read-only for them.', at: w.wa_last_sync ?? w.created_at });
  }
  for (const e of errors.filter((x) => hoursSince(x.at) < 24 * 7).slice(0, 4)) {
    out.push({ tone: 'bad', ws: e.workspace_id, title: SOURCE[e.source.split(':')[0]!] ?? e.source,
      body: `${e.workspace_name ? e.workspace_name + ': ' : ''}${e.detail.slice(0, 120)}${e.detail.length > 120 ? '…' : ''}`, at: e.at });
  }
  const rank = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone] || +new Date(b.at ?? 0) - +new Date(a.at ?? 0));
}

export const SOURCE: Record<string, string> = {
  'kito-ask': "Kito couldn't answer a question", 'kito-run': 'Kito reading had failures', 'kito-tag': "Kito couldn't read a chat",
  webhook: "WhatsApp events didn't process", stuck: 'WhatsApp events stuck mid-processing', connection: 'A connection broke',
  media: "A customer's photo couldn't be read",
};

export function Today({ ov, rows, act, errors, onOpen, goErrors, onb, costAlerts, goUsage }:
  { ov: Overview | null; rows: WsRow[]; act: Activity | null; errors: ErrRow[]; onOpen: (id: string) => void; goErrors: () => void;
    onb: Record<string, OnboardingRow>; costAlerts: { tone: string; text: string }[]; goUsage: () => void }) {
  const items = useMemo(() => buildItems(rows, errors, onb, costAlerts), [rows, errors, onb, costAlerts]);
  const needs = items.filter((i) => i.tone !== 'info').length;
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });

  return (
    <div className="ia-today">
      <header className="ia-hero">
        <p className="ia-date">{today}</p>
        <h1>
          {rows.length ? plural(rows.length, 'business', 'businesses') : 'No businesses'} on itaOS.{' '}
          <span className={needs ? 'ia-need' : 'ia-calm'}>{needs === 0 ? 'Nothing needs you right now.' : needs === 1 ? 'One thing needs a look.' : `${needs} things need a look.`}</span>
        </h1>
      </header>

      <dl className="ia-strip">
        <Stat label="Live on WhatsApp" value={ov?.wa_live != null ? `${fmt(ov.wa_live)}/${fmt(ov.workspaces)}` : fmt(ov?.workspaces)}
              sub={`${fmt(ov?.workspaces_7d)} new this week · ${ov ? `${fmt(ov.active_users_7d)} owners signed in` : ''}`} />
        <Stat label="WhatsApp messages" value={fmt(ov?.messages_7d)} sub={`last 7 days · ${fmt(ov?.messages_24h)} today`} />
        <Stat label="Sales, 30 days" value={revenueText(ov?.revenue_30d)}
              sub={ov?.orders_30d != null ? `${plural(ov.orders_30d, 'paid order')} · ${fmt(ov.tick_orders_30d)} from ✅` : `${fmt(ov?.orders_paid)} paid orders in total`} />
        <Stat label="Replies from itaOS" value={fmt(ov?.sent_itaos_7d)} sub={`last 7 days · ${plural(ov?.receipts_7d ?? 0, 'payment screenshot')} read`} />
        <Stat label="Kito" value={fmt(ov?.kito_reads_24h ?? ov?.kito_asks_7d)}
              sub={ov?.kito_reads_24h != null ? `chats read today · ${fmt(ov.kito_read_fails_24h)} failed · ${fmt(ov.kito_asks_7d)} questions this week`
                                                : `questions this week · ${fmt(ov?.kito_errors_7d)} failed`}
              tone={(ov?.kito_read_fails_24h ?? 0) + (ov?.kito_errors_7d ?? 0) > 0 ? 'warn' : undefined} />
        <Stat label="Message queue" value={fmt((ov?.failed_events ?? 0) + (ov?.stuck_events ?? 0))}
              sub={`failed or stuck · ${fmt(ov?.pending_events)} waiting`} tone={(ov?.failed_events ?? 0) + (ov?.stuck_events ?? 0) > 0 ? 'bad' : undefined} />
      </dl>

      <Board rows={rows} onOpen={onOpen} onb={onb} />

      <div className="ia-split">
        <section className="ia-panel">
          <div className="ia-panel-h"><h2>Activity, last 30 days</h2>
            <div className="ia-key"><i className="k-msg" />WhatsApp messages<i className="k-sign" />New business</div></div>
          {act ? <ActivityChart a={act} /> : <div className="ia-skel" style={{ height: 190 }} />}
        </section>
        <section className="ia-panel">
          <div className="ia-panel-h"><h2>Needs you</h2>{errors.length > 0 && <button className="ia-textbtn" onClick={goErrors}>All errors</button>}</div>
          {items.length === 0
            ? <p className="ia-empty">All quiet. Every business is running normally.</p>
            : <ul className="ia-feed">
                {items.slice(0, 6).map((it, i) => (
                  <li key={i}>
                    <button className={`ia-feeditem t-${it.tone}`} onClick={() => (it.ws ? onOpen(it.ws) : it.title === 'AI cost' && goUsage())} disabled={!it.ws && it.title !== 'AI cost'}>
                      <span className="ia-feeddot" aria-hidden />
                      <span className="ia-feedtxt"><strong>{it.title}</strong><span>{it.body}</span></span>
                      <time title={stamp(it.at)}>{ago(it.at)}</time>
                    </button>
                  </li>
                ))}
              </ul>}
        </section>
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'bad' | 'warn' }) {
  return <div className={`ia-stat${tone ? ' t-' + tone : ''}`}><dt>{label}</dt><dd>{value}</dd><span>{sub}</span></div>;
}

/* the memorable bit: where each business is stuck */
export function Board({ rows, onOpen, onb = {} }: { rows: WsRow[]; onOpen: (id: string) => void; onb?: Record<string, OnboardingRow> }) {
  const cols = [...STEPS.map((s) => s.label), 'Fully set up'];
  const by = cols.map((_, i) => rows.filter((w) => stuckAt(w) === i && w.status !== 'suspended'));
  let n = 0;
  return (
    <section className="ia-board" aria-label="Where each business is stuck">
      <div className="ia-board-h">
        <h2>Where each business is stuck</h2>
        <p>Each business sits on the next setup step it hasn't done yet. Move them all to Fully set up.</p>
      </div>
      <ol className="ia-lanes">
        {cols.map((c, i) => (
          <li key={c} className={`ia-lane${by[i]!.length ? ' has' : ''}${i === STEPS.length ? ' done' : ''}`}>
            <div className="ia-lane-h">
              <div className="ia-lane-top">
                <span className="ia-step">{i < STEPS.length ? i + 1 : '✓'}</span>
                <b className="ia-lane-n">{plural(by[i]!.length, 'business', 'businesses')}</b>
              </div>
              <strong>{c}</strong><small>{i < STEPS.length ? STEPS[i]!.hint : 'Ads, WhatsApp and sales all flowing'}</small>
            </div>
            <div className="ia-chips">
              {by[i]!.map((w) => {
                const h = healthOf(w);
                const days = daysOnStep(onb[w.id], i), act = stepAction(i, days);
                return (
                  <button key={w.id} title={act ? `${days != null ? `${days} days on this step. ` : ''}Next: ${act.text}` : undefined} className="ia-chip" style={{ animationDelay: `${120 + n++ * 70}ms` }} onClick={() => onOpen(w.id)}>
                    <span className="ia-tile sm" style={{ background: tileColor(w.id) }}>{initials(w.name)}</span>
                    <span className="ia-chiptxt"><strong>{w.name}</strong><small>joined {ago(w.created_at)}{days != null && <> · <span className={`ix-stuck t-${act?.tone ?? 'info'}`}>{days === 0 ? 'today' : `${days}d here`}</span></>}</small></span>
                    <span className="ia-ticks" aria-label={`${STEPS.filter((s) => s.done(w)).length} of ${STEPS.length} steps done`}>
                      {STEPS.map((s) => <i key={s.key} className={s.done(w) ? 'on' : ''} title={s.label} />)}
                    </span>
                    {(h.tone === 'bad' || h.tone === 'warn') && <span className={`ia-flag t-${h.tone}`} title={h.text} />}
                  </button>
                );
              })}
              {by[i]!.length === 0 && <span className="ia-lane-empty">Nobody here</span>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ActivityChart({ a }: { a: Activity }) {
  const W = 640, H = 190, P = { l: 30, r: 8, t: 12, b: 30 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const max = Math.max(5, ...a.messages);
  const top = Math.ceil(max / 5) * 5;
  const bw = iw / a.days.length;
  const [hover, setHover] = useState<number | null>(null);
  const total = a.messages.reduce((s, x) => s + x, 0);
  return (
    <div className="ia-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${total} WhatsApp messages and ${a.signups.reduce((s, x) => s + x, 0)} signups in 30 days`}
           onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={P.l} x2={W - P.r} y1={P.t + ih * (1 - f)} y2={P.t + ih * (1 - f)} className="grid" />
            <text x={P.l - 6} y={P.t + ih * (1 - f) + 4} className="ax" textAnchor="end">{Math.round(top * f)}</text>
          </g>
        ))}
        {a.days.map((d, i) => {
          const h = (a.messages[i]! / top) * ih;
          const x = P.l + i * bw;
          return (
            <g key={d} onMouseEnter={() => setHover(i)}>
              <rect x={x} y={P.t} width={bw} height={ih + P.b} fill="transparent" />
              <rect x={x + bw * 0.18} y={P.t + ih - h} width={bw * 0.64} height={Math.max(h, a.messages[i] ? 2 : 0)} rx={2}
                    className={`ia-bar${hover === i ? ' hi' : ''}`} />
              {a.signups[i]! > 0 && <circle cx={x + bw / 2} cy={P.t + ih + 9} r={4.5} className="sign" />}
              {(i % 7 === 2 || i === a.days.length - 1) && (
                <text x={x + bw / 2} y={H - 4} className="ax" textAnchor="middle">
                  {new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="ia-tip" aria-live="polite">
        {hover == null
          ? <>{plural(total, 'message')} in 30 days{a.orders ? ` · ${plural(a.orders.reduce((s, x) => s + x, 0), 'paid order')}` : ''} · {plural(a.kito.reduce((s, x) => s + x, 0), 'Kito question')}</>
          : <>{new Date(a.days[hover] + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}: {plural(a.messages[hover]!, 'message')}
              {a.signups[hover] ? `, ${plural(a.signups[hover]!, 'new business', 'new businesses')}` : ''}
              {a.sent?.[hover] ? `, ${plural(a.sent[hover]!, 'reply', 'replies')} from itaOS` : ''}
              {a.orders?.[hover] ? `, ${plural(a.orders[hover]!, 'paid order')}` : ''}
              {a.kito[hover] ? `, ${plural(a.kito[hover]!, 'Kito question')}` : ''}</>}
      </div>
    </div>
  );
}

/* ================= businesses ================= */
export function Spark({ v }: { v: number[] | undefined }) {
  if (!v || v.length === 0) return <span className="ia-faint">–</span>;
  const max = Math.max(1, ...v);
  const any = v.some((x) => x > 0);
  return (
    <svg className="ia-spark" viewBox={`0 0 ${v.length * 6} 24`} aria-label={`${v.reduce((s, x) => s + x, 0)} messages in 14 days`}>
      {v.map((x, i) => <rect key={i} x={i * 6} y={24 - (x / max) * 22 - (any ? 1 : 0)} width={4} height={x ? (x / max) * 22 + 1 : 1.5} rx={1} className={x ? 'on' : ''} />)}
    </svg>
  );
}

export function Businesses({ rows, act, loading, onOpen }: { rows: WsRow[]; act: Activity | null; loading: boolean; onOpen: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [f, setF] = useState<'all' | 'attention' | 'live' | 'trial' | 'suspended'>('all');
  const list = useMemo(() => {
    const rank: Record<Tone, number> = { bad: 0, warn: 1, ok: 2, idle: 3 };
    return rows
      .filter((w) => !q || `${w.name} ${w.owner_email ?? ''} ${w.wa_phone ?? ''}`.toLowerCase().includes(q.toLowerCase().replace(/^\+/, '')))
      .filter((w) => f === 'all' ? true : f === 'attention' ? ['bad', 'warn'].includes(healthOf(w).tone) : f === 'live' ? w.wa_status === 'active' : w.status === f)
      .sort((a, b) => rank[healthOf(a).tone] - rank[healthOf(b).tone] || +new Date(b.created_at) - +new Date(a.created_at));
  }, [rows, q, f]);
  const counts = { all: rows.length, attention: rows.filter((w) => ['bad', 'warn'].includes(healthOf(w).tone)).length,
    live: rows.filter((w) => w.wa_status === 'active').length,
    trial: rows.filter((w) => w.status === 'trial').length, suspended: rows.filter((w) => w.status === 'suspended').length };

  return (
    <div>
      <header className="ia-pagehead"><h1>Businesses</h1><p>Everyone using itaOS, sorted so problems come first.</p></header>
      <div className="ia-tools">
        <label className="ia-search">{ICON.search}<input placeholder="Find a business, email or number" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <div className="ia-seg" role="radiogroup" aria-label="Filter">
          {(['all', 'attention', 'live', 'trial', 'suspended'] as const).map((k) => (
            <button key={k} role="radio" aria-checked={f === k} className={f === k ? 'on' : ''} onClick={() => setF(k)}>
              {k === 'all' ? 'All' : k === 'attention' ? 'Needs a look' : k === 'live' ? 'Live on WhatsApp' : k[0]!.toUpperCase() + k.slice(1)}<em>{counts[k]}</em>
            </button>
          ))}
        </div>
      </div>
      {/* Phone: one row per business instead of the wide table */}
      <ul className="ia-mlist">
        {loading && rows.length === 0 && <li><div className="ia-skel" /></li>}
        {!loading && list.length === 0 && <li className="ia-empty">No business matches that search.</li>}
        {list.map((w) => {
          const h = healthOf(w); const s = stuckAt(w);
          return (
            <li key={w.id}>
              <button onClick={() => onOpen(w.id)}>
                <span className="ia-tile" style={{ background: tileColor(w.id) }}>{initials(w.name)}</span>
                <span className="ia-mbody">
                  <span className="ia-mtop"><strong>{w.name}</strong>{w.status !== 'active' && <span className={`ia-badge s-${w.status}`}>{w.status}</span>}<small>{ago(w.created_at)}</small></span>
                  {w.wa_phone && <small className="ia-faint">+{w.wa_phone} · {viaName(w.wa_via)}</small>}
                  <span className={`ia-health t-${h.tone}`}><i />{h.text}</span>
                  <span className="ia-msetup"><span className="ia-ticks lg">{STEPS.map((st) => <i key={st.key} className={st.done(w) ? 'on' : ''} />)}</span>
                    <small className="ia-faint">{s < STEPS.length ? `Next: ${STEPS[s]!.label}` : 'Fully set up'}</small></span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="ia-tablecard">
        <table className="ia-table">
          <thead><tr>
            <th>Business</th><th>Setup</th><th>Owner</th><th>Messages, 14 days</th>
            <th className="r">Sales 30d</th><th className="r">Ad spend 30d</th><th className="r">Kito 30d</th><th className="r">Joined</th>
          </tr></thead>
          <tbody>
            {loading && rows.length === 0 && <tr><td colSpan={8}><div className="ia-skel" /></td></tr>}
            {!loading && list.length === 0 && <tr><td colSpan={8} className="ia-empty">No business matches that search.</td></tr>}
            {list.map((w) => {
              const h = healthOf(w); const s = stuckAt(w);
              return (
                <tr key={w.id} tabIndex={0} onClick={() => onOpen(w.id)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(w.id); }}>
                  <td>
                    <div className="ia-bizcell">
                      <span className="ia-tile" style={{ background: tileColor(w.id) }}>{initials(w.name)}</span>
                      <div><strong>{w.name}{w.status !== 'active' && <span className={`ia-badge s-${w.status}`}>{w.status}</span>}</strong>
                        {w.wa_phone && <small className="ia-faint">WhatsApp +{w.wa_phone} · {viaName(w.wa_via)}</small>}
                        <span className={`ia-health t-${h.tone}`}><i />{h.text}</span></div>
                    </div>
                  </td>
                  <td>
                    <div className="ia-ticks lg">{STEPS.map((st) => <i key={st.key} className={st.done(w) ? 'on' : ''} title={`${st.label}: ${st.done(w) ? 'done' : 'not yet'}`} />)}</div>
                    <small className="ia-faint">{s < STEPS.length ? `Next: ${STEPS[s]!.label}` : 'Fully set up'}</small>
                  </td>
                  <td><div className="ia-trunc">{w.owner_email ?? 'No owner'}</div><small className="ia-faint">{w.owner_email ? `signed in ${ago(w.owner_last_sign_in)}` : 'nobody can sign in to it'}</small></td>
                  <td><div className="ia-sparkcell"><Spark v={act?.per_ws[w.id]} /><span>{fmt(w.messages)} total</span></div></td>
                  <td className="r num"><span className="nowrap">{w.revenue_30d != null ? money(w.revenue_30d, w.currency) : fmt(w.orders)}</span><small className="ia-faint">{plural(w.orders, 'paid order')}{w.tick_orders ? ` · ${fmt(w.tick_orders)} ✅` : ''}</small></td>
                  <td className="r num">{money(w.spend_30d, w.spend_currency)}</td>
                  <td className="r num">{fmt(w.kito_asks_30d)}<small className="ia-faint">{w.kito_tokens_30d ? `${fmt(Math.max(1, Math.round(w.kito_tokens_30d / 1000)))}k tokens` : 'no tokens'}</small></td>
                  <td className="r nowrap" title={stamp(w.created_at)}>{ago(w.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ================= errors & audit ================= */
export function Errors({ rows, loading, onOpen }: { rows: ErrRow[]; loading: boolean; onOpen: (id: string) => void }) {
  const [src, setSrc] = useState('all');
  const sources = useMemo(() => Array.from(new Set(rows.map((e) => e.source.split(':')[0]!))), [rows]);
  const list = rows.filter((e) => src === 'all' || e.source.startsWith(src));
  return (
    <div>
      <header className="ia-pagehead"><h1>Errors</h1><p>Things that failed behind the scenes, newest first.</p></header>
      {sources.length > 1 && (
        <div className="ia-tools"><div className="ia-seg">
          {['all', ...sources].map((s) => <button key={s} className={src === s ? 'on' : ''} onClick={() => setSrc(s)}>{s === 'all' ? 'All' : s}</button>)}
        </div></div>
      )}
      {loading && rows.length === 0 && <div className="ia-skel" />}
      {!loading && list.length === 0 && <div className="ia-panel"><p className="ia-empty">No errors. Messages, syncs and Kito are all processing cleanly.</p></div>}
      <ol className="ia-errlist">
        {list.map((e, i) => (
          <li key={i} className="ia-panel">
            <div className="ia-err-h">
              <strong>{SOURCE[e.source.split(':')[0]!] ?? e.source}</strong>
              {e.workspace_id
                ? <button className="ia-textbtn" onClick={() => onOpen(e.workspace_id!)}>{e.workspace_name ?? 'Open business'}</button>
                : <span className="ia-faint">Not linked to a business</span>}
              <time title={stamp(e.at)}>{ago(e.at)}</time>
            </div>
            <pre>{e.detail}</pre>
            <code className="ia-src">{e.source}</code>
            {(() => { const r = recoveryFor(e.source, e.detail); return r ? (
              <div className="ix-recovery"><p><b>Likely cause:</b> {r.cause}</p><ol>{r.steps.map((x, j) => <li key={j}>{x}</li>)}</ol>
                {e.workspace_id && /^(webhook|stuck)/.test(e.source) && <p className="ia-faint small">Retry is in the business's panel (open it above).</p>}</div>) : null; })()}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Audit({ supabase, tick }: { supabase: SupabaseClient; tick: number }) {
  const { data, error, loading } = useRpc<AuditRow[]>(supabase, 'admin_audit_log', { p_limit: 100 }, [tick]);
  return (
    <div>
      <header className="ia-pagehead"><h1>Audit log</h1><p>Every change made from this admin page, and who made it.</p></header>
      {error && <div className="ia-alert">Couldn't load the audit log: {error}</div>}
      {loading && !data && <div className="ia-skel" />}
      {data && data.length === 0 && <div className="ia-panel"><p className="ia-empty">No admin changes yet. Status, plan, sending, staff and deletions show up here.</p></div>}
      {data && data.length > 0 && (
        <ol className="ia-timeline">
          {data.map((a, i) => (
            <li key={i}><time title={stamp(a.at)}>{ago(a.at)}</time>
              <div><strong>{ACTION[a.action] ?? a.action}</strong>{a.workspace_name && <> for {a.workspace_name}</>}
                <span>{[describe(a.action, a.details), a.actor_email].filter(Boolean).join(' · ')}</span></div></li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* ================= drawer ================= */
export function StaffPage({ supabase }: { supabase: SupabaseClient }) {
  const [tick, setTick] = useState(0);
  const { data, error, loading } = useRpc<Staff[]>(supabase, 'admin_staff', undefined, [tick]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  async function set(e: string, add: boolean) {
    if (!add && confirm !== e) { setConfirm(e); return; }
    setConfirm(null); setBusy(e); setMsg(null);
    const { error } = await supabase.rpc('admin_set_staff', { p_email: e, p_add: add });
    setBusy(null);
    if (error) setMsg({ ok: false, text: error.message });
    else { setMsg({ ok: true, text: add ? `${e} can now open this page` : `${e} removed` }); setEmail(''); setTick((t) => t + 1); }
  }

  return (
    <div>
      <header className="ia-pagehead"><h1>Staff</h1><p>Pondi people who can open this admin page. They sign in at /app/admin with their own itaOS account.</p></header>
      {error && <div className="ia-alert">{/function .* does not exist|schema cache/i.test(error) ? 'Staff management needs the latest database update (0023_admin_refresh).' : error}</div>}
      {loading && !data && <div className="ia-skel" />}
      {data && (
        <ol className="ia-timeline">
          {data.map((s) => (
            <li key={s.email}><time title={stamp(s.added_at)}>added {ago(s.added_at)}</time>
              <div className="ia-staffrow">
                <div><strong>{s.email}{s.is_me && <span className="ia-badge">you</span>}</strong><span>signed in {ago(s.last_sign_in_at)}</span></div>
                {!s.is_me && <button className={`ia-btn${confirm === s.email ? ' danger' : ''}`} disabled={busy !== null} onClick={() => set(s.email, false)}>{busy === s.email ? 'Removing…' : confirm === s.email ? 'Confirm remove' : 'Remove'}</button>}
              </div></li>
          ))}
        </ol>
      )}
      <form className="ia-panel ia-addstaff" onSubmit={(e) => { e.preventDefault(); if (email.trim()) void set(email.trim(), true); }}>
        <label className="ia-field"><span>Add a staff member</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@ponditech.com" /></label>
        <button className="ia-btn primary" disabled={!email.trim() || busy !== null}>Add</button>
        {msg && <span className={msg.ok ? 'ia-ok' : 'ia-bad'} role="status">{msg.text}</span>}
        <p className="ia-faint small">The person needs an itaOS account first (Create account on the sign-in page, then confirm the email). Staff see every business's counts and settings, never message text.</p>
      </form>
    </div>
  );
}

/* ================= icons ================= */
