-- ====================================================================
-- 026_blog_font_garet.sql
-- --------------------------------------------------------------------
-- Garet, the brand guide's digital and social typeface, joins the post
-- fonts in the editor's "..." menu.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ====================================================================

alter table public.blog_posts drop constraint if exists blog_posts_font_check;
alter table public.blog_posts add constraint blog_posts_font_check
  check (font in ('default', 'mono', 'technical', 'garet'));
