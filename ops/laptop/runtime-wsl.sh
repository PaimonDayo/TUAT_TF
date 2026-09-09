#!/bin/sh
# Invoke from PowerShell: wsl -d Ubuntu -u root -- sh <this-file> status|start|stop
set -eu
cd /opt/tuat-tf-supabase
set -- "${1:-status}"
compose() {
  if [ -f compose.auth.json ]; then
    docker compose -p tuat-contingency -f docker-compose.yml -f compose.local.yml -f compose.rehearsal.yml -f compose.auth.json "$@"
  else
    docker compose -p tuat-contingency -f docker-compose.yml -f compose.local.yml -f compose.rehearsal.yml "$@"
  fi
}
case "${1:-status}" in
  start) compose up -d --wait --wait-timeout 180 ;;
  stop) compose stop ;;
  status) compose ps ;;
  *) echo 'Expected status, start or stop'; exit 1 ;;
esac
