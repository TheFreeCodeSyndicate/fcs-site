-- 009_remove_member.sql
-- Lets an admin remove someone from the panel completely: their login is
-- deleted (auth.users), which cascades to their profiles row and ends
-- their sessions. The site's content they edited is kept.
--
-- security definer because only the owner may delete from auth.users;
-- the checks below are what stop anyone but an admin using it.
create or replace function public.remove_member(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select private.current_role()) <> 'admin' then
    raise exception 'Only admins can remove people.' using errcode = '42501';
  end if;
  if target = (select auth.uid()) then
    raise exception 'You cannot remove yourself.' using errcode = '42501';
  end if;
  delete from auth.users where id = target;
  if not found then
    raise exception 'That account no longer exists.' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.remove_member(uuid) from public, anon;
grant execute on function public.remove_member(uuid) to authenticated;
