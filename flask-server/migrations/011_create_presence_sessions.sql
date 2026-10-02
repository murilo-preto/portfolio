-- The stay in progress: the server-side running timer for the Panopto app.
-- time_entries cannot hold one, since its end_time is NOT NULL and every query
-- assumes a closed interval. A row lives here from "enter" until "exit", when it
-- is deleted and a time entry is written in the same transaction.
--
-- UNIQUE (user_id) means at most one open stay per person. Entering a second
-- place while one is open, through overlapping geofences or a missed exit,
-- closes the first at the moment the second starts, so overlapping places
-- never count the same minutes twice.
--
-- started_at is the entering event's occurred_at, in UTC. Deleting the place
-- discards a stay that is still open there, as it does the place's events.
CREATE TABLE IF NOT EXISTS presence_sessions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,

  user_id INT UNSIGNED NOT NULL,
  place_id INT UNSIGNED NOT NULL,
  device_id INT UNSIGNED NULL,

  started_at DATETIME NOT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uk_presence_sessions_user (user_id),

  CONSTRAINT fk_presence_sessions_user
    FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,

  CONSTRAINT fk_presence_sessions_place
    FOREIGN KEY (place_id)
    REFERENCES places (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,

  CONSTRAINT fk_presence_sessions_device
    FOREIGN KEY (device_id)
    REFERENCES devices (id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB;
