-- ====================================================================
-- 005_advisor_fixes.sql
-- --------------------------------------------------------------------
-- Clears the Supabase security and performance advisor warnings.
--
-- 1. The role helper moves from public.current_role() to
--    private.current_role(). Functions in `public` are callable by
--    anyone over /rest/v1/rpc/; the `private` schema is not exposed by
--    the API, but policies can still call it. SECURITY DEFINER stays:
--    it has to read profiles past profiles' own RLS.
-- 2. Every policy is recreated against the private helper, with
--    auth.uid() and the helper wrapped in (select ...) so Postgres
--    evaluates them once per query instead of once per row.
-- 3. The two read policies per table (published rows / editors see
--    all) merge into one, which is what the advisor asks for and is
--    easier to read.
-- 4. Trigger and event-trigger functions lose EXECUTE for API roles:
--    triggers still fire (EXECUTE is only checked when the trigger is
--    created), but nobody can call them over RPC.
-- 5. touch_updated_at() gets a fixed, empty search_path.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ====================================================================

-- 1. The helper, outside the API --------------------------------------
create schema if not exists private;
grant usage on schema private to anon, authenticated;

create or replace function private.current_role()
returns text
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select role from public.profiles where id = (select auth.uid())),
    'anon'
  );
$$;

revoke execute on function private.current_role() from public;
grant execute on function private.current_role() to anon, authenticated;

-- 2 + 3. Policies on the content tables -------------------------------
do $$
declare
  t text;
  visible text;
begin
  foreach t in array array['events','class_sessions','resources','study_groups',
                           'social_links','core_members','repo_kinds']
  loop
    -- Drop every policy name used so far, so this file is re-runnable.
    execute format('drop policy if exists "public read" on public.%1$I', t);
    execute format('drop policy if exists "read published" on public.%1$I', t);
    execute format('drop policy if exists "read scheduled events" on public.%1$I', t);
    execute format('drop policy if exists "read active sessions" on public.%1$I', t);
    execute format('drop policy if exists "editors read all" on public.%1$I', t);
    execute format('drop policy if exists "read" on public.%1$I', t);
    execute format('drop policy if exists "editors insert" on public.%1$I', t);
    execute format('drop policy if exists "editors update" on public.%1$I', t);
    execute format('drop policy if exists "admins delete" on public.%1$I', t);

    -- What a visitor may see; editors and admins see every row.
    visible := case t
      when 'events'         then 'stage <> ''draft'''
      when 'class_sessions' then 'is_active'
      when 'repo_kinds'     then 'true'
      else                       'is_published'
    end;

    execute format($p$
      create policy "read" on public.%1$I for select to anon, authenticated
      using (%2$s or (select private.current_role()) in ('admin','editor'))
    $p$, t, visible);

    execute format($p$
      create policy "editors insert" on public.%1$I for insert to authenticated
      with check ((select private.current_role()) in ('admin','editor'))
    $p$, t);

    execute format($p$
      create policy "editors update" on public.%1$I for update to authenticated
      using ((select private.current_role()) in ('admin','editor'))
      with check ((select private.current_role()) in ('admin','editor'))
    $p$, t);

    execute format($p$
      create policy "admins delete" on public.%1$I for delete to authenticated
      using ((select private.current_role()) = 'admin')
    $p$, t);
  end loop;
end $$;

-- Policies on profiles: your own row, or every row if you are an admin.
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.current_role()) = 'admin');

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select private.current_role()) = 'admin');

-- The role guard from 003, now calling the private helper.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  -- Requests from the website arrive as 'anon' or 'authenticated'. The
  -- SQL editor and the service role are trusted and pass through, so an
  -- owner can still promote the first admin by hand.
  if coalesce(auth.role(), '') not in ('anon', 'authenticated') then
    return new;
  end if;

  if new.id is distinct from old.id or new.email is distinct from old.email then
    raise exception 'A profile''s id and email cannot be changed.'
      using errcode = '42501';
  end if;

  if new.role is distinct from old.role then
    if private.current_role() <> 'admin' then
      raise exception 'Only an admin can change roles.'
        using errcode = '42501';
    end if;
    if old.role = 'admin' and new.role <> 'admin'
       and (select count(*) from public.profiles where role = 'admin') <= 1 then
      raise exception 'There must always be at least one admin.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- The public helper has no remaining users.
drop function if exists public.current_role();

-- 4. Trigger functions are not API endpoints ----------------------------
revoke execute on function public.guard_profile_update() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
-- Supabase's own "enable RLS on new tables" event trigger.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- 5. Fixed search_path --------------------------------------------------
alter function public.touch_updated_at() set search_path = '';
