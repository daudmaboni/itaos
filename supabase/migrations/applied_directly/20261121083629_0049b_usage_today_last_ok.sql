create or replace function public.admin_api_usage(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare
  d  int := greatest(0, least(coalesce(p_days, 30), 366));
  t0 timestamptz;
  m0 timestamptz := date_trunc('month', now() at time zone 'Africa/Dar_es_Salaam') at time zone 'Africa/Dar_es_Salaam';
  dd timestamptz := date_trunc('day', now() at time zone 'Africa/Dar_es_Salaam') at time zone 'Africa/Dar_es_Salaam';
  fl date;
  r  jsonb;
begin
  t0 := case when d = 0 then dd else now() - make_interval(days => d) end;
  select (min(at) at time zone 'Africa/Dar_es_Salaam')::date into fl from api_usage where not backfilled;
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  with u as (
    select x.*, private.api_cost(x, p) as cost, p.model is not null as priced,
           (x.at at time zone 'Africa/Dar_es_Salaam')::date as day
      from api_usage x left join api_pricing p on p.model = x.model
     where x.at >= least(t0, m0, now() - interval '15 days')
  ), win as (select * from u where at >= t0),
  tot as (
    select count(*) calls, count(*) filter (where not ok) errors, count(*) filter (where attempt > 1) retries,
           coalesce(sum(input_tokens), 0) input_tokens, coalesce(sum(output_tokens), 0) output_tokens,
           coalesce(sum(cache_read_tokens), 0) cache_read_tokens, coalesce(sum(cache_write_tokens), 0) cache_write_tokens,
           coalesce(sum(cost), 0) cost, count(*) filter (where not priced) unpriced
      from win
  ), days as (
    select g::date as day from generate_series((t0 at time zone 'Africa/Dar_es_Salaam')::date,
                                              (now() at time zone 'Africa/Dar_es_Salaam')::date, interval '1 day') g
  ), byday as (select day, count(*) n, coalesce(sum(cost), 0) cost, count(*) filter (where not ok) errors from u group by day),
  base as (
    select coalesce(avg(coalesce(b.cost, 0)), 0) avg_cost, coalesce(avg(coalesce(b.n, 0)), 0) avg_calls, count(*) n_days
      from generate_series(greatest((dd at time zone 'Africa/Dar_es_Salaam')::date - 14, coalesce(fl, (dd at time zone 'Africa/Dar_es_Salaam')::date)),
                           (dd at time zone 'Africa/Dar_es_Salaam')::date - 1, interval '1 day') g
      left join byday b on b.day = g::date
  ), tod as (select *, extract(hour from at at time zone 'Africa/Dar_es_Salaam')::int hr from u where at >= dd),
  hrs as (select h from generate_series(0, 23) h)
  select jsonb_build_object(
    'days', d, 'from', t0,
    'totals', (select to_jsonb(tot) from tot),
    'today', (select jsonb_build_object('calls', count(*), 'cost', coalesce(sum(cost), 0), 'errors', count(*) filter (where not ok)) from u where at >= dd),
    'month', (select jsonb_build_object('calls', count(*), 'cost', coalesce(sum(cost), 0), 'from', m0,
                'day_of_month', extract(day from now() at time zone 'Africa/Dar_es_Salaam')::int,
                'days_in_month', extract(day from (date_trunc('month', now() at time zone 'Africa/Dar_es_Salaam') + interval '1 month - 1 day'))::int)
              from u where at >= m0),
    'baseline', (select to_jsonb(base) from base),
    'today_hourly', jsonb_build_object(
       'cost',   (select jsonb_agg(coalesce((select sum(cost) from tod where hr = h), 0) order by h) from hrs),
       'calls',  (select jsonb_agg((select count(*) from tod where hr = h) order by h) from hrs),
       'errors', (select jsonb_agg((select count(*) from tod where hr = h and not ok) order by h) from hrs),
       'by_feature', coalesce((select jsonb_object_agg(ft, arr) from (
           select ft, (select jsonb_agg(coalesce((select sum(cost) from tod where hr = h and feature = ft), 0) order by h) from hrs) arr
             from (select distinct feature ft from tod) q) z), '{}'),
       'features', coalesce((select jsonb_agg(to_jsonb(f) order by f.cost desc) from (
           select feature, count(*) calls, count(*) filter (where not ok) errors, coalesce(sum(cost), 0) cost,
                  (select left(t2.error, 160) from tod t2 where t2.feature = tod.feature and not t2.ok order by t2.at desc limit 1) last_error,
                  (select t3.ok from tod t3 where t3.feature = tod.feature order by t3.at desc limit 1) last_ok
             from tod group by feature) f), '[]')),
    'daily', jsonb_build_object(
       'days',  (select jsonb_agg(day order by day) from days),
       'cost',  (select jsonb_agg(coalesce((select cost from byday b where b.day = days.day), 0) order by day) from days),
       'calls', (select jsonb_agg(coalesce((select n from byday b where b.day = days.day), 0) order by day) from days),
       'errors',(select jsonb_agg(coalesce((select errors from byday b where b.day = days.day), 0) order by day) from days)),
    'by_feature', coalesce((select jsonb_agg(to_jsonb(f) order by f.cost desc nulls last) from (
        select feature, count(*) calls, count(*) filter (where not ok) errors, count(*) filter (where attempt > 1) retries,
               sum(input_tokens + cache_read_tokens + cache_write_tokens) input_tokens, sum(output_tokens) output_tokens, coalesce(sum(cost), 0) cost
          from win group by feature) f), '[]'),
    'by_model', coalesce((select jsonb_agg(to_jsonb(f) order by f.cost desc nulls last) from (
        select model, bool_and(priced) priced, count(*) calls, count(*) filter (where not ok) errors,
               sum(input_tokens) input_tokens, sum(output_tokens) output_tokens,
               sum(cache_read_tokens) cache_read_tokens, sum(cache_write_tokens) cache_write_tokens, coalesce(sum(cost), 0) cost
          from win group by model) f), '[]'),
    'by_workspace', coalesce((select jsonb_agg(to_jsonb(f) order by f.cost desc nulls last) from (
        select win.workspace_id, w.name, count(*) calls, count(*) filter (where not ok) errors,
               sum(input_tokens + cache_read_tokens + cache_write_tokens) input_tokens, sum(output_tokens) output_tokens, coalesce(sum(cost), 0) cost,
               coalesce((select sum(u2.cost) from u u2 where u2.workspace_id is not distinct from win.workspace_id and u2.at >= dd), 0) cost_today,
               coalesce((select jsonb_object_agg(ff.feature, ff.cost) from (select feature, coalesce(sum(cost), 0) cost from win w2
                  where w2.workspace_id is not distinct from win.workspace_id group by feature) ff), '{}') by_feature
          from win left join workspaces w on w.id = win.workspace_id group by win.workspace_id, w.name) f), '[]'),
    'recent_errors', coalesce((select jsonb_agg(to_jsonb(e) order by e.at desc) from (
        select win.at, win.feature, win.model, win.status, win.error, win.attempt, w.name workspace_name
          from win left join workspaces w on w.id = win.workspace_id where not ok order by win.at desc limit 20) e), '[]'),
    'pricing', coalesce((select jsonb_agg(to_jsonb(p) - 'updated_by' || jsonb_build_object('updated_by_email', au.email) order by p.model)
        from api_pricing p left join auth.users au on au.id = p.updated_by), '[]'),
    'budget', (select value from admin_settings where key = 'api_budget'),
    'first_logged_at', (select min(at) from api_usage where not backfilled),
    'generated_at', now()
  ) into r;
  return r;
end $$;

revoke all on function public.admin_api_usage(int) from public, anon;
grant execute on function public.admin_api_usage(int) to authenticated;
