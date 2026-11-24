-- Live updates without pull-to-refresh (24 Nov 2026): the web app listens for changes on these tables too,
-- so promises, tasks and products update on screen by themselves. Realtime still applies each table's RLS.
do $$ begin
  begin alter publication supabase_realtime add table public.follow_up_tasks; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.products; exception when duplicate_object then null; end;
end $$;
