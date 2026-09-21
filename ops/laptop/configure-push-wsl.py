"""Configure only Web Push; require the complete production Compose stack."""
import datetime
import json
import os
import pathlib
import shutil
import subprocess
import sys

os.umask(0o077)
repo = pathlib.Path(__file__).resolve().parents[2]
profile_file = repo / '.contingency/server.json'
profile = json.loads(profile_file.read_text()) if profile_file.exists() else {}
stack = pathlib.Path(profile.get('stackDir', '/opt/tuat-tf-supabase'))
project = profile.get('composeProject', 'tuat-contingency')
files = ['docker-compose.yml', 'compose.local.yml', 'compose.rehearsal.yml', 'compose.auth.json']
KEYS = ['NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'PUSH_WEBHOOK_SECRET']
FUNCTION_URL = 'http://supabase-edge-functions:9000/send-web-push'

def sql(statement):
    result = subprocess.run(['docker', 'exec', '-i', 'supabase-db', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'], input=statement.encode(), capture_output=True, timeout=60)
    if result.returncode:
        raise SystemExit('SQL failed; transaction aborted (secret-bearing SQL suppressed)')
    return result.stdout.decode().strip()

def secrets():
    values = dict(line.split('=', 1) for line in (repo / '.contingency/backend/push.env').read_text().splitlines() if '=' in line)
    if any(not values.get(k) for k in KEYS): raise SystemExit('Missing push configuration')
    return values

def literal(value):
    return "'" + value.replace("'", "''") + "'"

def compose(args):
    for name in files:
        if not (stack / name).is_file(): raise SystemExit('Missing required Compose file: ' + name)
    cmd = ['docker', 'compose', '-p', project]
    for name in files: cmd += ['-f', str(stack / name)]
    result = subprocess.run(cmd + args, cwd=stack, capture_output=True, timeout=180)
    if result.returncode: raise SystemExit('Compose failed (configuration values suppressed)')
    return result.stdout

def identities():
    return dict(line.split(' ',1) for line in subprocess.check_output(['docker','ps','--format','{{.Names}} {{.ID}}']).decode().splitlines() if line.startswith('supabase-') or line.startswith('realtime-'))

mode = sys.argv[1]
if mode == 'snapshot':
    target = stack / 'transfer' / ('push-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    target.mkdir(parents=True)
    for name in files + ['.env']: shutil.copy2(stack/name, target/name)
    (target/'vault.json').write_text(sql("SELECT COALESCE(json_agg(json_build_object('name',name,'description',description,'secret',decrypted_secret)),'[]') FROM vault.decrypted_secrets;"))
    dump = subprocess.check_output(['docker','exec','supabase-db','pg_dump','-U','supabase_admin','-d','postgres','-t','public.push_subscriptions','-t','vault.secrets'])
    (target/'push.sql').write_bytes(dump)
    if (stack/'volumes/functions/send-web-push').exists(): shutil.copytree(stack/'volumes/functions/send-web-push',target/'send-web-push')
    print('Private snapshot:', target)
elif mode == 'env':
    values = secrets()
    compose(['config','--quiet'])
    env = stack/'.env'
    lines = [line for line in env.read_text().splitlines() if line.split('=',1)[0] not in KEYS]
    env.write_text('\n'.join(lines + [k+'='+values[k] for k in KEYS])+'\n')
    config_path = stack/'compose.auth.json'
    config = json.loads(config_path.read_text())
    if 'auth_outbound' not in config.get('networks',{}): raise SystemExit('Expected outbound network missing')
    function = config.setdefault('services',{}).setdefault('functions',{})
    function['networks'] = {'default':{}, 'auth_outbound':{}}
    function.setdefault('environment',{}).update({k:'${'+k+'}' for k in KEYS})
    config_path.write_text(json.dumps(config))
    shutil.copytree(repo/'supabase/functions/send-web-push',stack/'volumes/functions/send-web-push',dirs_exist_ok=True)
    compose(['config','--quiet'])
    print('Push configuration and function source staged; runtime unchanged')
elif mode == 'restart-functions':
    before = identities()
    compose(['up','-d','--no-deps','--wait','--wait-timeout','60','functions'])
    after = identities()
    if any(after.get(k)!=v for k,v in before.items() if k!='supabase-edge-functions'): raise SystemExit('Unexpected non-function container replacement')
    config = json.loads(subprocess.check_output(['docker','inspect','supabase-edge-functions']))[0]
    env = dict(e.split('=',1) for e in config['Config']['Env'])
    if any(not env.get(k) for k in KEYS): raise SystemExit('Missing runtime push configuration')
    if project+'_auth_outbound' not in config['NetworkSettings']['Networks']: raise SystemExit('Outbound network not attached')
    print('Only functions recreated; all other container identities unchanged')
elif mode in ('vault-dry-run','vault'):
    values = secrets()
    statements = ['BEGIN; SET LOCAL lock_timeout=\'5s\';']
    for name,value in [('push_webhook_secret',values['PUSH_WEBHOOK_SECRET']),('push_webhook_url',FUNCTION_URL)]:
        statements += [f"DO $$ DECLARE existing uuid; BEGIN SELECT id INTO existing FROM vault.secrets WHERE name={literal(name)}; IF existing IS NULL THEN PERFORM vault.create_secret({literal(value)},{literal(name)},'Web Push configuration'); ELSE PERFORM vault.update_secret(existing,{literal(value)}); END IF; END $$;"]
        statements += [f"DO $$ BEGIN IF (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name={literal(name)}) IS DISTINCT FROM {literal(value)} THEN RAISE EXCEPTION 'Vault mismatch'; END IF; END $$;"]
    statements += ['COMMIT;' if mode=='vault' else 'ROLLBACK;']
    sql('\n'.join(statements))
    print(mode + ': verified two settings')
elif mode == 'check':
    print(sql("SELECT 'push vault entries: '||count(*) FROM vault.decrypted_secrets WHERE name IN ('push_webhook_secret','push_webhook_url');"))
else:
    raise SystemExit('Expected snapshot, env, restart-functions, vault-dry-run, vault or check')
