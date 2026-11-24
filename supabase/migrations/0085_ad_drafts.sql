-- Auto ads (25 Nov 2026): Claude writes a new click-to-WhatsApp ad from the business's best ad,
-- itaOS creates it in Meta as PAUSED, and the owner turns it on, edits or deletes it.
-- Members can read their business's drafts; every write goes through the ad-maker Edge Function.
create table if not exists public.ad_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  source_ad_id text not null,              -- the ad whose setup (audience, budget, WhatsApp destination, media) is copied
  source_ad_name text,
  product_name text,
  primary_text text not null,
  headline text,
  greeting text,                           -- first WhatsApp message the customer sees
  options jsonb not null default '[]',     -- the other versions Claude wrote, for "try another"
  warnings text[] not null default '{}',   -- policy words found by the deterministic check
  status text not null default 'draft' check (status in ('draft','creating','paused','active','deleted','failed')),
  meta_campaign_id text,
  meta_adset_id text,
  meta_creative_id text,
  meta_ad_id text,
  meta_status text,                        -- Meta's effective_status, refreshed on open
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ad_drafts add column if not exists daily_budget numeric,   -- copied from the source ad, in the ad account's currency (major units)
  add column if not exists budget_currency text,
  add column if not exists media_url text;                                       -- thumbnail of the copied photo/video, for the preview
create index if not exists ad_drafts_ws on public.ad_drafts (workspace_id, created_at desc);

alter table public.ad_drafts enable row level security;
drop policy if exists ad_drafts_read on public.ad_drafts;
create policy ad_drafts_read on public.ad_drafts for select using (public.is_member(workspace_id));
