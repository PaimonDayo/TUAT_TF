#!/bin/bash
# Local-only backup and graceful recreation; never removes database volumes.
set -euo pipefail
umask 077
cd /opt/tuat-tf-supabase
install -d -m 0700 backups
backup="backups/before-wifi-$(date -u +%Y%m%dT%H%M%SZ).dump"
test ! -e "$backup"
docker exec supabase-db pg_dump -U supabase_admin -d postgres --format=custom --schema=public --schema=auth --schema=storage > "$backup"
test "$(head -c5 "$backup")" = PGDMP
sha256sum "$backup" > "$backup.sha256"
docker compose -p tuat-contingency -f docker-compose.yml -f compose.local.yml -f compose.rehearsal.yml -f compose.auth.json down --timeout 30
install -m 0600 '/mnt/c/Paimon Dayo/TUAT_TF/.contingency/backend/compose.auth.json' compose.auth.json
echo 'Local backup verified, containers stopped gracefully, volumes preserved, new networking staged.'
