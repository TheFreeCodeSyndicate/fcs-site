-- 013_other_links.sql
-- Social links can be "other": any site, shown with that site's own icon.
alter table public.social_links drop constraint if exists social_links_platform_check;
alter table public.social_links
  add constraint social_links_platform_check
  check (platform in ('discord','instagram','whatsapp','github','x','web','other'));
