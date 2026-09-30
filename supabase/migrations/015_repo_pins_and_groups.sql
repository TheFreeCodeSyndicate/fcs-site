-- 015_repo_pins_and_groups.sql
-- Repositories can be pinned (shown first under Projects, in sort_order)
-- and linked to a study group (listed on that group's card).
alter table public.repo_kinds
  add column if not exists pinned     boolean not null default false,
  add column if not exists sort_order integer not null default 0,
  add column if not exists group_id   uuid references public.study_groups(id) on delete set null;
create index if not exists repo_kinds_group_idx on public.repo_kinds (group_id);
