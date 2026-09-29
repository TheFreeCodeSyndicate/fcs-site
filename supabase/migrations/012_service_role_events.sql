-- 012_service_role_events.sql
-- The event-mail Edge Function reads events (for the email's event box)
-- with the service role. This project does not grant tables to
-- service_role by default, so confirm and unsubscribe links failed with
-- "This link has already been used". Read-only on purpose.
grant select on public.events to service_role;
