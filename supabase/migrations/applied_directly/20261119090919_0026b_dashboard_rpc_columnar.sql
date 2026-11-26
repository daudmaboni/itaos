drop function if exists public.dashboard_conversations(uuid, timestamptz);
create function public.dashboard_conversations(p_ws uuid, p_from timestamptz)
returns json
language sql
stable
security invoker
set search_path = public
as $$
  select json_build_object(
    'id', coalesce(json_agg(id), '[]'),
    'contact_id', coalesce(json_agg(contact_id), '[]'),
    'contact_name', coalesce(json_agg(contact_name), '[]'),
    'started_at', coalesce(json_agg(started_at), '[]'),
    'last_message_at', coalesce(json_agg(last_message_at), '[]'),
    'source', coalesce(json_agg(source), '[]'),
    'source_label', coalesce(json_agg(source_label), '[]'),
    'ad_id', coalesce(json_agg(ad_id), '[]'),
    'ad_signal', coalesce(json_agg(ad_signal), '[]'),
    'first_response_sec', coalesce(json_agg(first_response_sec), '[]'),
    'price_asked', coalesce(json_agg(price_asked), '[]'),
    'price_shared', coalesce(json_agg(price_shared), '[]'),
    'replied_after_price', coalesce(json_agg(replied_after_price), '[]'),
    'payment_signal', coalesce(json_agg(payment_signal), '[]'),
    'payment_amount', coalesce(json_agg(payment_amount), '[]'),
    'objections', coalesce(json_agg(objections), '[]'),
    'followed_up', coalesce(json_agg(followed_up), '[]'),
    'warm', coalesce(json_agg(warm), '[]'),
    'stage', coalesce(json_agg(stage), '[]'),
    'auto_outcome', coalesce(json_agg(auto_outcome), '[]'),
    'outcome_override', coalesce(json_agg(outcome_override), '[]'),
    'label', coalesce(json_agg(label), '[]'),
    'kito_outcome', coalesce(json_agg(kito_outcome), '[]'),
    'kito_label', coalesce(json_agg(kito_label), '[]'),
    'kito_amount', coalesce(json_agg(kito_amount), '[]'),
    'kito_objections', coalesce(json_agg(kito_objections), '[]'),
    'kito_tags', coalesce(json_agg(kito_tags), '[]'),
    'kito_temp', coalesce(json_agg(kito_temp), '[]'),
    'kito_blocker', coalesce(json_agg(kito_blocker), '[]'),
    'last_dir', coalesce(json_agg(last_dir), '[]'),
    'kito_confidence', coalesce(json_agg(kito_confidence), '[]'),
    'kito_checked_at', coalesce(json_agg(kito_checked_at), '[]'),
    'outcome', coalesce(json_agg(outcome), '[]'),
    'sale_amount', coalesce(json_agg(sale_amount), '[]'),
    'sale_provenance', coalesce(json_agg(sale_provenance), '[]'),
    'override_by', coalesce(json_agg(override_by), '[]'),
    'override_at', coalesce(json_agg(override_at), '[]'),
    'paid_orders', coalesce(json_agg(paid_orders), '[]'),
    'first_paid_at', coalesce(json_agg(first_paid_at), '[]'),
    'last_paid_at', coalesce(json_agg(last_paid_at), '[]'),
    'last_out_at', coalesce(json_agg(last_out_at), '[]'),
    'pay_instructions', coalesce(json_agg(pay_instructions), '[]')
  )
  from (
    select * from public.conversation_outcomes
    where workspace_id = p_ws and started_at >= p_from
    order by started_at, id
  ) r;
$$;

revoke all on function public.dashboard_conversations(uuid, timestamptz) from public, anon;
grant execute on function public.dashboard_conversations(uuid, timestamptz) to authenticated;
