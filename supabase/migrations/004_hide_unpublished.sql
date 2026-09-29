-- ====================================================================
-- 004_hide_unpublished.sql
-- --------------------------------------------------------------------
-- Hidden content was only hidden by the website's JavaScript.
--
-- Every content table had   create policy "public read" ... using (true)
-- so a draft event, an unpublished resource, or a hidden core member
-- (email address included) was readable by anyone calling the REST API
-- with the public anon key from js/config.js.
--
-- After this migration the database itself decides:
--   * visitors, and signed-in accounts without an editor role, read only
--     what is published;
--   * editors and admins read everything, which the admin panel needs.
-- Two permissive SELECT policies are OR-ed together by Postgres.
--
-- current_role() is wrapped in (select ...) so Postgres evaluates it
-- once per query instead of once per row.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ====================================================================

-- Events: drafts are the maintainers' working copies.
drop policy if exists "public read" on public.events;
drop policy if exists "read scheduled events" on public.events;
create policy "read scheduled events" on public.events
  for select to anon, authenticated
  using (stage <> 'draft');

-- Weekly sessions: inactive ones are paused.
drop policy if exists "public read" on public.class_sessions;
drop policy if exists "read active sessions" on public.class_sessions;
create policy "read active sessions" on public.class_sessions
  for select to anon, authenticated
  using (is_active);

-- Tables with a "Show on the site" switch.
do $$
declare t text;
begin
  foreach t in array array['resources','study_groups','social_links','core_members']
  loop
    execute format('drop policy if exists "public read" on public.%1$I;', t);
    execute format('drop policy if exists "read published" on public.%1$I;', t);
    execute format('create policy "read published" on public.%1$I
                      for select to anon, authenticated
                      using (is_published);', t);
  end loop;
end $$;

-- Editors and admins see every row, hidden or not.
do $$
declare t text;
begin
  foreach t in array array['events','class_sessions','resources','study_groups','social_links','core_members']
  loop
    execute format('drop policy if exists "editors read all" on public.%1$I;', t);
    execute format('create policy "editors read all" on public.%1$I
                      for select to authenticated
                      using ((select public.current_role()) in (''admin'',''editor''));', t);
  end loop;
end $$;

-- repo_kinds keeps its public read: it only says which repos count as
-- resources, and every repo it names is already public on GitHub.
