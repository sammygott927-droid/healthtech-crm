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

-- Seed default sources. RSS URLs are best-effort — adjust any that 404 via
-- the Settings UI (delete + add with the correct URL).
--
-- Sources intentionally NOT seeded because they have no public RSS feed
-- (verified Apr 2026 — bespoke Next.js sites or paywalled newsletters):
--   General Catalyst "Stories"   — bespoke site, no RSS
--   Oak HC/FT                    — bespoke site, no RSS
--   Bessemer Atlas               — bespoke site, no RSS
--   Axios Pro Health Tech        — paywalled, no public RSS
-- If any of these start publishing RSS, add them via Settings → News Sources.
--
-- a16z Bio's WordPress feed was removed when they migrated off WP. The best
-- available substitute is their flagship bio+health podcast (Raising Health),
-- whose canonical RSS lives at feeds.simplecast.com/BXDamaKF (the old
-- raising-health.simplecast.com/episodes/feed URL now returns HTML after
-- Simplecast's platform migration).
insert into news_sources (name, url) values
  ('Out-of-Pocket',            'https://outofpocket.substack.com/feed'),
  ('STAT News',                'https://www.statnews.com/feed/'),
  ('Rock Health',              'https://rockhealth.com/feed/'),
  ('Fierce Healthcare',        'https://www.fiercehealthcare.com/rss/xml'),
  ('MedCity News',             'https://medcitynews.com/feed/'),
  ('a16z Bio',                 'https://feeds.simplecast.com/BXDamaKF'),
  ('F-Prime blog',             'https://www.fprimecapital.com/blog/feed/'),
  ('CB Insights Health',       'https://www.cbinsights.com/research/feed/'),
  ('Stratechery',              'https://stratechery.com/feed/'),
  ('John Gannon Blog',         'https://www.johngannonblog.com/feed'),
  ('Crunchbase News',          'https://news.crunchbase.com/feed/'),
  ('TechCrunch Health',        'https://techcrunch.com/tag/health/feed/'),
  ('Digital Health Today',     'https://digitalhealthtoday.com/feed/')
on conflict (url) do nothing;
