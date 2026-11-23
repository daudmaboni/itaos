// itaOS — Pondi platform admin (/admin)
// Reads only the admin_* RPCs (migrations 0012_platform_admin, 0013_admin_activity, 0023_admin_refresh).
// 0031_admin_insights adds Performance, AI usage, Data quality, onboarding days and staff follow-ups (AdminInsights.tsx).
// Fields added in 0023 are optional here, so the page still works against an older database.
// Every RPC re-checks platform_admins server-side; hiding this page is UX, not security.
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { pageTransition } from './pageTransition';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PerformancePage, UsagePage, QualityPage, INSIGHTS_CSS } from './AdminInsights';
import { usageAlerts, type OnboardingRow, type ApiUsage } from './adminInsights';
import { Overview, WsRow, Activity, ErrRow, Staff, View, ago, hoursSince, useRpc, ICON } from "./adminParts";
import { CSS } from "./adminStyles";
import { Today, Businesses, Errors, Audit, StaffPage } from "./AdminPages";
import { Drawer } from "./AdminDrawer";
import { useBackLayer, depth } from "./backStack";
export { healthOf } from "./adminParts";
/* ================= types ================= */
const VIEWS: View[] = ['today', 'workspaces', 'performance', 'usage', 'quality', 'errors', 'audit', 'staff'];

/* ================= helpers ================= */
/** Use in your nav to show the Admin link only to platform admins. */
export function useIsPlatformAdmin(supabase: SupabaseClient, userId?: string | null): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    if (userId === null) { setOk(false); return; } // signed out
    supabase.rpc('is_platform_admin').then(({ data, error }) => { if (live) setOk(!error && data === true); });
    return () => { live = false; };
  }, [supabase, userId]);
  return ok;
}

function useHashView(): [View, (v: View) => void] {
  const read = (): View => {
    const h = window.location.hash.replace('#', '');
    return VIEWS.includes(h as View) ? (h as View) : 'today';
  };
  const [v, setV] = useState<View>(read);
  const cur = useRef<View>(v);
  // Same light page change as the business app.
  const go = (nv: View) => {
    if (nv === cur.current) return;
    cur.current = nv;
    pageTransition({
      swap: () => flushSync(() => setV(nv)),
      area: () => { // yellow line along the top of the main area (right of the sidebar; under the phone top bar)
        const side = document.querySelector('.ia-side')?.getBoundingClientRect();
        if (!side) return {};
        return side.width < innerWidth * 0.6 ? { left: side.right } : { top: Math.max(0, side.bottom - 1) };
      },
      stage: () => document.querySelector<HTMLElement>('.ia-main'),
    });
  };
  useEffect(() => { const on = () => go(read()); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  return [v, (nv: View) => {
    try { if (window.location.hash !== '#' + nv) window.location.hash = nv; } catch { /* hash may be blocked */ }
    go(nv); // no-op when the hashchange already started it
  }];
}

/* ================= page ================= */
export default function Admin({ supabase, backHref, onSignOut }: { supabase: SupabaseClient; backHref?: string; onSignOut?: () => void }) {
  const isAdmin = useIsPlatformAdmin(supabase);
  const [view, setView] = useHashView();
  const [openWs, setOpenWs] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [more, setMore] = useState(false);   // phone: the "More" sheet
  useBackLayer(more, () => setMore(false));
  const refresh = () => setTick((t) => t + 1);

  const ov = useRpc<Overview>(supabase, 'admin_overview', undefined, [tick, isAdmin]);
  const ws = useRpc<WsRow[]>(supabase, 'admin_workspaces', undefined, [tick, isAdmin]);
  const act = useRpc<Activity>(supabase, 'admin_activity', { p_days: 30 }, [tick, isAdmin]);
  const errs = useRpc<ErrRow[]>(supabase, 'admin_errors', { p_limit: 200 }, [tick, isAdmin]);
  // 0031: optional. Older databases just don't show days-on-step, follow-ups or cost alerts.
  const onb = useRpc<OnboardingRow[]>(supabase, 'admin_onboarding', undefined, [tick, isAdmin]);
  const usage = useRpc<ApiUsage>(supabase, 'admin_api_usage', { p_days: 30 }, [tick, isAdmin]);

  if (isAdmin === null) return <Frame><p className="ia-blank">Checking your access…</p></Frame>;
  if (!isAdmin) return (
    <Frame><div className="ia-blank"><h2>This page is for Pondi admins</h2>
      <p>This account doesn't have staff access. Sign out and sign in with your Pondi staff account.</p>
      {onSignOut && <button className="ia-btn primary" onClick={onSignOut}>Sign out</button>}</div></Frame>
  );

  const rows = ws.data ?? [];
  const errors = errs.data ?? [];
  const recentErrors = errors.filter((e) => hoursSince(e.at) < 24 * 7).length;
  const onbBy: Record<string, OnboardingRow> = Object.fromEntries((onb.data ?? []).map((o) => [o.workspace_id, o]));
  const costAlerts = usage.data ? usageAlerts(usage.data) : [];
  const loading = ov.loading || ws.loading;
  const loadError = ov.error || ws.error || act.error;

  return (
    <Frame>
      <aside className="ia-side">
        <div className="ia-brand"><span className="ia-mark">ita.</span><span>Admin</span></div>
        {/* Phone: refresh lives in the top bar, with when it last updated */}
        <button className={'ia-mrefresh' + (loading ? ' busy' : '')} onClick={refresh} disabled={loading} aria-label="Refresh">
          <span className="ia-mrefresh-t">{loading ? 'Updating…' : `Updated ${ov.data ? ago(ov.data.generated_at) : '…'}`}</span>{ICON.refresh}
        </button>
        <nav className="ia-nav" aria-label="Admin sections">
          <NavBtn on={view === 'today'} onClick={() => setView('today')} icon={ICON.today}>Today</NavBtn>
          <NavBtn on={view === 'workspaces'} onClick={() => setView('workspaces')} icon={ICON.ws} count={rows.length}>Businesses</NavBtn>
          <NavBtn on={view === 'performance'} onClick={() => setView('performance')} icon={ICON.perf}>Performance</NavBtn>
          <NavBtn on={view === 'usage'} onClick={() => setView('usage')} icon={ICON.usage} count={costAlerts.filter((a) => a.tone !== 'info').length} hot>AI usage</NavBtn>
          <NavBtn on={view === 'quality'} onClick={() => setView('quality')} icon={ICON.quality}>Data quality</NavBtn>
          <NavBtn on={view === 'errors'} onClick={() => setView('errors')} icon={ICON.err} count={recentErrors} hot={recentErrors > 0}>Errors</NavBtn>
          <NavBtn on={view === 'audit'} onClick={() => setView('audit')} icon={ICON.audit}>Audit log</NavBtn>
          <NavBtn on={view === 'staff'} onClick={() => setView('staff')} icon={ICON.staff}>Staff</NavBtn>
        </nav>
        <div className="ia-side-foot">
          <button className="ia-refresh" onClick={refresh} disabled={loading}>{ICON.refresh}{loading ? 'Refreshing' : 'Refresh'}</button>
          <span>Updated {ov.data ? ago(ov.data.generated_at) : '…'}</span>
          {backHref && <a className="ia-back" href={backHref}>Open business app</a>}
          {onSignOut && <button className="ia-back ia-signout" onClick={onSignOut}>Sign out</button>}
          <span className="ia-co">Pondi Technologies</span>
        </div>
      </aside>

      {/* Phone only: refresh button in the slim top bar, and a bottom menu like the business app */}
      <nav className="ia-bnav" aria-label="Admin sections">
        <BBtn on={view === 'today'} onClick={() => { setMore(false); setView('today'); }} icon={ICON.today}>Today</BBtn>
        <BBtn on={view === 'workspaces'} onClick={() => { setMore(false); setView('workspaces'); }} icon={ICON.ws}>Businesses</BBtn>
        <BBtn on={view === 'errors'} onClick={() => { setMore(false); setView('errors'); }} icon={ICON.err} count={recentErrors}>Errors</BBtn>
        <BBtn on={more || ['performance', 'usage', 'quality', 'audit', 'staff'].includes(view)} onClick={() => setMore((m) => !m)} icon={ICON.more}
              count={costAlerts.filter((a) => a.tone !== 'info').length}>More</BBtn>
      </nav>
      {more && <>
        <div className="ia-sheet-back" onClick={() => setMore(false)} />
        <div className="ia-sheet" role="dialog" aria-label="More">
          {([['performance', 'Performance', ICON.perf], ['usage', 'AI usage', ICON.usage], ['quality', 'Data quality', ICON.quality], ['audit', 'Audit log', ICON.audit], ['staff', 'Staff', ICON.staff]] as const).map(([v, label, icon]) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => { setMore(false); setView(v); }}>{icon}<span>{label}</span>
              {v === 'usage' && costAlerts.filter((a) => a.tone !== 'info').length > 0 && <em>{costAlerts.filter((a) => a.tone !== 'info').length}</em>}</button>
          ))}
          <div className="ia-sheet-foot">
            <span>Updated {ov.data ? ago(ov.data.generated_at) : '…'}</span>
            {backHref && <a href={backHref}>Open business app</a>}
            {onSignOut && <button onClick={onSignOut}>Sign out</button>}
          </div>
        </div>
      </>}

      <main className="ia-main">
        {loadError && <div className="ia-alert">Some data didn't load: {loadError}. Try Refresh.</div>}
        {view === 'today' && <Today ov={ov.data} rows={rows} act={act.data} errors={errors} onOpen={setOpenWs} goErrors={() => setView('errors')}
                                    onb={onbBy} costAlerts={costAlerts} goUsage={() => setView('usage')} />}
        {view === 'workspaces' && <Businesses rows={rows} act={act.data} loading={ws.loading} onOpen={setOpenWs} />}
        {view === 'performance' && <PerformancePage supabase={supabase} tick={tick} onOpen={setOpenWs} />}
        {view === 'usage' && <UsagePage supabase={supabase} tick={tick} />}
        {view === 'quality' && <QualityPage supabase={supabase} tick={tick} onOpen={setOpenWs} />}
        {view === 'errors' && <Errors rows={errors} loading={errs.loading} onOpen={setOpenWs} />}
        {view === 'audit' && <Audit supabase={supabase} tick={tick} />}
        {view === 'staff' && <StaffPage supabase={supabase} />}
      </main>

      {openWs && <Drawer supabase={supabase} id={openWs} row={rows.find((r) => r.id === openWs)} onb={onbBy[openWs]} onClose={() => setOpenWs(null)} onChanged={refresh}
                         onDeleted={() => { setOpenWs(null); refresh(); }} />}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  // On a phone every table turns into a stack of cards (CSS). Each cell needs its column name to show
  // as a small label, so copy the header text onto the cells whenever a table appears or changes.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const label = () => {
      root.querySelectorAll('table').forEach((t) => {
        const heads = [...t.querySelectorAll('thead th')].map((th) => (th.textContent ?? '').trim());
        t.querySelectorAll<HTMLElement>('tbody tr').forEach((tr) => {
          const cells = [...tr.children].filter((td) => !td.classList.contains('ia-fold'));
          cells.forEach((td, i) => {
            const want = (td as HTMLElement).hasAttribute('colspan') ? '' : heads[i] ?? '';
            if ((td as HTMLElement).dataset.label !== want) (td as HTMLElement).dataset.label = want;
          });
          // (State lives in data-* attributes: React rewrites className on updates but leaves these alone.)
          // Phone: a card shows its title and two numbers. Rows that open a business already go to its page;
          // any other row with more to show opens as its own full page (tap the card, "Back" to return).
          const opens = tr.hasAttribute('data-opens');
          if (opens) tr.dataset.link = ''; else delete tr.dataset.link;
          const filled = cells.filter((td) => !(td as HTMLElement).hasAttribute('colspan') && (td.textContent ?? '').trim() !== '').length;
          let bar = tr.querySelector(':scope > td.ia-fold');
          if (!opens && filled > 3 && !bar) {
            bar = document.createElement('td');
            bar.className = 'ia-fold';
            bar.innerHTML = '<button type="button" class="ia-page-back"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg><span>Back</span></button>';
            tr.appendChild(bar);
            tr.dataset.more = '';
          } else if ((opens || filled <= 3) && bar) { bar.remove(); delete tr.dataset.more; }
        });
      });
    };
    label();
    // Open/close a folded card. Runs before React's own click handling, so the row's tap (open the business) doesn't fire.
    const onClick = (e: MouseEvent) => {
      const err = (e.target as HTMLElement).closest('.ia-errlist > li') as HTMLElement | null;
      if (err && !(e.target as HTMLElement).closest('a,button') && window.matchMedia('(max-width: 820px)').matches) {
        if (err.hasAttribute('data-open')) err.removeAttribute('data-open'); else err.setAttribute('data-open', ''); return;
      }
      const note = (e.target as HTMLElement).closest('.ia-timeline li span');
      if (note && !(e.target as HTMLElement).closest('a,button')) { note.closest('li')!.classList.toggle('ia-open'); return; }
      const t = e.target as HTMLElement;
      const back = t.closest('td.ia-fold > .ia-page-back');
      if (back) { e.stopPropagation(); e.preventDefault(); closePage(true); return; }
      const tr = t.closest('tr[data-more]') as HTMLElement | null;
      if (!tr || tr.hasAttribute('data-page') || !window.matchMedia('(max-width: 820px)').matches) return;
      if (t.closest('a,button,input,select,textarea,label')) return;
      e.stopPropagation();
      openPage(tr);
    };
    // One row at a time is shown as a full page. The phone's own back gesture closes it too.
    let page: HTMLElement | null = null;
    const still = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const openPage = (tr: HTMLElement) => {
      page = tr;
      tr.dataset.page = '';
      document.documentElement.classList.add('ia-paged');
      tr.scrollTop = 0;
      if (!still()) tr.animate([{ transform: 'translateX(100%)' }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
      try { history.pushState({ itaDepth: depth() + 1, iaPage: 1 }, ''); } catch { /* ignore */ }
    };
    const closePage = (viaButton: boolean) => {
      const tr = page; if (!tr) return;
      page = null;
      const done = () => { delete tr.dataset.page; document.documentElement.classList.remove('ia-paged'); };
      if (still()) done(); else tr.animate([{ transform: 'none' }, { transform: 'translateX(100%)' }], { duration: 240, easing: 'cubic-bezier(.4,0,1,1)' }).onfinish = done;
      if (viaButton) { try { if (history.state?.iaPage) history.back(); } catch { /* ignore */ } }
    };
    // Only when the row page's own entry was left (Back from a drawer on top of it keeps the page open).
    const onPop = () => { if (page && !history.state?.iaPage) closePage(false); };
    window.addEventListener('popstate', onPop);
    root.addEventListener('click', onClick);
    let queued = false;
    const mo = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; label(); }); } });
    mo.observe(root, { childList: true, subtree: true });
    return () => { mo.disconnect(); root.removeEventListener('click', onClick); window.removeEventListener('popstate', onPop); document.documentElement.classList.remove('ia-paged'); };
  }, []);
  return <div className="ia" ref={ref}><style>{CSS + INSIGHTS_CSS}</style>{children}</div>;
}

function NavBtn({ on, onClick, icon, count, hot, children }:
  { on: boolean; onClick: () => void; icon: React.ReactNode; count?: number; hot?: boolean; children: React.ReactNode }) {
  return (
    <button className={`ia-navbtn${on ? ' on' : ''}`} aria-current={on ? 'page' : undefined} onClick={onClick}>
      {icon}<span>{children}</span>{count != null && count > 0 && <em className={hot ? 'hot' : ''}>{count}</em>}
    </button>
  );
}

function BBtn({ on, onClick, icon, count, children }: { on: boolean; onClick: () => void; icon: React.ReactNode; count?: number; children: React.ReactNode }) {
  return (
    <button className={on ? 'on' : ''} aria-current={on ? 'page' : undefined} onClick={onClick}>
      <span className="ia-bico">{icon}{count != null && count > 0 && <em>{count > 99 ? '99+' : count}</em>}</span><span>{children}</span>
    </button>
  );
}

/* ================= today ================= */
