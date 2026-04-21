-- Brief category migration
-- Adds a `category` column to daily_briefs so the Command Center Daily
-- Brief tab can group articles by type (Funding / Partnership / Market
-- news / Thought leadership / Regulatory) instead of a flat list.
--
-- Run this in Supabase SQL Editor.

alter table daily_briefs
  add column if not exists category text;

-- Constrain to the 5 allowed values + null. Idempotent re-run.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'daily_briefs_category_check'
  ) then
    alter table daily_briefs
      add constraint daily_briefs_category_check
      check (category is null or category in (
        'funding',
        'partnership',
        'market_news',
        'thought_leadership',
        'regulatory'
      ));
  end if;
end $$;

-- Existing rows have category = null; the UI falls back to keyword-based
-- categorization at read time so historic briefs still render correctly.
