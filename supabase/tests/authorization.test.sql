-- Workspace isolation, roles, orders audit, webhook retry limits. Runs after all migrations
-- on the local test cluster (see run.sh). Every check raises on failure.
\set ON_ERROR_STOP on
\t on
\pset footer off
begin;

create schema t;
grant usage on schema t to anon, authenticated, service_role;
create function t.as_user(uid uuid, r text default 'authenticated') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  execute format('set local role %I', r);
end $$;
-- Run a statement as a user; returns the affected/returned row count. Errors propagate.
create function t.run(sql text, uid uuid, r text default 'authenticated') returns bigint language plpgsql as $$
declare n bigint;
begin
  perform t.as_user(uid, r);
  if sql ~* '^\s*select' then execute 'select count(*) from (' || sql || ') q' into n;
  else execute sql; get diagnostics n = row_count; end if;
  reset role;
  return n;
end $$;
-- Expect an error (RLS with-check, grants, constraints, triggers).
create function t.denied(label text, sql text, uid uuid, r text default 'authenticated') returns void language plpgsql as $$
begin
  begin
    perform t.run(sql, uid, r);
  exception when others then
    reset role; raise notice 'ok (denied): % [%]', label, sqlerrm; return;
  end;
  raise exception 'FAIL: % should have been denied', label;
end $$;
create function t.rows(label text, sql text, expected bigint, uid uuid, r text default 'authenticated') returns void language plpgsql as $$
declare n bigint;
begin
  n := t.run(sql, uid, r);
  if n <> expected then raise exception 'FAIL: % expected % rows, got %', label, expected, n; end if;
  raise notice 'ok: % (% rows)', label, n;
end $$;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- ---------- fixtures ----------
insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner-a@test'),
  ('00000000-0000-0000-0000-00000000000b', 'owner-b@test'),
  ('00000000-0000-0000-0000-0000000000a2', 'viewer-a@test');
insert into public.workspaces(id, name, currency) values
  ('10000000-0000-0000-0000-00000000000a', 'A', 'TZS'),
  ('10000000-0000-0000-0000-00000000000b', 'B', 'TZS');
insert into public.memberships(workspace_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'owner'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'viewer'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'owner');
insert into public.contacts(id, workspace_id, wa_id, name) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '255700000001', 'Cust A'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', '255700000001', 'Cust B');
insert into public.conversations(id, workspace_id, contact_id, phone_number_id, started_at, last_message_at, payment_signal, ad_id, source) values
  ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', 'pn', now() - interval '10 days', now() - interval '9 days', true, 'ad1', 'ad'),
  ('30000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', 'pn', now() - interval '10 days', now() - interval '9 days', false, null, 'unknown');
insert into public.ad_insights_daily(workspace_id, ad_id, day, spend) values ('10000000-0000-0000-0000-00000000000a', 'ad1', (now() - interval '10 days')::date, 1000);

-- ---------- isolation ----------
select t.rows('owner A sees own conversation', $$select * from public.conversation_outcomes$$, 1, '00000000-0000-0000-0000-00000000000a');
select t.rows('owner A cannot see B conversation', $$select * from public.conversations where workspace_id = '10000000-0000-0000-0000-00000000000b'$$, 0, '00000000-0000-0000-0000-00000000000a');
select t.denied('anon cannot read conversations', $$select * from public.conversations$$, null, 'anon');
select t.denied('anon cannot read orders (no grant)', $$select * from public.orders$$, null, 'anon');
select t.rows('non-member gets no ad performance', $$select * from public.ad_performance('10000000-0000-0000-0000-00000000000a', '2000-01-01', '2100-01-01')$$, 0, '00000000-0000-0000-0000-00000000000b');
select t.rows('non-member gets no webhook health', $$select * from public.webhook_health('10000000-0000-0000-0000-00000000000a')$$, 0, '00000000-0000-0000-0000-00000000000b');
select t.rows('non-member gets no member list', $$select * from public.workspace_members('10000000-0000-0000-0000-00000000000a')$$, 0, '00000000-0000-0000-0000-00000000000b');

-- ---------- roles ----------
select t.rows('viewer cannot update workspace settings', $$update public.workspaces set fx_rate = 2600 where id = '10000000-0000-0000-0000-00000000000a'$$, 0, '00000000-0000-0000-0000-0000000000a2');
select t.rows('owner can update workspace settings', $$update public.workspaces set fx_rate = 2600 where id = '10000000-0000-0000-0000-00000000000a'$$, 1, '00000000-0000-0000-0000-00000000000a');
select t.denied('viewer cannot record an order', $$insert into public.orders(workspace_id, conversation_id, amount, currency) values ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', 50000, 'TZS')$$, '00000000-0000-0000-0000-0000000000a2');
select t.denied('viewer cannot create a follow-up task', $$insert into public.follow_up_tasks(workspace_id, conversation_id, title) values ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', 't')$$, '00000000-0000-0000-0000-0000000000a2');
select t.denied('viewer cannot edit the business profile', $$insert into public.business_profiles(workspace_id, tone) values ('10000000-0000-0000-0000-00000000000a', 'warm')$$, '00000000-0000-0000-0000-0000000000a2');

-- ---------- orders: source of truth with audit ----------
select t.denied('owner A cannot record an order in workspace B', $$insert into public.orders(workspace_id, conversation_id, amount, currency) values ('10000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-00000000000b', 50000, 'TZS')$$, '00000000-0000-0000-0000-00000000000a');
select t.denied('owner A cannot link an A order to a B conversation', $$insert into public.orders(workspace_id, conversation_id, amount, currency) values ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000b', 50000, 'TZS')$$, '00000000-0000-0000-0000-00000000000a');
select t.denied('browser cannot claim csv provenance', $$insert into public.orders(workspace_id, conversation_id, amount, currency, provenance) values ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', 50000, 'TZS', 'csv_import')$$, '00000000-0000-0000-0000-00000000000a');
select t.denied('browser cannot claim to be another user', $$insert into public.orders(workspace_id, conversation_id, amount, currency, created_by) values ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', 50000, 'TZS', '00000000-0000-0000-0000-00000000000b')$$, '00000000-0000-0000-0000-00000000000a');

-- An inferred payment signal alone is NOT a sale
select t.rows('payment signal without an order is not a confirmed sale', $$select * from public.conversation_outcomes where sale_amount is not null$$, 0, '00000000-0000-0000-0000-00000000000a');

select t.rows('owner A records a manual order', $$insert into public.orders(id, workspace_id, conversation_id, amount, discount, currency, inferred_from) values ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', 50000, 5000, 'TZS', 'rules')$$, 1, '00000000-0000-0000-0000-00000000000a');
do $$ declare o record; begin
  select * into o from public.orders where id = '40000000-0000-0000-0000-000000000001';
  if o.created_by <> '00000000-0000-0000-0000-00000000000a' then raise exception 'FAIL: created_by not stamped'; end if;
  if o.paid_at is null then raise exception 'FAIL: paid_at not defaulted for paid order'; end if;
  if o.ad_id <> 'ad1' then raise exception 'FAIL: ad_id not copied from chat'; end if;
  if (select count(*) from public.order_events where order_id = o.id and action = 'insert') <> 1 then raise exception 'FAIL: audit insert missing'; end if;
  raise notice 'ok: order stamped and audited';
end $$;
select t.rows('confirmed net revenue appears on the chat', $$select * from public.conversation_outcomes where sale_amount = 45000 and outcome = 'sold' and sale_provenance = 'manual'$$, 1, '00000000-0000-0000-0000-00000000000a');
select t.rows('owner A reverses the order (status change, not delete)', $$update public.orders set status = 'cancelled' where id = '40000000-0000-0000-0000-000000000001'$$, 1, '00000000-0000-0000-0000-00000000000a');
select t.rows('reversed order no longer counts as a sale', $$select * from public.conversation_outcomes where sale_amount is not null$$, 0, '00000000-0000-0000-0000-00000000000a');
select t.denied('browser cannot delete an order', $$delete from public.orders where id = '40000000-0000-0000-0000-000000000001'$$, '00000000-0000-0000-0000-00000000000a');
select t.denied('provenance cannot be rewritten', $$update public.orders set provenance = 'provider' where id = '40000000-0000-0000-0000-000000000001'$$, '00000000-0000-0000-0000-00000000000a');
do $$ begin
  if (select count(*) from public.order_events where order_id = '40000000-0000-0000-0000-000000000001') < 2 then raise exception 'FAIL: audit trail incomplete'; end if;
  if (select count(*) from public.order_events where actor = '00000000-0000-0000-0000-00000000000a') < 2 then raise exception 'FAIL: actor missing in audit'; end if;
end $$;
select t.denied('order_events is append-only for clients', $$delete from public.order_events$$, '00000000-0000-0000-0000-00000000000a');

-- duplicate import reference is rejected (service role writes imports)
select t.rows('service role imports an order with a reference', $$insert into public.orders(workspace_id, amount, currency, provenance, external_ref, paid_at) values ('10000000-0000-0000-0000-00000000000a', 1000, 'TZS', 'csv_import', 'INV-1', now())$$, 1, null, 'service_role');
select t.denied('same reference in the same workspace is a duplicate', $$insert into public.orders(workspace_id, amount, currency, provenance, external_ref, paid_at) values ('10000000-0000-0000-0000-00000000000a', 1000, 'TZS', 'csv_import', 'INV-1', now())$$, null, 'service_role');
select t.rows('same reference in another workspace is fine', $$insert into public.orders(workspace_id, amount, currency, provenance, external_ref, paid_at) values ('10000000-0000-0000-0000-00000000000b', 1000, 'TZS', 'csv_import', 'INV-1', now())$$, 1, null, 'service_role');

-- ---------- conversion window in ad_performance ----------
select t.rows('paid inside the window counts as attributed', $$insert into public.orders(workspace_id, conversation_id, amount, currency, paid_at) values ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', 20000, 'TZS', now() - interval '5 days')$$, 1, '00000000-0000-0000-0000-00000000000a');
select t.rows('ad_performance shows one attributed sale', $$select * from public.ad_performance('10000000-0000-0000-0000-00000000000a', (now() - interval '20 days')::date, now()::date) where ad_id = 'ad1' and sold = 1 and revenue = 20000$$, 1, '00000000-0000-0000-0000-00000000000a');
update public.orders set paid_at = now() + interval '40 days' where conversation_id = '30000000-0000-0000-0000-00000000000a' and status = 'paid';
select t.rows('paid outside the 30-day window is not attributed', $$select * from public.ad_performance('10000000-0000-0000-0000-00000000000a', (now() - interval '20 days')::date, now()::date) where ad_id = 'ad1' and sold = 0$$, 1, '00000000-0000-0000-0000-00000000000a');

-- ---------- conversation corrections ----------
select t.rows('owner marks a chat lost with a note', $$update public.conversations set outcome_override = 'lost', override_note = 'wrong number' where id = '30000000-0000-0000-0000-00000000000a'$$, 1, '00000000-0000-0000-0000-00000000000a');
do $$ begin
  if (select override_by from public.conversations where id = '30000000-0000-0000-0000-00000000000a') <> '00000000-0000-0000-0000-00000000000a' then raise exception 'FAIL: override_by not stamped'; end if;
end $$;
select t.denied('browser cannot rewrite analyzer columns', $$update public.conversations set payment_signal = true where id = '30000000-0000-0000-0000-00000000000a'$$, '00000000-0000-0000-0000-00000000000a');
select t.rows('viewer cannot correct a chat', $$update public.conversations set outcome_override = 'open' where id = '30000000-0000-0000-0000-00000000000a'$$, 0, '00000000-0000-0000-0000-0000000000a2');

-- ---------- tokens and server-only RPCs ----------
select t.denied('authenticated cannot read tokens', $$select public.svc_read_token(gen_random_uuid())$$, '00000000-0000-0000-0000-00000000000a');
select t.denied('authenticated cannot store tokens', $$select public.svc_store_token('x', 'y')$$, '00000000-0000-0000-0000-00000000000a');
select t.denied('authenticated cannot claim webhook events', $$select public.claim_raw_event(1)$$, '00000000-0000-0000-0000-00000000000a');
select t.denied('authenticated cannot requeue webhook events', $$select public.svc_requeue_failed_events('10000000-0000-0000-0000-00000000000a')$$, '00000000-0000-0000-0000-00000000000a');
select t.denied('authenticated cannot read raw events', $$select * from public.raw_events$$, '00000000-0000-0000-0000-00000000000a');
select t.denied('authenticated cannot read the retired sales table', $$select * from public.sales_legacy_v01$$, '00000000-0000-0000-0000-00000000000a');

-- ---------- webhook retry limits ----------
insert into public.raw_events(id, workspace_id, provider, event_key, field, payload, max_attempts) overriding system value
  values (1, '10000000-0000-0000-0000-00000000000a', 'whatsapp', 'k1', 'messages', '{}', 2);
do $$ begin
  if not public.claim_raw_event(1) then raise exception 'FAIL: first claim'; end if;
  if public.claim_raw_event(1) then raise exception 'FAIL: claim while processing'; end if;
  update public.raw_events set status = 'failed' where id = 1;
  if not public.claim_raw_event(1) then raise exception 'FAIL: second claim'; end if;
  update public.raw_events set status = 'failed' where id = 1;
  if public.claim_raw_event(1) then raise exception 'FAIL: claimed past max_attempts'; end if;
  if public.svc_requeue_failed_events('10000000-0000-0000-0000-00000000000b') <> 0 then raise exception 'FAIL: requeue leaked across workspaces'; end if;
  if public.svc_requeue_failed_events('10000000-0000-0000-0000-00000000000a') <> 1 then raise exception 'FAIL: requeue'; end if;
  if not public.claim_raw_event(1) then raise exception 'FAIL: claim after requeue'; end if;
  raise notice 'ok: webhook claim/retry/requeue limits';
end $$;
select t.rows('owner sees webhook health counts', $$select * from public.webhook_health('10000000-0000-0000-0000-00000000000a') where status = 'processing' and events = 1$$, 1, '00000000-0000-0000-0000-00000000000a');

-- ---------- tasks ----------
select t.rows('owner creates a task', $$insert into public.follow_up_tasks(id, workspace_id, conversation_id, title) values ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', 'Follow up')$$, 1, '00000000-0000-0000-0000-00000000000a');
select t.rows('owner edits the draft', $$update public.follow_up_tasks set draft = 'Habari, ...' where id = '50000000-0000-0000-0000-000000000001'$$, 1, '00000000-0000-0000-0000-00000000000a');
select t.rows('owner snoozes', $$update public.follow_up_tasks set status = 'snoozed' where id = '50000000-0000-0000-0000-000000000001'$$, 1, '00000000-0000-0000-0000-00000000000a');
do $$ declare k record; begin
  select * into k from public.follow_up_tasks where id = '50000000-0000-0000-0000-000000000001';
  if k.draft_source <> 'manual' or k.draft_edited_by is null then raise exception 'FAIL: draft provenance'; end if;
  if k.snoozed_until is null then raise exception 'FAIL: snooze default'; end if;
  if (select count(*) from public.task_events where task_id = k.id) < 3 then raise exception 'FAIL: task history'; end if;
  raise notice 'ok: task provenance and history';
end $$;
select t.denied('tasks cannot be deleted (history)', $$delete from public.follow_up_tasks where id = '50000000-0000-0000-0000-000000000001'$$, '00000000-0000-0000-0000-00000000000a');
select t.rows('owner B cannot touch A tasks', $$update public.follow_up_tasks set status = 'done' where id = '50000000-0000-0000-0000-000000000001'$$, 0, '00000000-0000-0000-0000-00000000000b');

-- ---------- privileged fields: no request from a business can raise its own access (22 Nov 2026) ----------
select t.rows('owner cannot change their own role', $$update public.memberships set role = 'owner' where user_id = '00000000-0000-0000-0000-0000000000a2'$$, 0, '00000000-0000-0000-0000-0000000000a2');
select t.denied('viewer cannot add themselves as owner', $$insert into public.memberships(workspace_id, user_id, role) values ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000a2', 'owner')$$, '00000000-0000-0000-0000-0000000000a2');
select t.denied('owner cannot make themselves Pondi staff', $$insert into public.platform_admins(user_id) values ('00000000-0000-0000-0000-00000000000a')$$, '00000000-0000-0000-0000-00000000000a');
select t.denied('owner cannot change plan or status', $$update public.workspace_admin_state set plan = 'pro', status = 'active'$$, '00000000-0000-0000-0000-00000000000a');
select t.denied('owner cannot lift a staff send block', $$update public.workspace_admin_state set send_blocked = false$$, '00000000-0000-0000-0000-00000000000a');
select t.denied('owner cannot call the staff send switch', $$select public.admin_set_send_enabled('10000000-0000-0000-0000-00000000000a', true)$$, '00000000-0000-0000-0000-00000000000a');

-- Staff block sticks even when the owner flips their own switch.
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000ff', 'staff@test');
insert into public.platform_admins(user_id) values ('00000000-0000-0000-0000-0000000000ff');
select t.run($$select public.admin_set_send_enabled('10000000-0000-0000-0000-00000000000a', false)$$, '00000000-0000-0000-0000-0000000000ff');
select t.rows('owner flips own switch (allowed)', $$update public.workspaces set send_enabled = true where id = '10000000-0000-0000-0000-00000000000a'$$, 1, '00000000-0000-0000-0000-00000000000a');
do $$ begin
  perform t.as_user('00000000-0000-0000-0000-00000000000a');
  if public.send_blocked_by_staff('10000000-0000-0000-0000-00000000000a') is not true then raise exception 'FAIL: staff block lost after owner flipped their switch'; end if;
  perform t.as_user('00000000-0000-0000-0000-00000000000b');
  if public.send_blocked_by_staff('10000000-0000-0000-0000-00000000000a') is not null then raise exception 'FAIL: non-member can read another business''s send block'; end if;
  reset role;
  raise notice 'ok: staff send block survives the owner switch and is hidden from other businesses';
end $$;

rollback;
