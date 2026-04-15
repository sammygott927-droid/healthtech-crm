-- News Sources table — Task 2
-- Run this in Supabase SQL Editor once. Idempotent: uses IF NOT EXISTS and
-- ON CONFLICT DO NOTHING, so re-running is safe.

create table if not exists news_sources (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  url text not null unique,
  created_at timestamptz default now()
);

alter table news_sources enable row level security;

-- Allow-all policy (single-user app, already gated by APP_PASSWORD at the app layer)
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'news_sources' and policyname = 'Allow all on news_sources'
  ) then
    create policy "Allow all on news_sources" on news_sources for all using (true) with check (true);
  end if;
end $$;

-- Seed 14 default sources. RSS URLs are best-effort — adjust any that 404 via
-- the Settings UI (delete + add with the correct URL).
insert into news_sources (name, url) values
  ('Out-of-Pocket',            'https://www.outofpocket.health/blog/rss.xml'),
  ('STAT News',                'https://www.statnews.com/feed/'),
  ('Rock Health',              'https://rockhealth.com/feed/'),
  ('Fierce Healthcare',        'https://www.fiercehealthcare.com/rss/xml'),
  ('MedCity News',             'https://medcitynews.com/feed/'),
  ('a16z Bio',                 'https://a16z.com/feed/'),
  ('General Catalyst blog',    'https://www.generalcatalyst.com/feed'),
  ('F-Prime blog',             'https://www.fprimecapital.com/insights/feed'),
  ('Oak HC/FT blog',           'https://oakhcft.com/feed'),
  ('Bessemer Health',          'https://www.bvp.com/atlas/feed'),
  ('Axios Pro Health Tech',    'https://www.axios.com/newsletters/axios-pro-health-tech/feed'),
  ('CB Insights Health',       'https://www.cbinsights.com/research/feed/'),
  ('Stratechery',              'https://stratechery.com/feed/'),
  ('John Gannon Blog',         'https://www.johngannonblog.com/feed')
on conflict (url) do nothing;
