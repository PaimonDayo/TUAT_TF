// 別のPCをサーバーにできる状態か、読み取りだけで確かめる。
// 何も起動せず、何も書き換えず、秘密値も表示しない。
//
//   node ops/laptop/handoff-preflight.mjs
//
// 全部 ok になってから ops/laptop/SERVER-HANDOFF.md の手順へ進む。
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { root } from './backend-files.mjs';
import { serverProfile, wslArgs } from './server-profile.mjs';

const profile = serverProfile();
const checks = [];
const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });

const wsl = (args, timeout = 20_000) => {
  try {
    return execFileSync('wsl', [...wslArgs(), ...args], { encoding: 'utf8', timeout, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

// 1. Windows側の前提
add('node', true, process.version);
try {
  const distros = execFileSync('wsl', ['-l', '-q'], { encoding: 'utf16le', timeout: 20_000, windowsHide: true });
  const names = distros.split(/\r?\n/).map((s) => s.replace(/\0/g, '').trim()).filter(Boolean);
  add('wslDistroPresent', names.includes(profile.wslDistro),
    `profile=${profile.wslDistro} / installed=${names.join(', ') || '(none)'}`);
} catch {
  add('wslDistroPresent', false, 'wsl -l -q failed; install WSL2 first');
}

// 2. WSL内のコンテナ基盤
add('dockerEngine', Boolean(wsl(['docker', 'version', '--format', '{{.Server.Version}}'])), wsl(['docker', 'version', '--format', '{{.Server.Version}}']) ?? 'not reachable');
add('dockerCompose', Boolean(wsl(['docker', 'compose', 'version', '--short'])), wsl(['docker', 'compose', 'version', '--short']) ?? 'not installed');
add('cloudflared', Boolean(wsl(['cloudflared', '--version'])), wsl(['cloudflared', '--version']) ?? 'not installed');

// 3. スタックの置き場所
const stackEnv = wsl(['test', '-f', `${profile.stackDir}/.env`]) !== null;
add('stackInitialized', stackEnv, `${profile.stackDir}/.env ${stackEnv ? 'present' : 'missing (run initialize-wsl.sh)'}`);

// 4. 空き容量（DBとバックアップの世代を置ける余裕）
// df は WSL 内で実行し、解析はこちらで行う（パイプ・awk の引用を挟まない）。
const dfTarget = profile.stackDir.replace(/\/[^/]*$/, '') || '/';
const df = wsl(['df', '-Pk', dfTarget]);
const freeKb = Number(df?.split(/\r?\n/)[1]?.trim().split(/\s+/)[3] ?? NaN);
add('diskFree20GB', freeKb > 20 * 1024 * 1024,
  Number.isFinite(freeKb) ? `${Math.round(freeKb / 1048576)} GB free at ${dfTarget}` : `could not read df for ${dfTarget}`);

// 5. このPCへ持ち込む必要がある秘密ファイル（中身は読まない・見せない）
for (const [label, relative] of [
  ['.env.local (R2 と復号鍵の元)', '.env.local'],
  ['local-app.env (PC Supabase のキー)', '.contingency/local-app.env'],
  ['runtime template', '.contingency/runtime/docker-compose.yml'],
]) {
  const path = resolve(root, relative);
  add(`secret:${relative}`, existsSync(path), existsSync(path) ? `${statSync(path).size} bytes` : `${label} が無い。所有者の安全な経路で持ち込む`);
}

// 6. 引き継ぎ後に自分のものになる設定（まだ無くてよい）
const configPresent = existsSync(resolve(root, '.contingency/backend/config.json'));
add('backendConfig', true, configPresent ? 'present (this PC already has its own instance)' : 'absent (prepare-backend.mjs will create it)');

const failed = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ profile, checks, ready: failed.length === 0 }, null, 2));
if (failed.length) {
  console.error(`\nNot ready: ${failed.map((c) => c.name).join(', ')}`);
  process.exitCode = 1;
}
