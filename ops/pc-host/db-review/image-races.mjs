// Windows transport adapter only; the parent runner owns fresh DB resources.
import { spawn } from 'node:child_process';
import { runRaces } from '../../pc-image-cleanup/review-races.mjs';

const [flag, container] = process.argv.slice(2);
if (flag !== '--container' || process.argv.length !== 4 || !/^codex-auth-dbreview-[a-f0-9]{32}$/.test(container ?? '')) {
  throw Error('Explicit newly owned synthetic container required');
}

function command(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('wsl.exe', ['-d', 'Ubuntu', '--', 'docker', ...args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill(), 25000);
    child.stdout.on('data', chunk => { out += chunk; if (out.length > 65536) child.kill(); });
    child.stderr.on('data', chunk => { err += chunk; if (err.length > 16384) child.kill(); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(Error(err || 'Owned synthetic SQL transport failed'));
    });
    child.stdin.end(input);
  });
}

try {
  const state = JSON.parse(await command(['inspect', container]))[0];
  if (state.Name !== `/${container}` || state.Config.Labels['tuat.owner'] !== 'codex-auth-db-review' ||
      state.Config.Labels['tuat.generation'] !== container.slice('codex-auth-dbreview-'.length) ||
      state.HostConfig.NetworkMode !== `${container}-internal` || !/^[a-f0-9]{64}$/.test(state.Id) ||
      Object.keys(state.HostConfig.PortBindings ?? {}).length) throw Error('Owned unpublished synthetic DB boundary failed');
  const network = JSON.parse(await command(['network', 'inspect', `${container}-internal`]))[0];
  if (!network.Internal || network.Labels['tuat.owner'] !== 'codex-auth-db-review' ||
      network.Labels['tuat.generation'] !== state.Config.Labels['tuat.generation']) throw Error('Owned internal synthetic network required');
  const sql = statement => command(['exec', '-i', state.Id, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'tuat_rls_review'], statement);
  console.log(JSON.stringify(await runRaces({ sql })));
} catch (error) {
  console.error(`Synthetic image race failed: ${error.message}`);
  process.exitCode = 1;
}
