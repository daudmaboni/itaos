-- Money itaOS brought back (22 Nov 2026).
-- Home shows one number: sales that came after something itaOS did for the owner, plus how that compares
-- with what itaOS costs the business. Strict on purpose: a sale counts only when the owner acted on an
-- itaOS nudge (or confirmed it) BEFORE the customer paid, and the payment came inside that nudge's window.
--
--   promise      Kito found a customer promise (Ahadi), the owner confirmed it (open / snoozed / done),
--                and the customer paid after it was made, by 14 days after the due date.
--   after_price  Owner marked "Sent" on Actions → After price, customer paid within 14 days.
--   reorder      Owner marked "Sent" on Actions → Reorders, customer paid within 30 days.
--   follow_up    Owner finished an itaOS follow-up task from the queue, customer paid within 14 days.
-- One sale is credited once (first match in that order). Contacts marked "Not a customer" never count.
-- Proposed promises the owner never confirmed, dismissed tasks and owner-made tasks don't count.
--
-- Separately (not added to the total): sales itaOS spotted and recorded for the owner (rules, Kito,
-- the ✅ habit, name marks), so the owner sees the book-keeping it did too.

-- 1. What itaOS costs this business per month, in the business currency. Set by Pondi staff. ----------
alter table public.workspace_admin_state
  add column if not exists price_month numeric check (price_month is null or price_month >= 0);

create or replace function public.admin_set_price(p_ws uuid, p_price numeric)
returns void language plpgsql security definer set search_path = public as $$
declare before numeric;
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_price is not null and p_price < 0 then raise exception 'The price can''t be negative.'; end if;
  select price_month into before from public.workspace_admin_state where workspace_id = p_ws;
  insert into public.workspace_admin_state (workspace_id, price_month) values (p_ws, p_price)
  on conflict (workspace_id) do update set price_month = excluded.price_month, updated_by = auth.uid(), updated_at = now();
  insert into public.admin_audit (actor, action, workspace_id, details)
  values (auth.uid(), 'set_price', p_ws, jsonb_build_object('before', before, 'after', p_price));
end $$;

create or replace function public.admin_prices()
returns table(workspace_id uuid, name text, currency text, price_month numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select w.id, w.name, w.currency, s.price_month
      from public.workspaces w left join public.workspace_admin_state s on s.workspace_id = w.id
     order by w.name;
end $$;

-- 2. The credited sales for a period (dates in the business's own timezone). -----------------------
create or replace function public.recovered_sales(p_ws uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text; res jsonb;
begin
  if not public.is_member(p_ws) then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(timezone, 'Africa/Dar_es_Salaam') into tz from public.workspaces where id = p_ws;

  with nudges as (
    -- Each nudge: when it happened and until when a payment still counts for it.
    select t.conversation_id cid, t.id tid, 'promise'::text src, 1 prio,
           t.created_at at_, greatest(coalesce(t.due_at, t.created_at), t.created_at) + interval '14 days' until_
      from public.follow_up_tasks t
     where t.workspace_id = p_ws and t.source = 'kito_promise' and t.status in ('open', 'snoozed', 'done')
       and coalesce(t.result, 'paid') <> 'not_interested'
    union all
    select t.conversation_id, t.id, 'after_price', 2, t.completed_at, t.completed_at + interval '14 days'
      from public.follow_up_tasks t
     where t.workspace_id = p_ws and t.source = 'after_price' and t.status = 'done' and t.completed_at is not null
    union all
    select t.conversation_id, t.id, 'reorder', 3, t.completed_at, t.completed_at + interval '30 days'
      from public.follow_up_tasks t
     where t.workspace_id = p_ws and t.source = 'reorder' and t.status = 'done' and t.completed_at is not null
    union all
    select t.conversation_id, t.id, 'follow_up', 4, t.completed_at, t.completed_at + interval '14 days'
      from public.follow_up_tasks t
     where t.workspace_id = p_ws and t.source = 'queue' and t.status = 'done' and t.completed_at is not null
  ),
  paid as (
    select o.id, o.conversation_id cid, o.paid_at, o.currency, o.inferred_from,
           (o.amount - o.discount - o.refund_amount) val
      from public.orders o
      left join public.contacts ct on ct.id = o.contact_id
     where o.workspace_id = p_ws and o.status = 'paid' and o.paid_at is not null
       and (o.paid_at at time zone tz)::date between p_from and p_to
       and not coalesce(ct.not_customer, false)
  ),
  credited as (
    select distinct on (p.id) p.id, p.cid, p.paid_at, p.currency, p.val, n.src, n.at_ nudge_at
      from paid p
      join nudges n on n.cid = p.cid and p.paid_at > n.at_ and p.paid_at <= n.until_
      join public.conversations c on c.id = p.cid
      join public.contacts ct on ct.id = c.contact_id and not ct.not_customer
     order by p.id, n.prio, n.at_ desc
  ),
  waiting as (
    -- Nudges still inside their window with no sale yet: money that may still come in.
    select count(distinct n.cid) n from nudges n
     where n.until_ > now() and n.at_ <= now()
       and not exists (select 1 from public.orders o where o.conversation_id = n.cid and o.status = 'paid' and o.paid_at > n.at_)
  )
  select jsonb_build_object(
    'currency', (select currency from public.workspaces where id = p_ws),
    'total', coalesce((select sum(val) from credited), 0),
    'orders', (select count(*) from credited),
    'by_source', coalesce((select jsonb_agg(jsonb_build_object('source', src, 'amount', a, 'orders', n) order by a desc)
                             from (select src, sum(val) a, count(*) n from credited group by src) s), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                         'order_id', cr.id, 'conversation_id', cr.cid, 'amount', cr.val, 'currency', cr.currency,
                         'paid_at', cr.paid_at, 'nudge_at', cr.nudge_at, 'source', cr.src,
                         'name', coalesce(nullif(ct.full_name, ''), nullif(ct.name, ''), ct.wa_id)) order by cr.paid_at desc)
                         from credited cr join public.conversations c on c.id = cr.cid join public.contacts ct on ct.id = c.contact_id), '[]'::jsonb),
    'waiting', (select n from waiting),
    'found_orders', (select count(*) from paid where inferred_from is not null),
    'found_amount', coalesce((select sum(val) from paid where inferred_from is not null), 0),
    'price_month', (select price_month from public.workspace_admin_state where workspace_id = p_ws),
    'days', (p_to - p_from + 1)
  ) into res;
  return res;
end $$;

revoke all on function public.recovered_sales(uuid, date, date) from public, anon;
grant execute on function public.recovered_sales(uuid, date, date) to authenticated;
revoke all on function public.admin_set_price(uuid, numeric) from public, anon;
grant execute on function public.admin_set_price(uuid, numeric) to authenticated;
revoke all on function public.admin_prices() from public, anon;
grant execute on function public.admin_prices() to authenticated;
