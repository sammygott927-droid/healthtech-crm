-- Daily Briefs v2 — per-article rows with numeric scores
-- Run this in Supabase SQL Editor. DESTRUCTIVE: drops the old table.
-- Back up any data you want to keep from daily_briefs before running.

drop table if exists daily_briefs;

create table daily_briefs (
  id uuid default gen_random_uuid() primary key,
  headline text not null,
  source_url text,
  source_name text,
  pub_date text,                           -- original pubDate string from RSS
  so_what text,                            -- 1-2 sentence "why this matters"
  relevance_tag text,                      -- e.g. "Matches tag: value-based care"
  relevance_score integer not null default 0,  -- 1-10
  contact_match_score integer,             -- 1-10, null if no contact match
  contact_id uuid references contacts(id) on delete set null,
  contact_match_reason text,               -- one-line "why relevant to them"
  draft_email text,                        -- full draft email, null for no-match
  signal_boost integer not null default 0, -- +3 for funding/M&A/regulatory etc.
  status text default 'New' check (status in ('New', 'Sent', 'Dismissed')),
  created_at timestamptz default now()
);

alter table daily_briefs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'daily_briefs' and policyname = 'Allow all on daily_briefs'
  ) then
    create policy "Allow all on daily_briefs" on daily_briefs for all using (true) with check (true);
  end if;
end $$;

-- Index for the two main query patterns (brief tab + actions tab)
create index if not exists idx_daily_briefs_created_relevance
  on daily_briefs (created_at desc, relevance_score desc);

create index if not exists idx_daily_briefs_created_contact_match
  on daily_briefs (created_at desc, contact_match_score desc nulls last);
