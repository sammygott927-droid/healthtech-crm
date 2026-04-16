-- Watchlist Type column migration (Task 5)
-- Adds an enum-style "type" classification to each watchlist row so the
-- daily brief and the watchlist UI can group/filter companies by what
-- kind of organization they are.
--
-- Run this in Supabase SQL Editor.

alter table watchlist
  add column if not exists type text;

-- Constrain to the eight allowed values + null. Add the constraint only
-- if it's not already present (idempotent re-run).
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'watchlist_type_check'
  ) then
    alter table watchlist
      add constraint watchlist_type_check
      check (type is null or type in (
        'Fund',
        'Startup',
        'Growth Stage',
        'Incubator',
        'Health System',
        'Payer',
        'Consulting',
        'Other'
      ));
  end if;
end $$;

-- Index for filter performance once the table grows
create index if not exists watchlist_type_idx on watchlist(type);
