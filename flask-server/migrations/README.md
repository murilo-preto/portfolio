# Schema migrations

Numbered, forward-only SQL files applied once each at Flask boot by
`../migrations.py`. Read that module's docstring first — it is the spec.

## Adding one

1. Create `NNN_short_slug.sql`, taking the next free `NNN`.
2. Write plain DDL/DML, statements separated by `;`. No stored routines or
   triggers.
3. Restart Flask. The runner applies it and records the filename in
   `schema_migrations`.

## Rules

- **Never edit or renumber a file that has shipped.** Applied files are matched
  by name; changing one means it silently never re-runs. Add a new migration.
- **Prefer one statement per file.** MySQL DDL auto-commits and cannot roll
  back, so a multi-statement file that fails halfway leaves a partial change
  behind and is not recorded as applied — the next boot retries it from the
  top.
- **`../../mysql/schema.sql` is the frozen baseline.** Do not edit it to
  reflect a migration. A fresh volume runs schema.sql and then every migration;
  an existing volume runs only what it is missing. Both end up identical.

## Verifying

```bash
docker compose up --build          # watch for "Applying migration ..." in flask logs
docker compose exec mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD" \
  -e "SELECT * FROM $MYSQL_DATABASE.schema_migrations"
```

Test against a volume that already has data, not just a fresh `down -v` — an
existing database is the case migrations exist for.
