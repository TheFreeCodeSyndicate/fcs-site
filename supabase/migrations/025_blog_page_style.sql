-- ====================================================================
-- 025_blog_page_style.sql
-- --------------------------------------------------------------------
-- Page settings from the editor's "..." menu, as in Notion:
--
-- * font: the post's typeface, from the brand guide.
--     default    a readable sans for long reading
--     mono       Archivo Mono, the brand's primary voice
--     technical  Latin Modern Mono, the brand's technical voice
-- * small_text: a smaller body size.
-- * full_width: the page uses the full window width.
-- * locked: the editor opens read-only until someone unlocks it,
--   so a finished post is not changed by accident.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ====================================================================

alter table public.blog_posts
  add column if not exists font text not null default 'default' check (font in ('default', 'mono', 'technical')),
  add column if not exists small_text boolean not null default false,
  add column if not exists full_width boolean not null default false,
  add column if not exists locked boolean not null default false;
