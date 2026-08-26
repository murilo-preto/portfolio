-- Real preferences (daily targets, pomodoro durations, todo filters, theme)
-- lived only in the browser's localStorage, so they never followed a user to a
-- second device. This table is their home.
--
-- Shape: one row per user, typed columns for the few settings the *backend*
-- may ever need to reason about (theme, currency), plus a single JSON blob for
-- the client-owned settings. A key/value table was the alternative and was
-- rejected: every read would be a multi-row fetch to rebuild one object, and
-- the blobs here are nested (targets are keyed by category name, pomodoro is a
-- record of four numbers) so they would need flattening and re-nesting anyway.
-- The JSON column keeps the frontend free to add a setting without a migration,
-- while theme/currency stay queryable and constrained.
--
-- `settings` is nullable rather than DEFAULT '{}': a JSON column's default
-- needs an expression default (MySQL 8.0.13+), and the API already treats a
-- missing row *or* a NULL blob as "all defaults", so nullable costs nothing.
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id INT UNSIGNED NOT NULL,

  theme VARCHAR(16) NOT NULL DEFAULT 'system',
  currency CHAR(3) NOT NULL DEFAULT 'BRL',
  settings JSON NULL,

  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (user_id),

  CONSTRAINT fk_user_preferences_user
    FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,

  CONSTRAINT chk_user_preferences_theme
    CHECK (theme IN ('system', 'light', 'dark'))
) ENGINE=InnoDB;
