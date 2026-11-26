create or replace function public.wallet_record(p_line uuid, p_conv uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare l wallet_lines; v_id uuid; v_cur text;
begin
  select * into l from wallet_lines where id = p_line;
  if l.id is null or not public.can_edit(l.workspace_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_conv is not null and not exists (select 1 from conversations where id = p_conv and workspace_id = l.workspace_id) then
    raise exception 'chat not in this business';
  end if;
  select id into v_id from orders where workspace_id = l.workspace_id and (external_ref = 'wallet:' || l.txn_id or upper(payment_ref) = upper(l.txn_id)) limit 1;
  if v_id is not null then return v_id; end if;
  select currency into v_cur from workspaces where id = l.workspace_id;
  insert into orders (workspace_id, conversation_id, amount, currency, status, paid_at, occurred_at, provenance, external_ref, payment_ref, notes, created_by)
  values (l.workspace_id, p_conv, l.amount, coalesce(l.currency, v_cur), 'paid', l.at, l.at, 'manual', 'wallet:' || l.txn_id, l.txn_id,
          'From your ' || coalesce(l.provider, 'mobile-money') || ' statement' || coalesce(': ' || l.sender_name, '') || coalesce(' (…' || l.phone_tail || ')', '') || '. Code ' || l.txn_id || '.',
          auth.uid())
  returning id into v_id;
  update wallet_lines set dismissed = false where id = l.id;
  return v_id;
end $$;
revoke all on function public.wallet_record(uuid, uuid) from public, anon;
grant execute on function public.wallet_record(uuid, uuid) to authenticated;
