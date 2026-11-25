-- Posts (25 Nov 2026): the business's Facebook Page and Instagram posts, ranked by what they SOLD, not likes.
--   - Boosted posts / ads made from a post: chats and paid sales come from the Ad money numbers of those ads.
--   - Normal (organic) posts: each post can get its own WhatsApp link whose ready-made message carries a short
--     code, e.g. "(P7K2Q)". A chat whose first customer message has that code came from that post.
-- Posts are filled by the `posts` Edge Function (service role). Members only read.
create table if not exists public.social_posts (
  id text primary key,                         -- Facebook: page_post id; Instagram: media id
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  platform text not null check (platform in ('facebook', 'instagram')),
  page_id text,                                -- Facebook Page the post (or the Instagram account) belongs to
  caption text,
  media_type text,                             -- photo / video / album / reel / text
  media_url text,                              -- picture to show (thumbnail for videos)
  permalink text,
  posted_at timestamptz,
  likes int not null default 0,                -- reactions on Facebook, likes on Instagram
  comments int not null default 0,
  shares int not null default 0,
  views int,                                   -- Instagram views/reach when Meta allows it
  ad_ids text[] not null default '{}',         -- ads that run this post
  wa_code text,                                -- code in this post's WhatsApp link (organic tracking)
  synced_at timestamptz not null default now()
);
create index if not exists social_posts_ws on public.social_posts (workspace_id, posted_at desc);
create unique index if not exists social_posts_code on public.social_posts (workspace_id, wa_code) where wa_code is not null;
alter table public.social_posts enable row level security;
drop policy if exists social_posts_read on public.social_posts;
create policy social_posts_read on public.social_posts for select using (public.is_member(workspace_id));

alter table public.workspaces
  add column if not exists social_page_id text,          -- Facebook Page itaOS reads posts from (picked automatically)
  add column if not exists social_page_name text,
  add column if not exists social_ig_id text,
  add column if not exists social_ig_username text,
  add column if not exists social_synced_at timestamptz,
  add column if not exists social_note text;             -- last thing that stopped part of the read (e.g. Instagram permission)

-- "Make this an ad": a draft that runs an existing post instead of new words.
alter table public.ad_drafts
  add column if not exists source_post_id text,
  add column if not exists source_post_platform text,
  add column if not exists post_mode text;               -- as_is (the post itself, likes kept) or copy (same picture and words)

-- Per post: chats and PAID sales in the last p_days days.
--   ad part      = sum of Ad money's numbers for the ads that run the post (exact + shared estimates, as there).
--   organic part = chats that started with the post's code; paid orders from those chats, paid in the window and
--                  within the business's conversion window after the chat started. "Not a customer" never counts.
create or replace function public.post_money(p_ws uuid, p_days int default 30)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text; v_win int; v_days int := greatest(1, least(coalesce(p_days, 30), 90));
  v_to date; v_from date; v_ad jsonb; v_out jsonb;
begin
  if not public.is_member(p_ws) then raise exception 'not a member of this business'; end if;
  select coalesce(timezone, 'Africa/Dar_es_Salaam'), coalesce(conversion_window_days, 30) into v_tz, v_win from workspaces where id = p_ws;
  v_to := (now() at time zone v_tz)::date;
  v_from := v_to - (v_days - 1);
  v_ad := public.ad_money(p_ws, v_days);

  with
  ad_rows as (select a from jsonb_array_elements(coalesce(v_ad->'ads', '[]'::jsonb)) a),
  by_ad as (
    select p.id post_id,
           sum((r.a->>'spend')::numeric) spend, sum((r.a->>'chats')::numeric) chats,
           sum((r.a->>'sales')::numeric) sales, sum((r.a->>'revenue')::numeric) revenue
    from social_posts p
    cross join lateral unnest(p.ad_ids) x(ad_id)
    join ad_rows r on r.a->>'ad_id' = x.ad_id
    where p.workspace_id = p_ws
    group by p.id
  ),
  org_chats as (
    select p.id post_id, c.id conv_id, c.started_at
    from social_posts p
    join conversations c on c.workspace_id = p_ws and c.started_at is not null
      and (c.started_at at time zone v_tz)::date between v_from - v_win and v_to
    join contacts k on k.id = c.contact_id and coalesce(k.not_customer, false) = false
    where p.workspace_id = p_ws and p.wa_code is not null
      and exists (select 1 from messages m
                  where m.conversation_id = c.id and m.direction = 'in'
                    and m.sent_at < c.started_at + interval '1 day'
                    and m.body ilike '%(' || p.wa_code || ')%')
  ),
  org as (
    select post_id, count(*) filter (where (started_at at time zone v_tz)::date between v_from and v_to) chats
    from org_chats group by post_id
  ),
  org_paid as (
    select oc.post_id, count(distinct o.id) sales, sum(o.amount - o.discount - o.refund_amount) revenue
    from org_chats oc
    join orders o on o.conversation_id = oc.conv_id and o.status = 'paid' and o.paid_at is not null
      and (o.paid_at at time zone v_tz)::date between v_from and v_to
      and o.paid_at <= oc.started_at + make_interval(days => v_win)
    group by oc.post_id
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to, 'days', v_days, 'ad_currency', v_ad->>'ad_currency',
    'posts', coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'ad_spend', coalesce(b.spend, 0), 'ad_chats', coalesce(b.chats, 0), 'ad_sales', coalesce(b.sales, 0), 'ad_revenue', coalesce(b.revenue, 0),
      'link_chats', coalesce(o.chats, 0), 'link_sales', coalesce(op.sales, 0), 'link_revenue', coalesce(op.revenue, 0)
    )) filter (where b.post_id is not null or o.post_id is not null or op.post_id is not null), '[]'::jsonb)
  ) into v_out
  from social_posts p
  left join by_ad b on b.post_id = p.id
  left join org o on o.post_id = p.id
  left join org_paid op on op.post_id = p.id
  where p.workspace_id = p_ws;
  return v_out;
end $$;
revoke execute on function public.post_money(uuid, int) from public, anon;
grant execute on function public.post_money(uuid, int) to authenticated;
comment on function public.post_money(uuid, int) is 'Posts page: per post chats and paid sales (from the ads that run it, and from its own WhatsApp link code) for the last p_days days.';
