
CREATE DATABASE IF NOT EXISTS time_tracker
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE time_tracker;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(100) NOT NULL,
  pwd_hash VARBINARY(72) NOT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uk_users_username (username)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS category (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uk_category_name (name)
) ENGINE=InnoDB;

INSERT INTO category (name) VALUES
  ('Reading'),
  ('Work'),
  ('Study'),
  ('Exercise');

CREATE TABLE IF NOT EXISTS time_entries (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,

  user_id INT UNSIGNED NOT NULL,
  category_id INT UNSIGNED NOT NULL,

  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,

  PRIMARY KEY (id),

  KEY idx_time_entries_user (user_id),
  KEY idx_time_entries_category (category_id),

  CONSTRAINT fk_time_entries_user
    FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,

  CONSTRAINT fk_time_entries_category
    FOREIGN KEY (category_id)
    REFERENCES category (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT chk_time_range
    CHECK (end_time > start_time)
) ENGINE=InnoDB;
