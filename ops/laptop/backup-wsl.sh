#!/bin/bash
# Runs the official CLI-generated read-only pg_dump scripts inside a PG17 client.
set -euo pipefail
base='/mnt/c/Paimon Dayo/TUAT_TF/.contingency'
backup="/opt/tuat-tf-supabase/backups/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0700 "$backup"
for part in roles schema data; do
  test -f "$base/$part-dump-command.sh"
  docker run --rm -i --entrypoint bash supabase/postgres:17.6.1.136 < "$base/$part-dump-command.sh" > "$backup/$part.sql"
  test -s "$backup/$part.sql"
done
grep -q 'COPY "auth"\."users" ' "$backup/data.sql" || { echo 'Auth users missing: backup is incomplete'; exit 1; }
bash "$base/../ops/laptop/backup-managed-schema-wsl.sh" "$backup"
printf '%s\n' "$backup" > /opt/tuat-tf-supabase/latest-backup-path
printf 'Backup complete: %s\n' "$backup"
