-- 21 Nov 2026 — Everything per business, nothing written for Kayani only.
--
-- 1. "Goods delivered" messages. The shared word list had herbal-shop wording ("Matumizi ya …", "dawa ulizopokea",
--    "picha ya dawa ulizo…"). Those now live in each business's rules (Settings → How itaOS reads your chats →
--    "Messages you send once the customer has the goods"). Kayani keeps exactly the old list, so its results don't
--    change; other businesses start empty.
-- 2. The owner's price ✅ ("TZS 205,000✅" counts as a payment) is now a per-business switch. It stays on for every
--    business that already exists (nothing changes for them); new businesses start with it off and turn it on in
--    Settings if that's how they mark payments.
-- 3. Receipt look per business: main colour, accent colour, logo, town and payment method. Receipts used Kayani's
--    green/honey, "Dar es Salaam" and "M-Pesa" for every business. Kayani gets those values saved; others get
--    itaOS's plain default until they set their own.
-- 4. rules_reviewed_at: set when an owner saves the chat rules, so the staff setup board can show "Chat rules set".

alter table public.workspaces
  add column if not exists rule_delivered_texts text[] not null default '{}',
  add column if not exists rule_owner_tick boolean not null default false,
  add column if not exists rules_reviewed_at timestamptz,
  add column if not exists brand_color text,
  add column if not exists brand_accent text,
  add column if not exists brand_logo text,
  add column if not exists brand_town text,
  add column if not exists pay_method text;

alter table public.workspaces drop constraint if exists workspaces_rules2_size;
alter table public.workspaces add constraint workspaces_rules2_size check (cardinality(rule_delivered_texts) <= 15);
alter table public.workspaces drop constraint if exists workspaces_brand_ok;
alter table public.workspaces add constraint workspaces_brand_ok check (
  (brand_color is null or brand_color ~ '^#[0-9a-fA-F]{6}$')
  and (brand_accent is null or brand_accent ~ '^#[0-9a-fA-F]{6}$')
  and (brand_logo is null or (brand_logo ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' and length(brand_logo) <= 200000))
  and (brand_town is null or length(brand_town) <= 60)
  and (pay_method is null or length(pay_method) <= 40));

comment on column public.workspaces.rule_delivered_texts is 'Business messages sent once the customer has the goods (e.g. usage instructions). With a payment sign they mark a sale.';
comment on column public.workspaces.rule_owner_tick is 'The owner''s "price ✅" messages count as payments (ticks.ts, payment_moment).';
comment on column public.workspaces.brand_logo is 'Receipt logo as a small data URL (png/jpeg/webp, resized in the browser). Not loaded with the workspace row.';

-- Every business that exists today keeps the ✅ rule exactly as before.
update public.workspaces set rule_owner_tick = true;

-- Kayani keeps the wording that was built in.
update public.workspaces set
  rule_delivered_texts = array['Matumizi ya', 'Maelekezo ya matumizi', 'Jinsi ya kutumia', 'Namna ya kutumia',
                               'Dawa ulizopokea', 'Picha ya dawa ulizo', 'How to use it', 'How to use your'],
  brand_color = coalesce(brand_color, '#029046'), brand_accent = coalesce(brand_accent, '#e9a23b'),
  brand_town = coalesce(brand_town, 'Dar es Salaam'), pay_method = coalesce(pay_method, 'M-Pesa'),
  rules_reviewed_at = coalesce(rules_reviewed_at, now())
where name = 'Kayani Herbs';

-- Rules already filled in count as reviewed.
update public.workspaces set rules_reviewed_at = now()
where rules_reviewed_at is null
  and cardinality(rule_ad_texts) + cardinality(rule_paid_texts) + cardinality(rule_loc_reply) + cardinality(rule_delivered_texts) > 0;

-- ---------- payment day: the ✅ tier only for businesses that use it ----------
create or replace function public.payment_moment(p_conv uuid, p_before timestamptz default now())
returns table(at timestamptz, kind text, snippet text, message_id text)
language sql stable set search_path = public as $$
  with pt as (
    select w.rule_paid_texts, w.rule_owner_tick from conversations c join workspaces w on w.id = c.workspace_id where c.id = p_conv
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

-- ---------- public receipt page: the business's own look ----------
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
         w.name biz, coalesce(w.timezone, 'Africa/Dar_es_Salaam') tz,
         w.brand_color, w.brand_accent, w.brand_logo, w.brand_town, w.pay_method
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
    -- 0059: the business's own receipt look (Settings → Receipts). Nulls = itaOS's plain default.
    'brand', jsonb_build_object('color', o.brand_color, 'accent', o.brand_accent, 'logo', o.brand_logo,
                                'town', o.brand_town, 'pay_method', o.pay_method),
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

-- ---------- staff setup board: "Chat rules set" ----------
drop function if exists public.admin_workspaces();
create function public.admin_workspaces()
returns table(
  id uuid, name text, created_at timestamptz, status text, plan text, note text,
  owner_email text, owner_last_sign_in timestamptz, members int,
  wa_status text, wa_last_sync timestamptz, wa_via text, wa_phone text, send_enabled boolean, send_key boolean,
  meta_status text, meta_last_sync timestamptz, last_error text,
  messages bigint, messages_7d bigint, last_message_at timestamptz, last_customer_message_at timestamptz,
  conversations bigint, live_chats bigint, imported_chats bigint, sent_itaos_30d bigint, receipts_30d bigint,
  orders bigint, tick_orders bigint, revenue_30d numeric, revenue_total numeric, currency text,
  spend_30d numeric, spend_currency text, kito_asks_30d bigint, kito_tokens_30d bigint,
  kito_last_run timestamptz, kito_behind bigint,
  failed_events bigint, pending_events bigint, stuck_events bigint, settings_missing text[],
  rules_set boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select w.id, w.name, w.created_at,
         coalesce(s.status, 'active'), coalesce(s.plan, 'pilot'), s.note,
         o.email::text, o.last_sign_in_at,
         (select count(*)::int from memberships m where m.workspace_id = w.id),
         wa.status, wa.last_sync_at, coalesce(wa.meta->>'via', case when wa.id is not null then 'meta' end),
         (select n.display_phone from wa_numbers n where n.workspace_id = w.id order by n.created_at desc limit 1),
         w.send_enabled, (wa.meta ? 'api_key_secret_id'),
         ma.status, ma.last_sync_at,
         coalesce(wa.last_error, ma.last_error),
         (select count(*) from messages x where x.workspace_id = w.id),
         (select count(*) from messages x where x.workspace_id = w.id and x.sent_at > now() - interval '7 days'),
         (select max(c.last_message_at) from conversations c where c.workspace_id = w.id),
         (select x.sent_at from messages x where x.workspace_id = w.id and x.direction = 'in' order by x.sent_at desc limit 1),
         cv.total, cv.live, cv.imported,
         (select count(*) from messages x where x.workspace_id = w.id and x.origin = 'itaos' and x.sent_at > now() - interval '30 days'),
         (select count(*) from messages x where x.workspace_id = w.id and x.media is not null
             and x.media->'receipt'->>'is_receipt' = 'true' and x.sent_at > now() - interval '30 days'),
         od.paid, od.tick, od.rev_30d, od.rev_total, w.currency,
         sp.spend, sp.currency,
         ka.n, ka.tokens,
         (select max(kr.ran_at) from kito_runs kr where kr.workspace_id = w.id),
         (select count(*) from conversations c where c.workspace_id = w.id and c.phone_number_id <> 'import'
             and c.last_message_at > now() - interval '7 days'
             and (c.kito_checked_at is null or c.kito_checked_at < c.last_message_at)),
         (select count(*) from raw_events r where r.workspace_id = w.id and r.processed_at is null
             and (r.status = 'failed' or r.attempts >= r.max_attempts)),
         (select count(*) from raw_events r where r.workspace_id = w.id and r.status = 'pending'),
         (select count(*) from raw_events r where r.workspace_id = w.id and r.processed_at is null and r.status = 'processing'
             and coalesce(r.last_attempt_at, r.received_at) < now() - interval '15 minutes'),
         array_remove(array[
           case when ma.id is not null and w.fx_rate is null and coalesce(sp.currency, 'USD') <> w.currency then 'exchange rate' end,
           case when w.unit_cost is null then 'cost per order' end], null),
         -- 0059: the business's chat rules were saved or filled in (setup board step)
         (w.rules_reviewed_at is not null)
  from workspaces w
  left join workspace_admin_state s on s.workspace_id = w.id
  left join lateral (
    select u.email, u.last_sign_in_at from memberships m join auth.users u on u.id = m.user_id
    where m.workspace_id = w.id and m.role = 'owner' order by m.created_at limit 1) o on true
  left join lateral (
    select c.id, c.status, c.last_sync_at, c.last_error, c.meta from connections c
    where c.workspace_id = w.id and c.provider = 'whatsapp' order by c.created_at desc limit 1) wa on true
  left join lateral (
    select c.id, c.status, c.last_sync_at, c.last_error from connections c
    where c.workspace_id = w.id and c.provider = 'meta_ads' order by c.created_at desc limit 1) ma on true
  left join lateral (
    select count(*) total,
           count(*) filter (where c.phone_number_id <> 'import') live,
           count(*) filter (where c.phone_number_id = 'import') imported
    from conversations c where c.workspace_id = w.id) cv on true
  left join lateral (
    select count(*) filter (where x.status = 'paid') paid,
           count(*) filter (where x.status = 'paid' and x.inferred_from = 'tick') tick,
           coalesce(sum(x.amount - x.discount - x.refund_amount) filter (where x.status = 'paid' and x.paid_at > now() - interval '30 days'), 0) rev_30d,
           coalesce(sum(x.amount - x.discount - x.refund_amount) filter (where x.status = 'paid'), 0) rev_total
    from orders x where x.workspace_id = w.id) od on true
  left join lateral (
    select sum(a.spend) as spend, min(a.currency) as currency from ad_insights_daily a
    where a.workspace_id = w.id and a.day > current_date - 30) sp on true
  left join lateral (
    select count(*) as n,
           coalesce(sum(coalesce(k.input_tokens,0) + coalesce(k.output_tokens,0)),0)::bigint as tokens
    from kito_asks k where k.workspace_id = w.id and k.created_at > now() - interval '30 days') ka on true
  order by w.created_at desc;
end $$;
revoke all on function public.admin_workspaces() from public, anon;
grant execute on function public.admin_workspaces() to authenticated, service_role;
