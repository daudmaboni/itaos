// Admin: which business-app features each business uses (admin_feature_use, migration 0080), and adding
// a business's staff (admin_add_member / admin_remove_member).
//   FeaturesPage    one grid, every business × every feature (Admin → Features)
//   DrawerFeatures  the same for one business, with evidence and what to suggest (business drawer)
//   MembersAdmin    add / change / remove people in a business (business drawer → People)
import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useRpc } from './adminParts';
import { featureRows, adoption, type FeatureUse, type FState } from './adminFeatures';

const tone = (s: FState) => (s === 'ok' ? 't-ok' : s === 'warn' ? 't-warn' : 't-idle');
const word = (s: FState) => (s === 'ok' ? 'In use' : s === 'warn' ? 'Needs a nudge' : 'Not set up');

export function FeaturesPage({ supabase, tick, onOpen }: { supabase: SupabaseClient; tick: number; onOpen: (id: string) => void }) {
  const { data, error, loading } = useRpc<FeatureUse[]>(supabase, 'admin_feature_use', { p_ws: null }, [tick]);
  if (error) return <div className="ia-alert">{error}</div>;
  if (loading && !data) return <div className="ia-skel" />;
  const list = (data ?? []).map((f) => ({ f, rows: featureRows(f) })).map((x) => ({ ...x, score: adoption(x.rows) })).sort((a, b) => b.score - a.score);
  const cols = list[0]?.rows ?? [];
  return (
    <div className="ia-panel">
      <div className="ia-panel-h"><h2>Features in use</h2><span className="ia-faint small">Green: in use · amber: set up but needs a nudge · empty: not set up. Click a business for details and what to suggest.</span></div>
      <div className="ia-tablecard" style={{ border: 0 }}>
        <table className="ia-table ia-feat">
          <thead><tr><th>Business</th><th className="r">Use</th>{cols.map((c) => <th key={c.key} title={c.label}><span className="ia-vert">{c.label}</span></th>)}</tr></thead>
          <tbody>
            {list.map(({ f, rows, score }) => (
              <tr key={f.id} onClick={() => onOpen(f.id)}>
                <td><strong>{f.name}</strong></td>
                <td className="r num">{score}%</td>
                {rows.map((r) => <td key={r.key} title={`${r.label}: ${r.text}${r.hint ? `\n→ ${r.hint}` : ''}`}><span className={`ia-health ${tone(r.state)}`}><i /></span></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DrawerFeatures({ supabase, id, tick }: { supabase: SupabaseClient; id: string; tick: number }) {
  const { data, error } = useRpc<FeatureUse[]>(supabase, 'admin_feature_use', { p_ws: id }, [id, tick]);
  const [all, setAll] = useState(false);
  const f = data?.[0];
  if (error) return <section className="ia-dsec"><h3>Features in use</h3><p className="ia-bad small">{error}</p></section>;
  if (!f) return <section className="ia-dsec"><h3>Features in use</h3><div className="ia-skel" /></section>;
  const rows = featureRows(f);
  const nudges = rows.filter((r) => r.hint && r.state !== 'ok');
  const shown = all ? rows : rows.filter((r) => r.state !== 'ok' || r.hint);
  return (
    <section className="ia-dsec">
      <h3>Features in use · {adoption(rows)}%</h3>
      {nudges.length > 0 && (
        <ol className="ia-nudges">
          {nudges.slice(0, 4).map((r) => <li key={r.key}><strong>{r.label}:</strong> {r.hint}</li>)}
        </ol>
      )}
      <ul className="ia-mini ia-featlist">
        {shown.map((r) => (
          <li key={r.key}>
            <span className={`ia-health ${tone(r.state)}`}><i /><span><b style={{ color: 'var(--ink)' }}>{r.label}</b> <small className="ia-faint">{word(r.state)}</small></span></span>
            <small className="ia-faint">{r.text}</small>
          </li>
        ))}
      </ul>
      <button className="ia-textbtn" onClick={() => setAll((x) => !x)}>{all ? 'Show only what needs attention' : `Show all ${rows.length} features`}</button>
    </section>
  );
}

type Member = { email: string; role: string; joined?: string; last_sign_in_at: string | null };
const ROLES = [['owner', 'Owner'], ['admin', 'Admin'], ['analyst', 'Staff'], ['viewer', 'View only']] as const;

export function MembersAdmin({ supabase, id, members, onChanged }: { supabase: SupabaseClient; id: string; members: Member[]; onChanged: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('analyst');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  async function add(e?: React.FormEvent, who = email, r = role) {
    e?.preventDefault();
    if (!who.trim()) return;
    setBusy('add' + who); setMsg(null);
    const { error } = await supabase.rpc('admin_add_member', { p_ws: id, p_email: who.trim(), p_role: r });
    setBusy('');
    if (error) setMsg({ ok: false, text: error.message });
    else { setMsg({ ok: true, text: `${who.trim()} is now ${ROLES.find((x) => x[0] === r)?.[1].toLowerCase()}.` }); setEmail(''); onChanged(); }
  }
  async function remove(who: string) {
    if (confirm !== who) { setConfirm(who); return; }
    setConfirm(null); setBusy('rm' + who); setMsg(null);
    const { error } = await supabase.rpc('admin_remove_member', { p_ws: id, p_email: who });
    setBusy('');
    if (error) setMsg({ ok: false, text: error.message }); else { setMsg({ ok: true, text: `${who} removed. Their chats are unassigned.` }); onChanged(); }
  }
  return (
    <div className="ia-members">
      {members.length > 0 && (
        <ul className="ia-people">
          {members.map((m) => (
            <li key={m.email}>
              <span className="ia-trunc">{m.email}</span>
              <select className="ia-select" aria-label={`Role for ${m.email}`} value={m.role} disabled={busy !== ''} onChange={(e) => void add(undefined, m.email, e.target.value)}>
                {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <small className="ia-faint">signed in {m.last_sign_in_at ? new Date(m.last_sign_in_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'never'}</small>
              <button className="ia-textbtn" disabled={busy !== ''} onClick={() => void remove(m.email)} style={{ color: confirm === m.email ? 'var(--bad)' : undefined }}>{confirm === m.email ? 'Confirm remove' : 'Remove'}</button>
            </li>
          ))}
        </ul>
      )}
      <form className="ia-form" onSubmit={add} style={{ marginTop: 10 }}>
        <label className="ia-field wide"><span>Add a person (the email they signed up with at itaos.app)</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="staff@example.com" autoComplete="off" /></label>
        <label className="ia-field"><span>Role</span>
          <select className="ia-select" value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <div className="ia-actions" style={{ alignSelf: 'end' }}><button className="ia-btn primary" disabled={!email.trim() || busy !== ''}>{busy.startsWith('add') ? 'Adding…' : 'Add'}</button></div>
      </form>
      {msg && <p className={msg.ok ? 'ia-ok small' : 'ia-bad small'} role="status">{msg.text}</p>}
      <p className="ia-faint small">Staff: answer and follow up chats, record sales. Admin: also settings. View only: can't change anything. Each person's numbers show on the owner's Staff leak guard.</p>
    </div>
  );
}

export const FEATURES_CSS = `
.ia-feat{min-width:0}.ia-feat td:first-child{min-width:160px}.ia-feat th{vertical-align:bottom;padding:10px 6px}.ia-feat td{padding:10px 6px;text-align:center}
.ia-feat td:first-child,.ia-feat th:first-child{text-align:left;padding-left:16px}
.ia-vert{display:inline-block;writing-mode:vertical-rl;transform:rotate(180deg);max-height:210px;font-size:12px;line-height:1.2;text-transform:none;white-space:nowrap}
.ia-feat .ia-health{justify-content:center}.ia-feat .ia-health i{width:11px;height:11px}
.ia-featlist li{display:grid!important;grid-template-columns:1fr;gap:2px;align-items:start}.ia-featlist li>*{text-align:left!important;justify-self:start}.ia-featlist .ia-health{color:var(--ink);justify-content:flex-start}
.ia-nudges{margin:0 0 10px;padding-left:18px;display:grid;gap:6px;font-size:13.5px;line-height:1.45}
.ia-select{border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--card);font:inherit;font-size:13px}
.ia-members .ia-people li{gap:10px}
`;
