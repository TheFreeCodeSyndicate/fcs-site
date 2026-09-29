-- ====================================================================
-- 007_member_photos.sql
-- --------------------------------------------------------------------
-- Photo upload for core members, instead of pasting a URL.
--
-- * A public Storage bucket, `member-photos`: anyone can view a photo by
--   its URL (the site needs that), nobody can list the bucket.
-- * Images only (webp, png, jpeg), 1 MB per file. The admin panel
--   shrinks photos in the browser before uploading, so this is a
--   ceiling, not a target.
-- * Only editors and admins can upload, replace or delete files.
-- * core_members.photo_thumb_url holds the 24px pixel-art version the
--   admin panel generates at upload time; the site shows it until the
--   full photo develops over it on hover.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ====================================================================

alter table public.core_members
  add column if not exists photo_thumb_url text check (photo_thumb_url ~* '^https?://');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('member-photos', 'member-photos', true, 1048576,
        array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Editors need SELECT to replace or delete their own uploads; the public
-- still reads through the bucket's public URL, which needs no policy.
drop policy if exists "editors read member photos" on storage.objects;
create policy "editors read member photos" on storage.objects for select to authenticated
  using (bucket_id = 'member-photos' and (select private.current_role()) in ('admin','editor'));

drop policy if exists "editors upload member photos" on storage.objects;
create policy "editors upload member photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'member-photos' and (select private.current_role()) in ('admin','editor'));

drop policy if exists "editors update member photos" on storage.objects;
create policy "editors update member photos" on storage.objects for update to authenticated
  using (bucket_id = 'member-photos' and (select private.current_role()) in ('admin','editor'))
  with check (bucket_id = 'member-photos' and (select private.current_role()) in ('admin','editor'));

drop policy if exists "editors delete member photos" on storage.objects;
create policy "editors delete member photos" on storage.objects for delete to authenticated
  using (bucket_id = 'member-photos' and (select private.current_role()) in ('admin','editor'));
