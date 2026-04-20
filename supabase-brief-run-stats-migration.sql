-- Brief run stats migration
-- Stores one row per daily brief pipeline run with per-source fetch/filter
-- diagnostics (displayed by the "Show source debug" link on the Daily Brief tab).
--
-- Run this in Supabase SQL Editor.

create table if not exists brief_run_stats (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  stats jsonb not null
);

alter table brief_run_stats enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'brief_run_stats'
      and policyname = 'Allow all on brief_run_stats'
  ) then
    create policy "Allow all on brief_run_stats" on brief_run_stats
      for all using (true) with check (true);
  end if;
end $$;

create index if not exists brief_run_stats_created_at_idx
  on brief_run_stats (created_at desc);
