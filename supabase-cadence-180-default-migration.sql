-- Default follow-up cadence change: 60 → 180 days
--
-- Two SQL statements. The first is REQUIRED so future direct-DB inserts
-- (anything not going through /api/contacts) get the new default. The
-- second is OPTIONAL — only run it if you want to bulk-bump every
-- existing contact whose cadence is still the old default of 60.

-- 1. REQUIRED — change the column default for new rows
alter table contacts alter column follow_up_cadence_days set default 180;

-- 2. OPTIONAL — bulk-update existing contacts currently on the old 60-day default.
--    Skip if you'd rather keep historical contacts on their existing cadences.
-- update contacts set follow_up_cadence_days = 180 where follow_up_cadence_days = 60;
