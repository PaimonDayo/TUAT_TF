#!/bin/sh
# Invoke from PowerShell: wsl -d Ubuntu -u root -- sh <this-file> status|start|stop
set -eu
cd /opt/tuat-tf-supabase
case "${1:-status}" in
  start) docker compose -p tuat-contingency -f docker-compose.yml -f compose.local.yml -f compose.rehearsal.yml up -d --wait --wait-timeout 180 ;;
  stop) docker compose -p tuat-contingency -f docker-compose.yml -f compose.local.yml -f compose.rehearsal.yml stop ;;
  status) docker compose -p tuat-contingency -f docker-compose.yml -f compose.local.yml -f compose.rehearsal.yml ps ;;
  *) echo 'Expected status, start or stop'; exit 1 ;;
esac
