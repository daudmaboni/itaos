-- 0067_staff_send_block — Pondi staff's "Reply from itaOS" switch can no longer be undone by the business (22 Nov 2026).
--
-- Before: staff and the owner flipped the same column, public.workspaces.send_enabled. Owners and admins may update
-- any column of their own workspace row, so a business that staff switched off could switch itself straight back on
-- (from Settings, or with one direct API call).
-- Now there are two separate switches, and sending works only when both allow it:
--   workspaces.send_enabled            — the owner's own choice (Settings). Unchanged.
--   workspace_admin_state.send_blocked — staff only. That table is closed to every signed-in user, so no request
--                                         from the business can change it. Set by admin_set_send_enabled.

alter table public.workspace_admin_state
  add column if not exists send_blocked boolean not null default false;
comment on column public.workspace_admin_state.send_blocked is
  'Pondi staff turned off replying from itaOS for this business. The business cannot change it.';

-- Carry over: businesses whose last staff action was "switch off", and that are still off, become staff-blocked.
insert into public.workspace_admin_state(workspace_id, send_blocked)
select w.id, true
  from public.workspaces w
 where w.send_enabled = false
   and (select (a.details->>'after')::boolean from public.admin_audit a
         where a.workspace_id = w.id and a.action = 'set_send' order by a.at desc limit 1) = false
on conflict (workspace_id) do update set send_blocked = true;

-- Staff switch: now writes the staff-only column and leaves the owner's own switch alone.
create or replace function public.admin_set_send_enabled(p_ws uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare before boolean;
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from workspaces where id = p_ws) then raise exception 'no such workspace'; end if;
  select not coalesce(send_blocked, false) into before from workspace_admin_state where workspace_id = p_ws;
  insert into workspace_admin_state(workspace_id, send_blocked, updated_by, updated_at)
  values (p_ws, not p_on, auth.uid(), now())
  on conflict (workspace_id) do update set send_blocked = not p_on, updated_by = auth.uid(), updated_at = now();
  insert into admin_audit(actor, action, workspace_id, details)
  values (auth.uid(), 'set_send_block', p_ws, jsonb_build_object('before', coalesce(before, true), 'after', p_on));
end $$;

-- Members can see whether staff switched sending off (to explain it in the app). Read only.
create or replace function public.send_blocked_by_staff(p_ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case when public.is_member(p_ws)
              then coalesce((select send_blocked from workspace_admin_state where workspace_id = p_ws), false) end;
$$;
revoke all on function public.send_blocked_by_staff(uuid) from public, anon;
grant execute on function public.send_blocked_by_staff(uuid) to authenticated, service_role;

-- Staff detail: report both switches. ('send_enabled' = the owner's switch, 'send_blocked' = staff's.)
create or replace function public.admin_workspace_detail(p_ws uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select jsonb_build_object(
    'workspace', (select jsonb_build_object('id', w.id, 'name', w.name, 'created_at', w.created_at,
                    'currency', w.currency, 'timezone', w.timezone, 'language', w.language,
                    'fx_rate', w.fx_rate, 'unit_cost', w.unit_cost, 'follow_up_hours', w.follow_up_hours,
                    'send_enabled', w.send_enabled, 'send_blocked', coalesce(s.send_blocked, false), 'status', coalesce(s.status,'active'),
                    'plan', coalesce(s.plan,'pilot'), 'note', s.note, 'state_updated_at', s.updated_at)
                  from workspaces w left join workspace_admin_state s on s.workspace_id = w.id where w.id = p_ws),
    'members', coalesce((select jsonb_agg(jsonb_build_object('email', u.email, 'role', m.role,
                    'joined', m.created_at, 'last_sign_in_at', u.last_sign_in_at) order by m.created_at)
                  from memberships m join auth.users u on u.id = m.user_id where m.workspace_id = p_ws), '[]'),
    'connections', coalesce((select jsonb_agg(jsonb_build_object('provider', c.provider, 'label', c.label,
                    'external_id', c.external_id, 'status', c.status, 'last_sync_at', c.last_sync_at,
                    'last_error', c.last_error, 'created_at', c.created_at,
                    'via', coalesce(c.meta->>'via', case when c.provider = 'whatsapp' then 'meta' end),
                    'send_key', c.meta ? 'api_key_secret_id', 'send_key_set_at', c.meta->>'api_key_set_at',
                    'webhook_set_at', c.meta->>'webhook_set_at') order by c.created_at)
                  from connections c where c.workspace_id = p_ws), '[]'),
    'wa_numbers', coalesce((select jsonb_agg(jsonb_build_object('display_phone', n.display_phone,
                    'phone_number_id', n.phone_number_id, 'waba_id', n.waba_id, 'coexistence', n.coexistence,
                    'history_status', n.history_status, 'created_at', n.created_at,
                    'last_in', (select max(x.sent_at) from messages x join conversations c on c.id = x.conversation_id
                                 where c.workspace_id = p_ws and c.phone_number_id = n.phone_number_id
                                   and x.direction = 'in' and x.sent_at > now() - interval '30 days')))
                  from wa_numbers n where n.workspace_id = p_ws), '[]'),
    'events', coalesce((select jsonb_agg(jsonb_build_object('status', e.status, 'n', e.n, 'newest', e.newest))
                  from (select case when status = 'processing' and processed_at is null
                                     and coalesce(last_attempt_at, received_at) < now() - interval '15 minutes'
                                    then 'stuck' else status end as status,
                               count(*) n, max(received_at) newest from raw_events
                        where workspace_id = p_ws group by 1) e), '[]'),
    'daily', (with days as (select g::date d from generate_series(current_date - 13, current_date, interval '1 day') g),
                   m as (select (sent_at at time zone 'Africa/Dar_es_Salaam')::date d,
                                count(*) filter (where direction = 'in') i,
                                count(*) filter (where direction = 'out') o,
                                count(*) filter (where origin = 'itaos') s
                           from messages where workspace_id = p_ws and sent_at >= current_date - 14 group by 1)
              select jsonb_agg(jsonb_build_object('day', days.d, 'in', coalesce(m.i,0), 'out', coalesce(m.o,0), 'itaos', coalesce(m.s,0)) order by days.d)
              from days left join m on m.d = days.d),
    'counts', jsonb_build_object(
        'contacts',      (select count(*) from contacts where workspace_id = p_ws),
        'conversations', (select count(*) from conversations where workspace_id = p_ws),
        'live_chats',    (select count(*) from conversations where workspace_id = p_ws and phone_number_id <> 'import'),
        'imported_chats',(select count(*) from conversations where workspace_id = p_ws and phone_number_id = 'import'),
        'messages',      (select count(*) from messages where workspace_id = p_ws),
        'ads',           (select count(*) from ads where workspace_id = p_ws),
        'insight_days',  (select count(*) from ad_insights_daily where workspace_id = p_ws),
        'orders',        (select count(*) from orders where workspace_id = p_ws and status = 'paid'),
        'expenses',      (select count(*) from expenses where workspace_id = p_ws),
        'open_tasks',    (select count(*) from follow_up_tasks where workspace_id = p_ws and status = 'open'),
        'content_ideas', (select count(*) from content_ideas where workspace_id = p_ws),
        'kito_tagged',   (select count(*) from conversations where workspace_id = p_ws and kito_checked_at is not null)),
    'msg_origins', coalesce((select jsonb_object_agg(coalesce(origin, 'unknown'), n)
                  from (select origin, count(*) n from messages where workspace_id = p_ws group by 1) x), '{}'),
    'sales', jsonb_build_object(
        'revenue_30d', (select coalesce(sum(amount - discount - refund_amount), 0) from orders
                          where workspace_id = p_ws and status = 'paid' and paid_at > now() - interval '30 days'),
        'revenue_total', (select coalesce(sum(amount - discount - refund_amount), 0) from orders where workspace_id = p_ws and status = 'paid'),
        'last_paid_at', (select max(paid_at) from orders where workspace_id = p_ws and status = 'paid'),
        'by_source', coalesce((select jsonb_agg(jsonb_build_object('from', src, 'status', status, 'n', n, 'amount', amt) order by n desc)
                  from (select coalesce(inferred_from, case when import_batch_id is not null then 'import' else 'manual' end) src,
                               status, count(*) n, sum(amount - discount - refund_amount) amt
                          from orders where workspace_id = p_ws group by 1, 2) x), '[]')),
    'media', (select jsonb_build_object('saved', count(*) filter (where media ? 'path'),
                                        'receipts', count(*) filter (where media->'receipt'->>'is_receipt' = 'true'),
                                        'errors', count(*) filter (where media ? 'error' and media->>'error' is not null),
                                        'last_at', max(sent_at))
              from messages where workspace_id = p_ws and media is not null),
    'kito', jsonb_build_object(
        'asks_30d',      (select count(*) from kito_asks where workspace_id = p_ws and created_at > now() - interval '30 days'),
        'input_tokens_30d',  (select coalesce(sum(input_tokens),0) from kito_asks where workspace_id = p_ws and created_at > now() - interval '30 days'),
        'output_tokens_30d', (select coalesce(sum(output_tokens),0) from kito_asks where workspace_id = p_ws and created_at > now() - interval '30 days'),
        'errors_30d',    (select count(*) from kito_asks where workspace_id = p_ws and error is not null and created_at > now() - interval '30 days'),
        'reads_24h',     (select coalesce(sum(checked), 0) from kito_runs where workspace_id = p_ws and ran_at > now() - interval '24 hours'),
        'fails_24h',     (select coalesce(sum(failed), 0) from kito_runs where workspace_id = p_ws and ran_at > now() - interval '24 hours'),
        'behind',        (select count(*) from conversations c where c.workspace_id = p_ws and c.phone_number_id <> 'import'
                            and c.last_message_at > now() - interval '7 days'
                            and (c.kito_checked_at is null or c.kito_checked_at < c.last_message_at)),
        'runs', coalesce((select jsonb_agg(jsonb_build_object('ran_at', kr.ran_at, 'trigger', kr.trigger,
                    'checked', kr.checked, 'failed', kr.failed, 'remaining', kr.remaining) order by kr.ran_at desc)
                  from (select * from kito_runs where workspace_id = p_ws order by ran_at desc limit 6) kr), '[]')),
    'deletions', coalesce((select jsonb_agg(jsonb_build_object('at', d.created_at, 'via', d.via, 'chats', d.chats,
                    'messages', d.messages, 'by_origin', d.by_origin, 'orders_unlinked', d.orders_unlinked, 'by', u.email)
                    order by d.created_at desc)
                  from (select * from chat_deletions where workspace_id = p_ws order by created_at desc limit 10) d
                  left join auth.users u on u.id = d.user_id), '[]'),
    'imports', coalesce((select jsonb_agg(jsonb_build_object('at', b.created_at, 'kind', b.kind, 'created', b.created_count,
                    'skipped', b.skipped_count, 'rejected', b.rejected_count) order by b.created_at desc)
                  from (select * from import_batches where workspace_id = p_ws order by created_at desc limit 5) b), '[]'),
    'audit', coalesce((select jsonb_agg(jsonb_build_object('at', a.at, 'action', a.action,
                    'actor', u.email, 'details', a.details) order by a.at desc)
                  from (select * from admin_audit where workspace_id = p_ws order by at desc limit 20) a
                  left join auth.users u on u.id = a.actor), '[]')
  ) into r;
  return r;
end $$;

-- Staff list / setup board: "can send" now means the owner has it on AND staff have not blocked it.
drop function if exists public.admin_workspaces();
create function public.admin_workspaces()
returns table(
  id uuid, name text, created_at timestamptz, status text, plan text, note text,
  owner_email text, owner_last_sign_in timestamptz, members int,
  wa_status text, wa_last_sync timestamptz, wa_via text, wa_phone text, send_enabled boolean, send_key boolean,
  meta_status text, meta_last_sync timestamptz, last_error text,
  messages bigint, messages_7d bigint, last_message_at timestamptz, last_customer_message_at timestamptz,
  conversations bigint, live_chats bigint, imported_chats bigint, sent_itaos_30d bigint, receipts_30d bigint,
  orders bigint, tick_orders bigint, revenue_30d numeric, revenue_total numeric, currency text,
  spend_30d numeric, spend_currency text, kito_asks_30d bigint, kito_tokens_30d bigint,
  kito_last_run timestamptz, kito_behind bigint,
  failed_events bigint, pending_events bigint, stuck_events bigint, settings_missing text[],
  rules_set boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select w.id, w.name, w.created_at,
         coalesce(s.status, 'active'), coalesce(s.plan, 'pilot'), s.note,
         o.email::text, o.last_sign_in_at,
         (select count(*)::int from memberships m where m.workspace_id = w.id),
         wa.status, wa.last_sync_at, coalesce(wa.meta->>'via', case when wa.id is not null then 'meta' end),
         (select n.display_phone from wa_numbers n where n.workspace_id = w.id order by n.created_at desc limit 1),
         (w.send_enabled and not coalesce(s.send_blocked, false)), (wa.meta ? 'api_key_secret_id'),
         ma.status, ma.last_sync_at,
         coalesce(wa.last_error, ma.last_error),
         (select count(*) from messages x where x.workspace_id = w.id),
         (select count(*) from messages x where x.workspace_id = w.id and x.sent_at > now() - interval '7 days'),
         (select max(c.last_message_at) from conversations c where c.workspace_id = w.id),
         (select x.sent_at from messages x where x.workspace_id = w.id and x.direction = 'in' order by x.sent_at desc limit 1),
         cv.total, cv.live, cv.imported,
         (select count(*) from messages x where x.workspace_id = w.id and x.origin = 'itaos' and x.sent_at > now() - interval '30 days'),
         (select count(*) from messages x where x.workspace_id = w.id and x.media is not null
             and x.media->'receipt'->>'is_receipt' = 'true' and x.sent_at > now() - interval '30 days'),
         od.paid, od.tick, od.rev_30d, od.rev_total, w.currency,
         sp.spend, sp.currency,
         ka.n, ka.tokens,
         (select max(kr.ran_at) from kito_runs kr where kr.workspace_id = w.id),
         (select count(*) from conversations c where c.workspace_id = w.id and c.phone_number_id <> 'import'
             and c.last_message_at > now() - interval '7 days'
             and (c.kito_checked_at is null or c.kito_checked_at < c.last_message_at)),
         (select count(*) from raw_events r where r.workspace_id = w.id and r.processed_at is null
             and (r.status = 'failed' or r.attempts >= r.max_attempts)),
         (select count(*) from raw_events r where r.workspace_id = w.id and r.status = 'pending'),
         (select count(*) from raw_events r where r.workspace_id = w.id and r.processed_at is null and r.status = 'processing'
             and coalesce(r.last_attempt_at, r.received_at) < now() - interval '15 minutes'),
         array_remove(array[
           case when ma.id is not null and w.fx_rate is null and coalesce(sp.currency, 'USD') <> w.currency then 'exchange rate' end,
           case when w.unit_cost is null then 'cost per order' end], null),
         -- 0059: the business's chat rules were saved or filled in (setup board step)
         (w.rules_reviewed_at is not null)
  from workspaces w
  left join workspace_admin_state s on s.workspace_id = w.id
  left join lateral (
    select u.email, u.last_sign_in_at from memberships m join auth.users u on u.id = m.user_id
    where m.workspace_id = w.id and m.role = 'owner' order by m.created_at limit 1) o on true
  left join lateral (
    select c.id, c.status, c.last_sync_at, c.last_error, c.meta from connections c
    where c.workspace_id = w.id and c.provider = 'whatsapp' order by c.created_at desc limit 1) wa on true
  left join lateral (
    select c.id, c.status, c.last_sync_at, c.last_error from connections c
    where c.workspace_id = w.id and c.provider = 'meta_ads' order by c.created_at desc limit 1) ma on true
  left join lateral (
    select count(*) total,
           count(*) filter (where c.phone_number_id <> 'import') live,
           count(*) filter (where c.phone_number_id = 'import') imported
    from conversations c where c.workspace_id = w.id) cv on true
  left join lateral (
    select count(*) filter (where x.status = 'paid') paid,
           count(*) filter (where x.status = 'paid' and x.inferred_from = 'tick') tick,
           coalesce(sum(x.amount - x.discount - x.refund_amount) filter (where x.status = 'paid' and x.paid_at > now() - interval '30 days'), 0) rev_30d,
           coalesce(sum(x.amount - x.discount - x.refund_amount) filter (where x.status = 'paid'), 0) rev_total
    from orders x where x.workspace_id = w.id) od on true
  left join lateral (
    select sum(a.spend) as spend, min(a.currency) as currency from ad_insights_daily a
    where a.workspace_id = w.id and a.day > current_date - 30) sp on true
  left join lateral (
    select count(*) as n,
           coalesce(sum(coalesce(k.input_tokens,0) + coalesce(k.output_tokens,0)),0)::bigint as tokens
    from kito_asks k where k.workspace_id = w.id and k.created_at > now() - interval '30 days') ka on true
  order by w.created_at desc;
end $$;
revoke all on function public.admin_workspaces() from public, anon;
grant execute on function public.admin_workspaces() to authenticated, service_role;
