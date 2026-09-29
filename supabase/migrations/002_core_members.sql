-- ====================================================================
-- 002_core_members.sql
-- --------------------------------------------------------------------
-- The Core Members section: club leads and mentors, editable from the
-- admin panel. Run once in the Supabase SQL editor, after schema.sql.
-- Safe to re-run: every statement is idempotent.
--
-- Links are one optional column per platform. The public site shows
-- only the ones that are filled in. Discord has no linkable profile
-- URL, so it is stored as a handle and shown as a copy button.
-- ====================================================================

create table if not exists public.core_members (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  role            text not null default 'mentor' check (role in ('lead','mentor')),
  title           text,
  status          text not null default 'active' check (status in ('active','alumni')),
  group_name      text,
  focus           text[] not null default '{}' check (cardinality(focus) <= 4),
  bio             text check (char_length(bio) <= 280),

  github_username text unique,
  photo_url       text check (photo_url     ~* '^https?://'),
  linkedin_url    text check (linkedin_url  ~* '^https?://'),
  instagram_url   text check (instagram_url ~* '^https?://'),
  x_url           text check (x_url         ~* '^https?://'),
  website_url     text check (website_url   ~* '^https?://'),
  email           text check (email         ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  discord_handle  text,

  joined_on       date,
  ended_on        date,
  sort_order      integer not null default 0,
  is_published    boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists touch_core_members on public.core_members;
create trigger touch_core_members before update on public.core_members
  for each row execute function public.touch_updated_at();

-- Same access as every other content table: anyone reads, editors and
-- admins write, only admins delete. The grants are what let RLS apply.
grant select on public.core_members to anon, authenticated;
grant insert, update, delete on public.core_members to authenticated;

alter table public.core_members enable row level security;

drop policy if exists "public read" on public.core_members;
create policy "public read" on public.core_members for select using (true);

drop policy if exists "editors insert" on public.core_members;
create policy "editors insert" on public.core_members for insert to authenticated
  with check (public.current_role() in ('admin','editor'));

drop policy if exists "editors update" on public.core_members;
create policy "editors update" on public.core_members for update to authenticated
  using (public.current_role() in ('admin','editor'))
  with check (public.current_role() in ('admin','editor'));

drop policy if exists "admins delete" on public.core_members;
create policy "admins delete" on public.core_members for delete to authenticated
  using (public.current_role() = 'admin');

-- The three maintainers from the old hard-coded section. Roles, groups
-- and bios are left for the admin panel; fill them in there.
insert into public.core_members (name, role, github_username, sort_order)
values
  ('Ronit Choudhury', 'lead', 'nonQualities',   0),
  ('Jyotirmoy Das',   'lead', 'JyotirmoyDas05', 1),
  ('Ved Bhandary',    'lead', 'no3465',         2)
on conflict (github_username) do nothing;
