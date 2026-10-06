-- 028: each admin/editor links their own login to their core-member card.
-- The link names the blog's authors ("Jyotirmoy Das", not "jyotimoydascse")
-- and gives them a picture. One card per login; only the owner of the login
-- can set or change it, admins included.

alter table public.profiles
  add column if not exists core_member_id uuid unique
    references public.core_members (id) on delete set null;

create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') not in ('anon', 'authenticated') then
    return new;
  end if;

  if new.id is distinct from old.id or new.email is distinct from old.email then
    raise exception 'A profile''s id and email cannot be changed.'
      using errcode = '42501';
  end if;

  if new.core_member_id is distinct from old.core_member_id
     and old.id is distinct from auth.uid() then
    raise exception 'Only the account''s owner can choose its member card.'
      using errcode = '42501';
  end if;

  if new.can_view_analytics is distinct from old.can_view_analytics
     and private.current_role() <> 'admin' then
    raise exception 'Only an admin can grant or revoke analytics access.'
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

-- The chosen card wins; until one is chosen, a card with the same email
-- stands in. `linked` tells the admin panel whether to ask.
drop function if exists public.blog_authors();
create function public.blog_authors()
returns table (id uuid, name text, avatar text, url text, role text, member_id uuid, linked boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id,
         coalesce(m.name, nullif(trim(p.display_name), ''), split_part(p.email, '@', 1)) as name,
         coalesce(m.photo_url, case when m.github_username is not null then 'https://github.com/' || m.github_username || '.png?size=96' end) as avatar,
         coalesce(case when m.github_username is not null then 'https://github.com/' || m.github_username end, m.website_url, m.linkedin_url) as url,
         p.role,
         m.id as member_id,
         p.core_member_id is not null as linked
    from public.profiles p
    left join lateral (
      select * from public.core_members c
       where c.id = p.core_member_id
          or (p.core_member_id is null and c.email is not null and lower(c.email) = lower(p.email))
       order by c.id = p.core_member_id desc nulls last, c.status = 'active' desc
       limit 1
    ) m on true
   where p.role in ('admin', 'editor')
     and (select private.current_role()) in ('admin', 'editor')
   order by 2;
$$;

revoke execute on function public.blog_authors() from public, anon;
grant execute on function public.blog_authors() to authenticated;
