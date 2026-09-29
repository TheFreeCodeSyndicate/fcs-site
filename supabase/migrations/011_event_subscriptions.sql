-- ====================================================================
-- 011_event_subscriptions.sql
-- --------------------------------------------------------------------
-- Email updates about events.
--
-- subscriptions: one row per (email, list). event_id null is the
--   "all events" list. Visitors sign up through the event-mail Edge
--   Function and count only once they confirm (confirmed_at); admins can
--   add people directly, already confirmed. token is the secret in the
--   confirm and unsubscribe links. Deleting an event deletes its list.
--
-- email_sends: one row per update an admin sent (subject, text, how many
--   got it). Logged to the activity log like any content change.
--
-- Admins only. Visitors and editors cannot read either table; the Edge
-- Function uses the service role for signups, confirms and reading lists.
-- ====================================================================

create table if not exists public.subscriptions (
  id           uuid primary key default gen_random_uuid(),
  email        text not null check (length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  event_id     uuid references public.events(id) on delete cascade,
  token        uuid not null unique default gen_random_uuid(),
  confirmed_at timestamptz,
  added_by     uuid,
  created_at   timestamptz not null default now(),
  constraint subscriptions_email_list unique nulls not distinct (email, event_id)
);
create index if not exists subscriptions_event_idx on public.subscriptions (event_id);
create index if not exists subscriptions_email_idx on public.subscriptions (email);

create table if not exists public.email_sends (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  body          text not null,
  event_id      uuid references public.events(id) on delete set null,
  sent_by_email text,
  recipients    integer not null default 0,
  failed        integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists email_sends_event_idx on public.email_sends (event_id);

alter table public.subscriptions enable row level security;
alter table public.email_sends enable row level security;

revoke all on public.subscriptions, public.email_sends from anon, authenticated;
grant select, insert, delete on public.subscriptions to authenticated;
grant select, insert on public.email_sends to authenticated;
grant select, insert, update, delete on public.subscriptions, public.email_sends to service_role;

drop policy if exists "admins read subscriptions" on public.subscriptions;
create policy "admins read subscriptions" on public.subscriptions for select to authenticated
  using ((select private.current_role()) = 'admin');

drop policy if exists "admins add subscriptions" on public.subscriptions;
create policy "admins add subscriptions" on public.subscriptions for insert to authenticated
  with check ((select private.current_role()) = 'admin' and added_by = (select auth.uid()) and confirmed_at is not null);

drop policy if exists "admins remove subscriptions" on public.subscriptions;
create policy "admins remove subscriptions" on public.subscriptions for delete to authenticated
  using ((select private.current_role()) = 'admin');

-- The Edge Function records each send as the admin who sent it, so the
-- activity log names them.
drop policy if exists "admins record sends" on public.email_sends;
create policy "admins record sends" on public.email_sends for insert to authenticated
  with check ((select private.current_role()) = 'admin');

drop policy if exists "admins read sends" on public.email_sends;
create policy "admins read sends" on public.email_sends for select to authenticated
  using ((select private.current_role()) = 'admin');

-- Sent updates show in the activity log ("sent email ..."). Subscriptions
-- are not logged: the log is readable by editors, and addresses are
-- admin-only.
drop trigger if exists log_activity on public.email_sends;
create trigger log_activity after insert on public.email_sends
  for each row execute function private.log_activity();
