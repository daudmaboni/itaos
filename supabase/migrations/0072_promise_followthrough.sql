-- 0072_promise_followthrough — promises that look after themselves (22 Nov 2026).
--  1. "Promise due" reminders are checked every 5 minutes (was 15).
--  2. A payment showing up in the chat after the promise closes it and cancels its reminders (Google Tasks too):
--     the customer's payment screenshot or pasted M-Pesa/bank message, "nimetuma / nimelipa …", or the business's
--     "tumepokea malipo" / a short price-with-✅ message. Marked auto_closed so the owner can see it and reopen it.
--  3. asked_at: when the owner asked a customer with no clear time for a day (shown on the card).
--  4. promise_record(): kept vs broken per customer and in total, for the Promises page.

alter table public.follow_up_tasks
  add column if not exists auto_closed text check (auto_closed in ('receipt', 'customer_said_paid', 'owner_confirmed')),
  add column if not exists asked_at timestamptz;
comment on column public.follow_up_tasks.auto_closed is 'itaOS closed this promise because a payment showed up in the chat (0072); the owner can reopen it.';
comment on column public.follow_up_tasks.asked_at is 'The owner asked the customer for a day (No clear time card, 0072).';

-- 1. Every 5 minutes -----------------------------------------------------------------------------------------
select cron.unschedule('promises-due-15m') where exists (select 1 from cron.job where jobname = 'promises-due-15m');
select cron.unschedule('promises-due-5m') where exists (select 1 from cron.job where jobname = 'promises-due-5m');
select cron.schedule('promises-due-5m', '3-59/5 * * * *', $cron$
  select net.http_post(
    url := 'https://jrdxeagnmunmatxtgmpk.supabase.co/functions/v1/push-send',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpyZHhlYWdubXVubWF0eHRnbXBrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1ODkyNjcsImV4cCI6MjExMDE2NTI2N30.1HJUnCAwcCwQ0BiGZxfhJsh6xa6Amm3SrDuDopSZOWc',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{"due_tasks": true}'::jsonb,
    timeout_milliseconds := 30000
  );
$cron$);

-- 2. Payment in the chat closes the promise ------------------------------------------------------------------
-- Same signs as payment_moment (0036), message by message.
create or replace function private.payment_sign(p_dir text, p_body text, p_media jsonb)
returns text language sql immutable as $$
  select case
    when p_dir = 'in' and ((p_media->'receipt'->>'is_receipt') = 'true' or coalesce(p_body, '') ilike '[picha ya malipo]%'
      or coalesce(p_body, '') ~* '(imethibitishwa|\mconfirmed\M[. ]|umetuma (tsh|tzs|sh)|umelipa (tsh|tzs|sh)|you have paid|paid to lipa|kwenda kwa mpokeaji)') then 'receipt'
    when p_dir = 'in' and coalesce(p_body, '') ~* '(nimetuma|nimelipa|nimelipia|nimeshalipa|nimeshalipia|nishalipa|nishalipia|nishatuma|nimeshatuma|nimekutumia|nimeweka (pesa|hela)|(nimefanya|nimeshafanya|nishafanya|nmefanya) malipo|huo hapo muamala|muamala huo|risiti hiyo|nimesend|i have paid|i.ve (paid|sent)|sent the money)' then 'customer_said_paid'
    when p_dir = 'out' and (coalesce(p_body, '') ~* '(tumepokea (malipo|pesa|tsh|tzs)|malipo yamepokelewa|payment received|asante kwa malipo|umelipiwa|imelipiwa)'
      or (coalesce(p_body, '') ~ '(✅|✔)' and length(p_body) <= 160 and (p_body ~ '\d[\d,.]{2,}|\d+\s*[kK]\M' or p_body ~* '(lipi|lipa|paid|malipo)'))) then 'owner_confirmed'
  end
$$;

create or replace function private.close_promises_on_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare sign text;
begin
  sign := private.payment_sign(new.direction, new.body, new.media);
  if sign is null then return null; end if;
  update public.follow_up_tasks t
     set status = 'done', result = 'paid', auto_closed = sign
   where t.conversation_id = new.conversation_id and t.source = 'kito_promise'
     and t.status in ('proposed', 'open', 'snoozed')
     and coalesce(t.promise_at, t.created_at) < new.sent_at;
  return null;
end $$;
drop trigger if exists messages_close_promises on public.messages;
create trigger messages_close_promises after insert or update of media, body on public.messages
  for each row execute function private.close_promises_on_payment();

-- 4. Kept vs broken ------------------------------------------------------------------------------------------
-- A promise is judged two days after its due time:
--   kept   = a paid order in that customer's chats between the promise and due + 2 days, or the owner/itaOS
--            marked it paid;
--   broken = no payment by then and not withdrawn ("Not a promise" / replaced by a newer promise don't count),
--            or marked "Not interested".
create or replace function public.promise_record(p_ws uuid, p_days int default 90)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_member(p_ws) then raise exception 'forbidden' using errcode = '42501'; end if;
  with p as (
    select t.id, t.conversation_id, c.contact_id, t.status, t.result,
           coalesce(t.promise_at, t.created_at) said, coalesce(t.snoozed_until, t.due_at) due
      from follow_up_tasks t
      join conversations c on c.id = t.conversation_id
      join contacts ct on ct.id = c.contact_id and not ct.not_customer
     where t.workspace_id = p_ws and t.source = 'kito_promise' and t.due_at is not null
       and coalesce(t.promise_at, t.created_at) > now() - make_interval(days => p_days)
       and not (t.status = 'dismissed' and t.result is null)
       and not (t.status = 'proposed')
  ), j as (
    select p.*,
           (p.result = 'paid' or exists (select 1 from orders o join conversations c2 on c2.id = o.conversation_id
                                          where c2.contact_id = p.contact_id and o.status = 'paid'
                                            and o.paid_at > p.said and o.paid_at <= p.due + interval '2 days')) kept,
           p.due + interval '2 days' <= now() or p.result = 'not_interested' judged
      from p
  ), per as (
    select j.contact_id, array_agg(distinct j.conversation_id) convs,
           count(*) filter (where kept) kept, count(*) filter (where judged and not kept) broken
      from j group by j.contact_id
  )
  select jsonb_build_object(
    'days', p_days,
    'kept', coalesce((select sum(kept) from per), 0),
    'broken', coalesce((select sum(broken) from per), 0),
    'contacts', coalesce((select jsonb_agg(jsonb_build_object('contact_id', per.contact_id, 'conversation_ids', per.convs,
                           'kept', per.kept, 'broken', per.broken,
                           'name', coalesce(nullif(ct.full_name, ''), nullif(ct.name, ''), ct.wa_id)) order by per.broken desc, per.kept desc)
                         from per join contacts ct on ct.id = per.contact_id where per.kept + per.broken > 0), '[]'::jsonb)
  ) into r;
  return r;
end $$;
revoke all on function public.promise_record(uuid, int) from public, anon;
grant execute on function public.promise_record(uuid, int) to authenticated;
