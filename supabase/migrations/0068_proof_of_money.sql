-- 0068_proof_of_money — "Money itaOS brought back", rebuilt so it can be trusted (22 Nov 2026).
--
-- The old card (0065) counted a sale when the owner pressed "Sent" and the customer later paid. Two holes:
-- an owner who forgets the button (or skips it on purpose) shrinks the number, and nothing answered
-- "would that customer have paid anyway?". Now:
--
-- WHO COUNTS (rules 1–3)
--   itaOS logs every customer who is slipping away the moment it would show them to the owner (atrisk_flags):
--     after_price — got a price, didn't buy, our message has had no answer for 24 h (up to 14 days)
--     promise     — Kito found a payment promise
--     reorder     — last purchase 45–120 days ago, nothing since
--   Contacts marked "Not a customer" never count. One payment is credited once.
--
-- PROOF THE OWNER ACTED (rules 4–6) — read from WhatsApp itself, never from a button
--   acted   = the business sent that customer any message after the flag (itaOS, the WhatsApp Business app, history)
--   replied = the customer answered after that message
--   paid    = a paid order inside the window (14 days; 30 for reorders; promise: 14 days after its due date)
--
-- PROOF THE MONEY IS REAL (rules 7–8)
--   Only paid orders, net of discount and refund. If the customer came back through a new ad click before paying,
--   the ad gets the credit, not itaOS.
--
-- PROOF itaOS CAUSED IT (rules 9–12)
--   Holdout: about 1 in 10 newly flagged customers is kept aside and NOT shown to the owner (Actions lists and
--   reminders only — their chats stay in Chats, and anyone waiting for a reply is always shown). Never the same
--   customer twice. Comparing how often shown vs kept-aside customers pay gives the extra sales itaOS created,
--   with a range while the numbers are small. Until enough customers are kept aside, the business's own chats
--   from before itaOS give the comparison.
--
-- HOW IT IS SHOWN (rules 13–15): three levels (proven / very likely / likely), the multiple of what itaOS costs,
-- and the money left on the table by flagged customers nobody messaged.

-- 1. The log of slipping-away customers ---------------------------------------------------------------
create table if not exists public.atrisk_flags (
  id              bigint generated always as identity primary key,
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  contact_id      uuid not null references public.contacts(id) on delete cascade,
  kind            text not null check (kind in ('after_price', 'promise', 'reorder')),
  flagged_at      timestamptz not null,
  until_at        timestamptz not null,
  holdout         boolean not null default false,
  task_id         uuid references public.follow_up_tasks(id) on delete set null,
  backfilled      boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists atrisk_flags_ws_idx   on public.atrisk_flags (workspace_id, flagged_at);
create index if not exists atrisk_flags_conv_idx on public.atrisk_flags (conversation_id, kind, flagged_at);
create unique index if not exists atrisk_flags_task_uq on public.atrisk_flags (task_id) where task_id is not null;
alter table public.atrisk_flags enable row level security;
revoke all on public.atrisk_flags from anon, authenticated;   -- read through recovered_sales / atrisk_hidden only
comment on table public.atrisk_flags is 'Customers itaOS flagged as slipping away; holdout = kept aside to measure what itaOS adds (0068).';

-- Share of new flags kept aside, per business (staff only; 0 turns the test off). Default 10%.
alter table public.workspace_admin_state
  add column if not exists holdout_pct int not null default 10 check (holdout_pct between 0 and 20);

-- 2. Finding them --------------------------------------------------------------------------------------
-- p_holdout = false: log without keeping anyone aside (used once, for customers the owner can already see).
-- Only FRESH flags (became at-risk in the last 2 hours) may be kept aside, so nobody vanishes from a list
-- the owner has already seen.
create or replace function private.atrisk_scan(p_ws uuid, p_holdout boolean default true)
returns int language plpgsql security definer set search_path = public as $$
declare pct numeric; n int := 0; k int;
begin
  perform pg_advisory_xact_lock(hashtext('atrisk:' || p_ws::text));
  select coalesce((select holdout_pct from workspace_admin_state where workspace_id = p_ws), 10) / 100.0 into pct;
  if not p_holdout then pct := 0; end if;

  -- after the price
  insert into atrisk_flags (workspace_id, conversation_id, contact_id, kind, flagged_at, until_at, holdout)
  select c.workspace_id, c.id, c.contact_id, 'after_price', f.at, f.at + interval '14 days',
         f.at > now() - interval '2 hours' and random() < pct
           and not exists (select 1 from atrisk_flags h where h.contact_id = c.contact_id and h.holdout)
    from conversations c
    join contacts ct on ct.id = c.contact_id and not ct.not_customer
    cross join lateral (select c.last_out_at + interval '24 hours' as at) f
   where c.workspace_id = p_ws and c.phone_number_id <> 'import'
     and (c.price_shared or c.kito_label in ('priced', 'awaiting_payment', 'paid', 'shipped', 'received', 'using'))
     and c.last_dir = 'out' and c.last_out_at between now() - interval '14 days' and now() - interval '24 hours'
     and coalesce(c.outcome_override, '') not in ('sold', 'lost')
     and not exists (select 1 from orders o where o.conversation_id = c.id and o.status = 'paid')
     and not exists (select 1 from atrisk_flags x where x.conversation_id = c.id and x.kind = 'after_price'
                       and x.flagged_at > f.at - interval '14 days');
  get diagnostics k = row_count; n := n + k;

  -- promises Kito found
  insert into atrisk_flags (workspace_id, conversation_id, contact_id, kind, flagged_at, until_at, holdout, task_id)
  select t.workspace_id, t.conversation_id, c.contact_id, 'promise', t.created_at,
         greatest(coalesce(t.due_at, t.created_at), t.created_at) + interval '14 days',
         t.status = 'proposed' and t.created_at > now() - interval '2 hours' and random() < pct
           and not exists (select 1 from atrisk_flags h where h.contact_id = c.contact_id and h.holdout),
         t.id
    from follow_up_tasks t
    join conversations c on c.id = t.conversation_id
    join contacts ct on ct.id = c.contact_id and not ct.not_customer
   where t.workspace_id = p_ws and t.source = 'kito_promise'
     and (t.status in ('proposed', 'open', 'snoozed', 'done') or (t.status = 'dismissed' and t.result = 'paid'))
     and t.created_at > now() - interval '120 days'
     and not exists (select 1 from atrisk_flags x where x.task_id = t.id);
  get diagnostics k = row_count; n := n + k;

  -- past buyers due a reorder (one flag per purchase)
  insert into atrisk_flags (workspace_id, conversation_id, contact_id, kind, flagged_at, until_at, holdout)
  select c.workspace_id, c.id, c.contact_id, 'reorder', f.at, f.at + interval '30 days',
         f.at > now() - interval '2 hours' and random() < pct
           and not exists (select 1 from atrisk_flags h where h.contact_id = c.contact_id and h.holdout)
    from (select distinct on (o.conversation_id) o.conversation_id, o.paid_at
            from orders o where o.workspace_id = p_ws and o.status = 'paid' and o.conversation_id is not null and o.paid_at is not null
           order by o.conversation_id, o.paid_at desc) lp
    join conversations c on c.id = lp.conversation_id
    join contacts ct on ct.id = c.contact_id and not ct.not_customer
    cross join lateral (select lp.paid_at + interval '45 days' as at) f
   where lp.paid_at between now() - interval '120 days' and now() - interval '45 days'
     and not exists (select 1 from atrisk_flags x where x.conversation_id = c.id and x.kind = 'reorder' and x.flagged_at > lp.paid_at);
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;
revoke all on function private.atrisk_scan(uuid, boolean) from public, anon, authenticated;

create or replace function private.atrisk_scan_all()
returns void language plpgsql security definer set search_path = public as $$
declare w uuid;
begin
  for w in select id from workspaces loop
    begin perform private.atrisk_scan(w, true);
    exception when others then raise warning 'atrisk_scan % failed: %', w, sqlerrm; end;
  end loop;
end $$;
revoke all on function private.atrisk_scan_all() from public, anon, authenticated;

-- 3. What the app must not show (also runs the scan first, so a fresh customer is decided before any list shows it)
create or replace function public.atrisk_hidden(p_ws uuid)
returns table (conversation_id uuid, kind text)
language plpgsql volatile security definer set search_path = public, private as $$
begin
  if not public.is_member(p_ws) then raise exception 'forbidden' using errcode = '42501'; end if;
  perform private.atrisk_scan(p_ws, true);
  return query
    select distinct a.conversation_id, a.kind from atrisk_flags a
     where a.workspace_id = p_ws and a.holdout
       and (a.until_at > now() or (a.kind = 'promise' and a.flagged_at > now() - interval '120 days'));
end $$;
revoke all on function public.atrisk_hidden(uuid) from public, anon;
grant execute on function public.atrisk_hidden(uuid) to authenticated;

-- Service role (push notifications): same list without the membership check.
create or replace function public.svc_atrisk_hidden(p_ws uuid)
returns table (conversation_id uuid, kind text)
language sql stable security definer set search_path = public as $$
  select distinct a.conversation_id, a.kind from atrisk_flags a
   where a.workspace_id = p_ws and a.holdout
     and (a.until_at > now() or (a.kind = 'promise' and a.flagged_at > now() - interval '120 days'));
$$;
revoke all on function public.svc_atrisk_hidden(uuid) from public, anon, authenticated;
grant execute on function public.svc_atrisk_hidden(uuid) to service_role;

-- 4. Start the log --------------------------------------------------------------------------------------
-- (a) Earlier nudges, from the tasks the owner already worked (nobody kept aside; they were all shown).
insert into public.atrisk_flags (workspace_id, conversation_id, contact_id, kind, flagged_at, until_at, task_id, backfilled)
select t.workspace_id, t.conversation_id, c.contact_id, t.source, f.at,
       f.at + case when t.source = 'reorder' then interval '30 days' else interval '14 days' end, t.id, true
  from public.follow_up_tasks t
  join public.conversations c on c.id = t.conversation_id
  -- when the customer would have shown up: after the price went unanswered for a day; a reorder a day before "Sent"
  cross join lateral (select case when t.source = 'reorder' then t.created_at - interval '1 day'
                                  else greatest(least(t.created_at, coalesce(c.price_shared_at + interval '24 hours', t.created_at)),
                                                t.created_at - interval '14 days') end as at) f
 where t.source in ('after_price', 'reorder') and t.created_at > now() - interval '120 days'
on conflict do nothing;
-- (b) Everyone at risk right now, without keeping anyone aside (the owner may already see them).
do $$ declare w uuid; begin
  for w in select id from public.workspaces loop perform private.atrisk_scan(w, false); end loop;
end $$;
update public.atrisk_flags set backfilled = true where created_at > now() - interval '5 minutes';

select cron.unschedule('atrisk-scan-hourly') where exists (select 1 from cron.job where jobname = 'atrisk-scan-hourly');
select cron.schedule('atrisk-scan-hourly', '17 * * * *', $cron$ select private.atrisk_scan_all(); $cron$);

-- 5. The number -----------------------------------------------------------------------------------------
create or replace function public.recovered_sales(p_ws uuid, p_from date, p_to date)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$   -- volatile: uses a scratch table
declare
  tz text; v_start timestamptz; v_end timestamptz; v_days int := p_to - p_from + 1;
  n1 int; k1 int; n0 int; k0 int; p1 numeric; p0 numeric; lift numeric; se numeric;
  v_avg numeric; m_period int; m_ap_period int;
  hist_n int := 0; hist_k int := 0; p_hist numeric; ap_n int; ap_k int; itaos_start timestamptz;
  na int; ka int; nn int; kn int; ignored int;
  proven_ready boolean; res jsonb;
begin
  if not public.is_member(p_ws) then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(timezone, 'Africa/Dar_es_Salaam') into tz from workspaces where id = p_ws;
  v_start := p_from::timestamp at time zone tz;
  v_end   := (p_to + 1)::timestamp at time zone tz;

  -- Every flag from 120 days before the period to its end, with what happened after it.
  create temp table if not exists _rs (
    id bigint, conversation_id uuid, contact_id uuid, kind text, flagged_at timestamptz, until_at timestamptz, holdout boolean,
    order_id uuid, paid_at timestamptz, val numeric, acted_at timestamptz, replied_at timestamptz, ad_at timestamptz
  ) on commit drop;
  truncate _rs;
  insert into _rs
  select a.id, a.conversation_id, a.contact_id, a.kind, a.flagged_at, a.until_at, a.holdout,
         pay.id, pay.paid_at, pay.val, act.at, rep.at, adc.at
    from atrisk_flags a
    join contacts ct on ct.id = a.contact_id and not ct.not_customer
    left join lateral (
      select o.id, o.paid_at, (o.amount - o.discount - o.refund_amount) val from orders o
       where o.conversation_id = a.conversation_id and o.status = 'paid'
         and o.paid_at > a.flagged_at and o.paid_at <= a.until_at and (o.amount - o.discount - o.refund_amount) > 0
       order by o.paid_at limit 1) pay on true
    left join lateral (
      select min(m.sent_at) at from messages m
       where m.conversation_id = a.conversation_id and m.direction = 'out'
         and m.sent_at > a.flagged_at and m.sent_at <= coalesce(pay.paid_at, a.until_at)) act on true
    left join lateral (
      select min(m.sent_at) at from messages m
       where m.conversation_id = a.conversation_id and m.direction = 'in'
         and m.sent_at > act.at and m.sent_at <= coalesce(pay.paid_at, a.until_at)) rep on true
    left join lateral (
      select min(m.sent_at) at from messages m
       where m.conversation_id = a.conversation_id and m.direction = 'in' and m.raw ? 'referral'
         and m.sent_at > a.flagged_at and m.sent_at <= coalesce(pay.paid_at, a.until_at)) adc on true
   where a.workspace_id = p_ws and a.flagged_at < v_end and a.flagged_at >= v_start - interval '120 days';

  -- Average sale, for turning "extra customers" into money.
  select avg(val) into v_avg from _rs where order_id is not null and not holdout and ad_at is null;
  if v_avg is null then
    select avg(o.amount - o.discount - o.refund_amount) into v_avg from orders o
     where o.workspace_id = p_ws and o.status = 'paid' and o.paid_at > now() - interval '120 days';
  end if;
  v_avg := coalesce(v_avg, 0);

  -- Rule 9: shown vs kept aside. Only settled flags (paid, or window closed) from the 120 days up to the period end.
  select count(*) filter (where not holdout), count(*) filter (where not holdout and order_id is not null and ad_at is null),
         count(*) filter (where holdout),     count(*) filter (where holdout and order_id is not null and ad_at is null)
    into n1, k1, n0, k0
    from _rs where order_id is not null or until_at <= now();
  p1 := case when n1 > 0 then k1::numeric / n1 end;
  p0 := case when n0 > 0 then k0::numeric / n0 end;
  lift := p1 - p0;
  se := case when n1 > 0 and n0 > 0 then sqrt(p1 * (1 - p1) / n1 + p0 * (1 - p0) / n0) end;
  proven_ready := coalesce(n0 >= 30 and n1 >= 100, false);
  select count(*) filter (where not holdout), count(*) filter (where not holdout and kind = 'after_price')
    into m_period, m_ap_period from _rs where flagged_at >= v_start;

  -- Rule 10: the business's own past — customers who went quiet after a price before itaOS was watching.
  select coalesce(min(sent_at), (select created_at from workspaces where id = p_ws)) into itaos_start
    from messages where workspace_id = p_ws and origin in ('webhook', 'app_echo', 'itaos');
  select count(*), count(*) filter (where exists (
           select 1 from orders o where o.conversation_id = c.id and o.status = 'paid'
              and o.paid_at > c.price_shared_at + interval '24 hours' and o.paid_at <= c.price_shared_at + interval '15 days'))
    into hist_n, hist_k
    from conversations c join contacts ct on ct.id = c.contact_id and not ct.not_customer
   where c.workspace_id = p_ws and c.price_shared_at is not null
     and c.price_shared_at between itaos_start - interval '365 days' and itaos_start - interval '15 days'
     and not exists (select 1 from orders o where o.conversation_id = c.id and o.status = 'paid' and o.paid_at <= c.price_shared_at + interval '24 hours')
     and not exists (select 1 from messages m where m.conversation_id = c.id and m.direction = 'in'
                       and m.sent_at > c.price_shared_at and m.sent_at <= c.price_shared_at + interval '24 hours');
  p_hist := case when hist_n >= 30 then hist_k::numeric / hist_n end;
  select count(*), count(*) filter (where order_id is not null and ad_at is null) into ap_n, ap_k
    from _rs where kind = 'after_price' and not holdout and (order_id is not null or until_at <= now());

  -- Rule 15: shown customers nobody messaged, and what messaging them is worth in this business.
  select count(*) filter (where acted_at is not null), count(*) filter (where acted_at is not null and order_id is not null and ad_at is null),
         count(*) filter (where acted_at is null),     count(*) filter (where acted_at is null and order_id is not null and ad_at is null)
    into na, ka, nn, kn
    from _rs where not holdout and (order_id is not null or until_at <= now());
  select count(*) into ignored from _rs
   where not holdout and flagged_at >= v_start and until_at <= now() and acted_at is null and order_id is null;

  with credited as (
    select distinct on (r.order_id) r.*, case when r.replied_at is not null then 'very_likely' else 'likely' end tier
      from _rs r
     where not r.holdout and r.order_id is not null and r.ad_at is null and r.acted_at is not null
       and r.paid_at >= v_start and r.paid_at < v_end
     order by r.order_id, (r.replied_at is not null) desc, r.flagged_at
  ),
  other as (
    select distinct on (r.order_id) r.*, case when r.ad_at is not null then 'ad' else 'on_own' end tier
      from _rs r
     where not r.holdout and r.order_id is not null and (r.ad_at is not null or r.acted_at is null)
       and r.paid_at >= v_start and r.paid_at < v_end
       and not exists (select 1 from credited c where c.order_id = r.order_id)
     order by r.order_id, r.flagged_at
  ),
  tiers as (
    select tier, sum(val) amount, count(*) orders from (select tier, val from credited union all select tier, val from other) x group by tier
  )
  select jsonb_build_object(
    'currency', (select currency from workspaces where id = p_ws),
    'days', v_days,
    'price_month', (select price_month from workspace_admin_state where workspace_id = p_ws),
    'method', case when proven_ready then 'proven' else 'evidence' end,
    'headline', case when proven_ready then greatest(lift, 0) * m_period * v_avg
                     else coalesce((select amount from tiers where tier = 'very_likely'), 0) end,
    'headline_low',  case when proven_ready then greatest(lift - 1.645 * se, 0) * m_period * v_avg end,
    'headline_high', case when proven_ready then greatest(lift + 1.645 * se, 0) * m_period * v_avg end,
    'proof', jsonb_build_object('ready', proven_ready, 'shown_n', n1, 'shown_paid', k1, 'hidden_n', n0, 'hidden_paid', k0,
               'shown_rate', p1, 'hidden_rate', p0, 'need_hidden', 30, 'need_shown', 100, 'exact', n0 >= 100,
               'pct', coalesce((select holdout_pct from workspace_admin_state where workspace_id = p_ws), 10),
               'extra_customers', case when proven_ready then round(greatest(lift, 0) * m_period) end),
    'past', jsonb_build_object('ready', p_hist is not null and ap_n >= 10, 'n', hist_n, 'paid', hist_k, 'rate', p_hist,
               'now_n', ap_n, 'now_paid', ap_k, 'now_rate', case when ap_n > 0 then ap_k::numeric / ap_n end,
               'extra', case when p_hist is not null and ap_n >= 10 then greatest(ap_k::numeric / ap_n - p_hist, 0) * m_ap_period * v_avg end),
    'tiers', jsonb_build_object(
               'very_likely', jsonb_build_object('amount', coalesce((select amount from tiers where tier = 'very_likely'), 0), 'orders', coalesce((select orders from tiers where tier = 'very_likely'), 0)),
               'likely',      jsonb_build_object('amount', coalesce((select amount from tiers where tier = 'likely'), 0),      'orders', coalesce((select orders from tiers where tier = 'likely'), 0)),
               'on_own',      jsonb_build_object('amount', coalesce((select amount from tiers where tier = 'on_own'), 0),      'orders', coalesce((select orders from tiers where tier = 'on_own'), 0)),
               'ad',          jsonb_build_object('amount', coalesce((select amount from tiers where tier = 'ad'), 0),          'orders', coalesce((select orders from tiers where tier = 'ad'), 0))),
    'by_kind', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'amount', a, 'orders', n) order by a desc)
                           from (select kind, sum(val) a, count(*) n from credited group by kind) s), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                         'order_id', x.order_id, 'conversation_id', x.conversation_id, 'amount', x.val, 'tier', x.tier, 'kind', x.kind,
                         'flagged_at', x.flagged_at, 'acted_at', x.acted_at, 'replied_at', x.replied_at, 'paid_at', x.paid_at,
                         'name', coalesce(nullif(ct.full_name, ''), nullif(ct.name, ''), ct.wa_id)) order by x.paid_at desc)
                         from (select order_id, conversation_id, contact_id, val, tier, kind, flagged_at, acted_at, replied_at, paid_at from credited
                               union all
                               select order_id, conversation_id, contact_id, val, tier, kind, flagged_at, acted_at, replied_at, paid_at from other) x
                         join contacts ct on ct.id = x.contact_id), '[]'::jsonb),
    'total', coalesce((select sum(val) from credited), 0),
    'orders', (select count(*) from credited),
    'waiting', (select count(distinct conversation_id) from _rs where not holdout and until_at > now() and order_id is null and acted_at is not null),
    'left', jsonb_build_object('ignored', ignored,
               'amount', case when na >= 10 and nn >= 10 then greatest(ka::numeric / na - kn::numeric / nn, 0) * ignored * v_avg end,
               'acted_rate', case when na > 0 then ka::numeric / na end, 'ignored_rate', case when nn > 0 then kn::numeric / nn end),
    'found_orders', (select count(*) from orders o where o.workspace_id = p_ws and o.status = 'paid' and o.inferred_from is not null
                       and o.paid_at >= v_start and o.paid_at < v_end),
    'found_amount', coalesce((select sum(o.amount - o.discount - o.refund_amount) from orders o where o.workspace_id = p_ws and o.status = 'paid'
                       and o.inferred_from is not null and o.paid_at >= v_start and o.paid_at < v_end), 0)
  ) into res;
  return res;
end $$;
revoke all on function public.recovered_sales(uuid, date, date) from public, anon;
grant execute on function public.recovered_sales(uuid, date, date) to authenticated;
