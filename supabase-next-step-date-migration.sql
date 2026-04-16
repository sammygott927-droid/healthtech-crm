-- Edit contact modal migration (Task 2)
-- Adds an optional date column for the "next step" so the edit modal can
-- offer a calendar picker alongside the existing free-text next_step field.
--
-- Run this in Supabase SQL Editor.

alter table contacts
  add column if not exists next_step_date date;
