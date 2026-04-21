-- News sources fixes (21 Apr 2026)
--
-- 1. Update a16z Bio to the canonical Raising Health podcast RSS.
--    Simplecast migrated their platform — the old
--    `raising-health.simplecast.com/episodes/feed` URL now returns HTML
--    instead of RSS. The canonical feed (confirmed via Apple Podcasts
--    lookup + the feed's own itunes:new-feed-url tag) is:
--        https://feeds.simplecast.com/BXDamaKF
--    Run this in Supabase SQL Editor.

update news_sources
   set url = 'https://feeds.simplecast.com/BXDamaKF'
 where name = 'a16z Bio';

-- 2. Add three new health-focused feeds. All three verified 200 OK with
--    the app's User-Agent (InTheLoop/1.0) and return valid RSS.
--    ON CONFLICT (url) DO NOTHING so re-running is safe.

insert into news_sources (name, url) values
  ('Crunchbase News',       'https://news.crunchbase.com/feed/'),
  ('TechCrunch Health',     'https://techcrunch.com/tag/health/feed/'),
  ('Digital Health Today',  'https://digitalhealthtoday.com/feed/')
on conflict (url) do nothing;
