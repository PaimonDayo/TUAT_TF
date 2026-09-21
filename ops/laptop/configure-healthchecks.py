"""Change only healthcheck intervals using all four production Compose files."""
import datetime
import json
import os
import pathlib
import shutil
import subprocess
import sys
import yaml

os.umask(0o077)
repo = pathlib.Path(__file__).resolve().parents[2]
profile_path = repo / '.contingency/server.json'
profile = json.loads(profile_path.read_text()) if profile_path.exists() else {}
stack = pathlib.Path(profile.get('stackDir', '/opt/tuat-tf-supabase'))
files = ['docker-compose.yml', 'compose.local.yml', 'compose.rehearsal.yml', 'compose.auth.json']
command = ['docker', 'compose', '-p', profile.get('composeProject', 'tuat-contingency')]
for name in files:
    if not (stack / name).is_file(): raise SystemExit('Missing required Compose file')
    command += ['-f', str(stack / name)]

def compose(args, timeout=60):
    result = subprocess.run(command + args, cwd=stack, capture_output=True, timeout=timeout)
    if result.returncode: raise RuntimeError('Compose operation failed (private configuration suppressed)')
    return result.stdout

before = json.loads(compose(['config', '--format', 'json']))
target = stack / 'compose.local.yml'
original = target.read_bytes()
config = yaml.compose(original)
def mapping(parent, name):
    for key, value in parent.value:
        if key.value == name: return value
    value = yaml.MappingNode('tag:yaml.org,2002:map', [])
    parent.value.append((yaml.ScalarNode('tag:yaml.org,2002:str', name), value))
    return value
# Includes postgres-meta's healthcheck inherited from its image.
services = ['api-gw', 'auth', 'db', 'functions', 'imgproxy', 'meta', 'rest', 'storage', 'studio', 'supavisor']
for service in services:
    health = mapping(mapping(mapping(config, 'services'), service), 'healthcheck')
    health.value = [(k, v) for k, v in health.value if k.value != 'interval']
    health.value.append((yaml.ScalarNode('tag:yaml.org,2002:str', 'interval'), yaml.ScalarNode('tag:yaml.org,2002:str', '30s')))
snapshot = stack / 'transfer' / ('healthchecks-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
snapshot.mkdir(parents=True)
for name in files: shutil.copy2(stack / name, snapshot / name)
applied = False
try:
    target.write_text(yaml.serialize(config))
    after = json.loads(compose(['config', '--format', 'json']))
    normalized = json.loads(json.dumps(after))
    for service in services:
        health = normalized['services'][service].setdefault('healthcheck', {})
        old = before['services'][service].get('healthcheck', {})
        if 'interval' in old: health['interval'] = old['interval']
        else: health.pop('interval', None)
        if not health and 'healthcheck' not in before['services'][service]: normalized['services'][service].pop('healthcheck')
    if normalized != before: raise RuntimeError('Unexpected change outside healthcheck intervals')
    print('Dry-run: only ten healthcheck intervals change to 30s; private snapshot:', snapshot, flush=True)
    if '--apply' in sys.argv:
        try:
            compose(['up', '-d', '--wait', '--wait-timeout', '240'], timeout=300)
            ids = compose(['ps', '-q']).decode().split()
            actual = json.loads(subprocess.check_output(['docker', 'inspect'] + ids))
            for container in actual:
                health = container['Config'].get('Healthcheck', {})
                if health and health.get('Interval') != 30000000000: raise RuntimeError('Runtime interval mismatch')
                if container['State']['Status'] != 'running': raise RuntimeError('Container not running')
                if container['State'].get('Health', {}).get('Status', 'healthy') != 'healthy': raise RuntimeError('Container not healthy')
            applied = True
            print('All eleven containers healthy; all healthcheck intervals are 30s', flush=True)
        except Exception:
            target.write_bytes(original)
            compose(['up', '-d', '--wait', '--wait-timeout', '240'], timeout=300)
            raise RuntimeError('Change failed; original configuration restored') from None
finally:
    if not applied: target.write_bytes(original)
