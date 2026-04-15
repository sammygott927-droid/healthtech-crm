-- Watchlist table — Task 3
-- Run this in Supabase SQL Editor once. Idempotent.

create table if not exists watchlist (
  id uuid default gen_random_uuid() primary key,
  company text not null unique,
  sector text,
  reason text,
  auto_added boolean default false,
  created_at timestamptz default now()
);

alter table watchlist enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'watchlist' and policyname = 'Allow all on watchlist'
  ) then
    create policy "Allow all on watchlist" on watchlist for all using (true) with check (true);
  end if;
end $$;
