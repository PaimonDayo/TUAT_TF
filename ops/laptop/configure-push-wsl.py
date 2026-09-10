"""Wire Web Push back up on the owner PC.

Puts the push secrets into the local Edge Function's environment, records the
webhook secret and the function URL in the database's vault, and recreates only
the functions container. Never prints a secret value.

Phases are explicit so each step can be checked before the next one runs.
"""
import os
import pathlib
import re
import subprocess
import sys

os.umask(0o077)
repo = pathlib.Path('/mnt/c/Paimon Dayo/TUAT_TF')
stack = pathlib.Path('/opt/tuat-tf-supabase')
compose = stack / 'docker-compose.yml'
env_file = stack / '.env'
secrets_path = repo / '.contingency/backend/push.env'

KEYS = ['NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'PUSH_WEBHOOK_SECRET']
# The database reaches the functions runtime over the compose network, not the host.
FUNCTION_URL = 'http://supabase-edge-functions:9000/send-web-push'


def read_secrets():
    values = {}
    for line in secrets_path.read_text(encoding='utf-8').splitlines():
        if '=' in line:
            name, value = line.split('=', 1)
            values[name.strip()] = value.strip()
    missing = [key for key in KEYS if not values.get(key)]
    if missing:
        raise SystemExit('Missing push secrets: ' + ', '.join(missing))
    return values


def sql(text, quiet=True):
    result = subprocess.run(
        ['docker', 'exec', '-i', 'supabase-db', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
         '-U', 'supabase_admin', '-d', 'postgres'],
        input=text.encode(), capture_output=True, timeout=180)
    if result.returncode:
        raise SystemExit('SQL failed: ' + result.stderr.decode()[-400:])
    return result.stdout.decode().strip()


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


mode = sys.argv[1]

if mode == 'env':
    secrets = read_secrets()
    # 1) values live in the stack's .env, which is already owner-only
    text = env_file.read_text(encoding='utf-8')
    for key in KEYS:
        line = f'{key}={secrets[key]}'
        if re.search(rf'^{key}=', text, re.M):
            text = re.sub(rf'^{key}=.*$', line, text, flags=re.M)
        else:
            text = text.rstrip('\n') + '\n' + line + '\n'
    env_file.write_text(text, encoding='utf-8')

    # 2) the functions container has to be told to pass them through
    body = compose.read_text(encoding='utf-8')
    anchor = '      VERIFY_JWT: "${FUNCTIONS_VERIFY_JWT}"'
    if anchor not in body:
        raise SystemExit('Could not find the functions environment block')
    if 'VAPID_PRIVATE_KEY' not in body:
        added = anchor + '\n' + '\n'.join(
            f'      {key}: ${{{key}}}' for key in KEYS)
        compose.write_text(body.replace(anchor, added), encoding='utf-8')
    print('env-and-compose-updated')

elif mode == 'restart-functions':
    result = subprocess.run(
        ['docker', 'compose', '-p', 'tuat-contingency', '-f', str(compose), 'up', '-d', 'functions'],
        cwd=str(stack), capture_output=True, timeout=300)
    if result.returncode:
        raise SystemExit('compose failed: ' + result.stderr.decode()[-400:])
    present = subprocess.run(
        ['docker', 'exec', 'supabase-edge-functions', 'printenv'],
        capture_output=True, timeout=60).stdout.decode()
    have = [key for key in KEYS if re.search(rf'^{key}=.+$', present, re.M)]
    print('functions-env-present:' + ','.join(sorted(have)))

elif mode == 'vault':
    secrets = read_secrets()
    sql(f"""
    DO $$
    BEGIN
      PERFORM vault.create_secret({literal(secrets['PUSH_WEBHOOK_SECRET'])}, 'push_webhook_secret', 'Web Push webhook shared secret');
      PERFORM vault.create_secret({literal(FUNCTION_URL)}, 'push_webhook_url', 'Local Edge Function endpoint for Web Push');
    END $$;
    """)
    print(sql("SELECT string_agg(name, ',' ORDER BY name) FROM vault.decrypted_secrets;"))

elif mode == 'persist-network':
    # 既定のネットワークは internal なので、外に出られるのは auth 用に用意された
    # auth_outbound だけ。Web Push は FCM / APNs へ出ていく必要があるので、
    # 送信関数のコンテナだけを同じ外向きネットワークにも参加させる。
    # DB をはじめ他のコンテナは今までどおり外へ出られないまま。
    body = compose.read_text(encoding='utf-8')
    anchor = '''    container_name: supabase-edge-functions
    image: supabase/edge-runtime:v1.74.0
    restart: unless-stopped
'''
    if anchor not in body:
        raise SystemExit('Could not find the functions service block')
    if 'auth_outbound' in body.split('supabase-edge-functions')[1][:600]:
        print('already-persisted')
    else:
        compose.write_text(
            body.replace(anchor, anchor + '    networks:\n      default: null\n      auth_outbound: null\n'),
            encoding='utf-8')
        print('networks-added')

elif mode == 'check':
    print(sql("""
      SELECT 'vault names: ' || coalesce(string_agg(name, ',' ORDER BY name), '(none)') FROM vault.decrypted_secrets
      UNION ALL
      SELECT 'trigger url from vault: ' || (position('push_webhook_url' in prosrc) > 0)::text
        FROM pg_proc WHERE proname = 'send_notification_push'
      UNION ALL
      SELECT 'http attempts: ' || count(*)::text FROM net._http_response;
    """))

else:
    raise SystemExit('Unknown phase')
