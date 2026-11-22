-- Ad money manager (22 Nov 2026).
-- One call that gives, per ad, what the owner needs to decide where ad money goes:
-- spend, chats (Meta's count and the chats itaOS saw), price shared, PAID sales and revenue.
--
-- Rules
--  - Spend and Meta chats are summed by day inside the window (business timezone).
--  - Chats itaOS saw: ad chats that STARTED inside the window.
--  - Paid sales: paid orders whose paid_at falls inside the window (the sale counts on the day of
--    payment), from a chat that came from the ad, paid within the business's conversion window
--    after that chat started. "Not a customer" contacts never count.
--  - Which ad a chat came from:
--      exact  = Meta's ad referral on the chat (or the ad saved on the order).
--      shared = the chat is an ad chat with no referral (Dualhook often delivers the ad greeting card
--               as an error). It is split between the ads that ran that day, in proportion to the chats
--               Meta reports for each ad that day (spend share when Meta reports none). One chat never
--               counts more than once in total. Shown as an estimate, never mixed up with exact.
--      Ad chats from a day when no ad ran stay "unmatched".
create or replace function public.ad_money(p_ws uuid, p_days int default 14)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text; v_win int; v_cur text; v_unit numeric; v_fx numeric;
  v_to date; v_from date; v_days int := greatest(1, least(coalesce(p_days, 14), 90));
  v_out jsonb;
begin
  if not public.is_member(p_ws) then raise exception 'not a member of this business'; end if;
  select coalesce(timezone, 'Africa/Dar_es_Salaam'), coalesce(conversion_window_days, 30), currency, unit_cost, fx_rate
    into v_tz, v_win, v_cur, v_unit, v_fx
    from workspaces where id = p_ws;
  v_to := (now() at time zone v_tz)::date;
  v_from := v_to - (v_days - 1);

  with
  -- Each ad's share of the day's ad chats (Meta's count), or of spend when Meta reports no chats.
  dayads as (
    select i.day, i.ad_id, i.spend, i.messaging_conversations mc,
           sum(i.messaging_conversations) over (partition by i.day) day_mc,
           sum(i.spend) over (partition by i.day) day_spend
    from ad_insights_daily i
    where i.workspace_id = p_ws and (i.spend > 0 or i.messaging_conversations > 0)
      and i.day between v_from - v_win - 1 and v_to
  ),
  share as (
    select day, ad_id,
           case when day_mc > 0 then mc::numeric / day_mc when day_spend > 0 then spend / day_spend else 0 end w
    from dayads
  ),
  -- Every ad chat that could matter: started in the window, or early enough to be paid in it.
  chat as (
    select c.id, c.started_at, (c.started_at at time zone v_tz)::date start_day, c.price_shared, c.ad_id
    from conversations c
    join contacts k on k.id = c.contact_id
    where c.workspace_id = p_ws and c.source = 'ad' and c.started_at is not null
      and coalesce(k.not_customer, false) = false
      and (c.started_at at time zone v_tz)::date between v_from - v_win and v_to
  ),
  -- chat → ad rows with a weight (1 for exact; the day's share for untagged chats).
  ch as (
    select c.id, c.started_at, c.start_day, c.price_shared, c.ad_id, 1::numeric w, 'exact' how
    from chat c where c.ad_id is not null
    union all
    select c.id, c.started_at, c.start_day, c.price_shared, s.ad_id, s.w, 'shared'
    from chat c join share s on s.day = c.start_day and s.w > 0
    where c.ad_id is null
  ),
  chats_in as (select * from ch where start_day between v_from and v_to),
  -- Paid orders in the window (the sale counts on the day of payment), from ad chats.
  ord as (
    select o.id, o.conversation_id, o.ad_id, o.paid_at, o.amount - o.discount - o.refund_amount net
    from orders o
    left join contacts k on k.id = o.contact_id
    where o.workspace_id = p_ws and o.status = 'paid' and o.paid_at is not null
      and (o.paid_at at time zone v_tz)::date between v_from and v_to
      and coalesce(k.not_customer, false) = false
  ),
  paid as (
    -- the order names its ad
    select o.id, o.net, o.ad_id, 1::numeric w, 'exact' how from ord o where o.ad_id is not null
    union all
    -- otherwise the ad(s) of its chat, paid inside the conversion window
    select o.id, o.net, ch.ad_id, ch.w, ch.how
    from ord o join ch on ch.id = o.conversation_id
    where o.ad_id is null and o.paid_at <= ch.started_at + make_interval(days => v_win)
  ),
  ad_orders as (
    select o.id from ord o
    where o.ad_id is not null
       or exists (select 1 from chat c where c.id = o.conversation_id and o.paid_at <= c.started_at + make_interval(days => v_win))
  ),
  sp as (
    select i.ad_id, sum(i.spend) spend, sum(i.messaging_conversations) meta_chats, max(i.currency) currency,
           sum(i.spend) filter (where i.day > v_to - 7) spend7,
           max(i.day) filter (where i.spend > 0) last_spend_day,
           min(i.day) filter (where i.spend > 0) first_spend_day
    from ad_insights_daily i
    where i.workspace_id = p_ws and i.day between v_from and v_to
    group by i.ad_id
  ),
  cs as (
    select ad_id, round(sum(w), 2) chats, count(*) filter (where how = 'exact') chats_exact,
           round(sum(w) filter (where price_shared), 2) priced
    from chats_in group by ad_id
  ),
  ps as (
    select ad_id, round(sum(w), 2) sales, count(*) filter (where how = 'exact') sales_exact, round(sum(net * w)) revenue
    from paid group by ad_id
  ),
  rows as (
    select coalesce(sp.ad_id, cs.ad_id, ps.ad_id) ad_id from sp
    full join cs on cs.ad_id = sp.ad_id
    full join ps on ps.ad_id = coalesce(sp.ad_id, cs.ad_id)
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to, 'days', v_days, 'currency', v_cur, 'unit_cost', v_unit, 'fx_rate', v_fx,
    'ad_currency', (select max(currency) from sp),
    'totals', jsonb_build_object(
      'spend', coalesce((select sum(spend) from sp), 0),
      'meta_chats', coalesce((select sum(meta_chats) from sp), 0),
      'ad_chats', (select count(*) from chat where start_day between v_from and v_to),
      'shared_chats', (select count(distinct id) from chats_in where how = 'shared'),
      'unmatched_chats', (select count(*) from chat c where c.start_day between v_from and v_to
                            and not exists (select 1 from chats_in x where x.id = c.id)),
      'ad_sales', (select count(*) from ad_orders),
      'ad_revenue', coalesce((select sum(o.net) from ord o join ad_orders a on a.id = o.id), 0),
      'shared_sales', (select count(distinct id) from paid where how = 'shared'),
      'unmatched_sales', (select count(*) from ad_orders a where not exists (select 1 from paid p where p.id = a.id)),
      'all_sales', (select count(*) from ord),
      'all_revenue', coalesce((select sum(net) from ord), 0)
    ),
    'ads', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ad_id', r.ad_id, 'name', a.name, 'adset', a.adset_name, 'campaign', a.campaign_name,
        'account', a.ad_account_id, 'status', a.effective_status,
        'spend', coalesce(sp.spend, 0), 'spend7', coalesce(sp.spend7, 0), 'meta_chats', coalesce(sp.meta_chats, 0),
        'first_spend_day', sp.first_spend_day, 'last_spend_day', sp.last_spend_day,
        'chats', coalesce(cs.chats, 0), 'chats_exact', coalesce(cs.chats_exact, 0), 'priced', coalesce(cs.priced, 0),
        'sales', coalesce(ps.sales, 0), 'sales_exact', coalesce(ps.sales_exact, 0), 'revenue', coalesce(ps.revenue, 0)
      ) order by coalesce(sp.spend, 0) desc)
      from rows r
      left join sp on sp.ad_id = r.ad_id left join cs on cs.ad_id = r.ad_id left join ps on ps.ad_id = r.ad_id
      left join ads a on a.ad_id = r.ad_id and a.workspace_id = p_ws
    ), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
revoke execute on function public.ad_money(uuid, int) from public, anon;
grant execute on function public.ad_money(uuid, int) to authenticated;
comment on function public.ad_money(uuid, int) is 'Ad money manager: per-ad spend, chats and paid sales (exact, or shared by each ad daily share of Meta chats) for the last p_days days.';
