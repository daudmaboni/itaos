-- 21 Nov 2026 — The buyer's real name on receipts, not the business's contact label.
--
-- Businesses save leads with campaign tags in the name ("Michael Mwanza Oct TTs Leads A 1182",
-- "Ngr Nov FF List 286❌ FABIAN KULWA OZZA", "Oct TTs Leads A 1707✅"). Receipts printed that label.
-- Now contacts.full_name (the name receipts show) is filled, best source first:
--   1. 'owner' — typed by the owner in Buyers. Never overwritten.
--   2. 'kito'  — the buyer's name Kito read in the chat: how they introduced themselves, the delivery
--               details they sent for themselves, or the payer in a payment message ("Ndugu X, Umetuma…").
--               Edge Function `names`, every 5 minutes, once per new payment.
--   3. 'auto'  — the name before a phone number in the delivery message (0054/0055 rule). Kito replaces
--               it, and drops it when Kito sees that name belongs to someone else receiving the parcel.
--   4. 'clean' — the saved contact name with tags, months, codes, products and places taken out.
--               Set at once when a sale is paid, so a receipt never waits for Kito.
-- The receipt shows the buyer only. A different receiver Kito finds is kept in receiver_name.
-- contacts.name (the saved/WhatsApp name with its tags) is never changed.

alter table public.contacts drop constraint if exists contacts_name_source_check;
alter table public.contacts add constraint contacts_name_source_check
  check (name_source in ('auto', 'owner', 'kito', 'clean'));
alter table public.contacts
  add column if not exists receiver_name text,
  add column if not exists name_evidence text,
  add column if not exists name_checked_at timestamptz;

-- Words that are never a person's name inside a saved contact name.
create table if not exists private.name_noise (word text primary key, kind text not null);
insert into private.name_noise (word, kind)
select w, 'tag' from unnest(string_to_array(
  'leads lead tts ngv ngvj ngvpi ngr ng ads ad ls lst list mid sec secth tml tfv nw gx gt gr trz batch btch '
  'one two twof three five cone end last new mix group autosave autosaves kuza klp instaad insta fb wa tz '
  'qlty qlfy uum pb fr fv zz pix tri bws paid blanks join contact call store gmail com dt jplus cy estro '
  'unknown tags tag customer customers mteja wateja lipa', ' ')) w
union all
select w, 'month' from unnest(string_to_array(
  'jan january feb february mar march apr april may jun june jul july aug august agust sep sept september '
  'oct october nov november dec december', ' ')) w
union all
select w, 'product' from unnest(string_to_array(
  'tumbo tumboflux ngiri fibroid acdr ulc kayatox kayapower kaya dawa', ' ')) w
union all
select w, 'note' from unnest(string_to_array(
  'guy boy atumiwe mdogo wake wa kike yakweli the and wife mke mume', ' ')) w
union all
select w, 'business' from unnest(string_to_array(
  'shop shops store bureau entertainment herbs ltd limited company enterprises enterprise services', ' ')) w
union all   -- short forms and places outside the region/district list
select w, 'place' from unnest(string_to_array(
  'znz zanz zanzbar ungj kgmbn arsha mby dsm pongwe nyamongo mtukula mutukula lamadi nairobi kenya uganda '
  'malawi zambia burundi rwanda congo drc mjini town', ' ')) w
on conflict (word) do nothing;

-- Per business: words that appear in so many saved names that they must be that business's own tags
-- (new campaign codes are picked up without anyone editing a list). Refreshed daily.
create table if not exists private.ws_name_tags (
  workspace_id uuid not null, word text not null, uses int not null, primary key (workspace_id, word));

create or replace function private.refresh_name_tags() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from private.ws_name_tags;
  insert into private.ws_name_tags (workspace_id, word, uses)
  with toks as (
    select c.workspace_id, c.id, lower(t) word
      from contacts c, regexp_split_to_table(regexp_replace(coalesce(c.name, ''), '[^[:alpha:]0-9]+', ' ', 'g'), ' ') t
     where t <> ''),
  totals as (select workspace_id, count(*) n from contacts group by workspace_id)
  select t.workspace_id, t.word, count(distinct t.id)::int
    from toks t join totals s using (workspace_id)
   group by t.workspace_id, t.word, s.n
  having count(distinct t.id) >= greatest(50, 0.005 * s.n);   -- at least 50 names and 0.5% of them
end $$;

-- The person's name inside a saved contact label, or null. The name is the first run of words that are
-- not tags, months, codes, products, notes, shop words or places (the customer's delivery place counts as a
-- place, and words of the business's own name never count as a name),
-- e.g. "Michael Mwanza Oct TTs Leads A 1182" → "Michael" (delivery place mentions Mwanza),
-- "Ngr Nov FF List 286❌ FABIAN KULWA OZZA" → "Fabian Kulwa Ozza", "Oct TTs Leads A 1707✅" → null.
create or replace function private.clean_saved_name(p_ws uuid, p_name text, p_place text default null, p_region text default null)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  toks text[]; t text; k text; run text[] := '{}'; best text[]; places text; out text := '';
  titles constant text[] := array['mr','mrs','ms','dr','eng','mama','baba','bibi','babu','mzee','madam','bro','sis','kaka','dada','ndugu','mwalimu','sir'];
begin
  if p_name is null or btrim(p_name) = '' then return null; end if;
  -- the customer's delivery place and the business's own name are never the customer's name
  select ' ' || lower(regexp_replace(coalesce(p_place, '') || ' ' || coalesce(p_region, '') || ' ' || coalesce(w.name, ''), '[^[:alpha:]]+', ' ', 'g')) || ' '
    into places from (select 1) x left join workspaces w on w.id = p_ws;
  toks := regexp_split_to_array(btrim(regexp_replace(p_name, '[^[:alpha:]0-9.'']+', ' ', 'g')), ' ') || array['#'];
  foreach t in array toks loop
    k := lower(btrim(t, '.'''));
    if t = '#' or k = '' or k ~ '\d' or (length(k) = 1 and t !~ '\.$')
       or exists (select 1 from private.name_noise n where n.word = k)
       or exists (select 1 from private.ws_name_tags g where g.workspace_id = p_ws and g.word = k)
       or exists (select 1 from private.tz_places p where lower(p.name) = k)
       or (length(k) >= 4 and position(' ' || k || ' ' in places) > 0)
    then
      -- a run counts once it holds a real name word (3+ letters, not just a title like "Mama")
      if best is null and exists (select 1 from unnest(run) r
                                   where length(btrim(r, '.''')) >= 3 and lower(btrim(r, '.''')) <> all (titles)) then
        best := run;
      end if;
      run := '{}';
    else
      run := run || t;
    end if;
  end loop;
  if best is null then return null; end if;
  foreach t in array best[1:4] loop
    if length(t) > 2 then t := rtrim(t, '.'); end if;
    -- SHOUTING or all-small words get capitals; mixed case ("KanyaPin") is kept as written
    if t = upper(t) or t = lower(t) then t := initcap(t); end if;
    out := out || ' ' || t;
  end loop;
  return nullif(btrim(out), '');
end $$;

-- Fill an empty receipt name from the saved label (on payment, before Kito has read the chat).
create or replace function private.fill_clean_name(p_contact uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update contacts c set full_name = x.nm, name_source = 'clean'
    from (select id, private.clean_saved_name(workspace_id, name, delivery_place, region) nm from contacts where id = p_contact) x
   where c.id = x.id and c.full_name is null and x.nm is not null;
end $$;

create or replace function private.orders_fill_location() returns trigger
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    cid := coalesce(new.contact_id, (select contact_id from conversations where id = new.conversation_id));
    perform private.fill_contact_location(cid);
    perform private.fill_contact_details(cid);
    perform private.fill_clean_name(cid);
  end if;
  return null;
end $$;

-- Kito's job list: paying customers whose name the owner hasn't set and whose chat Kito hasn't read
-- since their latest payment. Newest payments first.
create or replace function public.svc_name_candidates(p_limit int default 25)
returns table (contact_id uuid, workspace_id uuid, saved_name text, full_name text, name_source text)
language sql stable security definer set search_path = public as $$
  with paid as (
    select coalesce(o.contact_id, cv.contact_id) id, max(coalesce(o.paid_at, o.occurred_at)) last_paid
      from orders o left join conversations cv on cv.id = o.conversation_id
     where o.status = 'paid'
     group by 1)
  select c.id, c.workspace_id, c.name, c.full_name, c.name_source
    from paid p join contacts c on c.id = p.id
   where c.name_source is distinct from 'owner'
     and (c.name_checked_at is null or c.name_checked_at < p.last_paid)
   order by p.last_paid desc
   limit greatest(1, least(coalesce(p_limit, 25), 60));
$$;

-- Save what Kito found. Returns the name receipts now show.
create or replace function public.svc_save_buyer_name(p_contact uuid, p_buyer text, p_receiver text, p_evidence text)
returns text language plpgsql security definer set search_path = public as $$
declare c record; nm text; src text; rcv text;
begin
  select * into c from contacts where id = p_contact;
  if c.id is null then return null; end if;
  nm := nullif(btrim(p_buyer), '');
  rcv := nullif(btrim(p_receiver), '');
  if rcv is not null and nm is not null and lower(rcv) = lower(nm) then rcv := null; end if;
  if c.name_source = 'owner' then
    update contacts set receiver_name = coalesce(rcv, receiver_name), name_checked_at = now() where id = p_contact;
    return c.full_name;
  end if;
  if nm is not null then
    src := 'kito';
  elsif c.name_source = 'kito' and c.full_name is not null then        -- keep an earlier read
    nm := c.full_name; src := 'kito';
  elsif c.name_source = 'auto' and c.full_name is not null
        and (rcv is null or lower(split_part(c.full_name, ' ', 1)) <> lower(split_part(rcv, ' ', 1))) then
    nm := c.full_name; src := 'auto';                                 -- the delivery-message name, not the receiver's
  else
    nm := private.clean_saved_name(c.workspace_id, c.name, c.delivery_place, c.region);
    src := case when nm is null then null else 'clean' end;
  end if;
  update contacts set full_name = nm, name_source = src, receiver_name = rcv,
         name_evidence = left(nullif(btrim(p_evidence), ''), 200), name_checked_at = now()
   where id = p_contact;
  return nm;
end $$;

revoke all on function public.svc_name_candidates(int) from public, anon, authenticated;
revoke all on function public.svc_save_buyer_name(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.svc_name_candidates(int) to service_role;
grant execute on function public.svc_save_buyer_name(uuid, text, text, text) to service_role;

-- The public receipt page (QR scan) shows the first name: never a tag like "Oct".
create or replace function public.receipt_check(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  o record;
  staff boolean;
  wa text;
  items jsonb;
  nm text;
  first_name text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{16,40}$' then return null; end if;

  select ord.id, ord.workspace_id, ord.receipt_no, ord.status, ord.amount, ord.discount, ord.refund_amount,
         ord.currency, ord.paid_at, ord.occurred_at, ord.items, ord.product, ord.payment_ref, ord.fulfillment_status,
         ord.conversation_id, l.scans, l.first_scan_at, l.last_scan_at,
         w.name biz, coalesce(w.timezone, 'Africa/Dar_es_Salaam') tz
    into o
    from private.receipt_links l
    join public.orders ord on ord.id = l.order_id
    join public.workspaces w on w.id = ord.workspace_id
   where l.token = p_token and ord.receipt_no is not null;
  if not found then return null; end if;

  staff := auth.uid() is not null and public.is_member(o.workspace_id);

  -- Count customer opens only, at most one per minute per receipt.
  if not staff and (o.last_scan_at is null or o.last_scan_at < now() - interval '1 minute') then
    update private.receipt_links
       set scans = scans + 1, first_scan_at = coalesce(first_scan_at, now()), last_scan_at = now()
     where order_id = o.id;
  end if;

  select n.display_phone into wa from public.wa_numbers n where n.workspace_id = o.workspace_id
   order by n.display_phone nulls last limit 1;

  items := case
    when jsonb_typeof(o.items) = 'array' and jsonb_array_length(o.items) > 0 then
      (select jsonb_agg(jsonb_build_object('name', coalesce(i->>'name', '?'), 'qty', coalesce((i->>'qty')::numeric, 1)))
         from jsonb_array_elements(o.items) i)
    when nullif(btrim(o.product), '') is not null then
      (select jsonb_agg(jsonb_build_object('name', btrim(p), 'qty', 1))
         from regexp_split_to_table(o.product, '\s*[,+]\s*') p where btrim(p) <> '')
    else '[]'::jsonb end;

  -- First name only, from the buyer's name (0056); a title keeps the next word ("Mama Joshua").
  select coalesce(nullif(btrim(c.full_name), ''), private.clean_saved_name(c.workspace_id, c.name, c.delivery_place, c.region))
    into nm
    from public.conversations cv join public.contacts c on c.id = cv.contact_id
   where cv.id = o.conversation_id;
  first_name := case
    when lower(rtrim(split_part(nm, ' ', 1), '.')) in ('mr','mrs','ms','dr','eng','mama','baba','bibi','babu','mzee','madam','mwalimu')
      then nullif(btrim(split_part(nm, ' ', 1) || ' ' || split_part(nm, ' ', 2)), '')
    else nullif(split_part(nm, ' ', 1), '') end;

  return jsonb_build_object(
    'business', o.biz,
    'business_wa', nullif(regexp_replace(coalesce(wa, ''), '\D', '', 'g'), ''),
    'timezone', o.tz,
    'receipt_no', o.receipt_no,
    'status', o.status,
    'currency', o.currency,
    'total', o.amount - o.discount - o.refund_amount,
    'paid', o.amount - o.discount,
    'refunded', o.refund_amount,
    'paid_at', coalesce(o.paid_at, o.occurred_at),
    'items', coalesce(items, '[]'::jsonb),
    'customer', first_name,
    'payment_ref_end', case when length(o.payment_ref) >= 4 then right(o.payment_ref, 4) end,
    'delivery', o.fulfillment_status,
    'staff', case when staff then jsonb_build_object(
      'order_id', o.id, 'workspace_id', o.workspace_id,
      'scans', o.scans, 'first_scan_at', o.first_scan_at, 'last_scan_at', o.last_scan_at) end
  );
end $$;

revoke all on function public.receipt_check(text) from public;
grant execute on function public.receipt_check(text) to anon, authenticated, service_role;

-- Tag words now, and every night.
select private.refresh_name_tags();
select cron.unschedule('name-tags-daily') where exists (select 1 from cron.job where jobname = 'name-tags-daily');
select cron.schedule('name-tags-daily', '23 1 * * *', $cron$ select private.refresh_name_tags(); $cron$);

-- Every paying customer with no receipt name yet gets the cleaned one now; Kito upgrades it.
select private.fill_clean_name(p.id)
  from (select distinct coalesce(o.contact_id, cv.contact_id) id
          from orders o left join conversations cv on cv.id = o.conversation_id
         where o.status = 'paid') p
 where p.id is not null;

-- Kito reads names every 5 minutes (Edge Function `names`).
select cron.unschedule('names-5m') where exists (select 1 from cron.job where jobname = 'names-5m');
select cron.schedule('names-5m', '1-59/5 * * * *', $cron$
  select net.http_post(
    url := 'https://jrdxeagnmunmatxtgmpk.supabase.co/functions/v1/names',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpyZHhlYWdubXVubWF0eHRnbXBrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1ODkyNjcsImV4cCI6MjExMDE2NTI2N30.1HJUnCAwcCwQ0BiGZxfhJsh6xa6Amm3SrDuDopSZOWc',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$cron$);
