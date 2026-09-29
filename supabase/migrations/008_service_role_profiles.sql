-- 008_service_role_profiles.sql
-- The invite-member Edge Function reads the caller's role and sets the
-- invitee's role with the service-role key. This project does not grant
-- new tables to service_role by default, so without this every invite
-- failed with "Only admins can invite people."
grant select, update on public.profiles to service_role;
