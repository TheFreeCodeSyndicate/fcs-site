-- ====================================================================
-- 033_blog_source_url.sql
-- --------------------------------------------------------------------
-- Where an imported post came from. Set by the Medium importer
-- (supabase/functions/medium-import) and null for everything written by
-- hand. It is kept whether or not the writer includes the visible
-- "Originally published on Medium" line, so the record of provenance
-- does not depend on the body text.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ====================================================================

alter table public.blog_posts
  add column if not exists source_url text
    check (source_url is null or source_url ~* '^https://\S+$');
