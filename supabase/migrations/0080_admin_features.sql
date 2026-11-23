-- 23 Nov 2026 — Admin catches up with the business app.
--
-- The business side gained a lot between 18 and 23 Nov (Today, Send from itaOS + templates after 24 h,
-- Money itaOS brought back, Ad money manager, Check your M-Pesa, Receipt QR codes, My products, reorders,
-- the three guards…) but /admin only showed messages, connections, sales and Kito. This adds:
--
--  1. admin_feature_use(ws | null): per business, whether each feature is set up and being used, with the
--     one number that says so. With null it returns every business (the "Features in use" grid);
--     with an id, one business (the drawer section). Counts and labels only: no message text, names or numbers.
--  2. admin_add_member / admin_remove_member: Pondi staff add a business's staff by the email they signed
--     up with (the business app has no invite screen yet). The last owner can't be removed. Audited.

create or replace function public.admin_feature_use(p_ws uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', w.id, 'name', w.name,
    -- Actions: follow-ups done in 30 days, and paid sales within 14 days after one (not proof, a journey)
    'followups_30d', (select count(*) from follow_up_tasks t where t.workspace_id = w.id and t.status = 'done' and t.completed_at > now() - interval '30 days'),
    'sales_after_followup_30d', (select count(distinct o.id) from orders o join follow_up_tasks t on t.conversation_id = o.conversation_id
        where o.workspace_id = w.id and o.status = 'paid' and o.paid_at > now() - interval '30 days' and t.status = 'done'
          and t.completed_at < o.paid_at and t.completed_at > o.paid_at - interval '14 days'),
    'promises', (select jsonb_build_object('proposed', count(*) filter (where status = 'proposed'), 'open', count(*) filter (where status in ('open', 'snoozed')),
                   'overdue', count(*) filter (where status = 'open' and coalesce(promise_at, due_at) < now()))
                 from follow_up_tasks where workspace_id = w.id and source = 'kito_promise'),
    'reorder_on', coalesce(w.rebuy_enabled, false),
    'reorder_marks_30d', (select count(*) from rebuy_marks where workspace_id = w.id and marked_at > now() - interval '30 days'),
    -- Sending
    'send_on', coalesce(w.send_enabled, true) and not coalesce((select send_blocked from workspace_admin_state where workspace_id = w.id), false),
    'itaos_sent_30d', (select count(*) from messages where workspace_id = w.id and origin = 'itaos' and sent_at > now() - interval '30 days'),
    'templates', coalesce((select jsonb_object_agg(lower(status), n) from (select status, count(*) n from wa_templates where workspace_id = w.id group by status) x), '{}'::jsonb),
    -- Money
    'products', (select jsonb_build_object('active', count(*) filter (where active), 'priced', count(*) filter (where active and price > 0), 'costed', count(*) filter (where active and cost > 0))
                 from products where workspace_id = w.id),
    'unit_cost_set', w.unit_cost is not null,
    'receipt_links', (select count(*) from private.receipt_links rl join orders o on o.id = rl.order_id where o.workspace_id = w.id),
    'receipt_scans_30d', (select coalesce(sum(rl.scans), 0) from private.receipt_links rl join orders o on o.id = rl.order_id where o.workspace_id = w.id and rl.last_scan_at > now() - interval '30 days'),
    'wallet', (select jsonb_build_object('lines', count(*), 'last_upload', max(created_at),
                 'not_recorded', count(*) filter (where not dismissed and not exists (
                    select 1 from orders o where o.workspace_id = w.id and o.status = 'paid'
                      and (upper(coalesce(o.payment_ref, '')) = upper(l.txn_id) or o.external_ref = 'wallet:' || l.txn_id))))
               from wallet_lines l where l.workspace_id = w.id),
    -- Ads
    'ads', (select jsonb_build_object('running', count(*) filter (where effective_status = 'ACTIVE'), 'all', count(*)) from ads where workspace_id = w.id),
    'ad_spend_14d', (select coalesce(sum(spend), 0) from ad_insights_daily where workspace_id = w.id and day > current_date - 14),
    'ad_last_day', (select max(day) from ad_insights_daily where workspace_id = w.id),
    -- Guards (0079)
    'pay_receivers', coalesce(cardinality(w.pay_receivers), 0),
    'screenshots_30d', (select count(*) from messages where workspace_id = w.id and (media->'receipt'->>'is_receipt') = 'true' and sent_at > now() - interval '30 days'),
    'payments_to_check', (select count(*) from public._payment_rows(w.id, now() - interval '30 days') p where p.severity <> 'ok' and p.verdict is null),
    'fakes_caught', (select count(*) from guard_reviews where workspace_id = w.id and kind = 'payment' and verdict = 'fake'),
    'team', (select count(*) from memberships where workspace_id = w.id),
    'assigned_30d', (select count(*) from conversations where workspace_id = w.id and assigned_to is not null and last_message_at > now() - interval '30 days'),
    -- App and health
    'push_devices', (select count(*) from push_subscriptions where workspace_id = w.id and coalesce(fail_count, 0) < 3),
    'alerts_open', (select count(*) from connection_alerts where workspace_id = w.id and resolved_at is null),
    'voice_30d', (select count(*) from messages where workspace_id = w.id and type = 'audio' and media ? 'path' and sent_at > now() - interval '30 days'),
    'kito_read_30d', (select count(*) from conversations where workspace_id = w.id and kito_checked_at > now() - interval '30 days'),
    'rules_reviewed_at', w.rules_reviewed_at,
    'branded', w.brand_color is not null or w.brand_logo is not null,
    'proof_test', (select holdout_pct from workspace_admin_state where workspace_id = w.id)
  ) order by w.created_at), '[]'::jsonb) into res
  from workspaces w where p_ws is null or w.id = p_ws;
  return res;
end $$;
revoke all on function public.admin_feature_use(uuid) from public, anon;
grant execute on function public.admin_feature_use(uuid) to authenticated;

create or replace function public.admin_add_member(p_ws uuid, p_email text, p_role text default 'analyst')
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_before text;
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_role not in ('owner', 'admin', 'analyst', 'viewer') then raise exception 'unknown role'; end if;
  if not exists (select 1 from workspaces where id = p_ws) then raise exception 'no such workspace'; end if;
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null then raise exception 'No itaOS account uses that email yet. Ask them to sign up at itaos.app first.'; end if;
  select role into v_before from memberships where workspace_id = p_ws and user_id = v_user;
  if v_before = 'owner' and p_role <> 'owner' and (select count(*) from memberships where workspace_id = p_ws and role = 'owner') = 1 then
    raise exception 'This is the only owner. Make someone else owner first.';
  end if;
  insert into memberships (workspace_id, user_id, role) values (p_ws, v_user, p_role)
  on conflict (workspace_id, user_id) do update set role = excluded.role;
  insert into admin_audit (actor, action, workspace_id, details)
  values (auth.uid(), 'add_member', p_ws, jsonb_build_object('email', lower(btrim(p_email)), 'before', v_before, 'role', p_role));
end $$;
revoke all on function public.admin_add_member(uuid, text, text) from public, anon;
grant execute on function public.admin_add_member(uuid, text, text) to authenticated;

create or replace function public.admin_remove_member(p_ws uuid, p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_role text;
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select m.user_id, m.role into v_user, v_role from memberships m join auth.users u on u.id = m.user_id
   where m.workspace_id = p_ws and lower(u.email) = lower(btrim(p_email));
  if v_user is null then raise exception 'That person is not in this business.'; end if;
  if v_role = 'owner' and (select count(*) from memberships where workspace_id = p_ws and role = 'owner') = 1 then
    raise exception 'This is the only owner. Make someone else owner first.';
  end if;
  delete from memberships where workspace_id = p_ws and user_id = v_user;
  update conversations set assigned_to = null where workspace_id = p_ws and assigned_to = v_user;
  insert into admin_audit (actor, action, workspace_id, details)
  values (auth.uid(), 'remove_member', p_ws, jsonb_build_object('email', lower(btrim(p_email)), 'role', v_role));
end $$;
revoke all on function public.admin_remove_member(uuid, text) from public, anon;
grant execute on function public.admin_remove_member(uuid, text) to authenticated;
