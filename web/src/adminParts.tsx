// Shared pieces of the staff admin: data types, formatting helpers, icons (moved out of Admin.tsx, unchanged).
import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

export type Overview = {
  workspaces: number; workspaces_7d: number; users: number; active_users_7d: number;
  messages: number; messages_24h: number; messages_7d: number;
  connections_active: number; connections_error: number;
  failed_events: number; pending_events: number; unrouted_events: number;
  kito_asks_7d: number; kito_tokens_7d: number; kito_errors_7d: number;
  orders_paid: number; generated_at: string;
  // 0023
  orphan_workspaces?: number; sent_itaos_7d?: number; receipts_7d?: number; wa_live?: number; stuck_events?: number;
  kito_reads_24h?: number; kito_read_fails_24h?: number; orders_30d?: number; tick_orders_30d?: number;
  revenue_30d?: Record<string, number>;
};
export type WsStatus = 'trial' | 'active' | 'suspended';
export type WsRow = {
  id: string; name: string; created_at: string; status: WsStatus; plan: string; note: string | null;
  owner_email: string | null; owner_last_sign_in: string | null; members: number;
  wa_status: string | null; wa_last_sync: string | null; meta_status: string | null; meta_last_sync: string | null;
  last_error: string | null; messages: number; messages_7d: number; last_message_at: string | null;
  conversations: number; orders: number; spend_30d: number | null; spend_currency: string | null;
  kito_asks_30d: number; kito_tokens_30d: number; failed_events: number; pending_events: number;
  // 0023
  wa_via?: string | null; wa_phone?: string | null; send_enabled?: boolean; send_key?: boolean | null;
  last_customer_message_at?: string | null; live_chats?: number; imported_chats?: number;
  sent_itaos_30d?: number; receipts_30d?: number; tick_orders?: number; revenue_30d?: number; revenue_total?: number;
  currency?: string; kito_last_run?: string | null; kito_behind?: number; stuck_events?: number; settings_missing?: string[];
  rules_set?: boolean; // 0059
};
export type Activity = { days: string[]; messages: number[]; signups: number[]; kito: number[]; per_ws: Record<string, number[]>; sent?: number[]; orders?: number[] };
export type ErrRow = { at: string | null; workspace_id: string | null; workspace_name: string | null; source: string; detail: string };
export type AuditRow = { at: string; actor_email: string | null; action: string; workspace_name: string | null; details: unknown };
export type Detail = {
  workspace: { id: string; name: string; created_at: string; currency: string; timezone: string; language: string;
               fx_rate: number | null; status: WsStatus; plan: string; note: string | null; state_updated_at: string | null;
               unit_cost?: number | null; follow_up_hours?: number | null; send_enabled?: boolean };
  members: { email: string; role: string; joined: string; last_sign_in_at: string | null }[];
  connections: { provider: string; label: string | null; external_id: string; status: string;
                 last_sync_at: string | null; last_error: string | null; created_at: string;
                 via?: string | null; send_key?: boolean | null; send_key_set_at?: string | null; webhook_set_at?: string | null }[];
  wa_numbers: { display_phone: string | null; phone_number_id: string; waba_id: string; coexistence: boolean; history_status: string | null;
                created_at?: string; last_in?: string | null }[];
  events: { status: string; n: number; newest: string }[];
  daily: { day: string; in: number; out: number; itaos?: number }[];
  counts: Record<string, number>;
  kito: { asks_30d: number; input_tokens_30d: number; output_tokens_30d: number; errors_30d: number;
          runs: { ran_at: string; trigger: string; checked: number; failed: number; remaining: number }[];
          reads_24h?: number; fails_24h?: number; behind?: number };
  audit: { at: string; action: string; actor: string | null; details: unknown }[];
  // 0023
  msg_origins?: Record<string, number>;
  sales?: { revenue_30d: number; revenue_total: number; last_paid_at: string | null;
            by_source: { from: string; status: string; n: number; amount: number | null }[] };
  media?: { saved: number; receipts: number; errors: number; last_at: string | null };
  deletions?: { at: string; via: string; chats: number; messages: number; by_origin: Record<string, number>; orders_unlinked: number; by: string | null }[];
  imports?: { at: string; kind: string; created: number; skipped: number; rejected: number }[];
};
export type Staff = { email: string; added_at: string; last_sign_in_at: string | null; is_me: boolean };
export type Tone = 'ok' | 'warn' | 'bad' | 'idle';
export type Health = { tone: Tone; text: string };
export type View = 'today' | 'workspaces' | 'performance' | 'usage' | 'quality' | 'errors' | 'audit' | 'staff';
export const nf = new Intl.NumberFormat('en-US');
export const fmt = (v: number | null | undefined) => (v == null ? '–' : nf.format(v));
export const TZ = 'Africa/Dar_es_Salaam';

export function ago(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  if (d < 30) return d === 1 ? 'yesterday' : `${d} days ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: TZ });
}
export const stamp = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-GB', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }) : '';
export const hoursSince = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 3.6e6 : Infinity);
export const plural = (n: number, one: string, many = one + 's') => `${fmt(n)} ${n === 1 ? one : many}`;
export const money = (v: number | null | undefined, cur: string | null | undefined) =>
  v == null ? '–' : `${cur === 'USD' ? '$' : (cur ?? '') + ' '}${nf.format(Math.round(v))}`;
export const short = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}k` : nf.format(Math.round(v)));
export function revenueText(r: Record<string, number> | undefined): string {
  if (!r) return '–';
  const e = Object.entries(r).filter(([, v]) => v);
  if (e.length === 0) return '0';
  return e.map(([c, v]) => `${c === 'USD' ? '$' : c + ' '}${short(v)}`).join(' + ');
}

export const TILE = ['#16224A', '#2F6B5E', '#7A4E2D', '#5B3E8C', '#2C5A8C', '#8C3B4E'];
export function tileColor(id: string) { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return TILE[h % TILE.length]; }
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';

export function healthOf(w: WsRow): Health {
  if (w.status === 'suspended') return { tone: 'idle', text: 'Suspended: the owner sees a paused screen' };
  if (w.members === 0) return { tone: 'warn', text: 'No owner: sign-up never finished' };
  if (w.failed_events > 0) return { tone: 'bad', text: `${plural(w.failed_events, 'WhatsApp event')} failed to process` };
  if ((w.stuck_events ?? 0) > 0) return { tone: 'bad', text: `${plural(w.stuck_events!, 'WhatsApp event')} stuck mid-processing` };
  if (w.last_error) return { tone: 'bad', text: w.last_error };
  if (w.wa_status && w.wa_status !== 'active') return { tone: 'bad', text: `WhatsApp connection is ${w.wa_status}` };
  if (w.meta_status && w.meta_status !== 'active') return { tone: 'bad', text: `Meta Ads connection is ${w.meta_status}` };
  if (!w.wa_status && !w.meta_status && w.messages === 0) return { tone: 'idle', text: 'Nothing connected yet' };
  if (w.meta_status === 'active' && hoursSince(w.meta_last_sync) > 26) return { tone: 'warn', text: `Ads haven't synced since ${ago(w.meta_last_sync)}` };
  const lastIn = w.last_customer_message_at ?? w.last_message_at;
  if (w.wa_status === 'active' && hoursSince(lastIn) > 72) return { tone: 'warn', text: `No customer messages since ${ago(lastIn)}` };
  if (!w.wa_status && w.messages > 0) return { tone: 'warn', text: "WhatsApp isn't live, only imported chats" };
  if ((w.kito_behind ?? 0) >= 25) return { tone: 'warn', text: `Kito is behind: ${plural(w.kito_behind!, 'chat')} with new messages not read yet` };
  return { tone: 'ok', text: 'Running normally' };
}

export const liveChats = (w: WsRow) => w.live_chats ?? w.conversations;
export const viaName = (v: string | null | undefined) => (v === 'dualhook' ? 'Dualhook' : v === '360dialog' ? '360dialog' : 'Meta');

// Same order an owner follows on the Connections page today: WhatsApp first (Dualhook), then ads.
export const STEPS: { key: string; label: string; done: (w: WsRow) => boolean; hint: string }[] = [
  { key: 'wa', label: 'Go live on WhatsApp', done: (w) => w.wa_status === 'active', hint: 'Number connected (Dualhook, Coexistence)' },
  { key: 'chat', label: 'First live chat', done: (w) => liveChats(w) > 0, hint: 'A real customer chat arrived on WhatsApp' },
  { key: 'rules', label: 'Chat rules set', done: (w) => !!w.rules_set, hint: "Owner saved Settings → How itaOS reads your chats (their ad message, after-payment message, ✅ on or off)" },
  { key: 'meta', label: 'Connect Meta Ads', done: (w) => w.meta_status === 'active', hint: 'Ad account linked and syncing' },
  { key: 'sale', label: 'First recorded sale', done: (w) => w.orders > 0, hint: 'A paid order: ✅ message, Kito, or recorded' },
];
// Extras shown in the drawer: not part of the board, but things an owner can still be missing.
export const EXTRAS: { label: string; done: (w: WsRow) => boolean; hint: string }[] = [
  { label: 'Can reply from itaOS', done: (w) => w.wa_status === 'active' && !!w.send_key && w.send_enabled !== false, hint: 'Dualhook API key saved and sending switched on' },
  { label: 'Dashboard numbers set', done: (w) => (w.settings_missing ?? []).length === 0, hint: 'Exchange rate and cost per order, so ROAS and profit show' },
];
export const stuckAt = (w: WsRow) => { const i = STEPS.findIndex((s) => !s.done(w)); return i === -1 ? STEPS.length : i; };

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
  return { data, error, loading };
}

export const ACTION: Record<string, string> = {
  set_state: 'Changed account settings', set_ai_limit: 'Changed a business AI limit', dualhook_create_webhook: 'Made a Dualhook webhook URL', dualhook_rotate_webhook: 'Replaced a Dualhook webhook URL', dualhook_set_key: 'Saved a Dualhook API key', dualhook_fetch_images: 'Fetched missed images and voice notes', requeue_events: 'Retried failed WhatsApp events', set_send: 'Changed replying from itaOS',
  delete_workspace: 'Deleted a business', add_staff: 'Added a staff member', remove_staff: 'Removed a staff member',
  set_api_price: 'Changed an AI model price', set_api_budget: 'Changed the AI budget', add_task: 'Added a staff follow-up',
  task_done: 'Completed a staff follow-up', task_reopened: 'Reopened a staff follow-up',
  staff_access_changed: 'Changed staff access',
};
export function describe(action: string, d: any): string {
  if (action === 'set_state' && d?.after) {
    const b = d.before ?? { status: 'active', plan: 'pilot', note: null };
    const parts: string[] = [];
    if (b.status !== d.after.status) parts.push(`status ${b.status} → ${d.after.status}`);
    if ((b.plan ?? 'pilot') !== (d.after.plan || 'pilot')) parts.push(`plan ${b.plan ?? 'pilot'} → ${d.after.plan}`);
    if ((b.note ?? '') !== (d.after.note ?? '')) parts.push('note updated');
    return parts.join(', ') || 'no change';
  }
  if (action === 'requeue_events') return `${d?.requeued ?? 0} sent back to the queue`;
  if (action === 'set_send') return d?.after ? 'switched on' : 'switched off';
  if (action === 'delete_workspace') return `${d?.name ?? 'business'}: ${fmt(d?.chats ?? 0)} chats, ${fmt(d?.messages ?? 0)} messages, ${fmt(d?.orders ?? 0)} orders removed`;
  if (action === 'add_staff' || action === 'remove_staff') return d?.email ?? '';
  if (action === 'set_api_price') return `${d?.model}: $${d?.after?.input} in / $${d?.after?.output} out per million tokens`;
  if (action === 'set_api_budget') return `monthly ${d?.after?.monthly_usd != null ? '$' + d.after.monthly_usd : 'none'}, daily alert ${d?.after?.daily_usd != null ? '$' + d.after.daily_usd : 'none'}`;
  if (action === 'add_task' || action === 'task_done' || action === 'task_reopened') return d?.title ?? '';
  if (action === 'staff_access_changed') return [d?.added && `added ${d.added}`, d?.removed && `removed ${d.removed}`, d?.by && `by ${d.by}`].filter(Boolean).join(', ');
  if (action === 'dualhook_fetch_images' || action === 'dualhook_set_key') return d?.images_saved != null ? `${fmt(d.images_saved)} saved${d.images_failed ? `, ${fmt(d.images_failed)} failed` : ''}` : '';
  // Anything else: plain "key: value" words instead of raw JSON.
  if (!d || typeof d !== 'object') return d == null ? '' : String(d);
  return Object.entries(d).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
}

export const ORIGIN: Record<string, string> = {
  history: 'WhatsApp history sync', webhook: 'Live from customers', app_echo: 'Sent from the WhatsApp app',
  itaos: 'Replies sent from itaOS', import: 'Uploaded chat files', api: 'Sent through the API', unknown: 'Unknown',
};
export const ORDER_FROM: Record<string, string> = {
  tick: 'Owner’s ✅ message', kito: 'Kito (from a screenshot or chat)', rules: 'Payment words in the chat',
  name_mark: 'Name marked in WhatsApp', import: 'Imported file', manual: 'Recorded by hand',
};

export const sv = (d: string) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
export const ICON = {
  today: sv('M4 13h4l2-6 4 12 2-6h4'),
  ws: sv('M4 7h16M4 12h16M4 17h10'),
  err: sv('M12 8v5M12 16.5v.5M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z'),
  audit: sv('M12 7v5l3 2M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9Z'),
  refresh: sv('M20 11a8 8 0 0 0-14.9-3.5M4 4v4h4M4 13a8 8 0 0 0 14.9 3.5M20 20v-4h-4'),
  search: sv('m20 20-4-4m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z'),
  close: sv('M6 6l12 12M18 6 6 18'),
  perf: sv('M4 20V10M10 20V4M16 20v-7M22 20H2'),
  usage: sv('M12 3v18M17 7.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.6 5 3 5 1.4 5 3.3-2.2 3.2-5 3.2-5-1.3-5-3.2'),
  quality: sv('M9 12l2 2 4-4M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6Z'),
  more: <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>,
  staff: sv('M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM21 19v-1a4 4 0 0 0-3-3.9M15 4.1a3 3 0 0 1 0 5.8'),
};

/* ================= styles ================= */
