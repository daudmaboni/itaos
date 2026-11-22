// Staff admin: one business's details drawer and its WhatsApp setup (moved out of Admin.tsx, unchanged).
import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DrawerPerformance, DrawerTasks } from './AdminInsights';
import { daysOnStep, stepAction, type OnboardingRow } from './adminInsights';
import { Overview, WsStatus, WsRow, Detail, fmt, ago, stamp, plural, money, tileColor, initials, healthOf, viaName, STEPS, EXTRAS, stuckAt, useRpc, ACTION, describe, ORIGIN, ORDER_FROM, ICON } from "./adminParts";

export function Drawer({ supabase, id, row, onb, onClose, onChanged, onDeleted }:
  { supabase: SupabaseClient; id: string; row?: WsRow; onb?: OnboardingRow; onClose: () => void; onChanged: () => void; onDeleted: () => void }) {
  const [tick, setTick] = useState(0);
  const { data: d, error, loading } = useRpc<Detail>(supabase, 'admin_workspace_detail', { p_ws: id }, [id, tick]);
  const [status, setStatus] = useState<WsStatus>('active');
  const [plan, setPlan] = useState('pilot');
  const [note, setNote] = useState('');
  // What this business pays per month (business currency); drives the "× its cost" badge on its Home.
  const [price, setPrice] = useState('');
  const [priceWas, setPriceWas] = useState<{ v: number | null; cur: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [delName, setDelName] = useState('');
  const [delOpen, setDelOpen] = useState(false);

  useEffect(() => { if (d?.workspace) { setStatus(d.workspace.status); setPlan(d.workspace.plan); setNote(d.workspace.note ?? ''); } }, [d]);
  useEffect(() => {
    let gone = false;
    supabase.rpc('admin_prices').then(({ data }) => {
      const r = ((data ?? []) as { workspace_id: string; currency: string; price_month: number | null }[]).find((x) => x.workspace_id === id);
      if (!gone && r) { setPriceWas({ v: r.price_month, cur: r.currency }); setPrice(r.price_month == null ? '' : String(r.price_month)); }
    });
    return () => { gone = true; };
  }, [supabase, id, tick]);
  const priceNum = price.replace(/[,\s]/g, '') === '' ? null : Number(price.replace(/[,\s]/g, ''));
  const priceBad = priceNum != null && (!isFinite(priceNum) || priceNum < 0);
  const priceDirty = !!priceWas && !priceBad && priceNum !== priceWas.v;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const w = d?.workspace;
  const stateDirty = !!w && (status !== w.status || plan !== w.plan || (note.trim() || null) !== (w.note || null));
  const dirty = stateDirty || priceDirty;
  const retryable = (d?.events ?? []).filter((e) => e.status === 'failed' || e.status === 'stuck').reduce((s, e) => s + e.n, 0);
  const h = row ? healthOf(row) : null;
  const maxDay = Math.max(1, ...(d?.daily ?? []).map((x) => x.in + x.out));
  const totalIn = (d?.daily ?? []).reduce((s, x) => s + x.in, 0), totalOut = (d?.daily ?? []).reduce((s, x) => s + x.out, 0);
  const totalItaos = (d?.daily ?? []).reduce((s, x) => s + (x.itaos ?? 0), 0);
  const wa = d?.connections.find((c) => c.provider === 'whatsapp');
  const connected = (d?.connections.length ?? 0) > 0 || (d?.wa_numbers.length ?? 0) > 0;
  const hasPhotos = (d?.media?.saved ?? 0) > 0;
  const sendOn = w?.send_enabled !== false;

  async function run(key: string, fn: () => PromiseLike<{ error: { message: string } | null; data?: unknown }>, ok: (data: unknown) => string, fail: string) {
    setBusy(key); setMsg(null);
    const { data, error } = await fn();
    setBusy(null);
    if (error) setMsg({ ok: false, text: `${fail}: ${error.message}` });
    else { setMsg({ ok: true, text: ok(data) }); setTick((t) => t + 1); onChanged(); }
  }
  function save() {
    if (status === 'suspended' && w?.status !== 'suspended' && !confirmSuspend) { setConfirmSuspend(true); return; }
    setConfirmSuspend(false);
    void run('save', async () => {
      if (priceDirty) { const r = await supabase.rpc('admin_set_price', { p_ws: id, p_price: priceNum }); if (r.error || !stateDirty) return r; }
      return supabase.rpc('admin_set_workspace_state', { p_ws: id, p_status: status, p_plan: plan, p_note: note });
    }, () => 'Changes saved', 'Not saved');
  }
  const requeue = () => run('requeue', () => supabase.rpc('admin_requeue_events', { p_ws: id }),
    (n) => `${plural(Number(n ?? 0), 'event')} sent back to the queue`, 'Retry failed');
  const toggleSend = () => run('send', () => supabase.rpc('admin_set_send_enabled', { p_ws: id, p_on: !sendOn }),
    () => (sendOn ? 'Replying from itaOS switched off' : 'Replying from itaOS switched on'), 'Not changed');
  async function del() {
    setBusy('delete'); setMsg(null);
    const { error } = await supabase.rpc('admin_delete_workspace', { p_ws: id, p_confirm: delName });
    setBusy(null);
    if (error) setMsg({ ok: false, text: `Not deleted: ${error.message}` });
    else onDeleted();
  }

  return (
    <div className="ia-scrim" onClick={onClose}>
      <aside className="ia-drawer" role="dialog" aria-modal="true" aria-label={`${w?.name ?? 'Business'} details`} onClick={(e) => e.stopPropagation()}>
        <header className="ia-dh">
          <span className="ia-tile lg" style={{ background: tileColor(id) }}>{initials(w?.name ?? row?.name ?? '')}</span>
          <div className="ia-dh-t">
            <h2>{w?.name ?? row?.name ?? 'Loading…'}</h2>
            {w && <p>Joined {stamp(w.created_at)} · {w.language === 'sw' ? 'Kiswahili' : 'English'} · {w.currency}{row?.wa_phone ? ` · WhatsApp +${row.wa_phone}` : ''}</p>}
          </div>
          <button className="ia-x" onClick={onClose} aria-label="Close">{ICON.close}</button>
        </header>
        {h && <div className={`ia-banner t-${h.tone}`}><i />{h.text}</div>}
        {error && <div className="ia-alert">{error}</div>}
        {loading && !d && <div className="ia-dbody"><div className="ia-skel" /><div className="ia-skel" /></div>}

        {d && w && (
          <div className="ia-dbody">
            {row && (
              <section className="ia-dsec">
                <h3>Setup</h3>
                <ol className="ia-check">
                  {STEPS.map((s) => (
                    <li key={s.key} className={s.done(row) ? 'on' : ''}><span>{s.done(row) ? '✓' : ''}</span>
                      <div><strong>{s.label}</strong><small>{s.hint}</small></div></li>
                  ))}
                  {row.wa_via !== undefined && EXTRAS.map((s) => (
                    <li key={s.label} className={s.done(row) ? 'on' : ''}><span>{s.done(row) ? '✓' : ''}</span>
                      <div><strong>{s.label}</strong>
                        <small>{s.label.startsWith('Dashboard') && (row.settings_missing ?? []).length ? `Missing: ${row.settings_missing!.join(', ')}` : s.hint}</small></div></li>
                  ))}
                </ol>
              </section>
            )}

            {row && (() => { const st = stuckAt(row), days = daysOnStep(onb, st), a = stepAction(st, days); return a ? (
              <p className={`ia-faint small`} style={{ marginTop: -6 }}><b>{days != null ? `${days} days` : 'Time'} on "{STEPS[st]!.label}".</b> Suggested: {a.text}</p>) : null; })()}

            <DrawerPerformance supabase={supabase} id={id} />
            <DrawerTasks supabase={supabase} id={id} onChanged={onChanged}
                         suggestion={row && stuckAt(row) < STEPS.length ? stepAction(stuckAt(row), null)!.text : null} />

            <section className="ia-dsec">
              <h3>Account</h3>
              <div className="ia-form">
                <div className="ia-field"><span>Status</span>
                  <div className="ia-seg full" role="radiogroup" aria-label="Status">
                    {(['trial', 'active', 'suspended'] as WsStatus[]).map((s) => (
                      <button key={s} role="radio" aria-checked={status === s} className={status === s ? `on s-${s}` : ''} onClick={() => { setStatus(s); setConfirmSuspend(false); }}>{s[0]!.toUpperCase() + s.slice(1)}</button>
                    ))}
                  </div></div>
                <label className="ia-field"><span>Plan</span><input value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="pilot" /></label>
                <label className="ia-field"><span>Price per month{priceWas ? ` (${priceWas.cur})` : ''}</span><input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Not set" aria-invalid={priceBad} /></label>
                <label className="ia-field wide"><span>Private note</span>
                  <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Only Pondi staff can see this, e.g. how they found itaOS or what they're paying" /></label>
              </div>
              {confirmSuspend && <p className="ia-confirm">Suspend {w.name}? The owner will see a paused screen and can't send replies. Press Save again to confirm.</p>}
              <div className="ia-actions">
                <button className="ia-btn primary" disabled={!dirty || busy !== null} onClick={save}>{busy === 'save' ? 'Saving…' : confirmSuspend ? 'Confirm suspend' : 'Save changes'}</button>
                {retryable > 0 && <button className="ia-btn" disabled={busy !== null} onClick={requeue}>{busy === 'requeue' ? 'Retrying…' : `Retry ${plural(retryable, 'failed or stuck event')}`}</button>}
                {msg && <span className={msg.ok ? 'ia-ok' : 'ia-bad'} role="status">{msg.text}</span>}
              </div>
              <p className="ia-faint small">Suspended pauses the business app for everyone in it and blocks replies from itaOS. WhatsApp messages keep arriving, so nothing is lost.</p>
            </section>

            <section className="ia-dsec">
              <h3>WhatsApp messages, last 14 days</h3>
              <div className="ia-dbars" role="img" aria-label={`${totalIn} received and ${totalOut} sent in 14 days`}>
                {d.daily.map((x) => (
                  <div key={x.day} title={`${x.day}: ${x.in} received, ${x.out} sent${x.itaos ? ` (${x.itaos} from itaOS)` : ''}`}>
                    <span className="col" style={{ height: `${((x.in + x.out) / maxDay) * 100}%` }}>
                      <i className="s" style={{ flex: x.itaos ?? 0 }} /><i className="o" style={{ flex: x.out - (x.itaos ?? 0) }} /><i className="n" style={{ flex: x.in }} />
                    </span>
                    <small>{new Date(x.day + 'T12:00:00Z').getUTCDate()}</small>
                  </div>
                ))}
              </div>
              <p className="ia-key small"><i className="k-in" />{fmt(totalIn)} from customers<i className="k-out" />{fmt(totalOut - totalItaos)} from the WhatsApp app
                {d.daily[0]?.itaos !== undefined && <><i className="k-itaos" />{fmt(totalItaos)} from itaOS</>}</p>
              {d.msg_origins && Object.keys(d.msg_origins).length > 0 && (
                <ul className="ia-mini">
                  {Object.entries(d.msg_origins).sort((a, b) => b[1] - a[1]).map(([k, n]) => <li key={k}><span>{ORIGIN[k] ?? k}</span><b>{fmt(n)}</b></li>)}
                </ul>
              )}
            </section>

            <section className="ia-dsec">
              <h3>Connections</h3>
              {!connected && <p className="ia-empty left">Nothing connected yet. Set WhatsApp up below (Dualhook). Owners only see Connected / Not connected.</p>}
              <ul className="ia-conns">
                {d.connections.map((c, i) => (
                  <li key={i}>
                    <span className={`ia-health t-${c.status === 'active' ? 'ok' : 'bad'}`}><i /></span>
                    <div><strong>{c.provider === 'meta_ads' ? 'Meta Ads' : `WhatsApp via ${viaName(c.via)}`}</strong>
                      <small>{c.label ?? c.external_id}{c.provider === 'whatsapp' && c.webhook_set_at ? ` · webhook set ${ago(c.webhook_set_at)}` : ''}</small>
                      {c.provider === 'whatsapp' && c.send_key !== undefined && (
                        <small className={c.send_key ? '' : 'ia-warn'}>{c.send_key ? `Replies: Dualhook API key saved ${ago(c.send_key_set_at)}` : "Replies: no Dualhook API key yet, so they can't reply from itaOS"}</small>
                      )}
                      {c.last_error && <small className="ia-bad">{c.last_error}</small>}</div>
                    <span className="ia-faint">{c.provider === 'meta_ads' ? `synced ${ago(c.last_sync_at)}` : c.status}</span>
                  </li>
                ))}
                {d.wa_numbers.map((n) => (
                  <li key={n.phone_number_id}><span className="ia-health t-ok"><i /></span>
                    <div><strong>{n.display_phone ? `+${n.display_phone}` : n.phone_number_id}</strong>
                      <small>{n.coexistence ? 'Coexistence: the WhatsApp Business app still works' : 'Cloud API'} · history {n.history_status ?? 'not requested'}</small>
                      {n.last_in !== undefined && <small>Last customer message {ago(n.last_in)}</small>}</div>
                    <span className="ia-faint">WABA {n.waba_id}</span></li>
                ))}
              </ul>
              {wa && (
                <div className="ia-row">
                  <div><strong>Reply from itaOS</strong>
                    <small className="ia-faint">{sendOn ? 'On: owners and admins can answer chats inside itaOS (24-hour window).' : 'Off: the Chats inbox is read-only.'} The owner can also change this in Settings.</small></div>
                  <button className="ia-btn" disabled={busy !== null || row?.send_enabled === undefined} onClick={toggleSend}>{busy === 'send' ? 'Saving…' : sendOn ? 'Switch off' : 'Switch on'}</button>
                </div>
              )}
              <DualhookSetup supabase={supabase} id={id} hasDualhook={!!d.connections.find((c) => c.provider === 'whatsapp' && c.via === 'dualhook')}
                linked={d.wa_numbers.length > 0} keySaved={!!d.connections.find((c) => c.provider === 'whatsapp' && c.send_key)} onChanged={() => { setTick((t) => t + 1); onChanged(); }} />
              <p className="ia-faint small">Meta Ads: connect from the business's own login at <code>itaos.app/app#connect/setup</code> (it needs their Facebook login).</p>
            </section>

            {d.sales && (
              <section className="ia-dsec">
                <h3>Sales</h3>
                <p className="ia-kito"><strong>{money(d.sales.revenue_30d, w.currency)}</strong> in the last 30 days · {money(d.sales.revenue_total, w.currency)} in total
                  {d.sales.last_paid_at && <> · last paid {ago(d.sales.last_paid_at)}</>}</p>
                {d.sales.by_source.length === 0
                  ? <p className="ia-empty left">No orders yet.</p>
                  : <ul className="ia-mini">
                      {d.sales.by_source.map((s, i) => (
                        <li key={i}><span>{ORDER_FROM[s.from] ?? s.from}{s.status !== 'paid' && <em className="ia-badge">{s.status}</em>}</span>
                          <b>{plural(s.n, 'order')} · {money(s.amount ?? 0, w.currency)}</b></li>
                      ))}
                    </ul>}
                {(w.unit_cost == null || (w.fx_rate == null && row?.meta_status)) && (
                  <p className="ia-faint small">Dashboard can't show profit yet: {[w.fx_rate == null && row?.meta_status ? 'exchange rate' : '', w.unit_cost == null ? 'cost per order' : ''].filter(Boolean).join(' and ')} not set. The owner types them on the Dashboard card.</p>
                )}
              </section>
            )}

            <section className="ia-dsec">
              <h3>What's in their account</h3>
              <dl className="ia-counts">
                {([['live_chats', 'Live chats'], ['imported_chats', 'Imported chats'], ['messages', 'Messages'], ['contacts', 'Customers'],
                   ['kito_tagged', 'Chats read by Kito'], ['ads', 'Ads'], ['insight_days', 'Ad-days of data'], ['orders', 'Paid orders'],
                   ['open_tasks', 'Open follow-ups'], ['content_ideas', 'Content ideas']] as const)
                  .filter(([k]) => k in d.counts || !['live_chats', 'imported_chats'].includes(k))
                  .map(([k, l]) => (
                    <div key={k} className={d.counts[k] ? '' : 'zero'}><dd>{fmt(d.counts[k])}</dd><dt>{l}</dt></div>
                  ))}
              </dl>
              {d.media && d.media.saved + d.media.errors > 0 && (
                <p className="ia-faint small" style={{ marginTop: 10 }}>
                  {plural(d.media.saved, 'customer photo')} saved, {plural(d.media.receipts, 'payment screenshot')} read by Kito
                  {d.media.errors ? <span className="ia-bad">, {plural(d.media.errors, 'photo')} couldn't be read</span> : ''}. Last one {ago(d.media.last_at)}.</p>
              )}
            </section>

            <section className="ia-dsec">
              <h3>Kito</h3>
              {d.kito.reads_24h !== undefined && (
                <p className="ia-kito"><strong>{plural(d.kito.reads_24h, 'chat')}</strong> read in the last 24 hours
                  {d.kito.fails_24h ? <span className="ia-bad">, {fmt(d.kito.fails_24h)} failed</span> : ''}.{' '}
                  {(d.kito.behind ?? 0) > 0 ? <span className={(d.kito.behind ?? 0) >= 25 ? 'ia-warn' : ''}>{plural(d.kito.behind!, 'chat')} with new messages still to read.</span> : 'Up to date with new messages.'}</p>
              )}
              <p className="ia-kito"><strong>{plural(d.kito.asks_30d, 'question')}</strong> asked in 30 days, using {fmt(d.kito.input_tokens_30d + d.kito.output_tokens_30d)} tokens
                ({fmt(d.kito.input_tokens_30d)} in, {fmt(d.kito.output_tokens_30d)} out).
                {d.kito.errors_30d > 0 && <span className="ia-bad"> {plural(d.kito.errors_30d, 'question')} failed.</span>}</p>
              {d.kito.runs.length > 0 && (
                <ul className="ia-runs">
                  {d.kito.runs.map((r, i) => <li key={i}><time>{ago(r.ran_at)}</time><span>Read {plural(r.checked, 'chat')}{r.failed ? `, ${r.failed} failed` : ''}{r.remaining ? `, ${r.remaining} left` : ''}</span><small>{r.trigger === 'auto' ? 'automatic, every 15 min' : 'started by owner'}</small></li>)}
                </ul>
              )}
            </section>

            {((d.deletions?.length ?? 0) > 0 || (d.imports?.length ?? 0) > 0) && (
              <section className="ia-dsec">
                <h3>Imports and deletions</h3>
                <ol className="ia-timeline compact">
                  {[...(d.imports ?? []).map((b) => ({ at: b.at, title: `Imported ${b.kind === 'chat' || b.kind === 'chats' ? 'chat files' : b.kind}`,
                       body: `${fmt(b.created)} added, ${fmt(b.skipped)} skipped${b.rejected ? `, ${fmt(b.rejected)} rejected` : ''}` })),
                    ...(d.deletions ?? []).map((x) => ({ at: x.at, title: `Deleted ${plural(x.chats, 'chat')} ${x.via === 'kito' ? 'through Kito' : 'from Chats'}`,
                       body: `${fmt(x.messages)} messages${Object.keys(x.by_origin ?? {}).length ? ` (${Object.entries(x.by_origin).map(([k, n]) => `${n} ${k === 'export' ? 'imported' : k}`).join(', ')})` : ''}${x.orders_unlinked ? `, ${x.orders_unlinked} orders kept but unlinked` : ''} · ${x.by ?? 'unknown'}` }))]
                    .sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 10)
                    .map((e, i) => <li key={i}><time title={stamp(e.at)}>{ago(e.at)}</time><div><strong>{e.title}</strong><span>{e.body}</span></div></li>)}
                </ol>
              </section>
            )}

            <section className="ia-dsec">
              <h3>People</h3>
              {d.members.length === 0
                ? <p className="ia-empty left">Nobody belongs to this business, so no one can sign in to it. It's safe to delete below.</p>
                : <ul className="ia-people">
                    {d.members.map((m) => <li key={m.email}><span className="ia-trunc">{m.email}</span><span className="ia-badge">{m.role}</span><small className="ia-faint">signed in {ago(m.last_sign_in_at)}</small></li>)}
                  </ul>}
            </section>

            {d.audit.length > 0 && (
              <section className="ia-dsec">
                <h3>Admin changes</h3>
                <ol className="ia-timeline compact">
                  {d.audit.map((a, i) => <li key={i}><time title={stamp(a.at)}>{ago(a.at)}</time><div><strong>{ACTION[a.action] ?? a.action}</strong><span>{[describe(a.action, a.details), a.actor].filter(Boolean).join(' · ')}</span></div></li>)}
                </ol>
              </section>
            )}

            <section className="ia-dsec ia-danger">
              <h3>Delete this business</h3>
              {connected || hasPhotos
                ? <p className="ia-faint small">Can't delete while {connected ? 'WhatsApp or Meta Ads is connected (the owner disconnects on their Connections page)' : 'customer photos are stored'}. Suspend it instead.</p>
                : !delOpen
                  ? <button className="ia-btn danger" onClick={() => setDelOpen(true)}>Delete {w.name}…</button>
                  : <div className="ia-form">
                      <label className="ia-field wide"><span>Removes everything in it: {fmt(d.counts.conversations)} chats, {fmt(d.counts.messages)} messages, {fmt(d.counts.orders)} orders and its members' access. Type <b>{w.name}</b> to confirm.</span>
                        <input value={delName} onChange={(e) => setDelName(e.target.value)} placeholder={w.name} autoFocus /></label>
                      <div className="ia-actions wide">
                        <button className="ia-btn danger" disabled={delName !== w.name || busy !== null} onClick={del}>{busy === 'delete' ? 'Deleting…' : 'Delete for good'}</button>
                        <button className="ia-btn" onClick={() => { setDelOpen(false); setDelName(''); }}>Cancel</button>
                      </div>
                    </div>}
            </section>
            <p className="ia-faint small ia-id">Workspace ID {w.id}</p>
          </div>
        )}
      </aside>
    </div>
  );
}

/* ================= staff ================= */
/** Dualhook setup for one business, done by Pondi staff (owners only see Connected / Not connected).
 *  Calls the dualhook-connect function with the staff session; every action is written to admin_audit. */
export function DualhookSetup({ supabase, id, hasDualhook, linked, keySaved, onChanged }: {
  supabase: SupabaseClient; id: string; hasDualhook: boolean; linked: boolean; keySaved: boolean; onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [vals, setVals] = useState<{ webhook_url: string; verify_token: string } | null>(null);
  const [key, setKey] = useState('');
  const [confirmRotate, setConfirmRotate] = useState(false);
  async function call(k: string, body: Record<string, unknown>) {
    setBusy(k); setMsg(null);
    const { data, error } = await supabase.functions.invoke('dualhook-connect', { body: { workspace_id: id, ...body } });
    setBusy(null);
    let err = error?.message ?? (data as any)?.error ?? null;
    if (error) { try { const j = await (error as any).context?.json?.(); if (j?.error) err = j.error; } catch { /* keep */ } }
    if (err) { setMsg({ ok: false, text: String(err) }); return null; }
    onChanged();
    return data as any;
  }
  const copy = (v: string) => { void navigator.clipboard?.writeText(v).then(() => setMsg({ ok: true, text: 'Copied' }), () => setMsg({ ok: false, text: 'Copy failed: select the text and copy it by hand' })); };
  return (
    <div className="ia-row" style={{ display: 'grid', gap: 8 }}>
      <div><strong>WhatsApp setup (Dualhook)</strong>
        <small className="ia-faint">{!hasDualhook ? 'Not started.' : linked ? 'Linked: messages arrive.' : 'Webhook made, waiting for the first message.'} {keySaved ? 'API key saved (replies + photos).' : linked ? 'No API key yet.' : ''}</small></div>
      {!hasDualhook && <button className="ia-btn primary" disabled={busy !== null} onClick={async () => { const r = await call('mk', {}); if (r) setVals(r); }}>{busy === 'mk' ? 'Creating…' : 'Create webhook URL and token'}</button>}
      {hasDualhook && !linked && !vals && <button className="ia-btn" disabled={busy !== null} onClick={async () => { const r = await call('mk', {}); if (r) setVals(r); }}>{busy === 'mk' ? 'Creating…' : 'Lost them? Make a new URL and token'}</button>}
      {vals && (
        <div style={{ display: 'grid', gap: 6 }}>
          <small>In Dualhook: new connection → <b>Webhook Override</b>. Paste both <b>before</b> opening Meta's signup, then choose "Connect your existing WhatsApp Business app", scan the QR on the owner's phone and allow history sharing.</small>
          <label className="ia-field"><span>Webhook URL</span><div style={{ display: 'flex', gap: 6 }}><input readOnly value={vals.webhook_url} onFocus={(e) => e.target.select()} style={{ flex: 1 }} /><button className="ia-btn" onClick={() => copy(vals.webhook_url)}>Copy</button></div></label>
          <label className="ia-field"><span>Verify token</span><div style={{ display: 'flex', gap: 6 }}><input readOnly value={vals.verify_token} onFocus={(e) => e.target.select()} style={{ flex: 1 }} /><button className="ia-btn" onClick={() => copy(vals.verify_token)}>Copy</button></div></label>
          <small className="ia-bad">Save both now: itaOS keeps only a fingerprint and can't show them again.</small>
          <button className="ia-btn" onClick={() => setVals(null)}>Done</button>
        </div>
      )}
      {hasDualhook && linked && (
        <>
          <small className="ia-faint">Outbound API key (Dualhook → Connection → Overview → Outbound API key, starts with <code>dh_live_</code>). Lets the owner reply from itaOS and lets itaOS download payment screenshots.</small>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input type="password" autoComplete="off" placeholder="dh_live_…" value={key} onChange={(e) => setKey(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
            <button className="ia-btn primary" disabled={busy !== null || !key.trim().startsWith('dh_live_')} onClick={async () => {
              const r = await call('key', { action: 'set_api_key', api_key: key.trim() });
              if (r) { setKey(''); setMsg({ ok: !r.last_error, text: r.last_error ? `Key saved, but Dualhook didn't return the images and voice notes: ${r.last_error}` : `Key saved. ${r.images_saved} images and voice notes fetched.` }); }
            }}>{busy === 'key' ? 'Saving…' : keySaved ? 'Replace key' : 'Save key'}</button>
            {keySaved && <button className="ia-btn" disabled={busy !== null} onClick={async () => {
              const r = await call('img', { action: 'backfill_media' });
              if (r) setMsg({ ok: !r.last_error, text: r.last_error ? `Dualhook didn't return the images and voice notes: ${r.last_error}` : `${r.images_saved} images and voice notes fetched, ${r.images_failed} failed.` });
            }}>{busy === 'img' ? 'Fetching…' : 'Fetch images and voice notes'}</button>}
          </div>
          {!confirmRotate
            ? <button className="ia-btn" style={{ justifySelf: 'start' }} disabled={busy !== null} onClick={() => setConfirmRotate(true)}>Replace webhook URL…</button>
            : <div style={{ display: 'grid', gap: 6 }}>
                <small className="ia-bad">Only if the URL leaked. The current URL stops working immediately: no messages reach itaOS until the new URL and token are pasted into Dualhook (Webhook Override → Change).</small>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="ia-btn danger" disabled={busy !== null} onClick={async () => { setConfirmRotate(false); const r = await call('mk', {}); if (r) setVals(r); }}>{busy === 'mk' ? 'Creating…' : 'Yes, replace it'}</button>
                  <button className="ia-btn" onClick={() => setConfirmRotate(false)}>Cancel</button>
                </div>
              </div>}
        </>
      )}
      {msg && <small className={msg.ok ? '' : 'ia-bad'}>{msg.text}</small>}
    </div>
  );
}
