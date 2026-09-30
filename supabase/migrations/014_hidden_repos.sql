-- 014_hidden_repos.sql
-- A repository can be curated as "hidden": left off both Projects and
-- Resources (forks, experiments, archived work).
alter table public.repo_kinds drop constraint if exists repo_kinds_kind_check;
alter table public.repo_kinds
  add constraint repo_kinds_kind_check check (kind in ('project','resource','hidden'));
