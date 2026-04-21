-- Watchlist detail page migration (Task 11)
-- Adds optional fields that surface on the /watchlist/[id] detail page:
--   - stage:       funding / company stage (Seed, Series A, Growth, Public, etc.)
--   - description: one-line "what does this company do" blurb
--   - notes:       free-text user notes about the company (investment thesis,
--                  deal history, relevant contacts, etc.)
--
-- Run this in Supabase SQL Editor.

alter table watchlist
  add column if not exists stage text,
  add column if not exists description text,
  add column if not exists notes text;
