-- Nav badges that tell the truth (23 Nov 2026), after "A badge should tell the truth" (The Glide Studio):
--  1. clear on view: opening Chats / Actions marks them seen (mark_nav_seen, already there for both)
--  2. count down: the counts are live, so each customer you answer drops off at once
--  3. only what is new: two extra counts — waiting chats whose last message came after you last opened Chats,
--     and follow-ups that became due (or were proposed) after you last opened Actions. The app shows those
--     as the coloured number; anything you've already seen shows as a quiet grey number.
create or replace function public.nav_badges(ws uuid)
returns json language plpgsql stable set search_path to 'public' as $function$
declare
  seen timestamptz; aseen timestamptz;
  v_wait int; v_wait_new int; v_new int; v_due int; v_due_new int;
begin
  if not public.is_member(ws) then raise exception 'forbidden'; end if;
  select chats_seen_at, actions_seen_at into seen, aseen from public.nav_seen where user_id = auth.uid() and workspace_id = ws;
  seen := coalesce(seen, now() - interval '24 hours');
  aseen := coalesce(aseen, now() - interval '24 hours');

  select count(*), count(*) filter (where c.last_message_at > seen) into v_wait, v_wait_new
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

  select count(*),
         count(*) filter (where (t.status = 'proposed' and t.created_at > aseen)
                             or (t.status <> 'proposed' and coalesce(t.snoozed_until, t.due_at) > aseen))
    into v_due, v_due_new
  from public.follow_up_tasks t
  where t.workspace_id = ws
    and (t.status = 'proposed'
         or (t.status in ('open', 'snoozed') and coalesce(t.snoozed_until, t.due_at) <= now()))
    and not (t.source = 'kito_promise' and public.atrisk_is_kept_aside(t.conversation_id));

  return json_build_object('chats_waiting', v_wait, 'chats_waiting_new', v_wait_new, 'chats_new', v_new,
                           'actions_due', v_due, 'actions_due_new', v_due_new);
end $function$;
