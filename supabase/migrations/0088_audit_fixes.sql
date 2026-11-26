-- Audit fixes (26 Nov 2026). See the project doc itaOS_Full_Audit_26Nov.md.

-- 1. Nightly cleanup: the database was 289 MB with 2 businesses (Free plan cap 500 MB).
--    - raw_events: once a WhatsApp event is processed and 14 days old its body is no longer needed (only pending /
--      failed events are re-read). The row stays: its event_key stops Meta's retries from being saved twice.
--    - cron.job_run_details: pg_cron's own run log (17k rows) — keep 7 days.
create or replace function private.cleanup_logs()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare n_raw int; n_cron int;
begin
  update public.raw_events set payload = '{}'::jsonb
   where processed_at is not null and status = 'processed' and received_at < now() - interval '14 days' and payload <> '{}'::jsonb;
  get diagnostics n_raw = row_count;
  delete from cron.job_run_details where end_time < now() - interval '7 days';
  get diagnostics n_cron = row_count;
  return jsonb_build_object('raw_events_emptied', n_raw, 'cron_logs_deleted', n_cron);
end $$;
revoke all on function private.cleanup_logs() from public, anon, authenticated;

select cron.unschedule('cleanup-nightly') where exists (select 1 from cron.job where jobname = 'cleanup-nightly');
select cron.schedule('cleanup-nightly', '13 0 * * *', $$select private.cleanup_logs()$$);   -- 03:13 EAT

-- 2. Access rules that called auth.uid() once per row: wrapped in (select …) so it runs once per query.
alter policy mem_read on public.memberships using ((user_id = (select auth.uid())) or is_member(workspace_id));
alter policy orders_insert on public.orders with check (can_edit(workspace_id) and provenance = 'manual' and (created_by is null or created_by = (select auth.uid())));
alter policy expenses_insert on public.expenses with check (can_edit(workspace_id) and (created_by is null or created_by = (select auth.uid())));
alter policy follow_up_tasks_insert on public.follow_up_tasks with check (can_edit(workspace_id) and (created_by is null or created_by = (select auth.uid())));
alter policy kito_asks_read on public.kito_asks using ((user_id = (select auth.uid())) and is_member(workspace_id));
alter policy nav_seen_own on public.nav_seen using (user_id = (select auth.uid())) with check ((user_id = (select auth.uid())) and is_member(workspace_id));
alter policy push_own_select on public.push_subscriptions using (user_id = (select auth.uid()));
alter policy push_own_delete on public.push_subscriptions using (user_id = (select auth.uid()));

-- 3. Indexes for the foreign keys the app actually joins or deletes through.
create index if not exists conversations_contact_id_idx on public.conversations (contact_id);
create index if not exists orders_ws_conversation_idx on public.orders (workspace_id, conversation_id);
create index if not exists assignment_events_conversation_idx on public.assignment_events (conversation_id);
create index if not exists guard_reviews_conversation_idx on public.guard_reviews (conversation_id);
create index if not exists rebuy_marks_conversation_idx on public.rebuy_marks (workspace_id, conversation_id);
create index if not exists follow_up_tasks_assigned_to_idx on public.follow_up_tasks (assigned_to) where assigned_to is not null;
create index if not exists atrisk_flags_contact_idx on public.atrisk_flags (contact_id);
create index if not exists atrisk_assign_flag_idx on public.atrisk_assign (flag_id);

-- 4. Fixed search_path on the remaining helper functions.
alter function public._own_receiver(text[], text) set search_path = public, pg_temp;
alter function public._receipt_date(text, timestamptz) set search_path = public, pg_temp;
alter function public._digits(text) set search_path = public, pg_temp;
alter function private.wilson(numeric, numeric, numeric) set search_path = public, pg_temp;
alter function private.payment_sign(text, text, jsonb) set search_path = public, pg_temp;
