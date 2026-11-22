-- 0063 Google connection (22 Nov 2026): one Google account per business, on the Connections page.
-- Two switches: save contacts to Google Contacts, and promises → Google Tasks.
-- The Google refresh token lives in Vault (token_secret_id); browsers can read the row but never the token.

create table if not exists public.google_links (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  email text,
  token_secret_id uuid,
  scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'expired', 'error', 'revoked')),
  last_error text,
  connected_by uuid,
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  -- Promises → Google Tasks
  tasks_on boolean not null default true,
  tasklist_id text,
  tasks_synced int not null default 0,
  -- Contacts → Google Contacts (Google allows 25,000 per account)
  contacts_on boolean not null default false,
  contacts_days int not null default 0 check (contacts_days between 0 and 365), -- 0 = paying buyers only; N = buyers + chats from the last N days
  contact_group text,          -- resource name of the "itaOS" label in Google Contacts
  contacts_synced int not null default 0,
  contacts_skipped int not null default 0,  -- already in Google (same phone), left untouched
  contacts_full boolean not null default false,
  contacts_checked_at timestamptz,          -- when we last read the owner's Google contacts to avoid duplicates
  updated_at timestamptz not null default now()
);

alter table public.google_links enable row level security;
drop policy if exists google_links_read on public.google_links;
create policy google_links_read on public.google_links for select using (public.is_member(workspace_id));
-- No insert/update/delete policies: the google edge function (service role) writes; owners change switches through it.
revoke all on public.google_links from anon;
grant select on public.google_links to authenticated;

-- Which Google task belongs to which promise
alter table public.follow_up_tasks add column if not exists google_task_id text;
alter table public.follow_up_tasks add column if not exists google_synced_at timestamptz;
create index if not exists follow_up_tasks_google_todo on public.follow_up_tasks (workspace_id)
  where source = 'kito_promise' and (google_synced_at is null or google_synced_at < updated_at);

-- Which Google contact belongs to which itaOS contact ('skip' = the owner already had this phone in Google)
alter table public.contacts add column if not exists google_resource text;
create index if not exists contacts_google_todo on public.contacts (workspace_id) where google_resource is null;

-- Service-only helpers for the google edge function. They stamp google_synced_at with the database clock in
-- the same statement that bumps updated_at, so a synced row reads as synced (google_synced_at = updated_at).
create or replace function public.svc_mark_google_task(p_id uuid, p_task text)
returns void language sql security definer set search_path = public as $$
  update public.follow_up_tasks set google_task_id = p_task, google_synced_at = now() where id = p_id;
$$;

create or replace function public.svc_mark_google_contacts(p_ids uuid[], p_res text[])
returns void language sql security definer set search_path = public as $$
  update public.contacts c set google_resource = x.res
  from unnest(p_ids, p_res) as x(id, res) where c.id = x.id;
$$;

-- Next contacts to copy: paying buyers first, then (when contacts_days > 0) anyone who chatted in the last N days.
create or replace function public.svc_google_contacts_todo(p_ws uuid, p_days int, p_limit int)
returns table (id uuid, wa_id text, name text, full_name text, region text, buyer boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.wa_id, c.name, c.full_name, c.region,
         exists (select 1 from public.orders o where o.contact_id = c.id and o.status = 'paid') as buyer
  from public.contacts c
  where c.workspace_id = p_ws and c.google_resource is null and not coalesce(c.not_customer, false) and c.wa_id is not null
    and (exists (select 1 from public.orders o where o.contact_id = c.id and o.status = 'paid')
         or (p_days > 0 and exists (select 1 from public.conversations v where v.contact_id = c.id and v.last_message_at > now() - make_interval(days => p_days))))
  order by 6 desc, c.created_at desc
  limit p_limit;
$$;

-- How many are still waiting (shown on the Google card).
create or replace function public.google_contacts_waiting(p_ws uuid)
returns int language sql stable security definer set search_path = public as $$
  select case when not public.is_member(p_ws) then 0 else (
    select count(*)::int from public.contacts c
    join public.google_links g on g.workspace_id = c.workspace_id
    where c.workspace_id = p_ws and c.google_resource is null and not coalesce(c.not_customer, false) and c.wa_id is not null
      and (exists (select 1 from public.orders o where o.contact_id = c.id and o.status = 'paid')
           or (g.contacts_days > 0 and exists (select 1 from public.conversations v where v.contact_id = c.id and v.last_message_at > now() - make_interval(days => g.contacts_days))))
  ) end;
$$;

revoke all on function public.svc_mark_google_task(uuid, text) from public, anon, authenticated;
revoke all on function public.svc_mark_google_contacts(uuid[], text[]) from public, anon, authenticated;
revoke all on function public.svc_google_contacts_todo(uuid, int, int) from public, anon, authenticated;
grant execute on function public.svc_mark_google_task(uuid, text) to service_role;
grant execute on function public.svc_mark_google_contacts(uuid[], text[]) to service_role;
grant execute on function public.svc_google_contacts_todo(uuid, int, int) to service_role;
revoke all on function public.google_contacts_waiting(uuid) from public, anon;
grant execute on function public.google_contacts_waiting(uuid) to authenticated, service_role;

-- Fast "is this contact a paying buyer?" for the contacts copy.
create index if not exists orders_paid_contact on public.orders (contact_id) where status = 'paid';

-- Every 5 minutes: push promise changes to Google Tasks and copy the next contacts (does nothing until a
-- business connects Google or while the Google keys are not set).
select cron.unschedule('google-sync-5m') where exists (select 1 from cron.job where jobname = 'google-sync-5m');
select cron.schedule('google-sync-5m', '4-59/5 * * * *', $$
  select net.http_post(
    url := 'https://jrdxeagnmunmatxtgmpk.supabase.co/functions/v1/google',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb
  );
$$);
