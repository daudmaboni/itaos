create extension if not exists pg_cron;
create extension if not exists pg_net;
select vault.create_secret('<redacted>', 'cron_secret');
-- Every 3 hours: refresh last 3 days of ad insights for all connected ad accounts
select cron.schedule('ads-sync-3h', '7 */3 * * *', $$
  select net.http_post(
    url := 'https://jrdxeagnmunmatxtgmpk.supabase.co/functions/v1/ads-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <anon key>',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{"days":3}'::jsonb
  );
$$);
