-- 21 Nov 2026 — Name rules belong to each business (Settings → Rules & rates → "Customer names on receipts").
--
-- 0056 put some Kayani-only label words (TTS, NGV, TML, Tumboflux…) in the shared list. Now:
--   * private.name_noise keeps only words that are labels for ANY business: months, "leads", "list",
--     "batch", "paid", "customer"… plus place short forms and shop words.
--   * public.name_words holds each business's own choices:
--       kind 'tag'  — "this word is one of our labels, remove it" (owner adds them in Settings)
--       kind 'name' — "this word is part of real names, never remove it" (overrides everything else)
--   * Words used in many of that business's saved names are still found automatically (private.ws_name_tags).
--   * Words of that business's own product names (Business profile) are removed too.
-- The business-specific words that 0056 had in the shared list move to each business that uses them.
-- Changing a word re-cleans that business's receipt names straight away (Kito's and typed names stay).

create table if not exists public.name_words (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  word text not null check (word ~ '^[a-z0-9]{1,30}$'),
  kind text not null check (kind in ('tag', 'name')),
  added_by uuid,
  added_at timestamptz not null default now(),
  primary key (workspace_id, word)
);
alter table public.name_words enable row level security;
drop policy if exists name_words_read on public.name_words;
create policy name_words_read on public.name_words for select using (public.is_member(workspace_id));
-- writes only through set_name_words()

-- Move business-specific words out of the shared list, to each business whose saved names use them.
with moved as (
  delete from private.name_noise
   where word in ('ngv','ngvj','ngvpi','ngr','ng','tts','tml','tfv','nw','gx','gt','gr','trz','kuza','klp','instaad','uum','pb',
                  'fr','fv','zz','pix','tri','bws','secth','twof','cone','jplus','cy','estro','sec','mid','ls','lst','dt','qlty','qlfy','blanks',
                  'tumbo','tumboflux','ngiri','fibroid','acdr','ulc','kayatox','kayapower','kaya')
  returning word)
insert into public.name_words (workspace_id, word, kind)
select distinct c.workspace_id, m.word, 'tag'
  from moved m
  join contacts c on c.name ~* ('(^|[^[:alpha:]])' || m.word || '([^[:alpha:]]|$)')
on conflict do nothing;

-- Words of a business's product names ("NgiriMaster" → ngiri, master), 4+ letters.
create or replace function private.product_words(p_ws uuid) returns setof text
language sql stable security definer set search_path = public as $$
  select distinct w
    from business_profiles bp,
         jsonb_array_elements(case when jsonb_typeof(bp.products) = 'array' then bp.products else '[]'::jsonb end) p,
         regexp_split_to_table(lower(regexp_replace(coalesce(p->>'name', ''), '([[:lower:]])([[:upper:]])', '\1 \2', 'g')), '[^[:alpha:]]+') w
   where bp.workspace_id = p_ws and length(w) >= 4;
$$;

-- Same rules as 0056, with the business's own words: 'name' words are always kept; 'tag' words, words
-- found automatically and product words are removed.
create or replace function private.clean_saved_name(p_ws uuid, p_name text, p_place text default null, p_region text default null)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  toks text[]; t text; k text; run text[] := '{}'; best text[]; places text; out text := '';
  keep text[]; drop_ text[];
  titles constant text[] := array['mr','mrs','ms','dr','eng','mama','baba','bibi','babu','mzee','madam','bro','sis','kaka','dada','ndugu','mwalimu','sir'];
begin
  if p_name is null or btrim(p_name) = '' then return null; end if;
  select ' ' || lower(regexp_replace(coalesce(p_place, '') || ' ' || coalesce(p_region, '') || ' ' || coalesce(w.name, ''), '[^[:alpha:]]+', ' ', 'g')) || ' '
    into places from (select 1) x left join workspaces w on w.id = p_ws;
  select coalesce(array_agg(word) filter (where kind = 'name'), '{}'), coalesce(array_agg(word) filter (where kind = 'tag'), '{}')
    into keep, drop_ from public.name_words where workspace_id = p_ws;
  drop_ := drop_ || coalesce((select array_agg(w) from private.product_words(p_ws) w), '{}');
  toks := regexp_split_to_array(btrim(regexp_replace(p_name, '[^[:alpha:]0-9.'']+', ' ', 'g')), ' ') || array['#'];
  foreach t in array toks loop
    k := lower(btrim(t, '.'''));
    if t = '#' or k = '' or k ~ '\d' or (
         k <> all (keep) and (
           (length(k) = 1 and t !~ '\.$')
           or k = any (drop_)
           or exists (select 1 from private.name_noise n where n.word = k)
           or exists (select 1 from private.ws_name_tags g where g.workspace_id = p_ws and g.word = k)
           or exists (select 1 from private.tz_places p where lower(p.name) = k)
           or (length(k) >= 4 and position(' ' || k || ' ' in places) > 0)))
    then
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
    if t = upper(t) or t = lower(t) then t := initcap(t); end if;
    out := out || ' ' || t;
  end loop;
  return nullif(btrim(out), '');
end $$;

-- Redo the cleaned names of one business's paying customers (only those not read from the chat or typed).
create or replace function private.reclean_names(p_ws uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with buyers as (
    select distinct coalesce(o.contact_id, cv.contact_id) id
      from orders o left join conversations cv on cv.id = o.conversation_id
     where o.workspace_id = p_ws and o.status = 'paid'),
  x as (
    select c.id, private.clean_saved_name(c.workspace_id, c.name, c.delivery_place, c.region) nm
      from contacts c join buyers b on b.id = c.id
     where c.name_source = 'clean' or c.full_name is null)
  update contacts c set full_name = x.nm, name_source = case when x.nm is null then null else 'clean' end
    from x where c.id = x.id and c.full_name is distinct from x.nm;
  get diagnostics n = row_count;
  return n;
end $$;

-- Everything the Settings card shows.
create or replace function public.name_rules(p_ws uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare own jsonb; res jsonb;
begin
  if not public.is_member(p_ws) then raise exception 'not allowed'; end if;
  select jsonb_build_object(
    'tags', coalesce((select jsonb_agg(word order by word) from name_words where workspace_id = p_ws and kind = 'tag'), '[]'),
    'names', coalesce((select jsonb_agg(word order by word) from name_words where workspace_id = p_ws and kind = 'name'), '[]'),
    'auto', coalesce((select jsonb_agg(jsonb_build_object('word', g.word, 'uses', g.uses) order by g.uses desc)
                        from private.ws_name_tags g
                       where g.workspace_id = p_ws and g.word !~ '\d' and length(g.word) > 1
                         and not exists (select 1 from private.name_noise n where n.word = g.word)
                         and not exists (select 1 from name_words w where w.workspace_id = p_ws and w.word = g.word)), '[]'),
    'products', coalesce((select jsonb_agg(w order by w) from private.product_words(p_ws) w), '[]'),
    'builtin', (select jsonb_agg(word order by kind, word) from private.name_noise where kind in ('tag', 'month')),
    'examples', coalesce((
      select jsonb_agg(jsonb_build_object('saved', e.name, 'shown', e.full_name, 'source', e.name_source) order by e.last_paid desc)
        from (select c.name, c.full_name, c.name_source, max(coalesce(o.paid_at, o.occurred_at)) last_paid
                from orders o left join conversations cv on cv.id = o.conversation_id
                join contacts c on c.id = coalesce(o.contact_id, cv.contact_id)
               where o.workspace_id = p_ws and o.status = 'paid' and c.name is not null
               group by c.id, c.name, c.full_name, c.name_source
               order by last_paid desc limit 8) e), '[]')
  ) into res;
  return res;
end $$;

-- Add or remove the business's own words. p_kind: 'tag' (remove from names), 'name' (always keep), null (forget).
create or replace function public.set_name_words(p_ws uuid, p_words text[], p_kind text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w text; n int := 0;
begin
  if not public.can_manage(p_ws) then raise exception 'not allowed'; end if;
  if p_kind is not null and p_kind not in ('tag', 'name') then raise exception 'bad kind'; end if;
  foreach w in array coalesce(p_words, '{}') loop
    w := lower(regexp_replace(btrim(w), '[^[:alnum:]]', '', 'g'));
    continue when w = '' or length(w) > 30 or w !~ '^[a-z0-9]+$';
    n := n + 1; exit when n > 50;
    if p_kind is null then
      delete from name_words where workspace_id = p_ws and word = w;
    else
      insert into name_words (workspace_id, word, kind, added_by) values (p_ws, w, p_kind, auth.uid())
      on conflict (workspace_id, word) do update set kind = excluded.kind, added_by = excluded.added_by, added_at = now();
    end if;
  end loop;
  perform private.reclean_names(p_ws);
  return public.name_rules(p_ws);
end $$;

revoke all on function public.name_rules(uuid) from public, anon;
revoke all on function public.set_name_words(uuid, text[], text) from public, anon;
grant execute on function public.name_rules(uuid) to authenticated, service_role;
grant execute on function public.set_name_words(uuid, text[], text) to authenticated, service_role;

-- Buyers shows where a name came from and the parcel receiver.
create or replace function public.list_buyers(p_ws uuid, p_q text default null, p_region text default null)
returns jsonb language plpgsql stable set search_path = public as $$
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
      'delivery_place', c.delivery_place, 'region', c.region, 'district', c.district, 'area', c.area, 'landmark', c.landmark, 'delivery_note', c.delivery_note,
      'location_source', c.location_source, 'location_evidence', c.location_evidence, 'name_source', c.name_source,
      'name_evidence', c.name_evidence, 'receiver_name', c.receiver_name,
      'orders', a.n, 'spent', a.spent, 'currency', a.currency, 'first_at', a.first_at, 'last_at', a.last_at,
      'last_conversation_id', a.last_conv, 'last_receipt', a.last_receipt, 'products', pr.products
    ) order by a.last_at desc nulls last), '[]'::jsonb) into res
  from agg a join contacts c on c.id = a.buyer_id left join prods pr on pr.buyer_id = a.buyer_id
  where c.workspace_id = p_ws and not coalesce(c.not_customer, false)
    and (p_region is null or c.region = p_region)
    and (q is null or c.name ilike '%' || q || '%' or c.full_name ilike '%' || q || '%'
         or (length(qd) >= 4 and (c.wa_id like '%' || qd || '%' or regexp_replace(coalesce(c.alt_phone, ''), '\D', '', 'g') like '%' || right(qd, 9) || '%'))
         or concat_ws(' ', c.delivery_place, c.region, c.district, c.area, c.landmark) ilike '%' || q || '%'
         or pr.products ilike '%' || q || '%');
  return res;
end $$;

-- Re-clean every business with the moved words.
select private.reclean_names(w.id) from workspaces w;
