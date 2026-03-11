
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

-- Finance categories table
CREATE TABLE IF NOT EXISTS finance_categories (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uk_finance_category_name (name)
) ENGINE=InnoDB;

-- Finance entries table
CREATE TABLE IF NOT EXISTS finance_entries (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,

  user_id INT UNSIGNED NOT NULL,
  category_id INT UNSIGNED NOT NULL,

  product_name VARCHAR(255) NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  purchase_date DATETIME NOT NULL,
  status ENUM('planned', 'done') NOT NULL DEFAULT 'planned',

  PRIMARY KEY (id),

  KEY idx_finance_entries_user (user_id),
  KEY idx_finance_entries_category (category_id),

  CONSTRAINT fk_finance_entries_user
    FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,

  CONSTRAINT fk_finance_entries_category
    FOREIGN KEY (category_id)
    REFERENCES finance_categories (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
) ENGINE=InnoDB;

-- Recurring expenses table
CREATE TABLE IF NOT EXISTS recurring_expenses (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,

  user_id INT UNSIGNED NOT NULL,
  category_id INT UNSIGNED NOT NULL,

  name VARCHAR(255) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  frequency ENUM('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly') NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE DEFAULT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  next_payment_date DATE DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  KEY idx_recurring_expenses_user (user_id),
  KEY idx_recurring_expenses_category (category_id),
  KEY idx_recurring_expenses_active (is_active),

  CONSTRAINT fk_recurring_expenses_user
    FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,

  CONSTRAINT fk_recurring_expenses_category
    FOREIGN KEY (category_id)
    REFERENCES finance_categories (id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
) ENGINE=InnoDB;
