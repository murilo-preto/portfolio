#!/bin/bash
# Encrypted backup of the production database, run on the server:
#
#   ./deploy/backup-db.sh            writes ~/backups/portfolio-<UTC time>.sql.age
#
# The dump is streamed straight into age, encrypted to BACKUP_AGE_RECIPIENT (a
# public key, in .env), so no unencrypted copy ever touches the server's disk.
# The matching private key lives only on the laptop, never on the server: the
# server can write backups but cannot read them, and neither can anyone who
# copies them off it.
#
# Setup, once:
#   laptop:  age-keygen -o ~/.namu-keys/backup.agekey   (prints "Public key: age1...")
#   server:  sudo apt install age; put BACKUP_AGE_RECIPIENT=age1... in .env
#
# Restore, from the laptop (the private key never leaves it):
#   ssh guaratuba cat ~/backups/portfolio-<time>.sql.age \
#     | age -d -i ~/.namu-keys/backup.agekey \
#     | ssh guaratuba 'docker exec -i portfolio-mysql-1 sh -c \
#         "mysql -u\"\$MYSQL_USER\" -p\"\$MYSQL_PASSWORD\" \"\$MYSQL_DATABASE\""'

set -euo pipefail

cd "$(dirname "$0")/.."

RECIPIENT=$(grep -E '^BACKUP_AGE_RECIPIENT=' .env | tail -1 | cut -d= -f2- || true)
if [[ "$RECIPIENT" != age1* ]]; then
    echo "Set BACKUP_AGE_RECIPIENT=age1... in .env (see the comment at the top)." >&2
    exit 1
fi
command -v age > /dev/null || { echo "age is not installed: sudo apt install age" >&2; exit 1; }

MYSQL=$(docker ps --filter name=portfolio-mysql --format '{{.Names}}' | head -1)
[ -n "$MYSQL" ] || { echo "The MySQL container is not running." >&2; exit 1; }

mkdir -p ~/backups
chmod 700 ~/backups
OUT=~/backups/portfolio-$(date -u +%Y%m%dT%H%M%SZ).sql.age
PARTIAL="$OUT.partial"
trap 'rm -f "$PARTIAL"' EXIT

# --single-transaction: a consistent snapshot without locking the tables.
docker exec "$MYSQL" sh -c \
    'exec mysqldump --single-transaction --routines --no-tablespaces \
       -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' \
    | age -r "$RECIPIENT" > "$PARTIAL"

chmod 600 "$PARTIAL"
mv "$PARTIAL" "$OUT"
trap - EXIT
echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"
