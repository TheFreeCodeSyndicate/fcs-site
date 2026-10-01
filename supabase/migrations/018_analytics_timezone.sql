-- 018_analytics_timezone.sql
-- The report groups hours and days in the viewer's timezone (the admin
-- passes it), so a "day" starts at the viewer's midnight.
drop function if exists public.analytics_report(timestamptz, timestamptz);
create or replace function public.analytics_report(since timestamptz, until timestamptz, tz text default 'UTC')
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
  if tz is null or not exists (select 1 from pg_timezone_names where name = tz) then
    tz := 'UTC';
  end if;
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
           (select count(*) from (select distinct date_trunc('day', p.at, tz), p.visitor from pv p where (p.at >= since) = s.current) d) as visitors,
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
        select date_trunc(bucket, at, tz) as b, count(distinct visitor) as v, count(*) as n
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
    'regions', coalesce((
      select jsonb_agg(x) from (
        select coalesce(timezone, 'unknown') as name, count(distinct session) as sessions
        from pv where at >= since group by 1 order by 2 desc limit 10) x), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(x) from (
        select name, count(*) as count, count(distinct visitor) as visitors
        from public.analytics_events where at >= since and at < until and name <> 'section'
        group by name order by 2 desc) x), '[]'::jsonb),
    'sections', coalesce((
      select jsonb_agg(x) from (
        select label as name, count(distinct session) as sessions
        from public.analytics_events where at >= since and at < until and name = 'section'
        group by label order by 2 desc) x), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke execute on function public.analytics_report(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.analytics_report(timestamptz, timestamptz, text) to authenticated;
