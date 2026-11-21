-- "Sawa kak" is not a question. A chat whose last customer messages are only closing words
-- (sawa, poa, asante, ok, 👍, a sticker…) after your reply no longer shows as "Waiting for your reply",
-- in the chat list, the nav badge, the Actions queue or the morning push.
-- The word list matches supabase/functions/_shared/closing.ts; keep the two in step.

alter table public.conversations add column if not exists last_in_closing boolean not null default false;

-- 1. The word check (lower-case, repeated letters squashed, any "?" = a question, max 6 words, emoji-only = closing).
create or replace function public.is_closing_ack(t text) returns boolean
language sql immutable set search_path to 'public' as $$
  select case
    when btrim(coalesce(t, '')) = '' or t like '%?%' then false
    else (
      select count(*) <= 6 and coalesce(bool_and(w = any (
               select regexp_replace(x, '(.)\1+', '\1', 'g')
               from unnest(array['sawa', 'sawasawa', 'poa', 'powa', 'poapoa', 'fresh', 'freshi', 'safi', 'shwari', 'haya', 'kabisa', 'tuko', 'pamoja', 'ok', 'okay', 'okey', 'oky', 'k', 'alright', 'alrt', 'fine', 'nice', 'good', 'great', 'cool', 'noted', 'asante', 'asanteni', 'ahsante', 'aksante', 'asnt', 'shukran', 'shukrani', 'nashukuru', 'nashkuru', 'thanks', 'thank', 'thnks', 'thx', 'tnx', 'you', 'u', 'sana', 'much', 'barikiwa', 'ubarikiwe', 'mungu', 'akubariki', 'akubarikie', 'nimeona', 'nimeelewa', 'nimepokea', 'nimepata', 'tumeelewana', 'kak', 'kaka', 'bro', 'dada', 'sis', 'boss', 'bosi', 'mkuu', 'chief', 'mzee', 'ndugu']) x)), true)
      from (
        select regexp_replace(w0, '(.)\1+', '\1', 'g') w
        from regexp_split_to_table(regexp_replace(lower(t), '[^a-z0-9]+', ' ', 'g'), ' ') w0
        where w0 <> ''
      ) toks)
  end
$$;
grant execute on function public.is_closing_ack(text) to authenticated, service_role;

-- 2. Backfill: chats where the customer wrote last.
with lastout as (
  select c.id, c.last_out_at from public.conversations c where c.last_dir = 'in' and c.last_out_at is not null
)
update public.conversations c set last_in_closing = true
from lastout l
where c.id = l.id
  and exists (select 1 from public.messages m where m.conversation_id = c.id and m.direction = 'in' and m.sent_at > l.last_out_at)
  and not exists (
    select 1 from public.messages m
    where m.conversation_id = c.id and m.direction = 'in' and m.sent_at > l.last_out_at
      and not (m.type = 'sticker' or (coalesce(m.type, 'text') = 'text' and public.is_closing_ack(m.body))));

-- 3. conversation_outcomes: same columns as 0033, plus last_in_closing at the end.
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
  case when ct.not_customer then 'not_customer' else
  coalesce(case when p.n > 0 then 'sold' end, c.outcome_override,
    case when coalesce(case when c.kito_confidence in ('high', 'medium') and c.kito_checked_at >= c.last_message_at then c.kito_outcome end, c.auto_outcome) = 'open'
              and c.last_message_at < now() - interval '2 days' then 'lost'
         else coalesce(case when c.kito_confidence in ('high', 'medium') and c.kito_checked_at >= c.last_message_at then c.kito_outcome end, c.auto_outcome) end) end as outcome,
  p.net as sale_amount, p.provenance as sale_provenance, coalesce(p.n, 0::bigint) as paid_orders, p.first_paid_at, p.last_paid_at,
  c.last_dir, c.last_out_at, c.ad_signal,
  ct.not_customer, c.kito_party, ct.not_customer_at is not null as party_decided, ct.not_customer_note,
  c.assigned_to,
  c.last_in_closing
from public.conversations c
join public.contacts ct on ct.id = c.contact_id
left join paid p on p.conversation_id = c.id;


-- 4. Nav badge: closing words don't count as waiting (also uses the stored last_dir instead of a per-chat sub-query).
create or replace function public.nav_badges(ws uuid)
returns json language plpgsql stable set search_path to 'public' as $function$
declare
  seen timestamptz;
  v_wait int; v_new int; v_due int;
begin
  if not public.is_member(ws) then raise exception 'forbidden'; end if;
  select chats_seen_at into seen from public.nav_seen where user_id = auth.uid() and workspace_id = ws;
  seen := coalesce(seen, now() - interval '24 hours');

  select count(*) into v_wait
  from public.conversations c
  join public.contacts ct on ct.id = c.contact_id
  where c.workspace_id = ws
    and c.last_message_at between now() - interval '48 hours' and now() - interval '15 minutes'
    and public.chat_origin(ct.wa_id, c.phone_number_id) = 'live'
    and coalesce(c.outcome_override, '') not in ('sold', 'lost')
    and c.last_dir = 'in' and not c.last_in_closing;

  select count(*) into v_new
  from public.conversations c
  join public.contacts ct on ct.id = c.contact_id
  where c.workspace_id = ws
    and c.started_at > seen
    and public.chat_origin(ct.wa_id, c.phone_number_id) = 'live';

  select count(*) into v_due
  from public.follow_up_tasks t
  where t.workspace_id = ws
    and (t.status = 'proposed'
         or (t.status in ('open', 'snoozed') and coalesce(t.snoozed_until, t.due_at) <= now()));

  return json_build_object('chats_waiting', v_wait, 'chats_new', v_new, 'actions_due', v_due);
end $function$;
