-- 010_realtime_profiles.sql
-- Publish profiles to Realtime so the panel can sign someone out the
-- moment an admin removes them or pauses their access. RLS still
-- applies: people only receive changes to rows they can read, and a
-- delete event carries nothing but the row's id.
alter publication supabase_realtime add table public.profiles;
