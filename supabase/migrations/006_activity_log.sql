-- ====================================================================
-- 006_activity_log.sql
-- --------------------------------------------------------------------
-- Who changed what, and when. Written by database triggers, so every
-- change is recorded no matter which page, script or person made it.
--
-- * create / update / delete / restore on every content table, plus
--   role changes on profiles;
-- * updates list the fields that changed; reorder-only updates
--   (sort_order) are skipped as noise;
-- * a delete keeps a full snapshot of the row, which is what lets the
--   admin panel offer Undo and a Trash with Restore, with no changes to
--   the content tables themselves. Re-inserting the snapshot with its
--   original id is logged as 'restore'.
--
-- Readable by editors and admins only. Nobody can write to it directly:
-- the API roles get SELECT and nothing else, and only the trigger
-- (SECURITY DEFINER, in the unexposed private schema) inserts.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ====================================================================

create table if not exists public.activity_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor_email text,
  action      text not null check (action in ('create','update','delete','restore')),
  table_name  text not null,
  row_id      text not null,
  row_label   text,
  changed     text[] not null default '{}',
  snapshot    jsonb
);

create index if not exists activity_log_row_idx on public.activity_log (table_name, row_id, at desc);
create index if not exists activity_log_at_idx  on public.activity_log (at desc);

alter table public.activity_log enable row level security;
revoke all on public.activity_log from anon, authenticated;
grant select on public.activity_log to authenticated;

drop policy if exists "editors read the log" on public.activity_log;
create policy "editors read the log" on public.activity_log for select to authenticated
  using ((select private.current_role()) in ('admin','editor'));

create or replace function private.log_activity()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  rec   jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  prev  jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  key   text  := coalesce(rec ->> 'id', rec ->> 'repo_name');
  label text  := coalesce(rec ->> 'title', rec ->> 'name', rec ->> 'label',
                          rec ->> 'repo_name', rec ->> 'email');
  cols  text[] := '{}';
  act   text;
  who   uuid  := auth.uid();
begin
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(n.k order by n.k), '{}') into cols
    from jsonb_each(rec) as n(k, v)
    where n.k not in ('updated_at', 'created_at', 'sort_order')
      and n.v is distinct from prev -> n.k;
    if cardinality(cols) = 0 then
      return null; -- only the order changed
    end if;
    act := 'update';
  elsif tg_op = 'INSERT' then
    act := case when exists (
      select 1 from public.activity_log l
      where l.table_name = tg_table_name and l.row_id = key and l.action = 'delete'
    ) then 'restore' else 'create' end;
  else
    act := 'delete';
  end if;

  insert into public.activity_log
    (actor_id, actor_email, action, table_name, row_id, row_label, changed, snapshot)
  values
    (who, (select p.email from public.profiles p where p.id = who), act, tg_table_name,
     key, label, cols, case when tg_op = 'DELETE' then rec end);
  return null;
end;
$$;

revoke execute on function private.log_activity() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['events','class_sessions','resources','study_groups',
                           'social_links','core_members','repo_kinds','profiles']
  loop
    execute format('drop trigger if exists log_activity on public.%1$I', t);
    execute format('create trigger log_activity after insert or update or delete on public.%1$I
                      for each row execute function private.log_activity()', t);
  end loop;
end $$;
