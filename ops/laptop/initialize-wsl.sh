#!/bin/sh
set -eu
[ "$(id -u)" = 0 ] || exit 1
source_dir='/mnt/c/Paimon Dayo/TUAT_TF/.contingency/runtime'
runtime_dir='/opt/tuat-tf-supabase'
if [ -e "$runtime_dir" ]; then echo 'Runtime already exists; preserving it'; exit 1; fi
install -d -m 0700 "$runtime_dir"
cp -a "$source_dir/." "$runtime_dir/"
cd "$runtime_dir"
cp .env.example .env
chmod 600 .env
# Official generators print secrets: suppress stdout rather than exposing it in logs.
sh utils/generate-keys.sh --update-env >/dev/null
sh utils/add-new-auth-keys.sh --update-env >/dev/null
sed -i 's|^SITE_URL=.*|SITE_URL=http://localhost:3008|; s|^ADDITIONAL_REDIRECT_URLS=.*|ADDITIONAL_REDIRECT_URLS=http://localhost:3008/auth/callback|; s|^API_EXTERNAL_URL=.*|API_EXTERNAL_URL=http://localhost:8000|; s|^SUPABASE_PUBLIC_URL=.*|SUPABASE_PUBLIC_URL=http://localhost:8000|' .env
chmod 600 .env .env.old
# Separate local-only restore rehearsal from later externally connected operation.
cat > compose.rehearsal.yml <<'YAML'
networks:
  default:
    internal: true
  local_gateway: {}
services:
  api-gw:
    networks:
      default: {}
      local_gateway: {}
  db:
    ports: !reset []
    command:
      - postgres
      - -c
      - config_file=/etc/postgresql/postgresql.conf
      - -c
      - cron.launch_active_jobs=off
  auth:
    image: supabase/gotrue:v2.196.0
  storage:
    image: supabase/storage-api:v1.73.1
YAML
printf '%s\n' 'Local runtime prepared with fresh secrets and isolated rehearsal network.'
