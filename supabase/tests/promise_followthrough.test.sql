-- Promises that look after themselves (migration 0072): payment in the chat closes them; kept vs broken.
\set ON_ERROR_STOP on
\t on
\pset footer off
begin;
create function pg_temp.check_(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok: %', label;
end $$;
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid::text, true); set local role authenticated; end $$;

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a7', 'owner-p@test') on conflict do nothing;
insert into public.workspaces(id, name, currency) values ('10000000-0000-0000-0000-0000000000a7', 'Promise Shop', 'TZS');
insert into public.memberships(workspace_id, user_id, role) values ('10000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000a7', 'owner');
insert into public.contacts(id, workspace_id, wa_id, name) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a7', '255700000001', 'Asha'),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000a7', '255700000002', 'Baraka'),
  ('20000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-0000000000a7', '255700000003', 'Chausiku'),
  ('20000000-0000-0000-0000-0000000000a4', '10000000-0000-0000-0000-0000000000a7', '255700000004', 'Dotto');
insert into public.conversations(id, workspace_id, contact_id, phone_number_id, started_at, last_message_at)
select ('30000000-0000-0000-0000-0000000000a' || i)::uuid, '10000000-0000-0000-0000-0000000000a7', ('20000000-0000-0000-0000-0000000000a' || i)::uuid, 'pn', now() - interval '20 days', now()
  from generate_series(1, 4) i;
-- open promises made an hour ago
insert into public.follow_up_tasks(id, workspace_id, conversation_id, title, source, status, kind, promise_at, due_at)
select ('40000000-0000-0000-0000-0000000000a' || i)::uuid, '10000000-0000-0000-0000-0000000000a7', ('30000000-0000-0000-0000-0000000000a' || i)::uuid,
       'Promise', 'kito_promise', 'open', 'pay', now() - interval '1 hour', now() + interval '3 hours'
  from generate_series(1, 4) i;

-- Asha sends a payment screenshot; Baraka says "nimetuma"; Chausiku's owner writes "Tumepokea malipo"; Dotto just says "sawa".
insert into public.messages(id, workspace_id, conversation_id, direction, origin, sent_at, type, body, media) values
  ('pa1', '10000000-0000-0000-0000-0000000000a7', '30000000-0000-0000-0000-0000000000a1', 'in', 'webhook', now(), 'image', null, '{"receipt": {"is_receipt": true}}'),
  ('pa2', '10000000-0000-0000-0000-0000000000a7', '30000000-0000-0000-0000-0000000000a2', 'in', 'webhook', now(), 'text', 'Nimetuma kaka angalia', null),
  ('pa3', '10000000-0000-0000-0000-0000000000a7', '30000000-0000-0000-0000-0000000000a3', 'out', 'app_echo', now(), 'text', 'Tumepokea malipo, asante!', null),
  ('pa4', '10000000-0000-0000-0000-0000000000a7', '30000000-0000-0000-0000-0000000000a4', 'in', 'webhook', now(), 'text', 'Sawa', null),
  -- an OLD screenshot (before the promise) imported from history must not close Dotto's promise
  ('pa5', '10000000-0000-0000-0000-0000000000a7', '30000000-0000-0000-0000-0000000000a4', 'in', 'history', now() - interval '5 days', 'image', null, '{"receipt": {"is_receipt": true}}');
select pg_temp.check_((select status = 'done' and result = 'paid' and auto_closed = 'receipt' from public.follow_up_tasks where id = '40000000-0000-0000-0000-0000000000a1'), 'payment screenshot closes the promise');
select pg_temp.check_((select status = 'done' and auto_closed = 'customer_said_paid' from public.follow_up_tasks where id = '40000000-0000-0000-0000-0000000000a2'), '"nimetuma" closes the promise');
select pg_temp.check_((select status = 'done' and auto_closed = 'owner_confirmed' from public.follow_up_tasks where id = '40000000-0000-0000-0000-0000000000a3'), 'owner''s "tumepokea malipo" closes the promise');
select pg_temp.check_((select status = 'open' and auto_closed is null from public.follow_up_tasks where id = '40000000-0000-0000-0000-0000000000a4'), '"sawa" and an older screenshot leave it open');
-- A receipt read later (media filled in afterwards) also closes it
update public.messages set media = '{"receipt": {"is_receipt": true}}' where id = 'pa4';
select pg_temp.check_((select status = 'done' and auto_closed = 'receipt' from public.follow_up_tasks where id = '40000000-0000-0000-0000-0000000000a4'), 'a receipt read later closes it too');

-- Owner reopens a wrong one
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
update public.follow_up_tasks set status = 'open', result = null, auto_closed = null, completed_at = null where id = '40000000-0000-0000-0000-0000000000a2';
reset role;
select pg_temp.check_((select status = 'open' from public.follow_up_tasks where id = '40000000-0000-0000-0000-0000000000a2'), 'owner can reopen a promise itaOS closed');

-- ================= Kept vs broken =================
-- Asha: 2 old promises, both broken; 1 kept (paid order). Baraka: 1 kept. Withdrawn ("Not a promise") doesn't count.
insert into public.follow_up_tasks(workspace_id, conversation_id, title, source, status, kind, promise_at, due_at, result) values
  ('10000000-0000-0000-0000-0000000000a7', '30000000-0000-0000-0000-0000000000a1', 'P', 'kito_promise', 'done', 'pay', now() - interval '30 days', now() - interval '28 days', 'called'),
  ('10000000-0000-0000-0000-0000000000a7', '30000000-0000-0000-0000-0000000000a1', 'P', 'kito_promise', 'dismissed', 'pay', now() - interval '20 days', now() - interval '18 days', 'not_interested'),
  ('10000000-0000-0000-0000-0000000000a7', '30000000-0000-0000-0000-0000000000a1', 'P', 'kito_promise', 'done', 'pay', now() - interval '10 days', now() - interval '9 days', 'called'),
  ('10000000-0000-0000-0000-0000000000a7', '30000000-0000-0000-0000-0000000000a2', 'P', 'kito_promise', 'done', 'pay', now() - interval '10 days', now() - interval '9 days', 'called'),
  ('10000000-0000-0000-0000-0000000000a7', '30000000-0000-0000-0000-0000000000a3', 'P', 'kito_promise', 'dismissed', 'pay', now() - interval '10 days', now() - interval '9 days', null);
insert into public.orders(workspace_id, conversation_id, amount, currency, status, paid_at) values
  ('10000000-0000-0000-0000-0000000000a7', '30000000-0000-0000-0000-0000000000a1', 50000, 'TZS', 'paid', now() - interval '8 days'),
  ('10000000-0000-0000-0000-0000000000a7', '30000000-0000-0000-0000-0000000000a2', 50000, 'TZS', 'paid', now() - interval '9 days');
create temp table rr (j jsonb); grant all on rr to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
insert into rr select public.promise_record('10000000-0000-0000-0000-0000000000a7', 90);
reset role;
-- Asha: 30-day-old promise broken, not-interested broken, 10-day-old kept (paid 8 days ago, within due + 2), today's closed one kept (paid)
select pg_temp.check_((select (c->>'kept')::int = 2 and (c->>'broken')::int = 2 from rr, jsonb_array_elements(j->'contacts') c where c->>'name' = 'Asha'), 'Asha: kept 2, broke 2');
-- Baraka: the 10-day-old promise (paid before its due day) + today's reopened one, which recording his order closed as paid (0046)
select pg_temp.check_((select (c->>'kept')::int = 2 and (c->>'broken')::int = 0 from rr, jsonb_array_elements(j->'contacts') c where c->>'name' = 'Baraka'), 'Baraka: kept 2, broke 0');
select pg_temp.check_((select not exists (select 1 from rr, jsonb_array_elements(j->'contacts') c where c->>'name' = 'Chausiku' and (c->>'broken')::int > 0)), '"Not a promise" never counts as broken');
select pg_temp.check_((select (j->'contacts'->0->>'name') = 'Asha' from rr), 'most broken first');
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', true); set local role authenticated;
  begin perform public.promise_record('10000000-0000-0000-0000-0000000000a7', 90); raise exception 'FAIL: outsider got the record';
  exception when insufficient_privilege then null; end;
  reset role; raise notice 'ok: outsiders get nothing';
end $$;
rollback;
