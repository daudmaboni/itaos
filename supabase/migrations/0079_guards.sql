-- 23 Nov 2026 — Three money guards (features 2 and 4 of the $1,000 plan, plus "Why people didn't buy").
--
-- 1. Fake payment guard   payment_checks(ws, days) / chat_payment_flags(conv)
--    Every payment screenshot Kito read is checked, with no mobile-money API:
--      reused    the same transaction code is on a screenshot in ANOTHER chat, or on a sale of another chat   (red)
--      receiver  paid to a name/number that is not one of the business's payment numbers                      (red)
--      wallet    the owner's pasted M-Pesa statement covers that time and has no such payment                  (red)
--      amount    the screenshots in the chat add up to less than 90% of the agreed amount                       (amber)
--      date      the date on the screenshot is more than 3 days before, or after, the day it was sent          (amber)
--      edited    Kito saw signs of editing (mixed fonts, misaligned digits…)                                    (amber)
--    Bus/cargo/parcel receipts are not payments to the business and are skipped.
--    The owner decides: "Money came in" (ok) or "Fake" (fake). Fakes count as money saved on the card.
--
-- 2. Why people didn't buy   lost_reasons(ws, days)
--    Chats that went quiet or were lost without a paid sale, grouped by reason. No extra AI reads:
--    first what the customer said (Kito's blocker for price/money/think/trust/delivery, then objections,
--    then tags), else what the chat shows: never answered, a reply that took over an hour, quiet before
--    the price, quiet after the price. Kito's own "business_slow" is NOT trusted on its own: on Kayani it
--    covered 86% of chats whose replies were no slower than the rest, so lateness is measured instead.
--
-- 3. Staff leak guard   staff_leaks(ws, days)
--      pay_number       a business message asks to pay to a number that is not the business's
--      personal_number  a business message moves the customer to another phone number
--      paid_elsewhere   a customer's screenshot shows money paid to someone else
--      unrecorded       Kito or a screenshot says the customer paid, but no paid sale is recorded after 2 days
--    plus, per person on the team: chats assigned, bought, messages sent from itaOS and median reply time.
--    Messages typed on the phone (WhatsApp Business app) can't be tied to a person; they show as "Phone".
--
-- Reviews for both guards live in guard_reviews (one row per flag, the owner's decision).

alter table public.workspaces add column if not exists pay_receivers text[] not null default '{}';
comment on column public.workspaces.pay_receivers is
  'The business''s own payment numbers/names (Lipa namba, till, phone, bank account name). Used by the payment and leak guards.';

create table if not exists public.guard_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('payment', 'leak')),
  ref text not null,                    -- payment: message id · leak: '<flag>:<key>'
  verdict text not null check (verdict in ('ok', 'fake', 'leak')),
  amount numeric,
  conversation_id uuid references public.conversations(id) on delete set null,
  note text,
  reviewed_by uuid default auth.uid(),
  reviewed_at timestamptz not null default now(),
  unique (workspace_id, kind, ref)
);
alter table public.guard_reviews enable row level security;
drop policy if exists gr_read on public.guard_reviews;
create policy gr_read on public.guard_reviews for select using (public.is_member(workspace_id));
grant select on public.guard_reviews to authenticated;

-- Payment screenshots are few among many messages: partial indexes keep the checks fast.
create index if not exists messages_receipts_idx on public.messages (workspace_id, sent_at)
  where (media->'receipt'->>'is_receipt') = 'true';
create index if not exists messages_receipt_code_idx on public.messages
  (workspace_id, (upper(regexp_replace(coalesce(media->'receipt'->>'txn_code', ''), '\s', '', 'g'))))
  where (media->'receipt'->>'is_receipt') = 'true';

-- ---------- helpers ----------
create or replace function public._digits(p text) returns text language sql immutable as $$
  -- digits only, without the country code 255 or a leading 0 (0774587 / 255774587 / +255 774 587 → 774587)
  select regexp_replace(regexp_replace(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '^255', ''), '^0+', '');
$$;

/** Is this receiver one of the business's own? null when the business has not listed any. */
create or replace function public._own_receiver(p_list text[], p_text text) returns boolean language sql immutable as $$
  select case
    when coalesce(cardinality(p_list), 0) = 0 or nullif(btrim(coalesce(p_text, '')), '') is null then null
    else exists (
      select 1 from unnest(p_list) e
      where (length(public._digits(e)) >= 5 and (
               public._digits(p_text) like '%' || public._digits(e) || '%'
               or regexp_replace(coalesce(p_text, ''), '\D', '', 'g') like '%' || public._digits(e) || '%'
               or p_text ~ ('\*+\s*' || right(public._digits(e), 4) || '(\D|$)')))            -- masked: ****0266
         or (length(public._digits(e)) < 5 and length(regexp_replace(lower(e), '[^a-z]', '', 'g')) >= 4
             and regexp_replace(lower(p_text), '[^a-z]', '', 'g') like '%' || regexp_replace(lower(e), '[^a-z]', '', 'g') || '%'))
  end;
$$;

/** Best-effort date from a receipt's written date (dd/mm/yy, dd-mm-yyyy, yyyy-mm-dd, "18/11"). */
create or replace function public._receipt_date(p text, p_sent timestamptz) returns date language plpgsql immutable as $$
declare m text[]; y int; d date;
begin
  -- a date Kito only guessed ("date not shown; TID suggests …") is no date
  if p is null or p ~* '(not shown|suggest|unclear|ambiguous|guess|not visible)' then return null; end if;
  m := regexp_match(p, '(\d{4})-(\d{1,2})-(\d{1,2})');
  if m is not null then begin return make_date(m[1]::int, m[2]::int, m[3]::int); exception when others then return null; end; end if;
  m := regexp_match(p, '(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})');
  if m is not null then
    y := m[3]::int; if y < 100 then y := 2000 + y; end if;
    if y < extract(year from p_sent)::int - 1 then return null; end if;   -- 26-11-20 is yy-mm-dd, not 2020
    begin return make_date(y, m[2]::int, m[1]::int); exception when others then return null; end;
  end if;
  m := regexp_match(p, '(^|\D)(\d{1,2})/(\d{1,2})(\D|$)');
  if m is not null then
    begin
      d := make_date(extract(year from p_sent)::int, m[3]::int, m[2]::int);
      if d > p_sent::date + 31 then d := d - interval '1 year'; end if;
      return d;
    exception when others then return null; end;
  end if;
  return null;
end $$;

-- ---------- 1. payment rows (internal) ----------
create or replace function public._payment_rows(p_ws uuid, p_since timestamptz)
returns table (
  message_id text, conversation_id uuid, contact_name text, sent_at timestamptz, amount numeric, txn_code text,
  provider text, paid_to text, paid_at_text text, confidence text, notes text,
  flags text[], severity text, expected numeric, other_conversation_id uuid, verdict text, reviewed_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with w as (select pay_receivers from workspaces where id = p_ws),
  stmt as (select min(at) lo, max(at) hi from wallet_lines where workspace_id = p_ws and not dismissed),
  r as (
    select m.id, m.conversation_id, m.sent_at, m.media->'receipt' rc,
           nullif(upper(regexp_replace(coalesce(m.media->'receipt'->>'txn_code', ''), '\s', '', 'g')), '') code,
           nullif(m.media->'receipt'->>'amount', '')::numeric amt
    from messages m join conversations c on c.id = m.conversation_id join contacts k on k.id = c.contact_id
    where m.workspace_id = p_ws and m.direction = 'in' and m.sent_at >= p_since
      and (m.media->'receipt'->>'is_receipt') = 'true' and not k.not_customer
      and coalesce(m.media->'receipt'->>'kind', 'payment') = 'payment'
      and not (coalesce(m.media->'receipt'->>'provider', '') || ' ' || coalesce(m.media->'receipt'->>'paid_to', '')
               ~* '(cargo|parcel|luggage|mzigo|coach|transport|safaris?\M|express\M|bus (company|luggage)|courier)')
  ),
  x as (
    select r.*,
      (select c2.id from messages m2 join conversations c2 on c2.id = m2.conversation_id
        where m2.workspace_id = p_ws and (m2.media->'receipt'->>'is_receipt') = 'true'
          and m2.conversation_id <> r.conversation_id and r.code is not null and length(r.code) >= 6
          and upper(regexp_replace(coalesce(m2.media->'receipt'->>'txn_code', ''), '\s', '', 'g')) = r.code
        order by m2.sent_at limit 1) dup_shot,
      (select o.conversation_id from orders o where o.workspace_id = p_ws and o.status = 'paid' and r.code is not null and length(r.code) >= 6
          and upper(coalesce(o.payment_ref, '')) = r.code and o.conversation_id is distinct from r.conversation_id limit 1) dup_order,
      public._own_receiver((select pay_receivers from w), r.rc->>'paid_to') own,
      coalesce(
        (select o.amount - o.discount from orders o where o.conversation_id = r.conversation_id and o.status in ('paid', 'pending')
           and abs(extract(epoch from coalesce(o.paid_at, o.occurred_at) - r.sent_at)) < 7 * 86400
         order by abs(extract(epoch from coalesce(o.paid_at, o.occurred_at) - r.sent_at)) limit 1),
        (select c.kito_amount from conversations c where c.id = r.conversation_id and c.kito_amount > 0)) exp_amt,
      (select sum(nullif(m3.media->'receipt'->>'amount', '')::numeric) from messages m3
        where m3.conversation_id = r.conversation_id and m3.direction = 'in' and m3.media->'receipt'->>'is_receipt' = 'true'
          and abs(extract(epoch from m3.sent_at - r.sent_at)) <= 3 * 86400) paid_sum,
      public._receipt_date(r.rc->>'paid_at', r.sent_at) rdate,
      (select (s.lo <= r.sent_at - interval '1 hour' and s.hi >= r.sent_at) from stmt s) covered,
      exists (select 1 from wallet_lines l where l.workspace_id = p_ws
                and ((r.code is not null and upper(l.txn_id) = r.code)
                     or (r.code is null and r.amt is not null and abs(l.amount - r.amt) <= 1 and abs(extract(epoch from l.at - r.sent_at)) <= 86400))) in_wallet
    from r
  ),
  f as (
    select x.*, array_remove(array[
      case when x.dup_shot is not null or x.dup_order is not null then 'reused' end,
      case when x.own = false then 'receiver' end,
      case when coalesce(x.covered, false) and not x.in_wallet then 'wallet' end,
      case when x.exp_amt > 0 and coalesce(x.paid_sum, 0) > 0 and x.paid_sum < x.exp_amt * 0.9 then 'amount' end,
      case when x.rdate is not null and (x.rdate > (x.sent_at at time zone 'Africa/Dar_es_Salaam')::date + 1
                                       or x.rdate < (x.sent_at at time zone 'Africa/Dar_es_Salaam')::date - 3) then 'date' end,
      case when jsonb_array_length(coalesce(x.rc->'tamper', '[]'::jsonb)) > 0
             or coalesce(x.rc->>'notes', '') ~* '(edited|altered|tamper|manipulat|photoshop|fake|font (differs|mismatch)|misaligned|inconsistent)' then 'edited' end
    ], null) fl
    from x
  )
  select f.id, f.conversation_id,
         (select coalesce(nullif(k.full_name, ''), nullif(k.name, ''), k.wa_id) from conversations c join contacts k on k.id = c.contact_id where c.id = f.conversation_id),
         f.sent_at, f.amt, f.code, f.rc->>'provider', f.rc->>'paid_to', f.rc->>'paid_at', f.rc->>'confidence',
         concat_ws(' · ', nullif(f.rc->>'notes', ''), (select string_agg(t, ', ') from jsonb_array_elements_text(coalesce(f.rc->'tamper', '[]'::jsonb)) t)),
         f.fl,
         case when f.fl && array['reused', 'receiver', 'wallet'] then 'red' when cardinality(f.fl) > 0 then 'amber' else 'ok' end,
         f.exp_amt, coalesce(f.dup_shot, f.dup_order), g.verdict, g.reviewed_at
  from f left join guard_reviews g on g.workspace_id = p_ws and g.kind = 'payment' and g.ref = f.id;
$$;
revoke all on function public._payment_rows(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.payment_checks(p_ws uuid, p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_days int := greatest(1, least(coalesce(p_days, 30), 365)); res jsonb;
begin
  if not public.is_member(p_ws) then raise exception 'forbidden' using errcode = '42501'; end if;
  with p as (select * from public._payment_rows(p_ws, now() - make_interval(days => v_days)))
  select jsonb_build_object(
    'days', v_days,
    'receivers', (select to_jsonb(pay_receivers) from workspaces where id = p_ws),
    'checked', (select count(*) from p),
    'to_check', (select count(*) from p where severity <> 'ok' and verdict is null),
    'to_check_red', (select count(*) from p where severity = 'red' and verdict is null),
    'fakes', (select count(*) from guard_reviews g where g.workspace_id = p_ws and g.kind = 'payment' and g.verdict = 'fake' and g.reviewed_at >= now() - make_interval(days => v_days)),
    'fakes_amount', (select coalesce(sum(amount), 0) from guard_reviews g where g.workspace_id = p_ws and g.kind = 'payment' and g.verdict = 'fake' and g.reviewed_at >= now() - make_interval(days => v_days)),
    'statement', (select jsonb_build_object('from', min(at), 'to', max(at)) from wallet_lines where workspace_id = p_ws and not dismissed),
    -- receivers seen on screenshots that are not listed yet (to suggest adding them)
    'suggest', coalesce((select jsonb_agg(jsonb_build_object('paid_to', paid_to, 'n', n) order by n desc) from (
        select paid_to, count(*) n from public._payment_rows(p_ws, now() - interval '120 days')
        where paid_to is not null and coalesce(public._own_receiver((select pay_receivers from workspaces where id = p_ws), paid_to), false) = false
        group by paid_to order by count(*) desc limit 6) s), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(to_jsonb(p) order by (p.verdict is null) desc, (p.severity = 'red') desc, p.sent_at desc)
                       from p where p.severity <> 'ok' or p.verdict is not null), '[]'::jsonb)
  ) into res;
  return res;
end $$;
revoke all on function public.payment_checks(uuid, int) from public, anon;
grant execute on function public.payment_checks(uuid, int) to authenticated;

create or replace function public.chat_payment_flags(p_conv uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from conversations where id = p_conv;
  if v_ws is null or not public.is_member(v_ws) then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(p) order by p.sent_at desc)
    from public._payment_rows(v_ws, now() - interval '400 days') p
    where p.conversation_id = p_conv and p.severity <> 'ok' and p.verdict is null), '[]'::jsonb);
end $$;
revoke all on function public.chat_payment_flags(uuid) from public, anon;
grant execute on function public.chat_payment_flags(uuid) to authenticated;

create or replace function public.set_pay_receivers(p_ws uuid, p_list text[])
returns text[] language plpgsql security definer set search_path = public as $$
declare v text[];
begin
  if not public.can_edit(p_ws) then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(array_agg(distinct btrim(e)) filter (where length(btrim(e)) >= 3), '{}') into v
    from unnest(coalesce(p_list, '{}')) e;
  if cardinality(v) > 20 then raise exception 'at most 20 payment numbers'; end if;
  update workspaces set pay_receivers = v where id = p_ws;
  return v;
end $$;
revoke all on function public.set_pay_receivers(uuid, text[]) from public, anon;
grant execute on function public.set_pay_receivers(uuid, text[]) to authenticated;

/** The owner's decision on a flag. p_verdict null removes the decision. */
create or replace function public.guard_review(p_ws uuid, p_kind text, p_ref text, p_verdict text, p_amount numeric default null, p_conv uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_edit(p_ws) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_kind = 'payment' and not exists (select 1 from messages where id = p_ref and workspace_id = p_ws) then raise exception 'not found'; end if;
  if p_conv is not null and not exists (select 1 from conversations where id = p_conv and workspace_id = p_ws) then raise exception 'chat not in this business'; end if;
  if p_verdict is null then
    delete from guard_reviews where workspace_id = p_ws and kind = p_kind and ref = p_ref;
    return;
  end if;
  insert into guard_reviews (workspace_id, kind, ref, verdict, amount, conversation_id)
  values (p_ws, p_kind, p_ref, p_verdict, p_amount, p_conv)
  on conflict (workspace_id, kind, ref) do update set verdict = excluded.verdict, amount = excluded.amount,
    conversation_id = coalesce(excluded.conversation_id, guard_reviews.conversation_id), reviewed_by = auth.uid(), reviewed_at = now();
end $$;
revoke all on function public.guard_review(uuid, text, text, text, numeric, uuid) from public, anon;
grant execute on function public.guard_review(uuid, text, text, text, numeric, uuid) to authenticated;

-- ---------- 2. why people didn't buy ----------
create or replace function public.lost_reasons(p_ws uuid, p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_days int := greatest(7, least(coalesce(p_days, 30), 365)); v_since timestamptz; v_prev timestamptz; res jsonb;
begin
  if not public.is_member(p_ws) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_since := now() - make_interval(days => v_days);
  v_prev := v_since - make_interval(days => v_days);
  with c0 as (
    select c.*, coalesce(nullif(k.full_name, ''), nullif(k.name, ''), k.wa_id) contact_name,
           exists (select 1 from orders o where o.conversation_id = c.id and o.status = 'paid') bought,
           -- the longest a customer message waited for the business's next message, in minutes
           (select max(extract(epoch from (select min(o.sent_at) from messages o where o.conversation_id = c.id and o.direction = 'out' and o.sent_at > m.sent_at) - m.sent_at)) / 60
              from messages m where m.conversation_id = c.id and m.direction = 'in') worst_wait
    from conversations c join contacts k on k.id = c.contact_id
    where c.workspace_id = p_ws and not k.not_customer and c.kito_checked_at is not null and c.started_at >= v_prev
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
  cur as (select * from lost where started_at >= v_since),
  prev as (select * from lost where started_at < v_since),
  sold as (select * from base where started_at >= v_since and (bought or kito_outcome = 'sold')),
  avg_sale as (
    select avg(o.amount - o.discount - o.refund_amount) v from orders o
    where o.workspace_id = p_ws and o.status = 'paid' and o.paid_at >= now() - interval '90 days'
  )
  select jsonb_build_object(
    'days', v_days,
    'chats', (select count(*) from base where started_at >= v_since),
    'lost', (select count(*) from cur),
    'sold', (select count(*) from sold),
    'avg_sale', (select round(v) from avg_sale),
    -- of chats that got the price, the share that paid
    'close_rate', (select round(count(*) filter (where bought)::numeric / nullif(count(*), 0), 3) from base where started_at >= v_since and price_shared),
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
revoke all on function public.lost_reasons(uuid, int) from public, anon;
grant execute on function public.lost_reasons(uuid, int) to authenticated;

-- ---------- 3. staff leak guard ----------
create or replace function public.staff_leaks(p_ws uuid, p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_days int := greatest(1, least(coalesce(p_days, 30), 180)); v_since timestamptz; v_recv text[]; v_own text[]; res jsonb;
begin
  if not public.is_member(p_ws) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_since := now() - make_interval(days => v_days);
  select pay_receivers into v_recv from workspaces where id = p_ws;
  -- the business's own WhatsApp numbers never count as "another number"
  select coalesce(array_agg(public._digits(display_phone)) filter (where display_phone is not null), '{}') into v_own from wa_numbers where workspace_id = p_ws;

  with outm as (   -- business messages with a phone/till-like number in them
    select m.id, m.conversation_id, m.sent_at, m.sent_by, m.body,
           public._digits(n[1]) num
    from messages m
    cross join lateral regexp_matches(coalesce(m.body, ''), '(?:^|[^\d,.])((?:\+?255|0)[ -]?[67]\d{2}[ -]?\d{3}[ -]?\d{3}|\d{6,9})(?![\d,.])', 'g') n
    where m.workspace_id = p_ws and m.direction = 'out' and m.sent_at >= v_since and m.body is not null
      and m.body !~ '^\[picha'
      and public._digits(n[1]) !~ '[05]00$'    -- 155000 / 72500: an amount, not a number
  ),
  cust as (   -- customers' own numbers: a business message repeating them is an order note, not a leak
    select public._digits(wa_id) d from contacts where workspace_id = p_ws and wa_id is not null
    union select public._digits(alt_phone) from contacts where workspace_id = p_ws and alt_phone is not null
  ),
  cls as (
    select o.*,
      case
        when o.body ~* '(lipa|lipia|tuma (pesa|hela|kiasi)|namba ya malipo|lipa namba|till|paybill|akaunti|account|m-?pesa|tigo ?pesa|mixx|airtel ?money|halo ?pesa|muamala)'
             and coalesce(public._own_receiver(v_recv, o.num), true) = false then 'pay_number'
        when o.num ~ '^[67]\d{8}$' and not (o.num = any(v_own))
             and coalesce(public._own_receiver(v_recv, o.num), false) = false
             and o.body ~* '(nipigie|nipige|piga|call|namba yangu|my number|wasiliana|ongea na|niandikie|text me|whatsapp|sms|kwa namba)' then 'personal_number'
      end flag
    from outm o where not exists (select 1 from cust where cust.d = o.num)
      -- nor a number the customer gave in the same chat
      and not exists (select 1 from messages i where i.conversation_id = o.conversation_id and i.direction = 'in'
                        and regexp_replace(coalesce(i.body, ''), '\D', '', 'g') like '%' || o.num || '%')
  ),
  grp as (
    select flag, num, count(*) n, count(distinct conversation_id) chats, min(sent_at) first_at, max(sent_at) last_at,
           (array_agg(conversation_id order by sent_at desc))[1:20] conv_ids,
           (array_agg(left(body, 160) order by sent_at desc))[1] sample,
           array_remove(array_agg(distinct sent_by), null) senders
    from cls where flag is not null group by flag, num
  ),
  pay as (select * from public._payment_rows(p_ws, v_since) where 'receiver' = any(flags)),
  unrec as (
    select c.id, coalesce(nullif(k.full_name, ''), nullif(k.name, ''), k.wa_id) contact_name, c.last_message_at, c.assigned_to,
           coalesce(c.kito_amount, c.payment_amount,
             (select max(nullif(m.media->'receipt'->>'amount', '')::numeric) from messages m where m.conversation_id = c.id and m.media->'receipt'->>'is_receipt' = 'true')) amount,
           case when c.kito_outcome = 'sold' then 'kito' when c.payment_signal then 'words' else 'screenshot' end why
    from conversations c join contacts k on k.id = c.contact_id
    where c.workspace_id = p_ws and not k.not_customer and c.last_message_at >= v_since and c.last_message_at < now() - interval '2 days'
      and not exists (select 1 from orders o where o.conversation_id = c.id and o.status = 'paid')
      and (c.kito_outcome = 'sold'
           or exists (select 1 from messages m where m.conversation_id = c.id and m.direction = 'in' and m.sent_at >= v_since
                        and m.media->'receipt'->>'is_receipt' = 'true' and coalesce(m.media->'receipt'->>'kind', 'payment') = 'payment'
                        and coalesce(public._own_receiver(v_recv, m.media->'receipt'->>'paid_to'), true)))
  ),
  people as (
    select mb.user_id, split_part(u.email, '@', 1) name, mb.role,
      (select count(*) from conversations c where c.workspace_id = p_ws and c.assigned_to = mb.user_id and c.last_message_at >= v_since) assigned,
      (select count(*) from conversations c where c.workspace_id = p_ws and c.assigned_to = mb.user_id and c.last_message_at >= v_since
          and exists (select 1 from orders o where o.conversation_id = c.id and o.status = 'paid' and o.paid_at >= v_since)) bought,
      (select count(*) from messages m where m.workspace_id = p_ws and m.sent_by = mb.user_id and m.sent_at >= v_since) sent,
      (select round((percentile_cont(0.5) within group (order by gap) / 60)::numeric)
         from (select extract(epoch from m.sent_at - (select max(i.sent_at) from messages i where i.conversation_id = m.conversation_id and i.direction = 'in' and i.sent_at < m.sent_at)) gap
               from messages m where m.workspace_id = p_ws and m.sent_by = mb.user_id and m.sent_at >= v_since) g where gap is not null and gap < 3 * 86400) reply_min,
      (select count(*) from cls where cls.flag is not null and cls.sent_by = mb.user_id) flags
    from memberships mb join auth.users u on u.id = mb.user_id where mb.workspace_id = p_ws
  )
  select jsonb_build_object(
    'days', v_days,
    'receivers_set', coalesce(cardinality(v_recv), 0) > 0,
    'team', (select count(*) from memberships where workspace_id = p_ws),
    'phone_messages', (select count(*) from messages where workspace_id = p_ws and direction = 'out' and sent_by is null and sent_at >= v_since),
    'numbers', coalesce((select jsonb_agg(jsonb_build_object('flag', g.flag, 'num', g.num, 'n', g.n, 'chats', g.chats, 'first_at', g.first_at, 'last_at', g.last_at,
          'conv_ids', to_jsonb(g.conv_ids), 'sample', g.sample,
          'senders', (select jsonb_agg(split_part(u.email, '@', 1)) from auth.users u where u.id = any(g.senders)),
          'verdict', r.verdict) order by (r.verdict is null) desc, g.last_at desc)
        from grp g left join guard_reviews r on r.workspace_id = p_ws and r.kind = 'leak' and r.ref = g.flag || ':' || g.num), '[]'::jsonb),
    'paid_elsewhere', coalesce((select jsonb_agg(jsonb_build_object('paid_to', paid_to, 'n', n, 'amount', amt, 'conv_ids', ids, 'last_at', last_at) order by n desc)
        from (select paid_to, count(*) n, sum(amount) amt, jsonb_agg(distinct conversation_id) ids, max(sent_at) last_at from pay
              where verdict is distinct from 'ok' group by paid_to) p), '[]'::jsonb),
    'unrecorded', (select count(*) from unrec),
    'unrecorded_amount', (select coalesce(sum(amount), 0) from unrec),
    'unrecorded_items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', contact_name, 'at', last_message_at, 'amount', amount, 'why', why,
          'assigned', (select split_part(u.email, '@', 1) from auth.users u where u.id = unrec.assigned_to)) order by last_message_at desc)
        from (select * from unrec order by last_message_at desc limit 30) unrec), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(to_jsonb(p) - 'user_id' || jsonb_build_object('id', p.user_id) order by p.sent desc, p.assigned desc) from people p), '[]'::jsonb)
  ) into res;
  return res;
end $$;
revoke all on function public.staff_leaks(uuid, int) from public, anon;
grant execute on function public.staff_leaks(uuid, int) to authenticated;

-- "OK" on a "pay to another number" flag usually means it IS the business's number: add it to the list.
create or replace function public.leak_ok_add_receiver(p_ws uuid, p_num text)
returns text[] language plpgsql security definer set search_path = public as $$
declare v text[];
begin
  if not public.can_edit(p_ws) then raise exception 'forbidden' using errcode = '42501'; end if;
  update workspaces set pay_receivers = (select array_agg(distinct e) from unnest(pay_receivers || array[btrim(p_num)]) e)
   where id = p_ws returning pay_receivers into v;
  perform public.guard_review(p_ws, 'leak', 'pay_number:' || public._digits(p_num), 'ok');
  return v;
end $$;
revoke all on function public.leak_ok_add_receiver(uuid, text) from public, anon;
grant execute on function public.leak_ok_add_receiver(uuid, text) to authenticated;
