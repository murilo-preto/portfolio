-- Places a user wants their time tracked at: "Work", "Gym". Entering one starts
-- a stay, and leaving it writes a time entry in its category. The Android app
-- downloads them and registers one geofence each. Part of the Panopto feature.
--
-- These are pins the user chose, not a location trail. No coordinates are
-- stored anywhere else: events record which place was entered or left, never
-- where the phone was.
--
-- user_id cascades from users, unlike category's. The trap that rules the FK
-- out there (CLAUDE.md, test_security.py) needs two tables on the cascade path
-- joined by a RESTRICT. fk_places_category is RESTRICT, but category is not on
-- the path, since it has no FK to users at all, so deleting a user deletes
-- their places and stops. Deleting a category a place still uses is refused,
-- the same as one a time entry uses. category_admin has to count places as
-- usage before that can surface as anything but a 500.
--
-- DECIMAL(9,6) is about 10 cm, far finer than any geofence. radius_m is bounded
-- below by what Android geofencing can resolve reliably (about 100 m) and above
-- so a mistyped radius cannot swallow a whole city.
--
-- enabled pauses a place, e.g. on holiday, without losing its settings or its
-- history.
CREATE TABLE IF NOT EXISTS places (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,

  user_id INT UNSIGNED NOT NULL,
  category_id INT UNSIGNED NOT NULL,

  name VARCHAR(100) NOT NULL,
  latitude DECIMAL(9, 6) NOT NULL,
  longitude DECIMAL(9, 6) NOT NULL,
  radius_m SMALLINT UNSIGNED NOT NULL DEFAULT 150,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uk_places_user_name (user_id, name),

  CONSTRAINT fk_places_user
    FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,

  CONSTRAINT fk_places_category
    FOREIGN KEY (category_id)
    REFERENCES category (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT chk_places_latitude
    CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT chk_places_longitude
    CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT chk_places_radius
    CHECK (radius_m BETWEEN 100 AND 2000)
) ENGINE=InnoDB;
