create or replace function public.list_buyers(p_ws uuid, p_q text default null, p_region text default null)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare q text := nullif(btrim(coalesce(p_q, '')), ''); qd text := regexp_replace(coalesce(p_q, ''), '\D', '', 'g'); res jsonb;
begin
  if qd like '0%' then qd := '255' || substr(qd, 2); end if;
  with sales as (
    select coalesce(o.contact_id, cv.contact_id) buyer_id, o.amount, o.discount, o.refund_amount, o.paid_at, o.currency,
           o.conversation_id, o.receipt_no, o.items, o.product
    from orders o left join conversations cv on cv.id = o.conversation_id
    where o.workspace_id = p_ws and o.status = 'paid'
  ),
  prods as (
    select buyer_id, string_agg(distinct x, ', ') products from (
      select s.buyer_id, it->>'name' x from sales s, jsonb_array_elements(coalesce(s.items, '[]'::jsonb)) it
      union all
      select s.buyer_id, btrim(p) from sales s, regexp_split_to_table(coalesce(s.product, ''), '\s*,\s*') p
       where coalesce(s.items, '[]'::jsonb) = '[]'::jsonb
    ) z where x is not null and x <> '' group by buyer_id
  ),
  agg as (
    select s.buyer_id, count(*) n, sum(s.amount - coalesce(s.discount, 0) - coalesce(s.refund_amount, 0)) spent,
           min(s.paid_at) first_at, max(s.paid_at) last_at, max(s.currency) currency,
           (array_agg(s.conversation_id order by s.paid_at desc nulls last))[1] last_conv,
           (array_agg(s.receipt_no order by s.paid_at desc nulls last))[1] last_receipt
    from sales s where s.buyer_id is not null group by s.buyer_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'contact_id', c.id, 'wa_name', c.name, 'full_name', c.full_name, 'phone', c.wa_id, 'alt_phone', c.alt_phone,
      'region', c.region, 'district', c.district, 'area', c.area, 'landmark', c.landmark, 'delivery_note', c.delivery_note,
      'location_source', c.location_source, 'location_evidence', c.location_evidence, 'name_source', c.name_source,
      'orders', a.n, 'spent', a.spent, 'currency', a.currency, 'first_at', a.first_at, 'last_at', a.last_at,
      'last_conversation_id', a.last_conv, 'last_receipt', a.last_receipt, 'products', pr.products
    ) order by a.last_at desc nulls last), '[]'::jsonb) into res
  from agg a join contacts c on c.id = a.buyer_id left join prods pr on pr.buyer_id = a.buyer_id
  where c.workspace_id = p_ws and not coalesce(c.not_customer, false)
    and (p_region is null or c.region = p_region)
    and (q is null or c.name ilike '%' || q || '%' or c.full_name ilike '%' || q || '%'
         or (length(qd) >= 4 and (c.wa_id like '%' || qd || '%' or regexp_replace(coalesce(c.alt_phone, ''), '\D', '', 'g') like '%' || right(qd, 9) || '%'))
         or concat_ws(' ', c.region, c.district, c.area, c.landmark) ilike '%' || q || '%'
         or pr.products ilike '%' || q || '%');
  return res;
end $$;
grant execute on function public.list_buyers(uuid, text, text) to authenticated;
