-- 21 Nov 2026 — Permission check. Every table owners write to already requires the right role
-- (workspaces: owner/admin; orders, chats, products, tasks…: editor). The one exception was the empty
-- v0.1 table sales_legacy_v01 (renamed in 0010, unused since), whose policies still let any member,
-- viewers included, add or change rows. Nothing reads or writes it, so all writes are closed; reading stays.
drop policy if exists sale_write on public.sales_legacy_v01;
drop policy if exists sale_update on public.sales_legacy_v01;
drop policy if exists sale_delete on public.sales_legacy_v01;
revoke insert, update, delete on public.sales_legacy_v01 from anon, authenticated;
