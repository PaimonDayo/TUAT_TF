#!/bin/sh
# Invoke from PowerShell: wsl -d Ubuntu -u root -- sh <this-file> status|start|stop
set -eu
cd /opt/tuat-tf-supabase
action=${1:-status}
deadline_seconds=${2:-420}
compose() {
  if [ -f compose.auth.json ]; then
    docker compose -p tuat-contingency -f docker-compose.yml -f compose.local.yml -f compose.rehearsal.yml -f compose.auth.json "$@"
  else
    docker compose -p tuat-contingency -f docker-compose.yml -f compose.local.yml -f compose.rehearsal.yml "$@"
  fi
}

# Wait until every container is running and (if it has a healthcheck) healthy.
#
# `compose up --wait` gives up the moment a container reports unhealthy, and on a
# cold boot that happens for real: the stack lives on the external HDD, so storage
# and others fail their first checks while the database is still coming up, then
# recover a minute later. On 2026-09-21 the PC rebooted overnight and two start
# attempts in a row were thrown away this way, leaving the relay unstarted.
# Watch whether they actually recover instead of treating the first dip as fatal.
wait_for_health() {
  deadline=$(( $(date +%s) + $1 ))
  while :; do
    pending=''
    for id in $(compose ps -aq); do
      info=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.Name}}' "$id")
      state=$(echo "$info" | cut -d' ' -f1)
      health=$(echo "$info" | cut -d' ' -f2)
      name=$(echo "$info" | cut -d' ' -f3 | sed 's|^/||')
      if [ "$state" != running ] || { [ "$health" != none ] && [ "$health" != healthy ]; }; then
        pending="$pending $name($state/$health)"
      fi
    done
    [ -z "$pending" ] && return 0
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "Still not ready after ${1}s:$pending"
      return 1
    fi
    sleep 5
  done
}

case "$action" in
  start)
    if compose up -d --wait --wait-timeout 180; then exit 0; fi
    echo 'The health wait gave up early; watching whether the containers recover.'
    wait_for_health "$deadline_seconds"
    ;;
  wait) wait_for_health "$deadline_seconds" ;;
  stop) compose stop ;;
  status) compose ps ;;
  *) echo 'Expected status, start, stop or wait'; exit 1 ;;
esac
