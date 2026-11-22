-- Money itaOS brought back (migration 0068): who gets flagged, the hidden comparison group, and the number.
\set ON_ERROR_STOP on
\t on
\pset footer off
begin;

create function pg_temp.as_user(uid uuid, r text default 'authenticated') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  execute format('set local role %I', r);
end $$;
create function pg_temp.check_(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok: %', label;
end $$;
create function pg_temp.u(p text, i int) returns uuid language sql as $$ select (substr(md5(p || i), 1, 8) || '-0000-4000-8000-' || substr(md5(p || i), 9, 12))::uuid $$;

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000e1', 'owner-e@test'), ('00000000-0000-0000-0000-0000000000e2', 'outsider@test');
insert into public.workspaces(id, name, currency) values ('10000000-0000-0000-0000-0000000000e1', 'Proof Shop', 'TZS');
insert into public.memberships(workspace_id, user_id, role) values ('10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', 'owner');
insert into public.workspace_admin_state(workspace_id, holdout_pct) values ('10000000-0000-0000-0000-0000000000e1', 0);

-- ================= Finding slipping-away customers =================
-- s1: got a price, our message unanswered for 25 h  → after_price
-- s2: same but marked Not a customer               → never
-- s3: same but already paid                         → never
-- s4: customer wrote last (waiting for us)          → never
-- s5: bought 50 days ago, nothing since             → reorder
-- s6: Kito found a promise                          → promise
insert into public.contacts(id, workspace_id, wa_id, name, not_customer)
select pg_temp.u('sc', i), '10000000-0000-0000-0000-0000000000e1', '2557000000' || i, 'Scan ' || i, i = 2 from generate_series(1, 6) i;
insert into public.conversations(id, workspace_id, contact_id, phone_number_id, started_at, last_message_at, price_shared, last_dir, last_out_at)
select pg_temp.u('sv', i), '10000000-0000-0000-0000-0000000000e1', pg_temp.u('sc', i), 'pn-e', now() - interval '60 days', now() - interval '25 hours',
       i <= 4, case when i = 4 then 'in' else 'out' end, now() - interval '25 hours'
  from generate_series(1, 6) i;
insert into public.orders(workspace_id, conversation_id, amount, currency, status, paid_at) values
  ('10000000-0000-0000-0000-0000000000e1', pg_temp.u('sv', 3), 30000, 'TZS', 'paid', now() - interval '3 days'),
  ('10000000-0000-0000-0000-0000000000e1', pg_temp.u('sv', 5), 30000, 'TZS', 'paid', now() - interval '50 days');
insert into public.follow_up_tasks(id, workspace_id, conversation_id, title, source, status, due_at)
values (pg_temp.u('st', 6), '10000000-0000-0000-0000-0000000000e1', pg_temp.u('sv', 6), 'Promise', 'kito_promise', 'proposed', now() + interval '1 day');

select private.atrisk_scan('10000000-0000-0000-0000-0000000000e1');
select pg_temp.check_((select count(*) = 1 from public.atrisk_flags where conversation_id = pg_temp.u('sv', 1) and kind = 'after_price'), 'quiet after the price is flagged');
select pg_temp.check_((select count(*) = 0 from public.atrisk_flags where conversation_id in (pg_temp.u('sv', 2), pg_temp.u('sv', 3), pg_temp.u('sv', 4)) and kind = 'after_price'), 'not a customer / already paid / waiting for us are never flagged');
select pg_temp.check_((select count(*) = 1 from public.atrisk_flags where conversation_id = pg_temp.u('sv', 5) and kind = 'reorder'), 'past buyer due a reorder is flagged');
select pg_temp.check_((select count(*) = 1 from public.atrisk_flags where task_id = pg_temp.u('st', 6) and kind = 'promise'), 'Kito promise is flagged');
select private.atrisk_scan('10000000-0000-0000-0000-0000000000e1');
select pg_temp.check_((select count(*) = 3 from public.atrisk_flags where workspace_id = '10000000-0000-0000-0000-0000000000e1'), 'scanning again adds nothing');
select pg_temp.check_((select count(*) = 0 from public.atrisk_flags where workspace_id = '10000000-0000-0000-0000-0000000000e1' and holdout), 'holdout 0% keeps nobody aside');

-- Holdout at 20% over 200 fresh customers: some kept aside, never more than about a fifth, never the same person twice.
update public.workspace_admin_state set holdout_pct = 20 where workspace_id = '10000000-0000-0000-0000-0000000000e1';
insert into public.contacts(id, workspace_id, wa_id, name)
select pg_temp.u('hc', i), '10000000-0000-0000-0000-0000000000e1', '2557100' || i, 'H ' || i from generate_series(1, 200) i;
insert into public.conversations(id, workspace_id, contact_id, phone_number_id, started_at, last_message_at, price_shared, last_dir, last_out_at)
select pg_temp.u('hv', i), '10000000-0000-0000-0000-0000000000e1', pg_temp.u('hc', i), 'pn-e', now() - interval '5 days', now() - interval '25 hours',
       true, 'out', now() - interval '25 hours' from generate_series(1, 200) i;
select private.atrisk_scan('10000000-0000-0000-0000-0000000000e1');
select pg_temp.check_((select count(*) filter (where holdout) between 15 and 70 from public.atrisk_flags where conversation_id in (select pg_temp.u('hv', i) from generate_series(1, 200) i)), 'about 1 in 5 kept aside at 20%');
select pg_temp.check_((select count(*) = count(distinct contact_id) from public.atrisk_flags where holdout), 'nobody kept aside twice');

-- The owner sees which chats to leave out; outsiders don't.
create temp table hid (n bigint); grant all on hid to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
insert into hid select count(*) from public.atrisk_hidden('10000000-0000-0000-0000-0000000000e1');
reset role;
select pg_temp.check_((select n > 0 and n = (select count(*) from public.svc_atrisk_hidden('10000000-0000-0000-0000-0000000000e1')) from hid), 'owner gets the kept-aside list');
do $$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
  begin perform public.atrisk_hidden('10000000-0000-0000-0000-0000000000e1'); raise exception 'FAIL: outsider got the list';
  exception when insufficient_privilege then null; end;
  begin perform public.recovered_sales('10000000-0000-0000-0000-0000000000e1', current_date - 29, current_date); raise exception 'FAIL: outsider got the number';
  exception when insufficient_privilege then null; end;
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
  begin perform count(*) from public.atrisk_flags; raise exception 'FAIL: owner read the raw log';
  exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'ok: outsiders and the raw log are closed';
end $$;

-- ================= The number =================
-- A clean business: 101 customers shown, 40 kept aside, all flagged 20 days ago (window closed 6 days ago).
--   shown 1–20   : messaged, replied, paid 40,000      → very likely
--   shown 21–25  : messaged, no reply, paid            → likely
--   shown 26–30  : never messaged, paid                → paid on their own (not credited)
--   shown 31–65  : messaged, didn't pay
--   shown 66–100 : nobody messaged, didn't pay         → money left on the table
--   shown 101    : came back through a new ad, paid    → the ad's credit
--   kept aside   : 4 of 40 paid
insert into public.workspaces(id, name, currency) values ('10000000-0000-0000-0000-0000000000f1', 'Numbers Shop', 'TZS');
insert into public.memberships(workspace_id, user_id, role) values ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', 'owner');
insert into public.workspace_admin_state(workspace_id, price_month) values ('10000000-0000-0000-0000-0000000000f1', 100000);
insert into public.contacts(id, workspace_id, wa_id, name)
select pg_temp.u('nc', i), '10000000-0000-0000-0000-0000000000f1', '2557200' || i, 'N ' || i from generate_series(1, 141) i;
insert into public.conversations(id, workspace_id, contact_id, phone_number_id, started_at, last_message_at, last_dir)
select pg_temp.u('nv', i), '10000000-0000-0000-0000-0000000000f1', pg_temp.u('nc', i), 'pn-f', now() - interval '25 days', now() - interval '10 days', 'in'
  from generate_series(1, 141) i;
insert into public.atrisk_flags(workspace_id, conversation_id, contact_id, kind, flagged_at, until_at, holdout)
select '10000000-0000-0000-0000-0000000000f1', pg_temp.u('nv', i), pg_temp.u('nc', i), 'after_price', now() - interval '20 days', now() - interval '6 days', i > 101
  from generate_series(1, 141) i;
-- owner messages
insert into public.messages(id, workspace_id, conversation_id, direction, origin, sent_at, type, body)
select 'out-' || i, '10000000-0000-0000-0000-0000000000f1', pg_temp.u('nv', i), 'out', 'app_echo', now() - interval '19 days', 'text', 'Habari'
  from generate_series(1, 65) i where i <= 25 or i > 30;
-- customer replies
insert into public.messages(id, workspace_id, conversation_id, direction, origin, sent_at, type, body)
select 'in-' || i, '10000000-0000-0000-0000-0000000000f1', pg_temp.u('nv', i), 'in', 'webhook', now() - interval '18 days', 'text', 'Sawa'
  from generate_series(1, 20) i;
-- the ad click
insert into public.messages(id, workspace_id, conversation_id, direction, origin, sent_at, type, body, raw)
values ('ad-101', '10000000-0000-0000-0000-0000000000f1', pg_temp.u('nv', 101), 'in', 'webhook', now() - interval '18 days', 'text', 'Bei?', '{"referral": {"source_type": "ad"}}');
-- payments
insert into public.orders(workspace_id, conversation_id, amount, currency, status, paid_at)
select '10000000-0000-0000-0000-0000000000f1', pg_temp.u('nv', i), 40000, 'TZS', 'paid', now() - interval '15 days'
  from generate_series(1, 145) i where i <= 30 or i = 101 or i between 102 and 105;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
create temp table r as select public.recovered_sales('10000000-0000-0000-0000-0000000000f1', current_date - 29, current_date) j;
reset role;
select pg_temp.check_((select (j->'proof'->>'ready')::boolean and (j->'proof'->>'shown_n')::int = 101 and (j->'proof'->>'hidden_n')::int = 40
                         and (j->'proof'->>'shown_paid')::int = 30 and (j->'proof'->>'hidden_paid')::int = 4 from r), 'comparison groups counted right (ad sale not counted as paid)');
select pg_temp.check_((select j->>'method' = 'proven' from r), 'enough kept aside: the number is proven');
-- (30/101 - 4/40) × 101 shown × 40,000 = (0.29703 - 0.1) × 101 × 40,000 ≈ 796,000
select pg_temp.check_((select (j->>'headline')::numeric between 795000 and 797000 from r), 'proven extra ≈ 796,000');
select pg_temp.check_((select (j->>'headline_low')::numeric < (j->>'headline')::numeric and (j->>'headline_high')::numeric > (j->>'headline')::numeric from r), 'range around it');
select pg_temp.check_((select (j->'tiers'->'very_likely'->>'orders')::int = 20 and (j->'tiers'->'very_likely'->>'amount')::numeric = 800000 from r), '20 very likely (messaged, replied, paid)');
select pg_temp.check_((select (j->'tiers'->'likely'->>'orders')::int = 5 from r), '5 likely (messaged, paid)');
select pg_temp.check_((select (j->'tiers'->'on_own'->>'orders')::int = 5 from r), '5 paid on their own, not credited');
select pg_temp.check_((select (j->'tiers'->'ad'->>'orders')::int = 1 from r), 'the ad gets its sale');
select pg_temp.check_((select (j->>'orders')::int = 25 and jsonb_array_length(j->'items') = 31 from r), 'every sale listed with its level');
select pg_temp.check_((select (j->'left'->>'ignored')::int = 35 and (j->'left'->>'amount')::numeric > 0 from r), '35 nobody messaged, with money left on the table');
select pg_temp.check_((select (j->>'price_month')::numeric = 100000 from r), 'cost carried for the comparison');

-- Too few kept aside: falls back to the evidence level, never a made-up proof.
delete from public.atrisk_flags where workspace_id = '10000000-0000-0000-0000-0000000000f1' and holdout and conversation_id not in (select pg_temp.u('nv', i) from generate_series(102, 111) i);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select pg_temp.check_((select j->>'method' = 'evidence' and (j->>'headline')::numeric = 800000
                         from (select public.recovered_sales('10000000-0000-0000-0000-0000000000f1', current_date - 29, current_date) j) x), 'not enough kept aside yet: shows the very-likely sales only');
reset role;

rollback;
