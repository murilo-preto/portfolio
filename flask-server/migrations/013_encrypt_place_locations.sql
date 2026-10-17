-- Place coordinates move into one encrypted column (see location_crypto.py).
-- A place's latitude and longitude locate someone's home or work to about
-- 10 cm, so they are kept as an AES-256-GCM blob rather than plain numbers.
--
-- The plain columns stay, made nullable, because the rows already there can
-- only be encrypted by Flask, which holds the key: migrations are SQL. Flask
-- converts them at boot, right after the migrations, and clears the plain
-- values (location_crypto.prepare). New rows never fill them. Their CHECK
-- constraints still apply to anything written there, and NULL passes them.
--
-- 64 bytes fits the largest blob: 1 version + 12 nonce + 22 for
-- "-90.000000,-180.000000" + 16 tag = 51.
ALTER TABLE places
  ADD COLUMN location_enc VARBINARY(64) NULL AFTER name,
  MODIFY latitude DECIMAL(9, 6) NULL,
  MODIFY longitude DECIMAL(9, 6) NULL;
