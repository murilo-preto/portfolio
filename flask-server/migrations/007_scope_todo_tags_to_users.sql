-- `todo_tags` was global, and GET /todo/tags served it without a token. Tags are
-- free text typed by the user, so the shared list leaked whatever people name
-- their work after -- a client, an employer, a condition.
--
-- Ownership is indirect here, and that is the only structural difference from
-- 004: a tag has no user of its own, so its owner is the owner of the todo items
-- it hangs off, reached through todo_item_tags.
--
-- The hazard is also inverted. In 004 the originals could not be deleted early
-- because fk_time_entries_category is ON DELETE RESTRICT and would refuse. Here
-- fk_todo_item_tags_tag is ON DELETE CASCADE, so deleting an unowned tag would
-- not refuse -- it would silently take the join rows with it and quietly
-- untag every item that used it. The repoint has to come first because nothing
-- will stop it going wrong, not because something will.
--
-- The repoint updates tag_id, which is half of todo_item_tags' PRIMARY KEY. That
-- is safe: names are unique per user, so the old-tag to new-tag mapping is
-- injective within any one item, and every new id is above every old one, so no
-- updated row can collide with one that has not been updated yet.
--
-- No defaults are seeded. schema.sql seeds no tags, and an unattached tag has no
-- owner and no meaning. Autocomplete therefore starts empty for a new account
-- and fills in as they tag things, which is the intended trade.
--
-- See 004's header for why the name-only unique is dropped before the clones go
-- in, and why user_id carries no foreign key to users.

ALTER TABLE todo_tags
  ADD COLUMN user_id INT UNSIGNED NULL AFTER id;

ALTER TABLE todo_tags
  DROP INDEX uk_todo_tags_name;

INSERT INTO todo_tags (user_id, name)
SELECT DISTINCT ti.user_id, t.name
FROM todo_item_tags tit
JOIN todo_items ti ON ti.id = tit.todo_id
JOIN todo_tags t ON t.id = tit.tag_id
WHERE t.user_id IS NULL;

UPDATE todo_item_tags tit
JOIN todo_items ti ON ti.id = tit.todo_id
JOIN todo_tags old_t ON old_t.id = tit.tag_id AND old_t.user_id IS NULL
JOIN todo_tags new_t ON new_t.user_id = ti.user_id AND new_t.name = old_t.name
SET tit.tag_id = new_t.id;

DELETE FROM todo_tags WHERE user_id IS NULL;

ALTER TABLE todo_tags
  MODIFY COLUMN user_id INT UNSIGNED NOT NULL;

ALTER TABLE todo_tags
  ADD UNIQUE KEY uk_todo_tags_user_name (user_id, name);
