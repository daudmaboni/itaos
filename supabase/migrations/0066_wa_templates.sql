-- WhatsApp templates (22 Nov 2026): follow-ups after the 24-hour window.
-- WhatsApp only lets a business message a customer more than 24 h after the customer's last message with a
-- template Meta has approved. itaOS keeps each business's templates here, creates them on the business's own
-- WhatsApp account (wa-templates function, using the token saved for "Send sales to Meta"), and wa-send sends
-- them through Dualhook. Approve & send in Actions picks the approved template for the list it is on.
--
-- purpose: which Actions list uses it ('after_price', 'reorder', 'promise') or 'custom'.
-- body: the text with {{1}} = customer's first name, {{2}} = product (reorder only).

create table if not exists public.wa_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  waba_id text not null,
  name text not null,                     -- Meta template name (lowercase, underscores)
  language text not null default 'sw',
  category text not null default 'MARKETING',
  purpose text not null default 'custom' check (purpose in ('after_price', 'reorder', 'promise', 'custom')),
  body text not null,
  params jsonb not null default '[]',     -- what each {{n}} is: ["name"] / ["name","product"]
  meta_id text,
  status text not null default 'PENDING', -- Meta: PENDING / APPROVED / REJECTED / PAUSED / DISABLED; ours: DRAFT / ERROR
  reason text,                            -- Meta's rejection reason or our error text
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  synced_at timestamptz,
  unique (workspace_id, waba_id, name, language)
);
create index if not exists wa_templates_ws_idx on public.wa_templates (workspace_id, purpose, status);
alter table public.wa_templates enable row level security;
drop policy if exists wa_templates_read on public.wa_templates;
create policy wa_templates_read on public.wa_templates for select using (public.is_member(workspace_id));
grant select on public.wa_templates to authenticated;
-- Writes only through the wa-templates function (service role).

-- Messages sent as templates are stored like any other itaOS message (type 'template', name in raw).
