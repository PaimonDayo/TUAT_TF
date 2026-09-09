#!/bin/bash
set -euo pipefail
umask 077
repo='/mnt/c/Paimon Dayo/TUAT_TF'
out='/opt/tuat-tf-supabase/transfer'
install -d -m 0700 "$out"
mode=${1:-inspect-local}
case "$mode" in
  snapshot-local)
    name=${2:-local}; [[ "$name" =~ ^[a-z0-9-]+$ ]] || exit 1
    test ! -e "$out/$name.jsonl"
    docker exec -i supabase-db psql -X -qAt -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < "$repo/ops/laptop/snapshot.sql" > "$out/$name.jsonl"
    printf 'Local snapshot saved: %s\n' "$name" ;;
  install-local-freeze)
    docker exec -i supabase-db psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < "$repo/ops/laptop/freeze-install.sql" >/dev/null
    echo 'Local write gate installed (not activated).' ;;
  inspect-local)
    docker exec supabase-db psql -X -qAt -U supabase_admin -d postgres -c "select extname,extnamespace::regnamespace from pg_extension;"
    ;;
  inspect-cloud|snapshot-cloud|preflight-cloud|freeze-cloud|thaw-cloud|apply-return-cloud)
    # Read only the CLI-produced connection exports; never execute its dump command here.
    source <(sed -n '/^export PG/p' "$repo/.contingency/data-dump-command.sh")
    [[ "$PGHOST" =~ ^[a-z0-9.-]+\.pooler\.supabase\.com$ ]] && [ "$PGPORT" = 5432 ] || exit 1
    export PGSSLMODE=require
    args=(docker run --rm -i --env PGHOST --env PGPORT --env PGUSER --env PGPASSWORD --env PGDATABASE --env PGSSLMODE --entrypoint psql supabase/postgres:17.6.1.136 -X -qAt -v ON_ERROR_STOP=1)
    if [ "$mode" = apply-return-cloud ]; then
      name=${2:-}; [[ "$name" =~ ^return-[0-9]{14}$ ]] || exit 1
      test -f "$out/$name.sql" && test -f "$out/$name.report.json"
      python3 - "$out/$name" <<'PY'
import hashlib,json,pathlib,sys
base=pathlib.Path(sys.argv[1])
report=json.loads(base.with_suffix('.report.json').read_text())
assert hashlib.sha256(base.with_suffix('.sql').read_bytes()).hexdigest()==report['sha256'], 'Return plan checksum mismatch'
PY
      { printf '%s\n' 'SET ROLE postgres;'; cat "$out/$name.sql"; } | "${args[@]}" > "$out/$name-apply.log" 2> "$out/$name-apply-error.log"
      echo 'Return transaction committed. Both write gates remain frozen; verify before thawing.'
    elif [ "$mode" = preflight-cloud ]; then
      printf '%s\n' "SET ROLE postgres; SELECT has_table_privilege(current_user,'auth.users','TRIGGER'),has_table_privilege(current_user,'auth.identities','TRIGGER'); SELECT jobname,schedule,active FROM cron.job;" | "${args[@]}"
    elif [ "$mode" = freeze-cloud ]; then
      { printf '%s\n' 'SET ROLE postgres;'; cat "$repo/ops/laptop/freeze-install.sql"; printf '%s\n' 'BEGIN; CREATE TABLE IF NOT EXISTS pc_ops.cloud_cron_state(jobid bigint PRIMARY KEY,active boolean NOT NULL); INSERT INTO pc_ops.cloud_cron_state SELECT jobid,active FROM cron.job ON CONFLICT DO NOTHING; SELECT cron.alter_job(jobid,active:=false) FROM pc_ops.cloud_cron_state WHERE active; UPDATE pc_ops.control SET frozen=true WHERE singleton; COMMIT;'; } | "${args[@]}"
      echo 'Cloud application writes frozen.'
    elif [ "$mode" = thaw-cloud ]; then
      printf '%s\n' 'SET ROLE postgres; BEGIN; UPDATE pc_ops.control SET frozen=false WHERE singleton; SELECT cron.alter_job(jobid,active:=active) FROM pc_ops.cloud_cron_state; COMMIT;' | "${args[@]}"
      echo 'Cloud application writes resumed.'
    elif [ "$mode" = inspect-cloud ]; then
      printf '%s\n' "SET ROLE postgres; BEGIN; SET LOCAL session_replication_role=replica; SELECT current_user,pg_has_role(current_user,'supabase_auth_admin','MEMBER'); SELECT count(*) FROM public.profiles; ROLLBACK;" | "${args[@]}"
    else
      name=${2:-cloud}; [[ "$name" =~ ^[a-z0-9-]+$ ]] || exit 1
      test ! -e "$out/$name.jsonl"
      { printf '%s\n' 'SET ROLE postgres;'; cat "$repo/ops/laptop/snapshot.sql"; } | "${args[@]}" > "$out/$name.jsonl"
      printf 'Cloud snapshot saved: %s\n' "$name"
    fi ;;
  *) echo 'Unsupported database operation'; exit 1 ;;
esac
