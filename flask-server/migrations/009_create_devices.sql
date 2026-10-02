-- Phones paired to an account, for the Panopto app. A geofence event arrives
-- from the phone's background task, with no browser session and no cookie, so
-- each phone gets its own long-lived credential instead.
--
-- Only a SHA-256 of the token is stored. bcrypt, as for passwords, would be
-- wrong here: the token is 32 random bytes, so there is nothing to slow down
-- guessing of, and every request has to find its device by the hash, which an
-- index can do for SHA-256 and cannot for a salted hash.
--
-- Revoking sets revoked_at rather than deleting the row, so past events can
-- still say which phone sent them. last_seen_at lets the UI show a phone that
-- has silently stopped reporting (Android battery savers do this).
CREATE TABLE IF NOT EXISTS devices (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,

  user_id INT UNSIGNED NOT NULL,

  name VARCHAR(100) NOT NULL,
  token_hash BINARY(32) NOT NULL,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NULL,
  revoked_at DATETIME NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uk_devices_token_hash (token_hash),
  KEY idx_devices_user (user_id),

  CONSTRAINT fk_devices_user
    FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB;
