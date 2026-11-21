-- Connection health alerts (21 Nov 2026). Every 2 hours push-send { health: true } checks each business's
-- Meta Ads token, ad account state, Conversions API status and WhatsApp traffic. When something breaks it sends
-- one push notification to the business's owners/admins and to Pondi staff (platform admins); a reminder once a
-- day while it stays broken; and an "all good again" notice when it recovers.
--
-- One row per connection problem. An open alert has resolved_at null.
create table if not exists public.connection_alerts (
  id bigint generated always as identity primary key,
  connection_id uuid not null references public.connections(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null,                -- ads_token | ads_account | capi | wa_silent | wa_error
  problem text not null,             -- plain-language cause shown in the notification
  first_seen_at timestamptz not null default now(),
  alerted_at timestamptz,            -- last time a notification went out for this alert
  resolved_at timestamptz
);
create unique index if not exists connection_alerts_open on public.connection_alerts(connection_id) where resolved_at is null;
create index if not exists connection_alerts_ws on public.connection_alerts(workspace_id, first_seen_at desc);
alter table public.connection_alerts enable row level security;
drop policy if exists connection_alerts_read on public.connection_alerts;
create policy connection_alerts_read on public.connection_alerts for select using (public.is_member(workspace_id) or public.is_platform_admin());

select cron.unschedule('connection-health-2h') where exists (select 1 from cron.job where jobname = 'connection-health-2h');
select cron.schedule('connection-health-2h', '23 */2 * * *', $cron$
  select net.http_post(
    url := 'https://jrdxeagnmunmatxtgmpk.supabase.co/functions/v1/push-send',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpyZHhlYWdubXVubWF0eHRnbXBrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1ODkyNjcsImV4cCI6MjExMDE2NTI2N30.1HJUnCAwcCwQ0BiGZxfhJsh6xa6Amm3SrDuDopSZOWc',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{"health": true}'::jsonb,
    timeout_milliseconds := 120000
  );
$cron$);

-- WhatsApp traffic for one business: events in the last 7 days, the longest quiet gap in the last 14 days (seconds),
-- and the newest event. Any webhook event counts (customer messages, the owner's replies from the phone, delivery
-- receipts), so a quiet period means Meta stopped sending, not just that customers are quiet.
create or replace function public.svc_wa_traffic(p_ws uuid)
returns table (events_7d bigint, max_gap_s double precision, last_event timestamptz)
language sql stable security definer set search_path = public as $$
  with ev as (
    select received_at, received_at - lag(received_at) over (order by received_at) gap
    from public.raw_events
    where workspace_id = p_ws and provider = 'whatsapp' and received_at > now() - interval '14 days'
  )
  select count(*) filter (where received_at > now() - interval '7 days'),
         coalesce(extract(epoch from max(gap)), 0)::double precision,
         max(received_at)
  from ev;
$$;
revoke all on function public.svc_wa_traffic(uuid) from public, anon, authenticated;
grant execute on function public.svc_wa_traffic(uuid) to service_role;
