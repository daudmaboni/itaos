-- 0070_proof_v2_customer_trial — "Money itaOS brought back", method v2 (22 Nov 2026).
-- After an outside review of v1 (0068). What changed and why:
--
--  1. Customers are randomized, not flags. Each customer is assigned ONCE per method version (atrisk_assign), at their
--     first fresh flag: "show" or "hold". A held customer stays hidden for that whole window (every kind of flag);
--     a shown customer is never moved to hold later. Stops one person landing in both groups.
--  2. Balanced (blocked) assignment inside each stratum = flag kind × Kito temperature: in every block of 10
--     (at 10%) exactly one customer is held, at a position nobody can predict. Small months can't come out lopsided.
--  3. Intention to treat: everyone is compared in the group they were assigned to, whether or not the owner acted.
--     A held customer the owner messaged anyway stays "hold" and is reported as contamination.
--  4. Outcome per customer over a fixed window that starts at assignment: bought anything (paid, net > 0) in any of
--     their chats, and how much. Only closed windows are compared. New-ad sales are NOT removed from the trial
--     (that would be judging by what happened after assignment).
--  5. Wilson intervals per group, Newcombe interval for the difference in buying rate; money = difference in revenue
--     per assigned customer (zeros included) × customers shown, with a Welch interval.
--  6. Status: learning (fewer than 30 held / 100 shown closed) → estimate (range still touches zero) →
--     clear (the whole 95% range of the buying-rate difference is above zero).
--  7. The observational parts are labelled as such: "sales after your follow-ups" (messaged → paid), the business's
--     past (context only), and a COUNT of flagged customers nobody messaged (no money guess).
-- The method is frozen as 'v2'; changing it means a new version and a fresh trial.

-- 1. Assignments -------------------------------------------------------------------------------------------
create table if not exists public.atrisk_assign (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id   uuid not null references public.contacts(id) on delete cascade,
  version      text not null,
  arm          text not null check (arm in ('show', 'hold')),
  stratum      text not null,
  pct          int not null,
  flag_id      bigint references public.atrisk_flags(id) on delete set null,
  kind         text not null,
  assigned_at  timestamptz not null,
  until_at     timestamptz not null,
  created_at   timestamptz not null default now(),
  unique (workspace_id, contact_id, version)
);
create index if not exists atrisk_assign_ws_idx on public.atrisk_assign (workspace_id, version, stratum);
alter table public.atrisk_assign enable row level security;
revoke all on public.atrisk_assign from anon, authenticated;
comment on table public.atrisk_assign is 'One row per customer per method version: shown or held (kept aside) to measure what itaOS adds (0070).';

alter table public.atrisk_flags add column if not exists fresh boolean not null default false;
comment on column public.atrisk_flags.fresh is 'Flagged within 2 hours of becoming at-risk and not yet seen by the owner: may start a trial assignment.';

-- 2. Finding customers + assigning them ---------------------------------------------------------------------
create or replace function private.atrisk_scan(p_ws uuid, p_holdout boolean default true)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_ver constant text := 'v2';
  pct int; maxid bigint; n int := 0; k int; rf record; cnt int; bsize int; slot int; arm text;
begin
  perform pg_advisory_xact_lock(hashtext('atrisk:' || p_ws::text));
  select coalesce((select holdout_pct from workspace_admin_state where workspace_id = p_ws), 10) into pct;
  if not p_holdout then pct := 0; end if;
  select coalesce(max(id), 0) into maxid from atrisk_flags;

  -- after the price
  insert into atrisk_flags (workspace_id, conversation_id, contact_id, kind, flagged_at, until_at, fresh)
  select c.workspace_id, c.id, c.contact_id, 'after_price', f.at, f.at + interval '14 days', p_holdout and f.at > now() - interval '2 hours'
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

  -- promises Kito found (only a still-unconfirmed, just-found promise can start a trial)
  insert into atrisk_flags (workspace_id, conversation_id, contact_id, kind, flagged_at, until_at, task_id, fresh)
  select t.workspace_id, t.conversation_id, c.contact_id, 'promise', t.created_at,
         greatest(coalesce(t.due_at, t.created_at), t.created_at) + interval '14 days', t.id,
         p_holdout and t.status = 'proposed' and t.created_at > now() - interval '2 hours'
    from follow_up_tasks t
    join conversations c on c.id = t.conversation_id
    join contacts ct on ct.id = c.contact_id and not ct.not_customer
   where t.workspace_id = p_ws and t.source = 'kito_promise'
     and (t.status in ('proposed', 'open', 'snoozed', 'done') or (t.status = 'dismissed' and t.result = 'paid'))
     and t.created_at > now() - interval '120 days'
     and not exists (select 1 from atrisk_flags x where x.task_id = t.id);
  get diagnostics k = row_count; n := n + k;

  -- past buyers due a reorder (one flag per purchase)
  insert into atrisk_flags (workspace_id, conversation_id, contact_id, kind, flagged_at, until_at, fresh)
  select c.workspace_id, c.id, c.contact_id, 'reorder', f.at, f.at + interval '30 days', p_holdout and f.at > now() - interval '2 hours'
    from (select distinct on (o.conversation_id) o.conversation_id, o.paid_at
            from orders o where o.workspace_id = p_ws and o.status = 'paid' and o.conversation_id is not null and o.paid_at is not null
           order by o.conversation_id, o.paid_at desc) lp
    join conversations c on c.id = lp.conversation_id
    join contacts ct on ct.id = c.contact_id and not ct.not_customer
    cross join lateral (select lp.paid_at + interval '45 days' as at) f
   where lp.paid_at between now() - interval '120 days' and now() - interval '45 days'
     and not exists (select 1 from atrisk_flags x where x.conversation_id = c.id and x.kind = 'reorder' and x.flagged_at > lp.paid_at);
  get diagnostics k = row_count; n := n + k;

  -- New flags, oldest first: hide anyone in an open hold window; assign fresh, never-assigned customers.
  for rf in
    select a.id, a.contact_id, a.kind, a.flagged_at, a.until_at, a.fresh, coalesce(c.kito_temp, 'unknown') temp
      from atrisk_flags a join conversations c on c.id = a.conversation_id
     where a.workspace_id = p_ws and a.id > maxid
     order by a.flagged_at, a.id
  loop
    if exists (select 1 from atrisk_assign s where s.contact_id = rf.contact_id and s.arm = 'hold' and s.until_at > now())
       or exists (select 1 from atrisk_flags h where h.contact_id = rf.contact_id and h.holdout and h.id <> rf.id and h.until_at > now()) then
      update atrisk_flags set holdout = true where id = rf.id;
      continue;
    end if;
    if rf.fresh and pct > 0
       and not exists (select 1 from atrisk_assign s where s.workspace_id = p_ws and s.contact_id = rf.contact_id and s.version = v_ver)
       and not exists (select 1 from atrisk_flags h where h.contact_id = rf.contact_id and h.holdout) then
      -- blocked randomization inside the stratum: one hold per block, at a hidden position
      bsize := greatest(round(100.0 / pct)::int, 2);
      select count(*) into cnt from atrisk_assign s where s.workspace_id = p_ws and s.version = v_ver and s.stratum = rf.kind || ':' || rf.temp;
      slot := abs(hashtext(p_ws::text || v_ver || rf.kind || ':' || rf.temp || ':' || (cnt / bsize)::text || ':' || bsize::text)) % bsize;
      arm := case when cnt % bsize = slot then 'hold' else 'show' end;
      insert into atrisk_assign (workspace_id, contact_id, version, arm, stratum, pct, flag_id, kind, assigned_at, until_at)
      values (p_ws, rf.contact_id, v_ver, arm, rf.kind || ':' || rf.temp, pct, rf.id, rf.kind, rf.flagged_at, rf.until_at);
      if arm = 'hold' then update atrisk_flags set holdout = true where id = rf.id; end if;
    end if;
  end loop;
  return n;
end $$;
revoke all on function private.atrisk_scan(uuid, boolean) from public, anon, authenticated;

-- 3. Small-sample intervals ---------------------------------------------------------------------------------
create or replace function private.wilson(k numeric, n numeric, z numeric default 1.96, out lo numeric, out hi numeric)
language sql immutable as $$
  select case when n > 0 then ((k + z*z/2) - z * sqrt(k * (n - k) / n + z*z/4)) / (n + z*z) end,
         case when n > 0 then ((k + z*z/2) + z * sqrt(k * (n - k) / n + z*z/4)) / (n + z*z) end;
$$;

-- 4. The number ---------------------------------------------------------------------------------------------
create or replace function public.recovered_sales(p_ws uuid, p_from date, p_to date)
returns jsonb
language plpgsql volatile security definer set search_path = public, private as $$   -- volatile: uses a scratch table
declare
  v_ver constant text := 'v2';
  tz text; v_start timestamptz; v_end timestamptz; v_days int := p_to - p_from + 1;
  ns int; ks int; nh int; kh int; rs numeric; rh numeric; ss numeric; sh numeric;
  fol int; con int; pend_s int; pend_h int; show_period int; pct int;
  ps numeric; ph numeric; ws_lo numeric; ws_hi numeric; wh_lo numeric; wh_hi numeric;
  d numeric; d_lo numeric; d_hi numeric; md numeric; md_se numeric;
  status text; exp_start timestamptz;
  hist_n int := 0; hist_k int := 0; itaos_start timestamptz; res jsonb;
begin
  if not public.is_member(p_ws) then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(timezone, 'Africa/Dar_es_Salaam') into tz from workspaces where id = p_ws;
  v_start := p_from::timestamp at time zone tz;
  v_end   := (p_to + 1)::timestamp at time zone tz;
  select coalesce((select holdout_pct from workspace_admin_state where workspace_id = p_ws), 10) into pct;

  -- 4a. The trial: one row per assigned customer, outcome over their window (all their chats).
  create temp table if not exists _tr (arm text, assigned_at timestamptz, until_at timestamptz, closed boolean,
                                       bought boolean, rev numeric, messaged boolean) on commit drop;
  truncate _tr;
  insert into _tr
  select s.arm, s.assigned_at, s.until_at, s.until_at <= now(),
         coalesce(o.n, 0) > 0, coalesce(o.rev, 0),
         exists (select 1 from messages m join conversations c2 on c2.id = m.conversation_id
                  where c2.contact_id = s.contact_id and m.direction = 'out' and m.sent_at > s.assigned_at and m.sent_at <= s.until_at)
    from atrisk_assign s
    join contacts ct on ct.id = s.contact_id and not ct.not_customer
    left join lateral (
      select count(*) n, sum(x.amount - x.discount - x.refund_amount) rev
        from orders x join conversations c on c.id = x.conversation_id
       where c.contact_id = s.contact_id and x.status = 'paid'
         and x.paid_at > s.assigned_at and x.paid_at <= s.until_at and (x.amount - x.discount - x.refund_amount) > 0) o on true
   where s.workspace_id = p_ws and s.version = v_ver and s.assigned_at < v_end;
  select min(assigned_at) into exp_start from atrisk_assign where workspace_id = p_ws and version = v_ver;

  select count(*) filter (where arm = 'show' and closed), count(*) filter (where arm = 'show' and closed and bought),
         count(*) filter (where arm = 'hold' and closed), count(*) filter (where arm = 'hold' and closed and bought),
         coalesce(sum(rev) filter (where arm = 'show' and closed), 0), coalesce(sum(rev) filter (where arm = 'hold' and closed), 0),
         coalesce(sum(rev * rev) filter (where arm = 'show' and closed), 0), coalesce(sum(rev * rev) filter (where arm = 'hold' and closed), 0),
         count(*) filter (where arm = 'show' and closed and messaged), count(*) filter (where arm = 'hold' and closed and messaged),
         count(*) filter (where arm = 'show' and not closed), count(*) filter (where arm = 'hold' and not closed),
         count(*) filter (where arm = 'show' and assigned_at >= v_start)
    into ns, ks, nh, kh, rs, rh, ss, sh, fol, con, pend_s, pend_h, show_period
    from _tr;

  ps := case when ns > 0 then ks::numeric / ns end;
  ph := case when nh > 0 then kh::numeric / nh end;
  select lo, hi into ws_lo, ws_hi from private.wilson(ks, ns);
  select lo, hi into wh_lo, wh_hi from private.wilson(kh, nh);
  if ns > 0 and nh > 0 then
    d := ps - ph;                                                       -- Newcombe (hybrid score) 95%
    d_lo := d - sqrt((ps - ws_lo)^2 + (wh_hi - ph)^2);
    d_hi := d + sqrt((ws_hi - ps)^2 + (ph - wh_lo)^2);
  end if;
  if ns > 1 and nh > 1 then                                             -- revenue per assigned customer, Welch
    md := rs / ns - rh / nh;
    md_se := sqrt(greatest(ss / ns - (rs / ns)^2, 0) * ns / (ns - 1) / ns + greatest(sh / nh - (rh / nh)^2, 0) * nh / (nh - 1) / nh);
  end if;
  status := case when nh < 30 or ns < 100 then 'learning'
                 when d_lo > 0 and md > 0 then 'clear'
                 else 'estimate' end;
  if pct = 0 and status = 'learning' then status := 'off'; end if;

  -- 4b. Context only: the business's past (customers who went quiet after a price before itaOS was watching).
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

  -- 4c. Observational journeys on shown flags: messaged → (replied) → paid. Never added to the trial number.
  create temp table if not exists _rs (
    id bigint, conversation_id uuid, contact_id uuid, kind text, flagged_at timestamptz, until_at timestamptz,
    order_id uuid, paid_at timestamptz, val numeric, acted_at timestamptz, replied_at timestamptz, ad_at timestamptz
  ) on commit drop;
  truncate _rs;
  insert into _rs
  select a.id, a.conversation_id, a.contact_id, a.kind, a.flagged_at, a.until_at,
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
   where a.workspace_id = p_ws and not a.holdout and a.flagged_at < v_end and a.flagged_at >= v_start - interval '120 days';

  with j as (
    select distinct on (r.order_id) r.*,
           case when r.ad_at is not null then 'ad' when r.acted_at is null then 'on_own'
                when r.replied_at is not null then 'very_likely' else 'likely' end tier
      from _rs r
     where r.order_id is not null and r.paid_at >= v_start and r.paid_at < v_end
     order by r.order_id, (r.ad_at is null and r.acted_at is not null) desc, (r.replied_at is not null) desc, r.flagged_at
  ),
  tiers as (select tier, sum(val) amount, count(*) orders from j group by tier)
  select jsonb_build_object(
    'version', v_ver, 'experiment_start', exp_start,
    'currency', (select currency from workspaces where id = p_ws),
    'days', v_days,
    'price_month', (select price_month from workspace_admin_state where workspace_id = p_ws),
    'status', status,
    'trial', jsonb_build_object(
       'pct', pct, 'need_hold', 30, 'need_show', 100, 'pending_show', pend_s, 'pending_hold', pend_h,
       'show', jsonb_build_object('n', ns, 'bought', ks, 'rate', ps, 'rate_lo', ws_lo, 'rate_hi', ws_hi,
                                  'revenue', rs, 'per_customer', case when ns > 0 then rs / ns end, 'messaged', fol),
       'hold', jsonb_build_object('n', nh, 'bought', kh, 'rate', ph, 'rate_lo', wh_lo, 'rate_hi', wh_hi,
                                  'revenue', rh, 'per_customer', case when nh > 0 then rh / nh end, 'contaminated', con),
       'diff_rate', d, 'diff_lo', d_lo, 'diff_hi', d_hi,
       'shown_in_period', show_period,
       'extra', case when md is not null then md * show_period end,
       'extra_lo', case when md is not null then (md - 1.96 * md_se) * show_period end,
       'extra_hi', case when md is not null then (md + 1.96 * md_se) * show_period end,
       'extra_customers', case when d is not null then round(d * show_period) end),
    'recorded', jsonb_build_object(
       'amount', coalesce((select sum(amount) from tiers where tier in ('very_likely', 'likely')), 0),
       'orders', coalesce((select sum(orders) from tiers where tier in ('very_likely', 'likely')), 0)),
    'tiers', jsonb_build_object(
       'very_likely', jsonb_build_object('amount', coalesce((select amount from tiers where tier = 'very_likely'), 0), 'orders', coalesce((select orders from tiers where tier = 'very_likely'), 0)),
       'likely',      jsonb_build_object('amount', coalesce((select amount from tiers where tier = 'likely'), 0),      'orders', coalesce((select orders from tiers where tier = 'likely'), 0)),
       'on_own',      jsonb_build_object('amount', coalesce((select amount from tiers where tier = 'on_own'), 0),      'orders', coalesce((select orders from tiers where tier = 'on_own'), 0)),
       'ad',          jsonb_build_object('amount', coalesce((select amount from tiers where tier = 'ad'), 0),          'orders', coalesce((select orders from tiers where tier = 'ad'), 0))),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                         'order_id', j.order_id, 'conversation_id', j.conversation_id, 'amount', j.val, 'tier', j.tier, 'kind', j.kind,
                         'flagged_at', j.flagged_at, 'acted_at', j.acted_at, 'replied_at', j.replied_at, 'paid_at', j.paid_at,
                         'name', coalesce(nullif(ct.full_name, ''), nullif(ct.name, ''), ct.wa_id)) order by j.paid_at desc)
                         from j join contacts ct on ct.id = j.contact_id), '[]'::jsonb),
    'waiting', (select count(distinct conversation_id) from _rs where until_at > now() and order_id is null and acted_at is not null),
    'no_message', (select count(distinct conversation_id) from _rs where flagged_at >= v_start and until_at <= now() and acted_at is null and order_id is null),
    'past', jsonb_build_object('n', hist_n, 'paid', hist_k, 'rate', case when hist_n >= 30 then hist_k::numeric / hist_n end),
    'capture', (select jsonb_build_object('entered', count(*) filter (where o.inferred_from is null), 'detected', count(*) filter (where o.inferred_from is not null))
                  from orders o where o.workspace_id = p_ws and o.status = 'paid' and o.paid_at >= v_start and o.paid_at < v_end),
    'found_orders', (select count(*) from orders o where o.workspace_id = p_ws and o.status = 'paid' and o.inferred_from is not null
                       and o.paid_at >= v_start and o.paid_at < v_end),
    'found_amount', coalesce((select sum(o.amount - o.discount - o.refund_amount) from orders o where o.workspace_id = p_ws and o.status = 'paid'
                       and o.inferred_from is not null and o.paid_at >= v_start and o.paid_at < v_end), 0)
  ) into res;
  return res;
end $$;
revoke all on function public.recovered_sales(uuid, date, date) from public, anon;
grant execute on function public.recovered_sales(uuid, date, date) to authenticated;

-- 5. Staff view of the trial --------------------------------------------------------------------------------
create or replace function public.admin_holdout(p_ws uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  with s as (
    select a.*, a.until_at <= now() closed,
           exists (select 1 from orders x join conversations c on c.id = x.conversation_id
                    where c.contact_id = a.contact_id and x.status = 'paid' and x.paid_at > a.assigned_at and x.paid_at <= a.until_at
                      and (x.amount - x.discount - x.refund_amount) > 0) bought,
           exists (select 1 from messages m join conversations c on c.id = m.conversation_id
                    where c.contact_id = a.contact_id and m.direction = 'out' and m.sent_at > a.assigned_at and m.sent_at <= a.until_at) messaged
      from atrisk_assign a where a.workspace_id = p_ws and a.version = 'v2'
  )
  select jsonb_build_object(
    'version', 'v2',
    'pct', coalesce((select holdout_pct from workspace_admin_state where workspace_id = p_ws), 10),
    'flags', (select count(*) from atrisk_flags where workspace_id = p_ws and flagged_at > now() - interval '120 days'),
    'by_kind', coalesce((select jsonb_object_agg(kind, n) from (select kind, count(*) n from atrisk_flags
                           where workspace_id = p_ws and flagged_at > now() - interval '120 days' group by kind) k), '{}'::jsonb),
    'assigned', (select count(*) from s),
    'kept_aside_now', (select count(*) from s where arm = 'hold' and not closed),
    'shown_settled', (select count(*) from s where arm = 'show' and closed),
    'shown_paid', (select count(*) from s where arm = 'show' and closed and bought),
    'shown_messaged', (select count(*) from s where arm = 'show' and closed and messaged),
    'hidden_settled', (select count(*) from s where arm = 'hold' and closed),
    'hidden_paid', (select count(*) from s where arm = 'hold' and closed and bought),
    'contaminated', (select count(*) from s where arm = 'hold' and closed and messaged),
    'strata', coalesce((select jsonb_object_agg(stratum, jsonb_build_object('show', sh, 'hold', ho))
                          from (select stratum, count(*) filter (where arm = 'show') sh, count(*) filter (where arm = 'hold') ho from s group by stratum) t), '{}'::jsonb),
    'last_flag', (select max(flagged_at) from atrisk_flags where workspace_id = p_ws)
  ) into r;
  return r;
end $$;
