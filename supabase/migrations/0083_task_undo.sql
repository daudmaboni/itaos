-- Undo (23 Nov 2026): "Sent" / "Not now" on After price and Reorders insert a closed task; the Undo toast removes it.
-- Only the person who made it, only within 10 minutes, only with edit rights.
drop policy if exists follow_up_tasks_undo on public.follow_up_tasks;
create policy follow_up_tasks_undo on public.follow_up_tasks for delete
  using (public.can_edit(workspace_id) and created_by = auth.uid() and created_at > now() - interval '10 minutes');
