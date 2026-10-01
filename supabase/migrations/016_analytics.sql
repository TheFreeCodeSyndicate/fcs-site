-- ====================================================================
-- 016_analytics.sql
-- --------------------------------------------------------------------
-- First-party, cookie-free analytics for the public site.
--
-- Written only by the `collect` Edge Function (service role). Nobody
-- reads the raw rows over the API: the admin's Analytics page calls
-- analytics_report(), which returns totals and top lists, and only for
-- admins and the editors an admin has granted it to
-- (profiles.can_view_analytics).
--
-- Privacy:
--   visitor   a hash of (a random salt for the day + IP + browser),
--             made in the Edge Function; the IP is never stored, and
--             yesterday's salt is deleted, so hashes cannot be linked
--             across days or reversed.
--   session   random, per browser tab (sessionStorage).
--   is_new    the browser had never visited before (a localStorage flag).
-- Raw rows older than 13 months are deleted nightly.
-- ====================================================================

-- ---- who may see it --------------------------------------------------
alter table public.profiles
  add column if not exists can_view_analytics boolean not null default false;

-- Only an admin may grant or revoke it (people can edit their own row).
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') not in ('anon', 'authenticated') then
    return new;
  end if;

  if new.id is distinct from old.id or new.email is distinct from old.email then
    raise exception 'A profile''s id and email cannot be changed.'
      using errcode = '42501';
  end if;

  if new.can_view_analytics is distinct from old.can_view_analytics
     and private.current_role() <> 'admin' then
    raise exception 'Only an admin can grant or revoke analytics access.'
      using errcode = '42501';
  end if;

  if new.role is distinct from old.role then
    if private.current_role() <> 'admin' then
      raise exception 'Only an admin can change roles.'
        using errcode = '42501';
    end if;
    if old.role = 'admin' and new.role <> 'admin'
       and (select count(*) from public.profiles where role = 'admin') <= 1 then
      raise exception 'There must always be at least one admin.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.can_view_analytics()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.role = 'admin' or (p.role = 'editor' and p.can_view_analytics)
    from public.profiles p where p.id = (select auth.uid())
  ), false);
$$;
revoke execute on function private.can_view_analytics() from public, anon;
grant execute on function private.can_view_analytics() to authenticated;

-- ---- the data --------------------------------------------------------
create table if not exists public.analytics_pageviews (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  view_key      uuid not null unique,
  path          text not null,
  referrer_host text,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  visitor       text not null,
  session       text not null,
  is_new        boolean not null default false,
  device        text,
  timezone      text,
  engaged_ms    integer not null default 0
);
create index if not exists analytics_pageviews_at_idx on public.analytics_pageviews (at);

create table if not exists public.analytics_events (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  name    text not null,
  label   text,
  path    text,
  visitor text not null,
  session text not null
);
create index if not exists analytics_events_at_idx on public.analytics_events (at);

-- The day's salt for visitor hashes. Only the service role touches it.
create table if not exists public.analytics_salts (
  day  date primary key,
  salt text not null default encode(extensions.gen_random_bytes(32), 'hex')
);

alter table public.analytics_pageviews enable row level security;
alter table public.analytics_events enable row level security;
alter table public.analytics_salts enable row level security;
revoke all on public.analytics_pageviews, public.analytics_events, public.analytics_salts from anon, authenticated;
grant select, insert, update, delete on public.analytics_pageviews, public.analytics_events, public.analytics_salts to service_role;

-- ---- the report ------------------------------------------------------
-- One call per range: totals for this period and the one before it (for
-- the change arrows), a time series (hourly for up to 2 days, else
-- daily), and top lists. "Visitors" over several days is the sum of each
-- day's distinct visitors, as in every cookie-free tool: hashes change
-- daily on purpose.
create or replace function public.analytics_report(since timestamptz, until timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  span   interval := until - since;
  prev   timestamptz := since - span;
  bucket text := case when span <= interval '2 days' then 'hour' else 'day' end;
  result jsonb;
begin
  if not (select private.can_view_analytics()) then
    raise exception 'You do not have access to analytics.' using errcode = '42501';
  end if;

  with pv as (
    select * from public.analytics_pageviews where at >= prev and at < until
  ),
  sessions as (
    select session, at >= since as current, count(*) as views, sum(engaged_ms) as engaged,
           bool_or(is_new) as is_new
    from pv group by session, at >= since
  ),
  totals as (
    select current,
           (select count(*) from (select distinct date_trunc('day', p.at), p.visitor from pv p where (p.at >= since) = s.current) d) as visitors,
           count(*) filter (where is_new) as new_sessions,
           sum(views) as pageviews,
           count(*) as sessions,
           round(100.0 * count(*) filter (where views = 1 and engaged < 10000) / nullif(count(*), 0), 1) as bounce_rate,
           round(avg(engaged) / 1000.0, 1) as avg_engaged_s,
           round(avg(views)::numeric, 2) as pages_per_session
    from sessions s group by current
  )
  select jsonb_build_object(
    'bucket', bucket,
    'current', coalesce((select to_jsonb(t) - 'current' from totals t where current), '{}'::jsonb),
    'previous', coalesce((select to_jsonb(t) - 'current' from totals t where not current), '{}'::jsonb),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object('t', b, 'visitors', v, 'pageviews', n) order by b)
      from (
        select date_trunc(bucket, at) as b, count(distinct visitor) as v, count(*) as n
        from pv where at >= since group by 1
      ) s), '[]'::jsonb),
    'pages', coalesce((
      select jsonb_agg(x) from (
        select path as name, count(*) as views, count(distinct visitor) as visitors
        from pv where at >= since group by path order by 2 desc limit 10) x), '[]'::jsonb),
    'referrers', coalesce((
      select jsonb_agg(x) from (
        select coalesce(referrer_host, 'Direct') as name, count(distinct session) as sessions
        from pv where at >= since group by 1 order by 2 desc limit 10) x), '[]'::jsonb),
    'campaigns', coalesce((
      select jsonb_agg(x) from (
        select concat_ws(' / ', utm_source, utm_medium, utm_campaign) as name, count(distinct session) as sessions
        from pv where at >= since and utm_source is not null group by 1 order by 2 desc limit 10) x), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_agg(x) from (
        select coalesce(device, 'unknown') as name, count(distinct session) as sessions
        from pv where at >= since group by 1 order by 2 desc) x), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(x) from (
        select name, count(*) as count, count(distinct visitor) as visitors
        from public.analytics_events where at >= since and at < until group by name order by 2 desc) x), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke execute on function public.analytics_report(timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_report(timestamptz, timestamptz) to authenticated;

-- ---- housekeeping ----------------------------------------------------
create extension if not exists pg_cron;
select cron.unschedule('analytics-cleanup') where exists (select 1 from cron.job where jobname = 'analytics-cleanup');
select cron.schedule('analytics-cleanup', '17 3 * * *', $job$
  delete from public.analytics_pageviews where at < now() - interval '13 months';
  delete from public.analytics_events where at < now() - interval '13 months';
  delete from public.analytics_salts where day < current_date - 1;
$job$);
