-- `category` was global: one row per name for the whole installation, UNIQUE on
-- the name alone. GET /get/categories served that list to anyone, without a
-- token, and Flask's port is published -- so every user's category names were
-- readable by any caller who could reach it.
--
-- Every category gets an owner. Existing rows are shared, so each is cloned once
-- per user who actually has an entry in it, the entries are repointed at their
-- own copy, and the now-unreferenced originals are dropped. That includes
-- schema.sql's four seed rows, which belong to nobody: a fresh volume writes
-- them and this migration immediately removes them, so a fresh database and an
-- existing one converge. Every user is then given the four defaults back, so no
-- account is left with an empty picker. New accounts get them at registration.
--
-- Order is forced by fk_time_entries_category being ON DELETE RESTRICT: the
-- originals cannot go until nothing points at them. The old UNIQUE on name alone
-- must go before the clones are inserted, or the second user's "Work" collides
-- with the first's. Dropping it is safe -- the FK references category(id), not
-- this index. Because that index was utf8mb4_unicode_ci, no two existing names
-- can collide under the new (user_id, name) index either, so the clone insert
-- needs no dedup beyond DISTINCT.
--
-- An unowned category with no entries at all cannot be attributed to anyone --
-- nothing in the schema records who created it -- so it is dropped rather than
-- copied to every user, which would reproduce the disclosure this closes.
--
-- user_id carries no foreign key to users, deliberately. A cascade from users
-- would reach both `category` and `time_entries`, and InnoDB picks the order:
-- measured on MySQL 8.0.46, it takes `category` first and the RESTRICT from the
-- not-yet-deleted entries aborts the whole delete with errno 1451, making any
-- user who owns both entries and categories permanently undeletable. The
-- composite UNIQUE below indexes user_id as its leftmost column, so lookups do
-- not need a separate key. The cost is that deleting a user leaves their
-- lookup rows behind; nothing in the app deletes users today, and whatever adds
-- that must clear these tables first.
--
-- This file is all-or-nothing by intent, against the one-statement-per-file
-- preference in README.md. The steps are mutually dependent -- dropping the old
-- unique without adding the new one, or deleting originals before entries are
-- repointed, leaves the database worse than it started -- so splitting them
-- would only manufacture intermediate states that look resumable and are not.

ALTER TABLE category
  ADD COLUMN user_id INT UNSIGNED NULL AFTER id;

ALTER TABLE category
  DROP INDEX uk_category_name;

INSERT INTO category (user_id, name)
SELECT DISTINCT te.user_id, c.name
FROM time_entries te
JOIN category c ON c.id = te.category_id
WHERE c.user_id IS NULL;

UPDATE time_entries te
JOIN category old_c ON old_c.id = te.category_id AND old_c.user_id IS NULL
JOIN category new_c ON new_c.user_id = te.user_id AND new_c.name = old_c.name
SET te.category_id = new_c.id;

DELETE FROM category WHERE user_id IS NULL;

ALTER TABLE category
  MODIFY COLUMN user_id INT UNSIGNED NOT NULL;

ALTER TABLE category
  ADD UNIQUE KEY uk_category_user_name (user_id, name);

INSERT IGNORE INTO category (user_id, name)
SELECT u.id, d.name
FROM users u
CROSS JOIN (
  SELECT 'Reading' AS name
  UNION ALL SELECT 'Work'
  UNION ALL SELECT 'Study'
  UNION ALL SELECT 'Exercise'
) d;
