-- `todo_categories` was global, and GET /todo/categories served it without a
-- token. Same shape as 004, including the four defaults seeded back per user:
-- schema.sql:110 writes Personal/Work/Study/Shopping for the installation, this
-- migration removes those unowned rows and gives every existing account its own
-- copy, and registration seeds them for accounts created from here on.
--
-- See 004's header for why the statement order is forced by ON DELETE RESTRICT,
-- why the name-only unique has to be dropped before the clones go in, and why
-- user_id carries no foreign key to users.

ALTER TABLE todo_categories
  ADD COLUMN user_id INT UNSIGNED NULL AFTER id;

ALTER TABLE todo_categories
  DROP INDEX uk_todo_category_name;

INSERT INTO todo_categories (user_id, name)
SELECT DISTINCT ti.user_id, tc.name
FROM todo_items ti
JOIN todo_categories tc ON tc.id = ti.category_id
WHERE tc.user_id IS NULL;

UPDATE todo_items ti
JOIN todo_categories old_c ON old_c.id = ti.category_id AND old_c.user_id IS NULL
JOIN todo_categories new_c ON new_c.user_id = ti.user_id AND new_c.name = old_c.name
SET ti.category_id = new_c.id;

DELETE FROM todo_categories WHERE user_id IS NULL;

ALTER TABLE todo_categories
  MODIFY COLUMN user_id INT UNSIGNED NOT NULL;

ALTER TABLE todo_categories
  ADD UNIQUE KEY uk_todo_category_user_name (user_id, name);

INSERT IGNORE INTO todo_categories (user_id, name)
SELECT u.id, d.name
FROM users u
CROSS JOIN (
  SELECT 'Personal' AS name
  UNION ALL SELECT 'Work'
  UNION ALL SELECT 'Study'
  UNION ALL SELECT 'Shopping'
) d;
