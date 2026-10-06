-- ====================================================================
-- 023_blog_page_look.sql
-- --------------------------------------------------------------------
-- The Notion-style post page: an icon beside the title and a cover
-- that can be repositioned.
--
-- * icon: an emoji, "icon:<name>" for one of the site's own icons
--   (assets/icons.svg), or an https:// image address.
-- * cover_position: where the cover image is anchored vertically,
--   0 (top) to 100 (bottom); 50 is centred.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ====================================================================

alter table public.blog_posts
  add column if not exists icon text
    check (icon is null or (length(icon) <= 500 and (icon ~ '^icon:[a-z0-9-]+$' or icon ~* '^https://\S+$' or length(icon) <= 16))),
  add column if not exists cover_position smallint not null default 50
    check (cover_position between 0 and 100);
