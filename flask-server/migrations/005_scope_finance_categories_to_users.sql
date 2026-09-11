-- `finance_categories` was global, and GET /finance/categories served it without
-- a token. This is the namespace where that mattered most: names here are not
-- chosen, they are extracted from bank statement PDFs by /finance/parse-itau-pdf
-- and stored close to verbatim, so the anonymous listing disclosed the line
-- items of other people's statements rather than a tidy set of labels.
--
-- Same shape as 004: clone each shared row once per user who has an entry in it,
-- repoint the entries, drop the unattributable originals, then make user_id
-- mandatory and unique per owner. See 004's header for why the order is forced
-- by ON DELETE RESTRICT, why the old name-only unique has to go first, and why
-- user_id carries no foreign key to users.
--
-- No defaults are seeded. schema.sql seeds no finance categories, and inventing
-- a starter set here would be a product decision rather than a migration.

ALTER TABLE finance_categories
  ADD COLUMN user_id INT UNSIGNED NULL AFTER id;

ALTER TABLE finance_categories
  DROP INDEX uk_finance_category_name;

INSERT INTO finance_categories (user_id, name)
SELECT DISTINCT fe.user_id, fc.name
FROM finance_entries fe
JOIN finance_categories fc ON fc.id = fe.category_id
WHERE fc.user_id IS NULL;

UPDATE finance_entries fe
JOIN finance_categories old_c ON old_c.id = fe.category_id AND old_c.user_id IS NULL
JOIN finance_categories new_c ON new_c.user_id = fe.user_id AND new_c.name = old_c.name
SET fe.category_id = new_c.id;

DELETE FROM finance_categories WHERE user_id IS NULL;

ALTER TABLE finance_categories
  MODIFY COLUMN user_id INT UNSIGNED NOT NULL;

ALTER TABLE finance_categories
  ADD UNIQUE KEY uk_finance_category_user_name (user_id, name);
