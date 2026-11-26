create or replace function public.recovered_sales(p_ws uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text; res jsonb;
begin
  if not public.is_member(p_ws) then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(timezone, 'Africa/Dar_es_Salaam') into tz from public.workspaces where id = p_ws;

  with nudges as (
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
