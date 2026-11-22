-- 0065 (22 Nov 2026): "Save contacts to Google" can save everyone who messaged on WhatsApp, and sorts
-- saved contacts into two extra Google labels: "itaOS Buyers" (has a paid order) and "itaOS Leads" (everyone
-- else). A lead who later pays moves to Buyers on the next sync.
-- contacts_days: 0 = paying buyers only, 1..365 = buyers + chats from the last N days, 36500 = everyone.

alter table public.google_links drop constraint if exists google_links_contacts_days_check;
alter table public.google_links add constraint google_links_contacts_days_check check (contacts_days between 0 and 36500);
alter table public.google_links add column if not exists buyers_group text;
alter table public.google_links add column if not exists leads_group text;

alter table public.contacts add column if not exists google_kind text check (google_kind in ('buyer', 'lead'));

-- One pass over the business's paid orders and chats (per-row subqueries took ~54 s on 36k contacts).
create or replace function public.svc_google_contacts_todo(p_ws uuid, p_days int, p_limit int)
returns table (id uuid, wa_id text, name text, full_name text, region text, buyer boolean)
language sql stable security definer set search_path = public as $$
  with paid as (select distinct o.contact_id from public.orders o where o.workspace_id = p_ws and o.status = 'paid' and o.contact_id is not null),
       seen as (select v.contact_id, max(v.last_message_at) as lm from public.conversations v where v.workspace_id = p_ws group by 1)
  select c.id, c.wa_id, c.name, c.full_name, c.region, (p.contact_id is not null) as buyer
  from public.contacts c
  left join paid p on p.contact_id = c.id
  left join seen s on s.contact_id = c.id
  where c.workspace_id = p_ws and c.google_resource is null and not coalesce(c.not_customer, false) and c.wa_id is not null
    and (p_days >= 36500 or p.contact_id is not null or (p_days > 0 and s.lm > now() - make_interval(days => p_days)))
  order by (p.contact_id is not null) desc, s.lm desc nulls last, c.created_at desc
  limit p_limit;
$$;

create or replace function public.google_contacts_waiting(p_ws uuid)
returns int language sql stable security definer set search_path = public as $$
  with g as (select contacts_days as d from public.google_links where workspace_id = p_ws),
       paid as (select distinct o.contact_id from public.orders o where o.workspace_id = p_ws and o.status = 'paid' and o.contact_id is not null),
       seen as (select v.contact_id, max(v.last_message_at) as lm from public.conversations v where v.workspace_id = p_ws group by 1)
  select case when not public.is_member(p_ws) or not exists (select 1 from g) then 0 else (
    select count(*)::int from public.contacts c
    left join paid p on p.contact_id = c.id
    left join seen s on s.contact_id = c.id
    cross join g
    where c.workspace_id = p_ws and c.google_resource is null and not coalesce(c.not_customer, false) and c.wa_id is not null
      and (g.d >= 36500 or p.contact_id is not null or (g.d > 0 and s.lm > now() - make_interval(days => g.d)))
  ) end;
$$;

-- Saved contacts whose Buyers/Leads label is missing or out of date.
create or replace function public.svc_google_label_todo(p_ws uuid, p_limit int)
returns table (id uuid, resource text, kind text)
language sql stable security definer set search_path = public as $$
  with paid as (select distinct o.contact_id from public.orders o where o.workspace_id = p_ws and o.status = 'paid' and o.contact_id is not null)
  select c.id, c.google_resource, case when p.contact_id is not null then 'buyer' else 'lead' end
  from public.contacts c left join paid p on p.contact_id = c.id
  where c.workspace_id = p_ws and c.google_resource like 'people/%'
    and c.google_kind is distinct from (case when p.contact_id is not null then 'buyer' else 'lead' end)
  limit p_limit;
$$;

create or replace function public.svc_mark_google_kind(p_ids uuid[], p_kinds text[])
returns void language sql security definer set search_path = public as $$
  update public.contacts c set google_kind = x.kind
  from unnest(p_ids, p_kinds) as x(id, kind) where c.id = x.id;
$$;

revoke all on function public.svc_google_label_todo(uuid, int) from public, anon, authenticated;
revoke all on function public.svc_mark_google_kind(uuid[], text[]) from public, anon, authenticated;
grant execute on function public.svc_google_label_todo(uuid, int) to service_role;
grant execute on function public.svc_mark_google_kind(uuid[], text[]) to service_role;
revoke all on function public.svc_google_contacts_todo(uuid, int, int) from public, anon, authenticated;
grant execute on function public.svc_google_contacts_todo(uuid, int, int) to service_role;
revoke all on function public.google_contacts_waiting(uuid) from public, anon;
grant execute on function public.google_contacts_waiting(uuid) to authenticated, service_role;
