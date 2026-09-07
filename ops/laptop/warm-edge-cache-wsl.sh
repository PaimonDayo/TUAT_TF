#!/bin/sh
# First boot only: fetch the official main service's imports without DB/API secrets.
set -eu
cd /opt/tuat-tf-supabase
name=tuat-edge-cache-warmup
docker run -d --name "$name" --network bridge \
  -v /opt/tuat-tf-supabase/volumes/functions:/home/deno/functions:ro \
  -v tuat-contingency_deno-cache:/root/.cache/deno \
  supabase/edge-runtime:v1.74.0 start --main-service /home/deno/functions/main >/dev/null
trap 'docker stop "$name" >/dev/null; docker rm "$name" >/dev/null' EXIT
attempt=0
until docker logs "$name" 2>&1 | grep -q 'main function started'; do
  attempt=$((attempt + 1))
  [ "$attempt" -le 60 ] || { echo 'Edge dependency download timed out'; exit 1; }
  sleep 2
done
echo 'Official main-service dependencies cached; no application secrets were supplied.'
