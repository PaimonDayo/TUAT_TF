// Read package metadata only. This check never installs packages or reads .env files.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const dependencyGroups = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

export function checkEnvironment({ root = projectRoot, nodeVersion = process.versions.node } = {}) {
  const errors = [];
  const version = /^(\d+)\.(\d+)\.(\d+)$/.exec(nodeVersion);
  if (!version || Number(version[1]) < 22 || (Number(version[1]) === 22 && Number(version[2]) < 12)) {
    errors.push(`Node.js ${nodeVersion} は対象外です。Node.js 22.12.0 以降の正式版を使用してください。`);
  }

  const readJson = (relativePath) => {
    try {
      const value = JSON.parse(readFileSync(resolve(root, relativePath), 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
      return value;
    } catch {
      errors.push(`${relativePath} が存在しないか、有効な JSON オブジェクトではありません。`);
      return null;
    }
  };
  const manifest = readJson('package.json');
  const lock = readJson('package-lock.json');
  const lockedRoot = lock?.packages?.[''];
  if (lock && (!lockedRoot || typeof lockedRoot !== 'object' || Array.isArray(lockedRoot))) {
    errors.push('package-lock.json にルートパッケージの情報がありません。lockfileVersion 2 または 3 のロックファイルを使用してください。');
  }

  const dependencies = new Set();
  if (manifest && lockedRoot) {
    for (const group of dependencyGroups) {
      const declared = manifest[group] ?? {};
      const locked = lockedRoot[group] ?? {};
      if (typeof declared !== 'object' || Array.isArray(declared) || typeof locked !== 'object' || Array.isArray(locked)) {
        errors.push(`${group} の依存宣言が不正です。package.json と package-lock.json を確認してください。`);
        continue;
      }
      for (const name of new Set([...Object.keys(declared), ...Object.keys(locked)])) {
        if (typeof declared[name] !== 'string' || declared[name] !== locked[name]) {
          errors.push(`${group}.${name} の依存宣言が package.json と package-lock.json で一致しません。`);
        }
        if (Object.hasOwn(declared, name)) dependencies.add(name);
      }
    }
  }

  const hasInstalledDirectory = existsSync(resolve(root, 'node_modules'));
  if (dependencies.size && !hasInstalledDirectory) {
    errors.push('node_modules がありません。このチェックアウトの依存関係を npm ci で導入してください。');
  }
  let checkedPackages = 0;
  for (const name of [...dependencies].sort()) {
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) || name.split('/').some((part) => ['.', '..', '@.', '@..'].includes(part))) {
      errors.push('package.json に不正な依存パッケージ名があります。');
      continue;
    }
    const lockedVersion = lock.packages[`node_modules/${name}`]?.version;
    if (typeof lockedVersion !== 'string' || !lockedVersion) {
      errors.push(`${name} の解決済みバージョンが package-lock.json にありません。`);
      continue;
    }
    if (!hasInstalledDirectory) continue;
    const installed = readJson(`node_modules/${name}/package.json`);
    if (!installed) continue;
    if (installed.version !== lockedVersion) {
      errors.push(`${name}: インストール済み ${installed.version ?? '不明'} / ロックファイル ${lockedVersion}。依存関係をロックファイルに合わせてください。`);
    } else {
      checkedPackages += 1;
    }
  }
  return { errors, checkedPackages, nodeVersion };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkEnvironment();
  if (result.errors.length) {
    console.error('開発環境の確認に失敗しました。');
    for (const error of result.errors) console.error(`- ${error}`);
    console.error('Node.js の実行元と依存宣言を確認し、必要に応じて対象チェックアウトで npm ci を実行してください。この確認ではファイルを変更していません。');
    process.exitCode = 1;
  } else {
    console.log(`開発環境を確認しました: Node.js ${result.nodeVersion}、直接依存 ${result.checkedPackages} 件がロックファイルと一致。`);
  }
}
