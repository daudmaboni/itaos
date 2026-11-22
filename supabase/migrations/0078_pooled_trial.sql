-- 22 Nov 2026 — Staff only: the proof trial pooled across businesses.
-- A single small shop needs months before its own "shown vs kept aside" difference is clear. Pooling borrows
-- strength across shops with a standard random-effects model (DerSimonian–Laird) on each shop's difference in
-- buying rate (shown − kept aside, closed windows only, as assigned):
--   pooled: the overall difference with its 95% range, and tau² (how much shops really differ)
--   per shop: its own difference pulled toward the pooled one, more so the fewer customers it has
-- A shop takes part with at least 20 shown and 5 kept-aside customers whose window has closed. The pooled figure
-- is reported only from 3 such shops; below that the status is "needs_more_shops". Owners never see this; their
-- Home card keeps using their own trial (recovered_sales).
create or replace function public.admin_pooled_trial()
returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare res jsonb;
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  with a as (
    select s.workspace_id, s.arm,
           exists (select 1 from orders x join conversations c on c.id = x.conversation_id
                    where c.contact_id = s.contact_id and x.status = 'paid' and x.paid_at > s.assigned_at and x.paid_at <= s.until_at
                      and (x.amount - x.discount - x.refund_amount) > 0) bought
    from atrisk_assign s join contacts ct on ct.id = s.contact_id and not ct.not_customer
    where s.version = 'v2' and s.until_at <= now()
  ),
  shop as (
    select workspace_id,
           count(*) filter (where arm = 'show') ns, count(*) filter (where arm = 'show' and bought) ks,
           count(*) filter (where arm = 'hold') nh, count(*) filter (where arm = 'hold' and bought) kh
    from a group by workspace_id
  ),
  est as (   -- rates with a half-count added so a shop with zero buyers still has a usable spread
    select s.*, w.name,
           s.ks::numeric / nullif(s.ns, 0) - s.kh::numeric / nullif(s.nh, 0) d,
           ((s.ks + .5) / (s.ns + 1)) * (1 - (s.ks + .5) / (s.ns + 1)) / s.ns
             + ((s.kh + .5) / (s.nh + 1)) * (1 - (s.kh + .5) / (s.nh + 1)) / s.nh v,
           s.ns >= 20 and s.nh >= 5 eligible
    from shop s join workspaces w on w.id = s.workspace_id
    where s.ns > 0 and s.nh > 0
  ),
  fe as (
    select count(*) k, sum(1 / v) sw, sum(1 / v / v) sw2, sum(d / v) / sum(1 / v) dfix from est where eligible
  ),
  q as (
    select fe.*, (select sum((e.d - fe.dfix)^2 / e.v) from est e where e.eligible) qq from fe
  ),
  t as (
    select q.*, case when k > 1 and sw - sw2 / sw > 0 then greatest(0, (qq - (k - 1)) / (sw - sw2 / sw)) else 0 end tau2 from q
  ),
  re as (
    select t.*, (select sum(e.d / (e.v + t.tau2)) / sum(1 / (e.v + t.tau2)) from est e where e.eligible) dre,
                (select sqrt(1 / sum(1 / (e.v + t.tau2))) from est e where e.eligible) sere
    from t
  )
  select jsonb_build_object(
    'status', case when (select k from re) >= 3 then 'pooled' else 'needs_more_shops' end,
    'shops_eligible', (select k from re), 'need', 3,
    'pooled', (select case when k >= 3 then jsonb_build_object('diff', dre, 'lo', dre - 1.96 * sere, 'hi', dre + 1.96 * sere, 'tau2', tau2,
                                                              'clear', dre - 1.96 * sere > 0) end from re),
    'shops', coalesce((select jsonb_agg(jsonb_build_object(
        'workspace_id', e.workspace_id, 'name', e.name, 'eligible', e.eligible,
        'shown', e.ns, 'shown_bought', e.ks, 'kept', e.nh, 'kept_bought', e.kh, 'diff', e.d,
        'diff_lo', e.d - 1.96 * sqrt(e.v), 'diff_hi', e.d + 1.96 * sqrt(e.v),
        'shrunk', case when re.k >= 3 and e.eligible then (re.tau2 * e.d + e.v * re.dre) / (re.tau2 + e.v) end,
        'shrunk_lo', case when re.k >= 3 and e.eligible then (re.tau2 * e.d + e.v * re.dre) / (re.tau2 + e.v)
                          - 1.96 * sqrt(re.tau2 * e.v / nullif(re.tau2 + e.v, 0) + (e.v / (re.tau2 + e.v))^2 * re.sere^2) end,
        'shrunk_hi', case when re.k >= 3 and e.eligible then (re.tau2 * e.d + e.v * re.dre) / (re.tau2 + e.v)
                          + 1.96 * sqrt(re.tau2 * e.v / nullif(re.tau2 + e.v, 0) + (e.v / (re.tau2 + e.v))^2 * re.sere^2) end
      ) order by e.eligible desc, e.ns desc) from est e, re), '[]'::jsonb)
  ) into res;
  return res;
end $$;
revoke all on function public.admin_pooled_trial() from public, anon;
grant execute on function public.admin_pooled_trial() to authenticated;
