-- 22 Nov 2026 — Money card honesty fixes (after the Mistral review).
-- recovered_sales v2.1 = v2 plus a "strict" view without the sales itaOS recorded ON ITS OWN from the owner's
-- ✅ / "money received" messages (orders.inferred_from = 'tick', the only orders created with no person
-- pressing a button). Nothing about assignment, windows or the status rule changes, so the trial stays v2.
--   trial.extra_strict(_lo/_hi): the same Welch difference computed only on the other orders.
--   recorded.tick_orders / tick_amount: how much of "sales after your follow-ups" came from those messages.

create or replace function public.recovered_sales(p_ws uuid, p_from date, p_to date)
returns jsonb
language plpgsql volatile security definer set search_path = public, private as $$   -- volatile: uses a scratch table
declare
  v_ver constant text := 'v2';
  tz text; v_start timestamptz; v_end timestamptz; v_days int := p_to - p_from + 1;
  ns int; ks int; nh int; kh int; rs numeric; rh numeric; ss numeric; sh numeric;
  fol int; con int; ss_rs numeric; sh_rs numeric; ss_ss numeric; sh_ss numeric; md_s numeric; md_s_se numeric; pend_s int; pend_h int; show_period int; pct int;
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
                                       bought boolean, rev numeric, messaged boolean, rev_s numeric) on commit drop;
  truncate _tr;
  insert into _tr
  select s.arm, s.assigned_at, s.until_at, s.until_at <= now(),
         coalesce(o.n, 0) > 0, coalesce(o.rev, 0),
         exists (select 1 from messages m join conversations c2 on c2.id = m.conversation_id
                  where c2.contact_id = s.contact_id and m.direction = 'out' and m.sent_at > s.assigned_at and m.sent_at <= s.until_at),
         coalesce(o.rev_s, 0)
    from atrisk_assign s
    join contacts ct on ct.id = s.contact_id and not ct.not_customer
    left join lateral (
      select count(*) n, sum(x.amount - x.discount - x.refund_amount) rev,
             sum(x.amount - x.discount - x.refund_amount) filter (where x.inferred_from is distinct from 'tick') rev_s
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
  -- Same difference without the sales itaOS recorded on its own from the owner's ✅ / "money received" messages.
  select coalesce(sum(rev_s) filter (where arm = 'show' and closed), 0), coalesce(sum(rev_s) filter (where arm = 'hold' and closed), 0),
         coalesce(sum(rev_s * rev_s) filter (where arm = 'show' and closed), 0), coalesce(sum(rev_s * rev_s) filter (where arm = 'hold' and closed), 0)
    into ss_rs, sh_rs, ss_ss, sh_ss from _tr;
  if ns > 1 and nh > 1 then
    md_s := ss_rs / ns - sh_rs / nh;
    md_s_se := sqrt(greatest(ss_ss / ns - (ss_rs / ns)^2, 0) * ns / (ns - 1) / ns + greatest(sh_ss / nh - (sh_rs / nh)^2, 0) * nh / (nh - 1) / nh);
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
    order_id uuid, paid_at timestamptz, val numeric, tick boolean, acted_at timestamptz, replied_at timestamptz, ad_at timestamptz
  ) on commit drop;
  truncate _rs;
  insert into _rs
  select a.id, a.conversation_id, a.contact_id, a.kind, a.flagged_at, a.until_at,
         pay.id, pay.paid_at, pay.val, coalesce(pay.tick, false), act.at, rep.at, adc.at
    from atrisk_flags a
    join contacts ct on ct.id = a.contact_id and not ct.not_customer
    left join lateral (
      select o.id, o.paid_at, (o.amount - o.discount - o.refund_amount) val, o.inferred_from = 'tick' tick from orders o
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
  tiers as (select tier, sum(val) amount, count(*) orders, sum(val) filter (where tick) tick_amount, count(*) filter (where tick) tick_orders from j group by tier)
  select jsonb_build_object(
    'version', v_ver, 'methodology', 'v2.1', 'experiment_start', exp_start,
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
       'extra_customers', case when d is not null then round(d * show_period) end,
       'extra_strict', case when md_s is not null then md_s * show_period end,
       'extra_strict_lo', case when md_s is not null then (md_s - 1.96 * md_s_se) * show_period end,
       'extra_strict_hi', case when md_s is not null then (md_s + 1.96 * md_s_se) * show_period end),
    'recorded', jsonb_build_object(
       'amount', coalesce((select sum(amount) from tiers where tier in ('very_likely', 'likely')), 0),
       'orders', coalesce((select sum(orders) from tiers where tier in ('very_likely', 'likely')), 0),
       'tick_amount', coalesce((select sum(tick_amount) from tiers where tier in ('very_likely', 'likely')), 0),
       'tick_orders', coalesce((select sum(tick_orders) from tiers where tier in ('very_likely', 'likely')), 0)),
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
