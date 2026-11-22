-- 22 Nov 2026 — Each business's own "money received" words.
--
-- Some customers pay at the office, in cash, or the owner checks the wallet, so there is no screenshot.
-- The owner then sends a message that means "I have the money" (a bare "TZS 205,000✅", or their own words
-- like "Tumepokea malipo"). rule_received_texts holds those words per business (Settings → How itaOS reads
-- your chats). A business message containing one becomes a confirmed paid sale (ticks.ts) and sets the
-- payment day (payment_moment, same tier as the "message you send after payment").
-- Every business starts empty; nothing changes until an owner adds words.

alter table public.workspaces
  add column if not exists rule_received_texts text[] not null default '{}';

alter table public.workspaces drop constraint if exists workspaces_received_size;
alter table public.workspaces add constraint workspaces_received_size check (cardinality(rule_received_texts) <= 10);

comment on column public.workspaces.rule_received_texts is 'Business messages that mean "money received" (no screenshot needed). A message containing one records a paid sale (ticks.ts).';

-- Payment day: the "money received" words count like the "message you send after payment".
create or replace function public.payment_moment(p_conv uuid, p_before timestamptz default now())
returns table(at timestamptz, kind text, snippet text, message_id text)
language sql stable set search_path = public as $$
  with pt as (
    select w.rule_paid_texts || w.rule_received_texts as rule_paid_texts, w.rule_owner_tick from conversations c join workspaces w on w.id = c.workspace_id where c.id = p_conv
  ), m as (
    select id, sent_at, direction, coalesce(body,'') b, media from messages
    where conversation_id = p_conv and sent_at <= p_before
  ), c as (
    select id, sent_at, b,
      case
        when direction='out' and exists (select 1 from pt, unnest(pt.rule_paid_texts) p
          where length(regexp_replace(lower(p), '[\s-]+', '', 'g')) >= 4
            and regexp_replace(lower(b), '[\s-]+', '', 'g') like '%' || replace(replace(replace(regexp_replace(lower(p), '[\s-]+', '', 'g'), '\', '\\'), '%', '\%'), '_', '\_') || '%') then 1
        when direction='in' and ((media->'receipt'->>'is_receipt')='true' or b ilike '[picha ya malipo]%'
          or b ~* '(imethibitishwa|\mconfirmed\M[. ]|umetuma (tsh|tzs|sh)|umelipa (tsh|tzs|sh)|you have paid|paid to lipa|kwenda kwa mpokeaji)') then 2
        when direction='out' and (select rule_owner_tick from pt) and b ~ '(✅|✔)' and length(b) <= 160
          and (b ~ '\d[\d,.]{2,}|\d+\s*[kK]\M' or b ~* '(lipi|lipa|paid|malipo)' or btrim(b, E' \n\t✅✔️') = '') then 3
        when direction='in' and b ~* '(nimetuma|nimelipa|nimelipia|nimeshalipa|nimeshalipia|nishalipa|nishalipia|nishatuma|nimeshatuma|nimekutumia|nimeweka (pesa|hela)|(nimefanya|nimeshafanya|nishafanya|nmefanya) malipo|huo hapo muamala|muamala huo|risiti hiyo|nimesend|i have paid|i.ve (paid|sent)|sent the money|\mpaid\M)' then 4
        when direction='out' and b ~* '(tumepokea (malipo|pesa|tsh|tzs)|malipo yamepokelewa|payment received|asante kwa malipo|umelipiwa|imelipiwa|amelipia|kalipia|majina ya mpokeaji)' then 4
      end tier
    from m
  ), main as (
    select * from c where tier between 1 and 3
      and sent_at >= (select max(sent_at) - interval '10 days' from c where tier between 1 and 3)
    order by tier, sent_at asc limit 1
  ), backup as (
    select * from c where tier = 4 and not exists (select 1 from main) order by sent_at desc limit 1
  ), pick as (
    select sent_at, tier, b, id from main
    union all select sent_at, tier, b, id from backup
    union all select sent_at, 5, b, id from (select * from m where direction='in' order by sent_at desc limit 1) x
      where not exists (select 1 from main) and not exists (select 1 from backup)
  )
  select sent_at, case tier when 1 then 'payment_message' when 2 then 'receipt' when 3 then 'owner_tick' when 4 then 'customer_said_paid' else 'last_message' end,
    left(regexp_replace(b, '\s+', ' ', 'g'), 120), id
  from pick limit 1
$$;
