-- 032: who took a post's cover photo, for covers from Unsplash: shown as
-- "Photo by <name> on Unsplash" on the post, as Unsplash's API terms ask.
-- { name, url } with an https profile link; null for every other cover.
alter table public.blog_posts
  add column if not exists cover_credit jsonb
    check (cover_credit is null or (jsonb_typeof(cover_credit) = 'object'
      and length(cover_credit ->> 'name') between 1 and 120
      and (cover_credit ->> 'url') ~* '^https://unsplash\.com/\S+$'));
