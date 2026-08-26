-- A time entry recorded only a category, so a logged block of time could never
-- say what was actually done. `note` is optional free text; rows that predate
-- this migration keep NULL, which the API and UI both render as "no note".
ALTER TABLE time_entries ADD COLUMN note VARCHAR(255) NULL AFTER end_time;
