-- 22 Nov 2026 — Check payments against the business's mobile-money statement (M-Pesa, Mixx, Airtel Money…).
-- The owner pastes the payment SMS messages or uploads the statement CSV (Receipts → Check your M-Pesa).
-- itaOS keeps one line per incoming payment, then shows which are already recorded as sales and which are not,
-- with the chat it most likely belongs to. Recording one is the owner's tap (an order with provenance csv_import,
-- external_ref wallet:<code>), never automatic. Only the last 4 digits of the sender's number are kept.

create table if not exists public.wallet_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  txn_id text not null,
  at timestamptz not null,
  amount numeric not null check (amount > 0),
  currency text not null default 'TZS',
  sender_name text,
  phone_tail text check (phone_tail is null or phone_tail ~ '^[0-9]{3,4}$'),
  provider text,
  source text not null check (source in ('sms', 'csv')),
  dismissed boolean not null default false,          -- owner: not a sale (own transfer, refund, loan…)
  uploaded_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (workspace_id, txn_id)
);
create index if not exists wallet_lines_ws_at_idx on public.wallet_lines (workspace_id, at desc);
alter table public.wallet_lines enable row level security;
drop policy if exists wallet_read on public.wallet_lines;
create policy wallet_read on public.wallet_lines for select using (public.is_member(workspace_id));
drop policy if exists wallet_insert on public.wallet_lines;
create policy wallet_insert on public.wallet_lines for insert with check (public.can_edit(workspace_id));
drop policy if exists wallet_update on public.wallet_lines;
create policy wallet_update on public.wallet_lines for update using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
drop policy if exists wallet_delete on public.wallet_lines;
create policy wallet_delete on public.wallet_lines for delete using (public.can_edit(workspace_id));
grant select, insert, update, delete on public.wallet_lines to authenticated;

-- Each statement payment, matched to the sales itaOS has and, when not recorded, to the chat it most likely belongs to.
--   recorded:        a paid order carries this payment code (payment_ref / wallet:<code>)
--   likely_recorded: a paid order for the same amount within 2 days, not already claimed by a code match
--   not_recorded:    neither; candidate chat by (1) the code on a payment screenshot, (2) the sender's last digits,
--                    (3) the sender's name, in that order
create or replace function public.wallet_check(p_ws uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text; v_start timestamptz; v_end timestamptz; res jsonb;
begin
  if not public.is_member(p_ws) then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(timezone, 'Africa/Dar_es_Salaam') into tz from workspaces where id = p_ws;
  v_start := p_from::timestamp at time zone tz;
  v_end := (p_to + 1)::timestamp at time zone tz;

  with l as (
    select * from wallet_lines where workspace_id = p_ws and at >= v_start and at < v_end
  ),
  paid as (
    select o.id, o.conversation_id, o.paid_at, o.amount - o.discount - o.refund_amount net, upper(coalesce(o.payment_ref, '')) ref, o.external_ref
    from orders o where o.workspace_id = p_ws and o.status = 'paid' and o.paid_at >= v_start - interval '3 days' and o.paid_at < v_end + interval '3 days'
  ),
  by_code as (
    select distinct on (l.id) l.id line_id, p.id order_id, p.conversation_id
    from l join paid p on p.ref = upper(l.txn_id) or p.external_ref = 'wallet:' || l.txn_id
    order by l.id
  ),
  by_amount as (
    select distinct on (l.id) l.id line_id, p.id order_id, p.conversation_id
    from l join paid p on abs(p.net - l.amount) <= greatest(1, l.amount * 0.005) and abs(extract(epoch from p.paid_at - l.at)) <= 2 * 86400
    where not exists (select 1 from by_code b where b.line_id = l.id)
      and not exists (select 1 from by_code b where b.order_id = p.id)
    order by l.id, abs(extract(epoch from p.paid_at - l.at))
  ),
  shot as (   -- a payment screenshot in a chat that shows this code
    select distinct on (l.id) l.id line_id, m.conversation_id
    from l join messages m on m.workspace_id = p_ws and upper(m.media->'receipt'->>'txn_code') = upper(l.txn_id)
    order by l.id, m.sent_at desc
  ),
  tail as (   -- a customer whose number ends with the sender's last digits (one chat only, else ambiguous)
    select l.id line_id, (array_agg(c.id order by c.last_message_at desc nulls last))[1] conversation_id, count(distinct k.id) n
    from l join contacts k on k.workspace_id = p_ws and l.phone_tail is not null and not k.not_customer
              and (right(regexp_replace(k.wa_id, '\D', '', 'g'), length(l.phone_tail)) = l.phone_tail
                   or right(regexp_replace(coalesce(k.alt_phone, ''), '\D', '', 'g'), length(l.phone_tail)) = l.phone_tail)
         join conversations c on c.contact_id = k.id
    where c.last_message_at >= l.at - interval '30 days'
    group by l.id
  ),
  nm as (     -- a customer whose saved or corrected name shares two words with the sender's name
    select l.id line_id, (array_agg(c.id order by c.last_message_at desc nulls last))[1] conversation_id, count(distinct k.id) n
    from l join contacts k on k.workspace_id = p_ws and l.sender_name is not null and not k.not_customer
         join conversations c on c.contact_id = k.id and c.last_message_at >= l.at - interval '30 days'
    where (select count(*) from (
             select unnest(regexp_split_to_array(lower(l.sender_name), '\s+')) w
             intersect
             select unnest(regexp_split_to_array(lower(coalesce(k.full_name, '') || ' ' || coalesce(k.name, '')), '[^[:alpha:]]+'))
           ) x where length(w) >= 3) >= 2
    group by l.id
  ),
  rows as (
    select l.*,
      case when l.dismissed then 'dismissed' when bc.order_id is not null then 'recorded'
           when ba.order_id is not null then 'likely_recorded' else 'not_recorded' end status,
      coalesce(bc.order_id, ba.order_id) order_id,
      coalesce(bc.conversation_id, ba.conversation_id, s.conversation_id,
               case when t.n = 1 then t.conversation_id end, case when n2.n = 1 then n2.conversation_id end) conversation_id,
      case when bc.order_id is not null then 'code' when ba.order_id is not null then 'amount'
           when s.conversation_id is not null then 'screenshot' when t.n = 1 then 'phone'
           when n2.n = 1 then 'name' end matched
    from l
    left join by_code bc on bc.line_id = l.id left join by_amount ba on ba.line_id = l.id
    left join shot s on s.line_id = l.id left join tail t on t.line_id = l.id left join nm n2 on n2.line_id = l.id
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'lines', (select count(*) from rows),
    'sales_lines', (select count(*) from rows where status <> 'dismissed'),
    'recorded', (select count(*) from rows where status in ('recorded', 'likely_recorded')),
    'not_recorded', (select count(*) from rows where status = 'not_recorded'),
    'not_recorded_amount', coalesce((select sum(amount) from rows where status = 'not_recorded'), 0),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'txn_id', r.txn_id, 'at', r.at, 'amount', r.amount, 'currency', r.currency, 'sender_name', r.sender_name,
        'phone_tail', r.phone_tail, 'provider', r.provider, 'status', r.status, 'order_id', r.order_id,
        'conversation_id', r.conversation_id, 'matched', r.matched,
        'contact_name', (select coalesce(nullif(k.full_name, ''), nullif(k.name, ''), k.wa_id) from conversations c join contacts k on k.id = c.contact_id where c.id = r.conversation_id)
      ) order by (r.status = 'not_recorded') desc, r.at desc) from rows r), '[]'::jsonb),
    'last_upload', (select max(created_at) from wallet_lines where workspace_id = p_ws)
  ) into res;
  return res;
end $$;
revoke all on function public.wallet_check(uuid, date, date) from public, anon;
grant execute on function public.wallet_check(uuid, date, date) to authenticated;

-- The owner's tap: record a statement payment as a paid sale (optionally on a chat). Manual provenance, because
-- a person confirmed it; external_ref wallet:<code> stops a second sale for the same payment.
create or replace function public.wallet_record(p_line uuid, p_conv uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare l wallet_lines; v_id uuid; v_cur text;
begin
  select * into l from wallet_lines where id = p_line;
  if l.id is null or not public.can_edit(l.workspace_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_conv is not null and not exists (select 1 from conversations where id = p_conv and workspace_id = l.workspace_id) then
    raise exception 'chat not in this business';
  end if;
  select id into v_id from orders where workspace_id = l.workspace_id and (external_ref = 'wallet:' || l.txn_id or upper(payment_ref) = upper(l.txn_id)) limit 1;
  if v_id is not null then return v_id; end if;
  select currency into v_cur from workspaces where id = l.workspace_id;
  insert into orders (workspace_id, conversation_id, amount, currency, status, paid_at, occurred_at, provenance, external_ref, payment_ref, notes, created_by)
  values (l.workspace_id, p_conv, l.amount, coalesce(l.currency, v_cur), 'paid', l.at, l.at, 'manual', 'wallet:' || l.txn_id, l.txn_id,
          'From your ' || coalesce(l.provider, 'mobile-money') || ' statement' || coalesce(': ' || l.sender_name, '') || coalesce(' (…' || l.phone_tail || ')', '') || '. Code ' || l.txn_id || '.',
          auth.uid())
  returning id into v_id;
  update wallet_lines set dismissed = false where id = l.id;
  return v_id;
end $$;
revoke all on function public.wallet_record(uuid, uuid) from public, anon;
grant execute on function public.wallet_record(uuid, uuid) to authenticated;
