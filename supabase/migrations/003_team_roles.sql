-- ====================================================================
-- 003_team_roles.sql
-- --------------------------------------------------------------------
-- Closes two holes and adds what the admin panel's Team page needs.
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- HOLE 1: self-promotion. The "update own profile" policy lets every
-- signed-in user update their own profiles row, and the role column
-- was not protected, so an editor could run
--   supabase.from('profiles').update({ role: 'admin' }).eq('id', myId)
-- and become an admin. A trigger now refuses any role change that an
-- admin did not make.
--
-- HOLE 2: open signup. Public signup is enabled on this project, and
-- every new account got role 'editor', so anyone could register and
-- edit the site. New accounts now start as 'pending', which grants no
-- write access, until an admin approves them on the Team page.
-- Existing accounts keep their current role.
-- ====================================================================

-- 'pending' is a role with no access. current_role() returns it, and
-- every write policy checks for 'admin' or 'editor', so it is refused.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin','editor','pending'));
alter table public.profiles alter column role set default 'pending';

create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- The guard is for requests from the website, which arrive with the
  -- JWT role 'anon' or 'authenticated'. The Supabase SQL editor and the
  -- service role are trusted and pass through, so an owner can still
  -- promote the first admin by hand (see the README).
  if coalesce(auth.role(), '') not in ('anon', 'authenticated') then
    return new;
  end if;

  if new.id is distinct from old.id or new.email is distinct from old.email then
    raise exception 'A profile''s id and email cannot be changed.'
      using errcode = '42501';
  end if;

  if new.role is distinct from old.role then
    if public.current_role() <> 'admin' then
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

drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Admins already read every profile through "read own profile"
-- (id = auth.uid() or current_role() = 'admin'), and update them
-- through "update own profile" with the same condition. The trigger
-- above is what stops non-admins changing roles through that policy.
