-- Fix broken news_sources URLs (verified Apr 2026)
--
-- 7 of the 14 seeded RSS URLs returned 404/403 in production. This script
-- updates the 3 that have real working RSS feeds elsewhere and deletes the
-- 4 whose publishers don't ship public RSS at all. Idempotent — safe to
-- re-run.
--
-- Run this in Supabase SQL Editor.

-- ─── Fixes: real working URLs ───────────────────────────────────────
--
-- 1. Out-of-Pocket moved off a custom rss.xml path onto Substack.
update news_sources
   set url = 'https://outofpocket.substack.com/feed'
 where name = 'Out-of-Pocket';

-- 2. a16z deprecated their WordPress feeds when they migrated to a static
--    site. Raising Health (simplecast) is a16z bio+health's flagship
--    content stream and carries a full RSS feed.
update news_sources
   set url = 'https://raising-health.simplecast.com/episodes/feed'
 where name = 'a16z Bio';

-- 3. F-Prime's blog RSS lives under /blog/feed/, not /insights/feed.
update news_sources
   set url = 'https://www.fprimecapital.com/blog/feed/'
 where name = 'F-Prime blog';

-- ─── Removals: publishers with no public RSS ────────────────────────
--
-- These four were all 404/403 and the publishers do not ship a public
-- RSS feed as of Apr 2026. Rather than leave broken rows flooding the
-- "Show source debug" panel with red errors every run, delete them.
-- If any of these start publishing RSS later, add them via Settings.
delete from news_sources where name in (
  'General Catalyst blog',
  'Oak HC/FT blog',
  'Bessemer Health',
  'Axios Pro Health Tech'
);
