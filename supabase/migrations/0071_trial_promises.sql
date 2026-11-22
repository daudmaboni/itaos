-- 0071_trial_promises — keep the v2 trial sound now that Kito opens clear-date promises by itself (22 Nov 2026).
-- Kito now creates a promise as OPEN (reminder set) when the day was said plainly, and opens older clear proposals.
--  1. A just-found promise can start a trial assignment whether Kito proposed it or opened it.
--  2. The Actions badge doesn't count promise cards of kept-aside customers (the app and push reminders skip them too).

create or replace function private.atrisk_scan(p_ws uuid, p_holdout boolean default true)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_ver constant text := 'v2';
  pct int; maxid bigint; n int := 0; k int; rf record; cnt int; bsize int; slot int; arm text;
begin
  perform pg_advisory_xact_lock(hashtext('atrisk:' || p_ws::text));
  select coalesce((select holdout_pct from workspace_admin_state where workspace_id = p_ws), 10) into pct;
  if not p_holdout then pct := 0; end if;
  select coalesce(max(id), 0) into maxid from atrisk_flags;

  -- after the price
  insert into atrisk_flags (workspace_id, conversation_id, contact_id, kind, flagged_at, until_at, fresh)
  select c.workspace_id, c.id, c.contact_id, 'after_price', f.at, f.at + interval '14 days', p_holdout and f.at > now() - interval '2 hours'
    from conversations c
    join contacts ct on ct.id = c.contact_id and not ct.not_customer
    cross join lateral (select c.last_out_at + interval '24 hours' as at) f
   where c.workspace_id = p_ws and c.phone_number_id <> 'import'
     and (c.price_shared or c.kito_label in ('priced', 'awaiting_payment', 'paid', 'shipped', 'received', 'using'))
     and c.last_dir = 'out' and c.last_out_at between now() - interval '14 days' and now() - interval '24 hours'
     and coalesce(c.outcome_override, '') not in ('sold', 'lost')
     and not exists (select 1 from orders o where o.conversation_id = c.id and o.status = 'paid')
     and not exists (select 1 from atrisk_flags x where x.conversation_id = c.id and x.kind = 'after_price'
                       and x.flagged_at > f.at - interval '14 days');
  get diagnostics k = row_count; n := n + k;

  -- promises Kito found (only a still-unconfirmed, just-found promise can start a trial)
  insert into atrisk_flags (workspace_id, conversation_id, contact_id, kind, flagged_at, until_at, task_id, fresh)
  select t.workspace_id, t.conversation_id, c.contact_id, 'promise', t.created_at,
         greatest(coalesce(t.due_at, t.created_at), t.created_at) + interval '14 days', t.id,
         p_holdout and t.status in ('proposed', 'open') and t.created_at > now() - interval '2 hours'
    from follow_up_tasks t
    join conversations c on c.id = t.conversation_id
    join contacts ct on ct.id = c.contact_id and not ct.not_customer
   where t.workspace_id = p_ws and t.source = 'kito_promise'
     and (t.status in ('proposed', 'open', 'snoozed', 'done') or (t.status = 'dismissed' and t.result = 'paid'))
     and t.created_at > now() - interval '120 days'
     and not exists (select 1 from atrisk_flags x where x.task_id = t.id);
  get diagnostics k = row_count; n := n + k;

  -- past buyers due a reorder (one flag per purchase)
  insert into atrisk_flags (workspace_id, conversation_id, contact_id, kind, flagged_at, until_at, fresh)
  select c.workspace_id, c.id, c.contact_id, 'reorder', f.at, f.at + interval '30 days', p_holdout and f.at > now() - interval '2 hours'
    from (select distinct on (o.conversation_id) o.conversation_id, o.paid_at
            from orders o where o.workspace_id = p_ws and o.status = 'paid' and o.conversation_id is not null and o.paid_at is not null
           order by o.conversation_id, o.paid_at desc) lp
    join conversations c on c.id = lp.conversation_id
    join contacts ct on ct.id = c.contact_id and not ct.not_customer
    cross join lateral (select lp.paid_at + interval '45 days' as at) f
   where lp.paid_at between now() - interval '120 days' and now() - interval '45 days'
     and not exists (select 1 from atrisk_flags x where x.conversation_id = c.id and x.kind = 'reorder' and x.flagged_at > lp.paid_at);
  get diagnostics k = row_count; n := n + k;

  -- New flags, oldest first: hide anyone in an open hold window; assign fresh, never-assigned customers.
  for rf in
    select a.id, a.contact_id, a.kind, a.flagged_at, a.until_at, a.fresh, coalesce(c.kito_temp, 'unknown') temp
      from atrisk_flags a join conversations c on c.id = a.conversation_id
     where a.workspace_id = p_ws and a.id > maxid
     order by a.flagged_at, a.id
  loop
    if exists (select 1 from atrisk_assign s where s.contact_id = rf.contact_id and s.arm = 'hold' and s.until_at > now())
       or exists (select 1 from atrisk_flags h where h.contact_id = rf.contact_id and h.holdout and h.id <> rf.id and h.until_at > now()) then
      update atrisk_flags set holdout = true where id = rf.id;
      continue;
    end if;
    if rf.fresh and pct > 0
       and not exists (select 1 from atrisk_assign s where s.workspace_id = p_ws and s.contact_id = rf.contact_id and s.version = v_ver)
       and not exists (select 1 from atrisk_flags h where h.contact_id = rf.contact_id and h.holdout) then
      -- blocked randomization inside the stratum: one hold per block, at a hidden position
      bsize := greatest(round(100.0 / pct)::int, 2);
      select count(*) into cnt from atrisk_assign s where s.workspace_id = p_ws and s.version = v_ver and s.stratum = rf.kind || ':' || rf.temp;
      slot := abs(hashtext(p_ws::text || v_ver || rf.kind || ':' || rf.temp || ':' || (cnt / bsize)::text || ':' || bsize::text)) % bsize;
      arm := case when cnt % bsize = slot then 'hold' else 'show' end;
      insert into atrisk_assign (workspace_id, contact_id, version, arm, stratum, pct, flag_id, kind, assigned_at, until_at)
      values (p_ws, rf.contact_id, v_ver, arm, rf.kind || ':' || rf.temp, pct, rf.id, rf.kind, rf.flagged_at, rf.until_at);
      if arm = 'hold' then update atrisk_flags set holdout = true where id = rf.id; end if;
    end if;
  end loop;
  return n;
end $$;
revoke all on function private.atrisk_scan(uuid, boolean) from public, anon, authenticated;

-- Is this chat's customer kept aside right now? (true/false only; members see the same through atrisk_hidden)
create or replace function public.atrisk_is_kept_aside(p_conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from atrisk_flags a where a.conversation_id = p_conv and a.holdout
                   and (a.until_at > now() or (a.kind = 'promise' and a.flagged_at > now() - interval '120 days')));
$$;
revoke all on function public.atrisk_is_kept_aside(uuid) from public, anon;
grant execute on function public.atrisk_is_kept_aside(uuid) to authenticated, service_role;

create or replace function public.nav_badges(ws uuid)
returns json language plpgsql stable set search_path to 'public' as $function$
declare
  seen timestamptz;
  v_wait int; v_new int; v_due int;
begin
  if not public.is_member(ws) then raise exception 'forbidden'; end if;
  select chats_seen_at into seen from public.nav_seen where user_id = auth.uid() and workspace_id = ws;
  seen := coalesce(seen, now() - interval '24 hours');

  select count(*) into v_wait
  from public.conversations c
  join public.contacts ct on ct.id = c.contact_id
  where c.workspace_id = ws
    and c.last_message_at between now() - interval '48 hours' and now() - interval '15 minutes'
    and public.chat_origin(ct.wa_id, c.phone_number_id) = 'live'
    and coalesce(c.outcome_override, '') not in ('sold', 'lost')
    and c.last_dir = 'in' and not c.last_in_closing;

  select count(*) into v_new
  from public.conversations c
  join public.contacts ct on ct.id = c.contact_id
  where c.workspace_id = ws
    and c.started_at > seen
    and public.chat_origin(ct.wa_id, c.phone_number_id) = 'live';

  select count(*) into v_due
  from public.follow_up_tasks t
  where t.workspace_id = ws
    and (t.status = 'proposed'
         or (t.status in ('open', 'snoozed') and coalesce(t.snoozed_until, t.due_at) <= now()))
    -- promise cards of customers kept aside (0070) aren't shown, so they don't count
    and not (t.source = 'kito_promise' and public.atrisk_is_kept_aside(t.conversation_id));

  return json_build_object('chats_waiting', v_wait, 'chats_new', v_new, 'actions_due', v_due);
end $function$;
