revoke execute on function public.create_workspace(text) from public, anon;
revoke execute on function public.is_member(uuid) from public, anon;
grant execute on function public.create_workspace(text) to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
revoke execute on function public.ad_performance(uuid, date, date) from public, anon;
grant execute on function public.ad_performance(uuid, date, date) to authenticated;
