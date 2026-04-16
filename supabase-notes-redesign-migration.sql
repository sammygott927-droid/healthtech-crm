-- Notes redesign migration (Task 1)
-- Adds per-note AI fields so each note becomes its own conversation card.
-- Old summary/full_notes columns remain for back-compat with historical data.
--
-- Run this in Supabase SQL Editor.

alter table notes
  add column if not exists raw_notes text,
  add column if not exists ai_summary text,
  add column if not exists ai_structured jsonb;

-- Make the old required column nullable so the new pipeline can insert rows
-- with only raw_notes set.
alter table notes alter column summary drop not null;

-- For any historical notes that have no raw_notes, backfill from full_notes
-- (or summary) so the conversation-card UI has something to render.
update notes
  set raw_notes = coalesce(full_notes, summary)
  where raw_notes is null;

-- Backfill ai_summary from the old summary field for historical notes so the
-- card renders the AI summary slot immediately (without re-running Claude).
update notes
  set ai_summary = summary
  where ai_summary is null and summary is not null;
