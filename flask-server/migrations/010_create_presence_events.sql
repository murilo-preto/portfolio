-- Every enter/exit event a phone reported, kept indefinitely for now. It is the
-- trail for "why did my timer stop at 14:02", and the raw material if routines
-- are ever learned rather than configured. It records which place and when,
-- never coordinates.
--
-- client_event_id is generated on the phone, once per event. The app queues
-- events while offline and resends a batch it cannot confirm was received, so
-- the same event can arrive twice. The UNIQUE key makes the second insert fail
-- and is the whole of the duplicate protection. It is scoped per user, not per
-- device, because device_id can become NULL.
--
-- occurred_at is the phone's time for the event, in UTC like every other
-- DATETIME here. Android delivers geofence transitions late and the queue can
-- hold them for hours, so received_at is not when it happened.
--
-- Every FK either cascades or nulls: no RESTRICT, so nothing on the users
-- cascade path can refuse and make an account undeletable. Deleting a place
-- deletes what was recorded at it.
CREATE TABLE IF NOT EXISTS presence_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  user_id INT UNSIGNED NOT NULL,
  place_id INT UNSIGNED NOT NULL,
  device_id INT UNSIGNED NULL,

  client_event_id CHAR(36) NOT NULL,
  kind ENUM('enter', 'exit') NOT NULL,
  occurred_at DATETIME NOT NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uk_presence_events_client_id (user_id, client_event_id),
  KEY idx_presence_events_place_time (place_id, occurred_at),

  CONSTRAINT fk_presence_events_user
    FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,

  CONSTRAINT fk_presence_events_place
    FOREIGN KEY (place_id)
    REFERENCES places (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,

  CONSTRAINT fk_presence_events_device
    FOREIGN KEY (device_id)
    REFERENCES devices (id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB;
