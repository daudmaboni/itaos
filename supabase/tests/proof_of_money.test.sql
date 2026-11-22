-- Money itaOS brought back, method v2 (migrations 0068 + 0070): who gets flagged, the customer-level trial, the number.
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
-- s1 quiet after price → flagged · s2 not a customer, s3 already paid, s4 waiting for us → never
-- s5 bought 50 days ago → reorder · s6 Kito promise → promise
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
select pg_temp.check_((select count(*) = 0 from public.atrisk_assign where workspace_id = '10000000-0000-0000-0000-0000000000e1'), 'test switched off: nobody enters the trial');

-- ================= The customer-level, balanced trial =================
-- 200 fresh after-price customers in one stratum at 20% → blocks of 5 → exactly 40 held.
update public.workspace_admin_state set holdout_pct = 20 where workspace_id = '10000000-0000-0000-0000-0000000000e1';
insert into public.contacts(id, workspace_id, wa_id, name)
select pg_temp.u('hc', i), '10000000-0000-0000-0000-0000000000e1', '2557100' || i, 'H ' || i from generate_series(1, 200) i;
insert into public.conversations(id, workspace_id, contact_id, phone_number_id, started_at, last_message_at, price_shared, last_dir, last_out_at)
select pg_temp.u('hv', i), '10000000-0000-0000-0000-0000000000e1', pg_temp.u('hc', i), 'pn-e', now() - interval '5 days', now() - interval '25 hours',
       true, 'out', now() - interval '25 hours' from generate_series(1, 200) i;
select private.atrisk_scan('10000000-0000-0000-0000-0000000000e1');
select pg_temp.check_((select count(*) = 200 and count(*) filter (where arm = 'hold') = 40 from public.atrisk_assign where workspace_id = '10000000-0000-0000-0000-0000000000e1'), 'balanced: exactly 1 in 5 held at 20%');
select pg_temp.check_((select bool_and(f.holdout = (s.arm = 'hold')) from public.atrisk_assign s join public.atrisk_flags f on f.id = s.flag_id), 'held customers are hidden, shown ones are not');
select pg_temp.check_((select count(distinct (cnt / 5)) = 40 from (select row_number() over (order by id) - 1 cnt, arm from public.atrisk_assign) b where arm = 'hold'), 'one held customer in every block of 5');

-- A held customer's next flag (another kind) is hidden too, with no second assignment; a shown customer stays shown.
insert into public.orders(workspace_id, conversation_id, amount, currency, status, paid_at)
select '10000000-0000-0000-0000-0000000000e1', c.id, 10000, 'TZS', 'paid', now() - interval '46 days'
  from public.atrisk_assign s join public.conversations c on c.contact_id = s.contact_id
 where s.id in ((select min(id) from public.atrisk_assign where arm = 'hold'), (select min(id) from public.atrisk_assign where arm = 'show'));
update public.conversations set price_shared = false where contact_id in (select contact_id from public.atrisk_assign);
select private.atrisk_scan('10000000-0000-0000-0000-0000000000e1');
select pg_temp.check_((select count(*) = 200 from public.atrisk_assign), 'nobody is assigned twice');
select pg_temp.check_((select f.holdout from public.atrisk_flags f where f.kind = 'reorder'
                         and f.contact_id = (select contact_id from public.atrisk_assign where arm = 'hold' order by id limit 1)), 'held customer: the new reorder flag is hidden too');
select pg_temp.check_((select not f.holdout from public.atrisk_flags f where f.kind = 'reorder'
                         and f.contact_id = (select contact_id from public.atrisk_assign where arm = 'show' order by id limit 1)), 'shown customer: never moved to held');

-- The owner gets the list of chats to leave out; outsiders and the raw tables are closed.
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
  begin perform count(*) from public.atrisk_assign; raise exception 'FAIL: owner read the assignments';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.atrisk_flags; raise exception 'FAIL: owner read the raw log';
  exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'ok: outsiders and the raw tables are closed';
end $$;

-- ================= The number =================
-- Windows opened 20 days ago and closed 6 days ago.
create function pg_temp.trial(ws uuid, n_show int, k_show int, n_hold int, k_hold int, n_msg_hold int) returns void language plpgsql as $$
declare i int;
begin
  insert into public.workspaces(id, name, currency) values (ws, 'Trial ' || ws, 'TZS');
  insert into public.memberships(workspace_id, user_id, role) values (ws, '00000000-0000-0000-0000-0000000000e1', 'owner');
  for i in 1 .. n_show + n_hold loop
    insert into public.contacts(id, workspace_id, wa_id, name) values (pg_temp.u(ws::text || 'c', i), ws, '255' || i, 'T ' || i);
    insert into public.conversations(id, workspace_id, contact_id, phone_number_id, started_at, last_message_at)
    values (pg_temp.u(ws::text || 'v', i), ws, pg_temp.u(ws::text || 'c', i), 'pn', now() - interval '30 days', now() - interval '10 days');
    insert into public.atrisk_assign(workspace_id, contact_id, version, arm, stratum, pct, kind, assigned_at, until_at)
    values (ws, pg_temp.u(ws::text || 'c', i), 'v2', case when i <= n_show then 'show' else 'hold' end, 'after_price:warm', 10, 'after_price',
            now() - interval '20 days', now() - interval '6 days');
    if (i <= k_show) or (i > n_show and i <= n_show + k_hold) then
      insert into public.orders(workspace_id, conversation_id, amount, currency, status, paid_at)
      values (ws, pg_temp.u(ws::text || 'v', i), 40000, 'TZS', 'paid', now() - interval '15 days');
    end if;
    if i > n_show + n_hold - n_msg_hold then
      insert into public.messages(id, workspace_id, conversation_id, direction, origin, sent_at, type, body)
      values ('m' || ws || i, ws, pg_temp.u(ws::text || 'v', i), 'out', 'app_echo', now() - interval '19 days', 'text', 'Habari');
    end if;
  end loop;
end $$;
create temp table r (k text, j jsonb); grant all on r to authenticated;
-- clear:    120 shown, 36 bought (30%) · 40 held, 4 bought (10%), 3 held messaged anyway
-- unsure:   30% vs 25%
-- learning: only 10 held
select pg_temp.trial('10000000-0000-0000-0000-0000000000f1', 120, 36, 40, 4, 3);
select pg_temp.trial('10000000-0000-0000-0000-0000000000f2', 120, 36, 40, 10, 0);
select pg_temp.trial('10000000-0000-0000-0000-0000000000f3', 120, 36, 10, 1, 0);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
insert into r select 'clear',    public.recovered_sales('10000000-0000-0000-0000-0000000000f1', current_date - 29, current_date);
insert into r select 'unsure',   public.recovered_sales('10000000-0000-0000-0000-0000000000f2', current_date - 29, current_date);
insert into r select 'learning', public.recovered_sales('10000000-0000-0000-0000-0000000000f3', current_date - 29, current_date);
reset role;

select pg_temp.check_((select (j->'trial'->'show'->>'n')::int = 120 and (j->'trial'->'show'->>'bought')::int = 36
                          and (j->'trial'->'hold'->>'n')::int = 40 and (j->'trial'->'hold'->>'bought')::int = 4 from r where k = 'clear'), 'groups counted per customer');
select pg_temp.check_((select (j->'trial'->'hold'->>'contaminated')::int = 3 from r where k = 'clear'), 'held customers messaged anyway stay held and are reported');
-- Wilson 36/120 ≈ 22.5–38.8%; 4/40 ≈ 4.0–23.1%
select pg_temp.check_((select round((j->'trial'->'show'->>'rate_lo')::numeric, 3) = 0.225 and round((j->'trial'->'hold'->>'rate_hi')::numeric, 3) = 0.231 from r where k = 'clear'), 'Wilson intervals');
select pg_temp.check_((select (j->'trial'->>'diff_lo')::numeric between 0.04 and 0.06 from r where k = 'clear'), 'Newcombe lower bound above zero');
select pg_temp.check_((select j->>'status' = 'clear' from r where k = 'clear'), 'clear when the whole range is above zero');
-- per customer: 36×40,000/120 − 4×40,000/40 = 12,000 − 4,000 = 8,000 × 120 shown = 960,000
select pg_temp.check_((select (j->'trial'->>'extra')::numeric = 960000 from r where k = 'clear'), 'extra = revenue per customer difference × shown customers');
select pg_temp.check_((select (j->'trial'->>'extra_lo')::numeric < 960000 and (j->'trial'->>'extra_hi')::numeric > 960000 from r where k = 'clear'), 'with a range');
select pg_temp.check_((select j->>'status' = 'estimate' and (j->'trial'->>'diff_lo')::numeric < 0 from r where k = 'unsure'), '30% vs 25%: an estimate that could still be zero');
select pg_temp.check_((select j->>'status' = 'learning' from r where k = 'learning'), 'only 10 held: still learning');
select pg_temp.check_((select j->>'version' = 'v2' from r where k = 'clear'), 'method version reported');

-- ================= Sales after follow-ups (observational, never added to the trial number) =================
-- j1 messaged + replied + paid · j2 messaged + paid · j3 paid without a message · j4 came back through a new ad · j5 nobody messaged, no sale
insert into public.workspaces(id, name, currency) values ('10000000-0000-0000-0000-0000000000f9', 'Journeys', 'TZS');
insert into public.memberships(workspace_id, user_id, role) values ('10000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-0000000000e1', 'owner');
insert into public.contacts(id, workspace_id, wa_id, name) select pg_temp.u('jc', i), '10000000-0000-0000-0000-0000000000f9', '2558' || i, 'J ' || i from generate_series(1, 5) i;
insert into public.conversations(id, workspace_id, contact_id, phone_number_id, started_at, last_message_at)
select pg_temp.u('jv', i), '10000000-0000-0000-0000-0000000000f9', pg_temp.u('jc', i), 'pn', now() - interval '30 days', now() - interval '5 days' from generate_series(1, 5) i;
insert into public.atrisk_flags(workspace_id, conversation_id, contact_id, kind, flagged_at, until_at)
select '10000000-0000-0000-0000-0000000000f9', pg_temp.u('jv', i), pg_temp.u('jc', i), 'after_price', now() - interval '20 days', now() - interval '6 days' from generate_series(1, 5) i;
insert into public.messages(id, workspace_id, conversation_id, direction, origin, sent_at, type, body, raw) values
  ('jo1', '10000000-0000-0000-0000-0000000000f9', pg_temp.u('jv', 1), 'out', 'app_echo', now() - interval '19 days', 'text', 'Habari', null),
  ('ji1', '10000000-0000-0000-0000-0000000000f9', pg_temp.u('jv', 1), 'in', 'webhook', now() - interval '18 days', 'text', 'Sawa', null),
  ('jo2', '10000000-0000-0000-0000-0000000000f9', pg_temp.u('jv', 2), 'out', 'itaos', now() - interval '19 days', 'text', 'Habari', null),
  ('ja4', '10000000-0000-0000-0000-0000000000f9', pg_temp.u('jv', 4), 'in', 'webhook', now() - interval '18 days', 'text', 'Bei?', '{"referral": {"source_type": "ad"}}');
insert into public.orders(workspace_id, conversation_id, amount, currency, status, paid_at)
select '10000000-0000-0000-0000-0000000000f9', pg_temp.u('jv', i), 40000, 'TZS', 'paid', now() - interval '15 days' from generate_series(1, 4) i;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
insert into r select 'journeys', public.recovered_sales('10000000-0000-0000-0000-0000000000f9', current_date - 29, current_date);
reset role;
select pg_temp.check_((select (j->'tiers'->'very_likely'->>'orders')::int = 1 and (j->'tiers'->'likely'->>'orders')::int = 1
                          and (j->'tiers'->'on_own'->>'orders')::int = 1 and (j->'tiers'->'ad'->>'orders')::int = 1 from r where k = 'journeys'), 'each sale gets its level');
select pg_temp.check_((select (j->'recorded'->>'amount')::numeric = 80000 from r where k = 'journeys'), 'sales after follow-up = messaged and paid only');
select pg_temp.check_((select (j->>'no_message')::int = 1 from r where k = 'journeys'), 'flagged customers nobody messaged are counted, not priced');
select pg_temp.check_((select j->>'status' = 'learning' and (j->'trial'->'show'->>'n')::int = 0 from r where k = 'journeys'), 'journeys never feed the trial number');

-- ================= Promises Kito opens by itself (0071) =================
-- A promise Kito opened straight away (clear day) can start a trial too; a held customer's open promise card
-- doesn't count in the Actions badge, and the badge still works for the owner.
update public.workspace_admin_state set holdout_pct = 10 where workspace_id = '10000000-0000-0000-0000-0000000000e1';
insert into public.contacts(id, workspace_id, wa_id, name) values (pg_temp.u('pc', 1), '10000000-0000-0000-0000-0000000000e1', '255790001', 'Promise open');
insert into public.conversations(id, workspace_id, contact_id, phone_number_id, started_at, last_message_at)
values (pg_temp.u('pv', 1), '10000000-0000-0000-0000-0000000000e1', pg_temp.u('pc', 1), 'pn-e', now() - interval '1 day', now());
insert into public.follow_up_tasks(id, workspace_id, conversation_id, title, source, status, kind, due_at)
values (pg_temp.u('pt', 1), '10000000-0000-0000-0000-0000000000e1', pg_temp.u('pv', 1), 'Promise', 'kito_promise', 'open', 'pay', now() - interval '1 minute');
select private.atrisk_scan('10000000-0000-0000-0000-0000000000e1');
select pg_temp.check_((select count(*) = 1 from public.atrisk_assign s join public.atrisk_flags f on f.id = s.flag_id where f.task_id = pg_temp.u('pt', 1)), 'a promise Kito opened itself enters the trial');
update public.atrisk_flags set holdout = true where task_id = pg_temp.u('pt', 1);
create temp table nb (j json); grant all on nb to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
insert into nb select public.nav_badges('10000000-0000-0000-0000-0000000000e1');
reset role;
select pg_temp.check_((select (j->>'actions_due')::int = (select count(*) from public.follow_up_tasks t where t.workspace_id = '10000000-0000-0000-0000-0000000000e1'
                          and (t.status = 'proposed' or (t.status in ('open', 'snoozed') and coalesce(t.snoozed_until, t.due_at) <= now()))
                          and t.id <> pg_temp.u('pt', 1)) from nb), 'badge works for the owner and skips the kept-aside promise');

rollback;
