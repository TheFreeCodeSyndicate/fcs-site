-- supabase/schema.sql
-- The Free Code Syndicate — schema, Row Level Security, and seed data.
--
-- HOW TO RUN
--   1. Go to https://supabase.com and create a free project.
--   2. In the project, open the "SQL Editor" in the left sidebar
--      (or https://<your-ref>.supabase.co/sql ).
--   3. Click "New query".
--   4. Select everything in THIS file, paste it in, and press Run
--      (or Ctrl+Enter).
--   5. It is safe to run more than once — every statement is
--      "if not exists" or an upsert, so re-running will not duplicate
--      or destroy your data.
--
-- This creates 7 tables, enables RLS on all of them, creates the
-- policies, and inserts your starting content. It does NOT create
-- your login accounts — you do that afterwards in Authentication.

-- ============================================================== TABLES

create extension if not exists "pgcrypto";

-- Who is allowed to edit. One row per account, created automatically
-- on signup by the trigger at the bottom of this file.
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  role         text not null default 'editor' check (role in ('admin','editor')),
  created_at   timestamptz not null default now()
);

-- The Kanban cards. `starts_at` is the single source of truth for
-- WHEN something happens. The website works out whether an event is
-- UPCOMING / LIVE / FINISHED from this column, so it can never show
-- a month-old event as upcoming.
-- `stage` is a WORKFLOW state you control by dragging the card:
--   draft     being written, hidden from the public site
--   scheduled published
--   live      published
--   done      published as finished, or hidden if in the past
create table if not exists public.events (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  group_name       text,
  details          text,
  starts_at        timestamptz not null,
  duration_minutes integer not null default 60,
  stage            text not null default 'draft' check (stage in ('draft','scheduled','live','done')),
  link             text,
  link_text        text,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists events_starts_at_idx on public.events (starts_at);
create index if not exists events_stage_idx on public.events (stage);

-- The standing weekly class schedule. `weekday` follows JavaScript's
-- Date.getDay(): 0 = Sunday, 1 = Monday, ... 6 = Saturday.
create table if not exists public.class_sessions (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  group_name       text,
  weekday          integer not null check (weekday between 0 and 6),
  start_time       time not null,
  duration_minutes integer not null default 60,
  timezone         text not null default 'Asia/Kolkata',
  link             text,
  is_active        boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Learning material that is NOT a GitHub repository: notes, videos,
-- papers, courses, tools, books. This is what makes the Resources
-- section distinct from the Projects section.
create table if not exists public.resources (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  kind         text not null default 'notes' check (kind in ('notes','video','paper','course','tool','book')),
  url          text not null,
  summary      text,
  group_name   text,
  sort_order   integer not null default 0,
  is_published boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.study_groups (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  topic        text not null,
  status       text not null default 'Forming' check (status in ('Active','Forming','Paused','Completed')),
  link         text,
  link_text    text,
  sort_order   integer not null default 0,
  is_published boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Discord, Instagram, WhatsApp, GitHub.
create table if not exists public.social_links (
  id           uuid primary key default gen_random_uuid(),
  platform     text not null default 'web' check (platform in ('discord','instagram','whatsapp','github','x','web')),
  label        text not null,
  url          text not null,
  hint         text,
  sort_order   integer not null default 0,
  is_published boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Curated classification of the live GitHub repository list.
-- Keyed by repo_name because GitHub repo names are unique and stable.
-- A repo that is NOT listed here is a Project by default — so a
-- newly pushed repo appears on its own with no CMS involvement.
-- List a repo here with kind = 'resource' to move it into Resources.
create table if not exists public.repo_kinds (
  repo_name  text primary key,
  kind       text not null default 'project' check (kind in ('project','resource')),
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================= TRIGGERS

-- Keep updated_at honest without the app having to remember.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['events','class_sessions','resources','study_groups','social_links','repo_kinds']
  loop
    execute format('drop trigger if exists touch_%1$s on public.%1$s;', t);
    execute format(
      'create trigger touch_%1$s before update on public.%1$s
       for each row execute function public.touch_updated_at();', t);
  end loop;
end $$;

-- Every new signup gets an editor profile automatically.
-- You promote the first account to admin by hand — see the end of this file.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ========================================================== RLS + POLICIES
--
-- The anon key in js/config.js is designed to be public — it is NOT a
-- secret. These policies are what actually protect your data. Without
-- them, anyone could delete your events. Never put the SERVICE-ROLE
-- key in js/config.js; that one really is a secret.
--
-- GRANTS vs POLICIES — read this, it is the one thing people get wrong.
-- These are two different layers and BOTH are required:
--
--   GRANT  = table-level. "May this role touch this table at all?"
--   POLICY = row-level. "Which rows of that table may it see?"
--
-- This project was created with "Automatically expose new tables" OFF,
-- which means no GRANTs were issued. RLS alone is not enough: a policy
-- saying "anon may read events" is never even consulted if anon has no
-- table privilege. The symptom is a 401 whose body reads
-- "permission denied for table events".
--
-- So the GRANTs below are explicit and minimal, and the policies decide
-- the rows. Do not remove the GRANTs, and do not grant anon any write.

create or replace function public.current_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'anon');
$$;

-- ------------------------------------------------------- table privileges

grant usage on schema public to anon, authenticated;

-- Anyone, signed in or not, may READ the public content tables.
-- Which rows they see is decided by the policies below.
grant select on
  public.events,
  public.class_sessions,
  public.resources,
  public.study_groups,
  public.social_links,
  public.repo_kinds
to anon, authenticated;

-- profiles is NOT granted to anon. A signed-in user may read and update
-- their own row only; the policy below restricts it to auth.uid().
grant select, update on public.profiles to authenticated;

-- Signed-in users get write privileges at the TABLE level. Whether a
-- given editor or admin may actually perform the write is decided by the
-- policies below — that is why delete is granted here but policed to
-- admins only.
grant insert, update, delete on
  public.events,
  public.class_sessions,
  public.resources,
  public.study_groups,
  public.social_links,
  public.repo_kinds
to authenticated;


alter table public.profiles       enable row level security;
alter table public.events         enable row level security;
alter table public.class_sessions enable row level security;
alter table public.resources      enable row level security;
alter table public.study_groups   enable row level security;
alter table public.social_links   enable row level security;
alter table public.repo_kinds     enable row level security;

-- profiles: read your own row; admins read all.
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select
  using (id = auth.uid() or public.current_role() = 'admin');

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update
  using (id = auth.uid() or public.current_role() = 'admin');

-- The content tables share four rules:
--   anyone can READ (the public page needs this)
--   signed-in editors and admins can INSERT and UPDATE
--   only admins can DELETE
do $$
declare t text;
begin
  foreach t in array array['events','class_sessions','resources','study_groups','social_links']
  loop
    execute format('drop policy if exists "public read" on public.%1$I;', t);
    execute format('create policy "public read" on public.%1$I for select using (true);', t);

    execute format('drop policy if exists "editors insert" on public.%1$I;', t);
    execute format('create policy "editors insert" on public.%1$I for insert to authenticated
      with check (public.current_role() in (''admin'',''editor''));', t);

    execute format('drop policy if exists "editors update" on public.%1$I;', t);
    execute format('create policy "editors update" on public.%1$I for update to authenticated
      using (public.current_role() in (''admin'',''editor''))
      with check (public.current_role() in (''admin'',''editor''));', t);

    execute format('drop policy if exists "admins delete" on public.%1$I;', t);
    execute format('create policy "admins delete" on public.%1$I for delete to authenticated
      using (public.current_role() = ''admin'');', t);
  end loop;
end $$;

-- repo_kinds: public read, editor write, admin delete.
-- Keyed by repo_name, so there is no `id` column involved.
drop policy if exists "public read" on public.repo_kinds;
create policy "public read" on public.repo_kinds for select using (true);

drop policy if exists "editors insert" on public.repo_kinds;
create policy "editors insert" on public.repo_kinds for insert to authenticated
  with check (public.current_role() in ('admin','editor'));

drop policy if exists "editors update" on public.repo_kinds;
create policy "editors update" on public.repo_kinds for update to authenticated
  using (public.current_role() in ('admin','editor'))
  with check (public.current_role() in ('admin','editor'));

drop policy if exists "admins delete" on public.repo_kinds;
create policy "admins delete" on public.repo_kinds for delete to authenticated
  using (public.current_role() = 'admin');

-- ============================================================ SEED DATA
--
-- Your starting content, so the site is not empty on first run.
-- Everything here is editable later from the /admin panel.

-- Note the new Discord invite, replacing the expired one.
insert into public.social_links (platform, label, url, hint, sort_order) values
  ('discord',   'Discord Server',     'https://discord.gg/97BAafVesn', 'Study rooms, voice rooms, and code help.', 1),
  ('instagram', 'Instagram',          'https://www.instagram.com/freecodesyndicate/', 'Posters, notes, and session announcements.', 2),
  ('whatsapp',  'WhatsApp Community', 'https://chat.whatsapp.com/Dks4VUe0E5n7xmilaKTqXS', 'Daily messages and notices.', 3),
  ('github',    'GitHub Organization','https://github.com/TheFreeCodeSyndicate', 'Public repositories and the work record.', 4)
on conflict (id) do nothing;

insert into public.study_groups (name, topic, status, link, link_text, sort_order) values
  ('Crypto Study Group', 'Study cryptography from first principles. Prove before you trust.', 'Completed',
   'https://github.com/TheFreeCodeSyndicate/CRYPTO_STUDY_GROUP', 'Check the repository', 1),
  ('Systems Reading Room', 'Read operating systems, networks, compilers, and the machine layer below user programs.', 'Forming',
   'https://discord.gg/97BAafVesn', 'Help form the room', 2),
  ('Anti Aliasing: A Computer Graphics Study Group', 'Study computer graphics from first principles. Learn to render, shade, and animate.', 'Forming',
   'https://github.com/TheFreeCodeSyndicate/anti-aliasing', 'Read the repositories', 3)
on conflict (id) do nothing;

-- The three existing events, already in the past, seeded as done so the
-- admin board starts clean. To hide them entirely instead, delete these
-- rows in the SQL editor:
--   delete from public.events;
insert into public.events (title, group_name, details, starts_at, duration_minutes, stage, link, link_text, sort_order) values
  ('Explain-3 Session', 'Crypto Study Group', 'A study session for the next Explain track discussion.',
   '2026-07-28T15:30:00Z', 60, 'done', 'https://github.com/TheFreeCodeSyndicate/CRYPTO_STUDY_GROUP', 'Check the repository', 1),
  ('CryptoMeet-3 Session', 'Crypto Study Group', 'A meeting for discussing the PCSP project, DES and AES, and some public key cryptography.',
   '2026-08-04T15:30:00Z', 60, 'done', 'https://discord.gg/97BAafVesn', 'Join Discord', 2),
  ('Quantum Computing and PQC Session', 'Crypto Study Group', 'A meeting for discussing quantum computing and post-quantum cryptography.',
   '2026-08-09T15:30:00Z', 60, 'done', 'https://calendar.app.google/4agDYABbWPYyvWQc9', 'Add to Calendar', 3)
on conflict (id) do nothing;

-- ================================================================ AFTER
--
-- These are the two manual steps. Run them AFTER you have signed up.
--
-- 1) Promote your own account to admin. Replace the email with yours:
--
--      update public.profiles set role = 'admin' where email = 'you@example.com';
--
-- 2) Create an account for your friend:
--      Authentication -> Users -> "Add user" -> invite by email.
--      They arrive with role 'editor': they can add and change things,
--      but not delete. Only admins can delete.
--
-- To create an account from SQL instead (so you can set their password
-- yourself), use the admin API or simply let them use "Add user".
