-- 021_realtime_analytics.sql
-- Publish analytics tables to Realtime so the admin panel can update
-- counts, charts, and diagrams live as visitors view pages and take actions.
alter publication supabase_realtime add table public.analytics_pageviews;
alter publication supabase_realtime add table public.analytics_events;
