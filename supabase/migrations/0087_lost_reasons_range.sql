-- 0087 "Why people didn't buy" follows the page's date range and Filters (25 Nov 2026).
-- Before: the card had its own 14/30/90-day switch (lost_reasons(ws, days)) and ignored the
-- page's date picker and Filters, so one screen mixed two periods.
-- Now: _lost_reasons() does the work for any window; lost_reasons_range() takes the page's
-- local dates, comparison period and filters; lost_reasons(ws, days) stays for Home tiles.

create or replace function public._lost_reasons(p_ws uuid, p_since timestamptz, p_until timestamptz, p_prev_since timestamptz,
  p_days int, p_from date, p_to date, p_source text, p_campaign text, p_ad text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.is_member(p_ws) then raise exception 'forbidden' using errcode = '42501'; end if;
  with c0 as (
    select c.*, coalesce(nullif(k.full_name, ''), nullif(k.name, ''), k.wa_id) contact_name,
           exists (select 1 from orders o where o.conversation_id = c.id and o.status = 'paid') bought,
           -- the longest a customer message waited for the business's next message, in minutes
           (select max(extract(epoch from (select min(o.sent_at) from messages o where o.conversation_id = c.id and o.direction = 'out' and o.sent_at > m.sent_at) - m.sent_at)) / 60
              from messages m where m.conversation_id = c.id and m.direction = 'in') worst_wait
    from conversations c join contacts k on k.id = c.contact_id
    where c.workspace_id = p_ws and not k.not_customer and c.kito_checked_at is not null
      and c.started_at >= p_prev_since and c.started_at < p_until
      -- the page's Filters (same rules as the browser's applyFilters; Product only narrows orders, so not chats)
      and (p_source is null or c.source = p_source)
      and (case when p_ad is not null then c.ad_id = p_ad
                when p_campaign is not null then exists (select 1 from ads a where a.workspace_id = p_ws and a.ad_id = c.ad_id and a.campaign_name = p_campaign)
                else true end)
  ),
  base as (
    select c0.*,
      case
        -- what the customer said, as Kito read it
        when kito_blocker in ('price', 'money', 'think', 'trust', 'delivery') then kito_blocker
        when coalesce(cardinality(kito_objections), 0) > 0 and kito_objections[1] in ('price', 'money', 'think', 'trust', 'delivery') then kito_objections[1]
        when 'far_location' = any(coalesce(kito_tags, '{}')) then 'delivery'
        when 'price_sensitive' = any(coalesce(kito_tags, '{}')) then 'price'
        when 'slow_decider' = any(coalesce(kito_tags, '{}')) then 'think'
        when 'not_serious' = any(coalesce(kito_tags, '{}')) then 'not_serious'
        -- what the chat shows (measured, not guessed)
        when last_dir = 'in' then 'no_reply'
        when worst_wait > 60 then 'business_slow'
        when not coalesce(price_shared, false) then 'quiet_before_price'
        else 'quiet_after_price' end reason
    from c0
  ),
  lost as (   -- no paid sale and (Kito says lost, or quiet for 3+ days)
    select * from base
    where not bought and coalesce(kito_outcome, '') <> 'sold'
      and (kito_outcome = 'lost' or last_message_at < now() - interval '3 days')
  ),
  cur as (select * from lost where started_at >= p_since),
  prev as (select * from lost where started_at < p_since),
  sold as (select * from base where started_at >= p_since and (bought or kito_outcome = 'sold')),
  avg_sale as (
    select avg(o.amount - o.discount - o.refund_amount) v from orders o
    where o.workspace_id = p_ws and o.status = 'paid' and o.paid_at >= now() - interval '90 days'
  )
  select jsonb_build_object(
    'days', p_days, 'from', p_from, 'to', p_to,
    'chats', (select count(*) from base where started_at >= p_since),
    'lost', (select count(*) from cur),
    'sold', (select count(*) from sold),
    'avg_sale', (select round(v) from avg_sale),
    -- of chats that got the price, the share that paid
    'close_rate', (select round(count(*) filter (where bought)::numeric / nullif(count(*), 0), 3) from base where started_at >= p_since and price_shared),
    -- median of the longest wait for a reply, chats that bought vs chats that didn't
    'wait_minutes', jsonb_build_object(
        'lost', (select round(percentile_cont(0.5) within group (order by worst_wait)::numeric) from cur where worst_wait is not null),
        'sold', (select round(percentile_cont(0.5) within group (order by worst_wait)::numeric) from sold where worst_wait is not null)),
    'reasons', coalesce((select jsonb_agg(jsonb_build_object(
        'reason', g.reason, 'n', g.n, 'after_price', g.after_price, 'from_ads', g.from_ads,
        'prev', (select count(*) from prev where prev.reason = g.reason),
        'examples', (select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.contact_name, 'summary', e.kito_summary, 'at', e.last_message_at))
                     from (select * from cur where cur.reason = g.reason order by last_message_at desc limit 4) e),
        'ids', (select jsonb_agg(i.id) from (select id from cur where cur.reason = g.reason order by last_message_at desc limit 60) i)
      ) order by g.n desc)
      from (select reason, count(*) n, count(*) filter (where price_shared) after_price, count(*) filter (where ad_id is not null or source = 'ad') from_ads
            from cur group by reason) g), '[]'::jsonb),
    'by_ad', coalesce((select jsonb_agg(jsonb_build_object('ad_id', a.ad_id, 'name', (select name from ads where ads.workspace_id = p_ws and ads.ad_id = a.ad_id),
                                                           'lost', a.n, 'top', a.top, 'top_n', a.top_n) order by a.n desc)
      from (select ad_id, count(*) n, mode() within group (order by reason) top, max(cnt) top_n
            from (select ad_id, reason, count(*) over (partition by ad_id, reason) cnt from cur where ad_id is not null) z
            group by ad_id having count(*) >= 3 order by count(*) desc limit 6) a), '[]'::jsonb)
  ) into res;
  return res;
end $$;
revoke all on function public._lost_reasons(uuid, timestamptz, timestamptz, timestamptz, int, date, date, text, text, text) from public, anon, authenticated;

-- Home tiles: the last N days up to now (unchanged behaviour).
create or replace function public.lost_reasons(p_ws uuid, p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_days int := greatest(7, least(coalesce(p_days, 30), 365)); v_since timestamptz := now() - make_interval(days => v_days);
begin
  return public._lost_reasons(p_ws, v_since, now() + interval '1 minute', v_since - make_interval(days => v_days), v_days, null, null, null, null, null);
end $$;
revoke all on function public.lost_reasons(uuid, int) from public, anon;
grant execute on function public.lost_reasons(uuid, int) to authenticated;

-- "Why people didn't buy" page: the page's own period (local days, both ends included), the
-- comparison period the rest of the page uses, and its Filters.
create or replace function public.lost_reasons_range(p_ws uuid, p_from date, p_to date, p_prev_from date,
  p_source text default null, p_campaign text default null, p_ad text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tz text; v_from date := least(p_from, p_to); v_to date := greatest(p_from, p_to); v_prev date;
begin
  if not public.is_member(p_ws) then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(nullif(timezone, ''), 'Africa/Dar_es_Salaam') into tz from workspaces where id = p_ws;
  -- comparison period: what the page sends, else the same number of days just before
  v_prev := case when p_prev_from is null or p_prev_from > v_from then v_from - (v_to - v_from + 1) else p_prev_from end;
  return public._lost_reasons(p_ws, v_from::timestamp at time zone tz, (v_to + 1)::timestamp at time zone tz, v_prev::timestamp at time zone tz,
    v_to - v_from + 1, v_from, v_to, nullif(p_source, ''), nullif(p_campaign, ''), nullif(p_ad, ''));
end $$;
revoke all on function public.lost_reasons_range(uuid, date, date, date, text, text, text) from public, anon;
grant execute on function public.lost_reasons_range(uuid, date, date, date, text, text, text) to authenticated;
