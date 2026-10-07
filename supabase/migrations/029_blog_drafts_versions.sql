-- 029: Notion-style autosave and version history for blog posts.
--
-- blog_drafts: a published post's unpublished edits. The editor autosaves
-- here as you type, so nothing is lost on a reload, and the live post (and
-- the public site, which reads blog_posts) only changes on "Update".
-- blog_versions: snapshots of a post (on publish/update, and at most every
-- few minutes while editing), listed in the editor's version history and
-- restorable. Neither table is readable by visitors.

create table if not exists public.blog_drafts (
  post_id    uuid primary key references public.blog_posts (id) on delete cascade,
  content    jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references public.profiles (id) on delete set null
);

create table if not exists public.blog_versions (
  id         bigint generated always as identity primary key,
  post_id    uuid not null references public.blog_posts (id) on delete cascade,
  content    jsonb not null,
  kind       text not null default 'edit' check (kind in ('edit', 'publish')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null
);
create index if not exists blog_versions_post_idx on public.blog_versions (post_id, created_at desc);

alter table public.blog_drafts enable row level security;
alter table public.blog_versions enable row level security;

drop policy if exists "editors manage drafts" on public.blog_drafts;
create policy "editors manage drafts" on public.blog_drafts for all to authenticated
  using ((select private.current_role()) in ('admin', 'editor'))
  with check ((select private.current_role()) in ('admin', 'editor'));

drop policy if exists "editors read versions" on public.blog_versions;
create policy "editors read versions" on public.blog_versions for select to authenticated
  using ((select private.current_role()) in ('admin', 'editor'));

drop policy if exists "editors add versions" on public.blog_versions;
create policy "editors add versions" on public.blog_versions for insert to authenticated
  with check ((select private.current_role()) in ('admin', 'editor') and created_by = (select auth.uid()));

-- This project grants nothing by default: only signed-in users, and RLS
-- above narrows that to admins and editors.
grant select, insert, update, delete on public.blog_drafts to authenticated;
grant select, insert on public.blog_versions to authenticated;
