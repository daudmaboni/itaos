-- 21 Nov 2026 — Kito sometimes keeps the town customers write after their name ("Mr Joseph Mbeya [simu]" →
-- "Joseph Mbeya"). Place words (regions, districts, short forms like Znz, and the customer's own delivery
-- place) are now taken out of Kito's name before it is saved, unless nothing would be left.

create or replace function private.strip_place_words(p_name text, p_place text default null, p_region text default null)
returns text language plpgsql stable security definer set search_path = public as $$
declare t text; k text; out text := ''; places text;
begin
  if p_name is null or btrim(p_name) = '' then return null; end if;
  places := ' ' || lower(regexp_replace(coalesce(p_place, '') || ' ' || coalesce(p_region, ''), '[^[:alpha:]]+', ' ', 'g')) || ' ';
  foreach t in array regexp_split_to_array(btrim(p_name), '\s+') loop
    k := lower(btrim(t, '.'''));
    continue when exists (select 1 from private.tz_places p where lower(p.name) = k)
               or exists (select 1 from private.name_noise n where n.word = k and n.kind = 'place')
               or (length(k) >= 4 and position(' ' || k || ' ' in places) > 0);
    out := out || ' ' || t;
  end loop;
  return coalesce(nullif(btrim(out), ''), btrim(p_name));
end $$;

create or replace function public.svc_save_buyer_name(p_contact uuid, p_buyer text, p_receiver text, p_evidence text)
returns text language plpgsql security definer set search_path = public as $$
declare c record; nm text; src text; rcv text;
begin
  select * into c from contacts where id = p_contact;
  if c.id is null then return null; end if;
  nm := private.strip_place_words(nullif(btrim(p_buyer), ''), c.delivery_place, c.region);
  rcv := private.strip_place_words(nullif(btrim(p_receiver), ''), c.delivery_place, c.region);
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

revoke all on function public.svc_save_buyer_name(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.svc_save_buyer_name(uuid, text, text, text) to service_role;

-- Names Kito already saved.
update contacts set full_name = private.strip_place_words(full_name, delivery_place, region)
 where name_source = 'kito' and full_name is distinct from private.strip_place_words(full_name, delivery_place, region);
