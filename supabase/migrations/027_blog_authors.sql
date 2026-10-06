-- ====================================================================
-- 027_blog_authors.sql
-- --------------------------------------------------------------------
-- Several authors per post, shown as an avatar group.
--
-- * blog_posts.authors: [{ "id"?, "name", "avatar"?, "url"? }, ...]. A copy
--   of each author's name and picture, so the public page (which cannot
--   read profiles) can show them. "id" is the profile id for club members;
--   guest authors have none. author_name stays, as the names joined, for
--   link previews and older code.
-- * blog_authors(): the people who can be picked, which is every admin and
--   editor, with the photo and link of the core member who has the same
--   email (their uploaded photo, else their GitHub avatar). Callable by
--   editors and admins only.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ====================================================================

alter table public.blog_posts
  add column if not exists authors jsonb not null default '[]'::jsonb
    check (jsonb_typeof(authors) = 'array' and jsonb_array_length(authors) <= 12);

-- Posts written before this keep their author as a guest name.
update public.blog_posts
   set authors = jsonb_build_array(jsonb_build_object('name', author_name))
 where author_name is not null and author_name <> '' and authors = '[]'::jsonb;

create or replace function public.blog_authors()
returns table (id uuid, name text, avatar text, url text, role text)
language sql stable security definer
set search_path = ''
as $$
  select p.id,
         coalesce(nullif(trim(p.display_name), ''), m.name, split_part(p.email, '@', 1)) as name,
         coalesce(m.photo_url,
                  case when m.github_username is not null then 'https://github.com/' || m.github_username || '.png?size=96' end) as avatar,
         coalesce(case when m.github_username is not null then 'https://github.com/' || m.github_username end,
                  m.website_url, m.linkedin_url) as url,
         p.role
    from public.profiles p
    left join lateral (
      select * from public.core_members c
       where c.email is not null and lower(c.email) = lower(p.email)
       order by c.status = 'active' desc
       limit 1
    ) m on true
   where p.role in ('admin', 'editor')
     and (select private.current_role()) in ('admin', 'editor')
   order by 2;
$$;

revoke execute on function public.blog_authors() from public, anon;
grant execute on function public.blog_authors() to authenticated;
