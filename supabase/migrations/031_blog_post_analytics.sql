-- 031: one post's numbers for the editor's Analytics tab, as in Notion:
-- views and unique visitors per day, totals, reading time and where readers
-- came from. Counts only, never visitor rows; admins and editors only.

create or replace function public.blog_post_analytics(post_slug text, days int default 28, tz text default 'UTC')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  since timestamptz := date_trunc('day', now() at time zone tz) at time zone tz - make_interval(days => greatest(1, least(days, 365)) - 1);
  result jsonb;
begin
  if (select private.current_role()) not in ('admin', 'editor') then
    raise exception 'Only admins and editors can see post analytics.' using errcode = '42501';
  end if;

  with views as (
    select v.at, v.visitor, v.engaged_ms, v.referrer_host
      from public.analytics_pageviews v
     where v.path like '%/blog/' || post_slug || '/' and v.at >= since
  ),
  days_list as (
    select generate_series(date_trunc('day', since at time zone tz), date_trunc('day', now() at time zone tz), interval '1 day')::date as day
  )
  select jsonb_build_object(
    'since', since,
    'views', (select count(*) from views),
    'visitors', (select count(distinct visitor) from views),
    'avg_engaged_ms', (select coalesce(round(avg(engaged_ms)), 0) from views where engaged_ms > 0),
    'daily', (select jsonb_agg(jsonb_build_object('day', d.day, 'views', coalesce(c.views, 0), 'visitors', coalesce(c.visitors, 0)) order by d.day)
                from days_list d
                left join (select (at at time zone tz)::date as day, count(*) as views, count(distinct visitor) as visitors from views group by 1) c on c.day = d.day),
    'referrers', (select coalesce(jsonb_agg(jsonb_build_object('host', r.host, 'views', r.n) order by r.n desc), '[]'::jsonb)
                    from (select coalesce(nullif(referrer_host, ''), 'Direct') as host, count(*) as n from views group by 1 order by 2 desc limit 5) r)
  ) into result;
  return result;
end;
$$;

revoke execute on function public.blog_post_analytics(text, int, text) from public, anon;
grant execute on function public.blog_post_analytics(text, int, text) to authenticated;
