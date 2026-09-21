"""Emit sensitive recovery metadata only to the encrypting backup parent process."""
import datetime
import json
import pathlib
import subprocess

repo = pathlib.Path(__file__).resolve().parents[2]
def sql(statement):
    result = subprocess.run(['docker','exec','-i','supabase-db','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],input=statement.encode(),capture_output=True,timeout=30)
    if result.returncode: raise RuntimeError('Recovery export query failed')
    return result.stdout.decode().strip()

vault = json.loads(sql("SELECT COALESCE(json_agg(json_build_object('name',name,'description',description,'secret',decrypted_secret) ORDER BY name),'[]') FROM vault.decrypted_secrets;"))
has_cron = sql("SELECT to_regclass('cron.job') IS NOT NULL;") == 't'
jobs = json.loads(sql("SELECT COALESCE(json_agg(to_jsonb(j) ORDER BY jobid),'[]') FROM cron.job j;")) if has_cron else []
push_path = repo/'.contingency/backend/push.env'
push_env = push_path.read_text() if push_path.exists() else None
print(json.dumps({'version':1,'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'vault':vault,'pushEnv':push_env,'cron':{'installed':has_cron,'jobs':jobs}}))
