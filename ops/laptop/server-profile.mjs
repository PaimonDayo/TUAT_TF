// このPC固有の値（WSLのディストリ名・スタックの置き場所・Composeプロジェクト名・
// チェックアウト位置）を1か所にまとめる。別のPCへサーバーを引き継ぐとき、
// スクリプトを書き換えずに `.contingency/server.json` だけで合わせられるようにするため。
//
// 既定値は現行の本番PCと同じ。server.json が無ければ今までどおり動く。
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { root } from './backend-files.mjs';

const DEFAULTS = {
  // `wsl -l -q` に出る名前。新しいPCでは Ubuntu-24.04 等になることがある。
  wslDistro: 'Ubuntu',
  // WSL内のスタック配置。initialize-wsl.sh がここへ作る。
  stackDir: '/opt/tuat-tf-supabase',
  // docker compose -p の値。ネットワーク名 <project>_default もこれに従う。
  composeProject: 'tuat-contingency',
};

const profilePath = resolve(root, '.contingency/server.json');

/** 実行中のPCのサーバープロファイル。環境変数 > server.json > 既定値。 */
export function serverProfile() {
  const file = existsSync(profilePath) ? JSON.parse(readFileSync(profilePath, 'utf8')) : {};
  const profile = {
    wslDistro: process.env.TUAT_WSL_DISTRO || file.wslDistro || DEFAULTS.wslDistro,
    stackDir: file.stackDir || DEFAULTS.stackDir,
    composeProject: file.composeProject || DEFAULTS.composeProject,
  };
  for (const [key, value] of Object.entries(profile)) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid server profile value: ${key}`);
  }
  // スクリプトが組み立てるシェル文字列へそのまま入るため、引用の要る文字は弾く。
  if (/[^A-Za-z0-9._/-]/.test(profile.stackDir)) throw new Error('stackDir must not need shell quoting');
  if (/[^A-Za-z0-9._-]/.test(profile.composeProject)) throw new Error('composeProject must not need shell quoting');
  return profile;
}

/** `wsl -d <distro> -u root --` までの引数。以降にコマンドを続ける。 */
export function wslArgs({ user = 'root' } = {}) {
  return ['-d', serverProfile().wslDistro, '-u', user, '--'];
}

/**
 * このチェックアウトのWSL側パス。以前は `/mnt/c/Paimon Dayo/TUAT_TF` を
 * 直接書いていたため、別のPC・別のフォルダ名では動かなかった。
 */
export function wslRepoRoot() {
  const path = execFileSync('wsl', ['-d', serverProfile().wslDistro, '--', 'wslpath', '-a', root],
    { encoding: 'utf8', timeout: 15_000, windowsHide: true }).trim();
  if (!path.startsWith('/mnt/')) throw new Error('Could not resolve this checkout inside WSL');
  return path;
}

/** docker compose をスタックの構成ファイル一式で呼ぶためのシェル断片。 */
export function composeCommand(profile = serverProfile()) {
  return `docker compose -p ${profile.composeProject} -f docker-compose.yml -f compose.local.yml -f compose.rehearsal.yml`;
}
