-- ====================================================================
-- 024_blog_icon_colors.sql
-- --------------------------------------------------------------------
-- A pixel icon can carry a colour: "icon:<name>:<colour>", e.g.
-- "icon:heart:red" (the editor offers Notion's ten colours).
--
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ====================================================================

alter table public.blog_posts drop constraint if exists blog_posts_icon_check;
alter table public.blog_posts add constraint blog_posts_icon_check
  check (icon is null or (length(icon) <= 500 and (
    icon ~ '^icon:[a-z0-9-]+(:[a-z]+)?$' or icon ~* '^https://\S+$' or length(icon) <= 16)));
