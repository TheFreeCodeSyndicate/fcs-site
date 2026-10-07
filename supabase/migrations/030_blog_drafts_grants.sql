-- 030: the grants 029 first shipped without (this project grants nothing
-- by default), so autosave and version history were refused. Same lines
-- as the end of 029; harmless to run twice.
grant select, insert, update, delete on public.blog_drafts to authenticated;
grant select, insert on public.blog_versions to authenticated;
