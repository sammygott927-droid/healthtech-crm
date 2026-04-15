-- HealthTech CRM Database Schema
-- Run this in Supabase SQL Editor (supabase.com > your project > SQL Editor)

-- 1. Contacts table
create table contacts (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  role text check (role in ('Operator', 'Investor', 'Consultant')),
  company text,
  sector text,
  referral_source text,
  status text default 'Active' check (status in ('Active', 'Warm', 'Cold', 'Dormant')),
  next_step text,
  email text,
  phone text,
  follow_up_cadence_days integer default 60,
  last_contact_date date,
  notes_summary text,           -- 1-2 sentence AI summary across all notes
  notes_structured jsonb,       -- Structured AI view: { "How we met": [...], "Areas of interest": [...], ... }
  created_at timestamptz default now()
);

-- If the contacts table already exists, run these migrations instead:
--   alter table contacts add column if not exists notes_summary text;
--   alter table contacts add column if not exists notes_structured jsonb;

-- 2. Notes table
create table notes (
  id uuid default gen_random_uuid() primary key,
  contact_id uuid references contacts(id) on delete cascade not null,
  summary text not null,
  full_notes text,
  created_at timestamptz default now()
);

-- 3. Tags table
create table tags (
  id uuid default gen_random_uuid() primary key,
  contact_id uuid references contacts(id) on delete cascade not null,
  tag text not null,
  source text default 'manual' check (source in ('auto-import', 'auto-note', 'manual')),
  created_at timestamptz default now()
);

-- 4. Daily briefs table
create table daily_briefs (
  id uuid default gen_random_uuid() primary key,
  company text,
  headline text,
  source_url text,
  ai_summary text,
  relevance text check (relevance in ('High', 'Medium', 'Low')),
  draft_email text,
  contact_id uuid references contacts(id) on delete set null,
  status text default 'New' check (status in ('New', 'Sent', 'Dismissed')),
  created_at timestamptz default now()
);

-- 5. Enable Row Level Security (required by Supabase, but allow all for single-user app)
alter table contacts enable row level security;
alter table notes enable row level security;
alter table tags enable row level security;
alter table daily_briefs enable row level security;

create policy "Allow all on contacts" on contacts for all using (true) with check (true);
create policy "Allow all on notes" on notes for all using (true) with check (true);
create policy "Allow all on tags" on tags for all using (true) with check (true);
create policy "Allow all on daily_briefs" on daily_briefs for all using (true) with check (true);
