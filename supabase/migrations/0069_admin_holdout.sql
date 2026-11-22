-- 0069_admin_holdout — staff control for the "kept aside" share behind Money itaOS brought back (22 Nov 2026).
-- admin_holdout: the setting plus how far the proof has come for one business.
-- admin_set_holdout: change it (0 = test off, max 20%), recorded in the audit log.
-- A change only affects customers flagged from now on; nobody already kept aside comes back early.

create or replace function public.admin_holdout(p_ws uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  with f as (
    select a.*, exists (select 1 from orders o where o.conversation_id = a.conversation_id and o.status = 'paid'
                          and o.paid_at > a.flagged_at and o.paid_at <= a.until_at) paid
      from atrisk_flags a where a.workspace_id = p_ws and a.flagged_at > now() - interval '120 days'
  )
  select jsonb_build_object(
    'pct', coalesce((select holdout_pct from workspace_admin_state where workspace_id = p_ws), 10),
    'flags', (select count(*) from f),
    'by_kind', coalesce((select jsonb_object_agg(kind, n) from (select kind, count(*) n from f group by kind) k), '{}'::jsonb),
    'kept_aside_now', (select count(*) from f where holdout and (until_at > now() or kind = 'promise')),
    'shown_settled', (select count(*) from f where not holdout and (paid or until_at <= now())),
    'shown_paid', (select count(*) from f where not holdout and paid),
    'hidden_settled', (select count(*) from f where holdout and (paid or until_at <= now())),
    'hidden_paid', (select count(*) from f where holdout and paid),
    'last_flag', (select max(flagged_at) from f)
  ) into r;
  return r;
end $$;

create or replace function public.admin_set_holdout(p_ws uuid, p_pct int)
returns void language plpgsql security definer set search_path = public as $$
declare before int;
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_pct is null or p_pct < 0 or p_pct > 20 then raise exception 'Choose between 0 and 20%%.'; end if;
  if not exists (select 1 from workspaces where id = p_ws) then raise exception 'no such workspace'; end if;
  select holdout_pct into before from workspace_admin_state where workspace_id = p_ws;
  insert into workspace_admin_state (workspace_id, holdout_pct, updated_by, updated_at) values (p_ws, p_pct, auth.uid(), now())
  on conflict (workspace_id) do update set holdout_pct = excluded.holdout_pct, updated_by = auth.uid(), updated_at = now();
  insert into admin_audit (actor, action, workspace_id, details)
  values (auth.uid(), 'set_holdout', p_ws, jsonb_build_object('before', coalesce(before, 10), 'after', p_pct));
end $$;

revoke all on function public.admin_holdout(uuid) from public, anon;
revoke all on function public.admin_set_holdout(uuid, int) from public, anon;
grant execute on function public.admin_holdout(uuid) to authenticated;
grant execute on function public.admin_set_holdout(uuid, int) to authenticated;
