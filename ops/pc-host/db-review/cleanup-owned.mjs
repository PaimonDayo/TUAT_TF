// Exact synthetic generation only. Creation attempts are recorded before Docker
// runs, so an unknown result is reconciled by name rather than a returned ID.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const owner = 'codex-auth-db-review';
const pins = {
  pg: 'sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00',
  auth: 'sha256:c0c25187a6b835e65a6f6e6c6b39d090e832d40e6de5186f2c038e0411944232',
  storage: 'sha256:c24fb33cc2fa38d0f9582a30312907fc56da333fb9ba0646833186197e4982f3',
  api: 'sha256:54000f24847d01a2c2302e0041cf0618b875c57fb48507d743cfa9aaa50bf43c',
};
const suffixes = { pg: '', auth: '-auth-migrate', storage: '-storage-source', api: '-postgrest' };
const validKeys = new Set(['pg', 'auth', 'storage', 'api', 'volume', 'network']);
const ensure = (condition, message) => { if (!condition) throw Error(message); };
const idValid = id => /^[a-f0-9]{64}$/.test(id ?? '');
const objectValid = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const labelsMatch = (labels, generation) => labels?.['tuat.owner'] === owner && labels?.['tuat.generation'] === generation;

export async function attemptResource(plan, key, create) {
  ensure(validKeys.has(key), 'Unknown synthetic resource kind');
  plan[key] = true;
  return create();
}

export async function cleanupOwned({ generation, attempted, docker }) {
  ensure(/^[a-f0-9]{32}$/.test(generation ?? '') && attempted && typeof attempted === 'object' && !Array.isArray(attempted), 'Explicit synthetic cleanup generation required');
  ensure(Object.entries(attempted).every(([key, value]) => validKeys.has(key) && typeof value === 'boolean'), 'Invalid synthetic cleanup plan');
  const base = `codex-auth-dbreview-${generation}`, network = `${base}-internal`, volume = `${base}-data`;
  const result = { cleanup: true, inspected: 0, removed: 0, absent: 0 };
  const list = async (kind, name) => {
    const args = kind === 'container' ? ['container', 'ls', '-a', '--no-trunc'] : [kind, 'ls'];
    const output = (await docker([...args, '--filter', `name=^${kind === 'container' ? '/' : ''}${name}$`, '--format', kind === 'volume' ? '{{.Name}}' : '{{.ID}}'])).trim();
    if (!output) return null;
    ensure(!output.includes('\n') && !output.includes('\r'), 'Ambiguous exact synthetic resource');
    return output;
  };
  const networkState = async () => {
    const fields = JSON.parse(await docker(['network', 'inspect', '--format', '[{{json .Id}},{{json .Name}},{{json .Labels}},{{json .Internal}},{{json .Containers}}]', network]));
    ensure(Array.isArray(fields) && fields.length === 5, 'Malformed synthetic network inspection');
    const [id, name, labels, internal, containers] = fields;
    ensure(idValid(id) && name === network && labelsMatch(labels, generation) && internal === true && objectValid(containers), 'Synthetic network ownership/isolation mismatch');
    return { id, containers };
  };
  // The PG/API/Auth network must be verified independently before removal.
  let ownedNetwork;
  if (attempted.pg || attempted.auth || attempted.api) {
    if (await list('network', network)) ownedNetwork = await networkState();
  }
  for (const kind of ['api', 'auth', 'storage', 'pg']) {
    if (!attempted[kind]) continue;
    const name = base + suffixes[kind], listed = await list('container', name);
    if (!listed) { result.absent++; continue; }
    const fields = JSON.parse(await docker(['inspect', '--format', '[{{json .Id}},{{json .Name}},{{json .Config.Labels}},{{json .Image}},{{json .HostConfig.PortBindings}},{{json .HostConfig.NetworkMode}},{{json .NetworkSettings.Networks}},{{json .State.Status}}]', name]));
    ensure(Array.isArray(fields) && fields.length === 8, 'Malformed synthetic container inspection');
    const [id, actualName, labels, image, ports, mode, networks, state] = fields;
    ensure(idValid(id) && listed === id && actualName === `/${name}` && labelsMatch(labels, generation) && image === pins[kind], 'Synthetic container ownership/image mismatch');
    ensure((ports === null || (objectValid(ports) && !Object.keys(ports).length)) && objectValid(networks), 'Synthetic container published-port mismatch');
    const attached = Object.keys(networks);
    if (kind === 'storage') ensure(mode === 'none' && attached.every(key => key === 'none') && attached.length <= 1, 'Synthetic Storage network mismatch');
    else ensure(ownedNetwork && mode === network && ((attached.length === 1 && attached[0] === network) || (state === 'created' && attached.length === 0)), 'Synthetic container internal network mismatch');
    result.inspected++;
    await docker(['rm', '-f', id]);
    ensure(!(await list('container', name)), 'Synthetic container removal not confirmed');
    result.removed++;
  }
  if (attempted.volume) {
    const listed = await list('volume', volume);
    if (!listed) result.absent++;
    else {
      const fields = JSON.parse(await docker(['volume', 'inspect', '--format', '[{{json .Name}},{{json .Labels}},{{json .Mountpoint}}]', volume]));
      ensure(Array.isArray(fields) && fields.length === 3, 'Malformed synthetic volume inspection');
      const [name, labels, mountpoint] = fields;
      ensure(listed === volume && name === volume && labelsMatch(labels, generation) && typeof mountpoint === 'string' && mountpoint.startsWith('/') && !mountpoint.split('/').includes('..') && mountpoint.endsWith(`/volumes/${volume}/_data`), 'Synthetic volume ownership/path mismatch');
      result.inspected++;
      await docker(['volume', 'rm', volume]);
      ensure(!(await list('volume', volume)), 'Synthetic volume removal not confirmed');
      result.removed++;
    }
  }
  if (attempted.network) {
    if (!(await list('network', network))) result.absent++;
    else {
      const entry = await networkState();
      ensure(Object.keys(entry.containers).length === 0, 'Synthetic network still occupied');
      result.inspected++;
      await docker(['network', 'rm', entry.id]);
      ensure(!(await list('network', network)), 'Synthetic network removal not confirmed');
      result.removed++;
    }
  }
  return result;
}

function dockerProcess(args) {
  return new Promise((resolveOutput, reject) => {
    const child = spawn('wsl.exe', ['-d', 'Ubuntu', '--exec', 'docker', ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', stopped = false;
    const stop = () => { stopped = true; child.kill(); };
    const timer = setTimeout(stop, 25000);
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 262144) stop(); });
    child.stderr.resume(); // Never forward Docker diagnostics or environments.
    child.on('error', () => { clearTimeout(timer); reject(Error('Synthetic cleanup command unavailable')); });
    child.on('close', code => { clearTimeout(timer); if (code === 0 && !stopped) resolveOutput(output); else reject(Error('Synthetic cleanup command result unknown')); });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [flag, generation] = process.argv.slice(2);
  try {
    ensure(flag === '--execute-generation' && process.argv.length === 4, 'Explicit synthetic cleanup execution required');
    let input = '';
    for await (const chunk of process.stdin) { input += chunk; ensure(input.length <= 1024, 'Oversized synthetic cleanup plan'); }
    console.log(JSON.stringify(await cleanupOwned({ generation, attempted: JSON.parse(input), docker: dockerProcess })));
  } catch { console.log(JSON.stringify({ cleanup: false, failure: 'Exact owned cleanup unconfirmed; resources retained' })); process.exitCode = 1; }
}
