create or replace view public.conversation_outcomes with (security_invoker = true) as
with paid as (
  select o.conversation_id,
         sum(o.amount - o.discount - o.refund_amount) as net, count(*) as n,
         max(o.paid_at) as last_paid_at, min(o.paid_at) as first_paid_at,
         (array_agg(o.provenance order by o.paid_at desc))[1] as provenance
  from public.orders o
  where o.status = 'paid' and o.conversation_id is not null
  group by o.conversation_id
)
select c.id, c.workspace_id, c.contact_id, c.phone_number_id, c.started_at, c.last_message_at, c.source, c.ad_id, c.ctwa_clid, c.referral,
  c.first_response_sec, c.price_asked, c.price_shared, c.price_shared_at, c.replied_after_price, c.pay_instructions, c.payment_signal,
  c.payment_amount, c.objections, c.followed_up, c.warm, c.stage, c.auto_outcome, c.outcome_override, c.analyzed_at, c.label,
  c.kito_outcome, c.kito_label, c.kito_amount, c.kito_objections, c.kito_tags, c.kito_summary, c.kito_next, c.kito_confidence,
  c.kito_checked_at, c.kito_error, c.source_label, c.kito_temp, c.kito_blocker, c.kito_evidence, c.override_by, c.override_at, c.override_note,
  ct.name as contact_name,
  coalesce(case when p.n > 0 then 'sold' end, c.outcome_override,
    case when coalesce(case when c.kito_confidence in ('high', 'medium') and c.kito_checked_at >= c.last_message_at then c.kito_outcome end, c.auto_outcome) = 'open'
              and c.last_message_at < now() - interval '2 days' then 'lost'
         else coalesce(case when c.kito_confidence in ('high', 'medium') and c.kito_checked_at >= c.last_message_at then c.kito_outcome end, c.auto_outcome) end) as outcome,
  p.net as sale_amount, p.provenance as sale_provenance, coalesce(p.n, 0::bigint) as paid_orders, p.first_paid_at, p.last_paid_at,
  c.last_dir, c.last_out_at, c.ad_signal
from public.conversations c
join public.contacts ct on ct.id = c.contact_id
left join paid p on p.conversation_id = c.id;
