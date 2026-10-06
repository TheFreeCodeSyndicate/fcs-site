-- ====================================================================
-- 022_blog_posts.sql
-- --------------------------------------------------------------------
-- The blog. Posts are written in the admin panel and live here as
-- Markdown; the deploy turns each published one into a static page
-- (tools/blog-build.mjs). Images are not stored here: the admin panel
-- uploads them through the upload-asset Edge Function to the public
-- fcs-assets repository and the post holds their jsDelivr addresses.
--
-- * Visitors read published posts only; editors and admins read drafts too.
-- * Editors and admins write; only admins delete (like every content table).
-- * published_at is stamped the first time a post is published and kept
--   after that, so unpublishing and republishing keeps the original date.
-- * Changes land in the activity log, so deletes can be undone.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ====================================================================

create table if not exists public.blog_posts (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (length(title) between 1 and 160),
  slug         text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  excerpt      text check (length(excerpt) <= 300),
  body         text not null default '' check (length(body) <= 200000),
  cover_url    text check (cover_url ~* '^https://\S+$'),
  author_name  text check (length(author_name) <= 80),
  status       text not null default 'draft' check (status in ('draft','published')),
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists blog_posts_published_idx on public.blog_posts (published_at desc) where status = 'published';

create or replace function public.stamp_published_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'published' and new.published_at is null then
    new.published_at = now();
  end if;
  return new;
end;
$$;
revoke execute on function public.stamp_published_at() from public, anon, authenticated;

drop trigger if exists stamp_published_at on public.blog_posts;
create trigger stamp_published_at before insert or update on public.blog_posts
  for each row execute function public.stamp_published_at();

drop trigger if exists touch_blog_posts on public.blog_posts;
create trigger touch_blog_posts before update on public.blog_posts
  for each row execute function public.touch_updated_at();

drop trigger if exists log_activity on public.blog_posts;
create trigger log_activity after insert or update or delete on public.blog_posts
  for each row execute function private.log_activity();

alter table public.blog_posts enable row level security;

grant select on public.blog_posts to anon, authenticated;
grant insert, update, delete on public.blog_posts to authenticated;

drop policy if exists "read published, editors read all" on public.blog_posts;
create policy "read published, editors read all" on public.blog_posts for select
  using (status = 'published' or (select private.current_role()) in ('admin','editor'));

drop policy if exists "editors insert" on public.blog_posts;
create policy "editors insert" on public.blog_posts for insert to authenticated
  with check ((select private.current_role()) in ('admin','editor'));

drop policy if exists "editors update" on public.blog_posts;
create policy "editors update" on public.blog_posts for update to authenticated
  using ((select private.current_role()) in ('admin','editor'))
  with check ((select private.current_role()) in ('admin','editor'));

drop policy if exists "admins delete" on public.blog_posts;
create policy "admins delete" on public.blog_posts for delete to authenticated
  using ((select private.current_role()) = 'admin');
