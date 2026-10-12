import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const manifestVersion = 1;
// The root cache belongs to build/test tools; package files and .bin are immutable.
const excludedPaths = Object.freeze(['node_modules/.cache']);
const hashFields = ['nodeExecutableHash', 'releaseCodeHash', 'dependencyTreeHash', 'publicTreeHash'];
const normalizePath = value => process.platform === 'win32' ? value.toLowerCase() : value;
const fileBuffer = Buffer.allocUnsafe(1024 * 1024);
export function runtimeRebuildRequired(message) {
  return Object.assign(Error(message), { code: 'ERR_PC_HOST_REBUILD_REQUIRED' });
}

function requiredExecutable(path, label) {
  try {
    if (!isAbsolute(path) || !lstatSync(path).isFile() || normalizePath(realpathSync(path)) !== normalizePath(path)) throw Error();
  } catch {
    throw Object.assign(Error(`Pinned ${label} executable is unavailable`), { code: 'ERR_PC_HOST_TOOL_UNAVAILABLE' });
  }
  return path;
}

export function hostGitPath() {
  if (process.platform !== 'win32') return requiredExecutable('/usr/bin/git', 'Git');
  const root = process.env.ProgramFiles;
  if (!isAbsolute(root ?? '')) throw Object.assign(Error('Pinned Git installation root is unavailable'), { code: 'ERR_PC_HOST_TOOL_UNAVAILABLE' });
  return requiredExecutable(resolve(root, 'Git/cmd/git.exe'), 'Git');
}

export function hostGitEnvironment() {
  // Git proof must not read a developer profile, injected GIT_* overrides or
  // a system config. Production preflight separately validates local metadata.
  const env = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', LC_ALL: 'C' };
  if (process.platform === 'win32') {
    env.SystemRoot = process.env.SystemRoot;
    env.WINDIR = process.env.SystemRoot;
  }
  return env;
}

export function hostWindowsToolPath(name) {
  if (process.platform !== 'win32' || !['whoami', 'icacls'].includes(name)) throw Error('Unexpected Windows host tool');
  const root = process.env.SystemRoot;
  if (!isAbsolute(root ?? '')) throw Object.assign(Error('Pinned Windows installation root is unavailable'), { code: 'ERR_PC_HOST_TOOL_UNAVAILABLE' });
  return requiredExecutable(resolve(root, `System32/${name}.exe`), name);
}

export function verifiedReleaseDirectory(directory) {
  if (!isAbsolute(directory ?? '')) throw Error('Absolute release directory required');
  const exact = resolve(directory);
  const stat = lstatSync(exact);
  if (!stat.isDirectory() || stat.isSymbolicLink() || normalizePath(realpathSync(exact)) !== normalizePath(exact) || exact.includes('*')) throw Error('Release directory may not be redirected');
  return exact;
}

function hashFile(path, digest = createHash('sha256')) {
  const file = openSync(path, 'r');
  try {
    const before = fstatSync(file, { bigint: true });
    if (!before.isFile()) throw Error('Runtime artifact must be a regular file');
    const size = Number(before.size);
    if (!Number.isSafeInteger(size)) throw Error('Runtime artifact is too large');
    let position = 0;
    while (position < size) {
      const bytes = readSync(file, fileBuffer, 0, Math.min(fileBuffer.length, size - position), position);
      if (bytes === 0) throw Error('Runtime artifact changed while hashing');
      digest.update(fileBuffer.subarray(0, bytes));
      position += bytes;
    }
    const after = fstatSync(file, { bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw Error('Runtime artifact changed while hashing');
    return digest;
  } finally { closeSync(file); }
}

function releaseCodeHash(directory) {
  // This supplements Git cleanliness: runtime helpers/config must also match
  // their built bytes even if an index entry has been marked skip-worktree.
  const names = execFileSync(hostGitPath(), ['-c', `safe.directory=${directory}`, '-C', directory, 'ls-files', '-z'], { encoding: 'utf8', windowsHide: true, env: hostGitEnvironment() }).split('\0').filter(Boolean).sort();
  const digest = createHash('sha256');
  for (const name of names) {
    const path = resolve(directory, name);
    const location = relative(directory, path);
    if (!location || location.startsWith('..') || isAbsolute(location) || !lstatSync(path).isFile() || normalizePath(realpathSync(path)) !== normalizePath(path)) throw Error('Release code may not escape its directory');
    digest.update(String(Buffer.byteLength(name))).update(':').update(name).update(hashFile(path).digest('hex'));
  }
  return digest.digest('hex');
}

function treeHash(directory, { dependencyTree = false } = {}) {
  const root = verifiedReleaseDirectory(directory);
  const digest = createHash('sha256');
  const field = value => digest.update(String(Buffer.byteLength(value))).update(':').update(value);
  const visit = dir => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const path = resolve(dir, entry.name);
      const name = relative(root, path).replaceAll('\\', '/');
      const stat = lstatSync(path);
      if (dependencyTree && name === '.cache') {
        verifiedReleaseDirectory(path); // A mutable cache cannot be an escape junction.
        continue;
      }
      if (stat.isSymbolicLink()) {
        // npm creates .bin links at the root and inside nested installations.
        // Bind each link to its own node_modules directory, not merely the tree.
        const link = readlinkSync(path);
        const target = realpathSync(path);
        const targetName = relative(root, target).replaceAll('\\', '/');
        const nested = name.match(/^(.+\/node_modules)\/\.bin\/[^/]+$/);
        const installation = /^\.bin\/[^/]+$/.test(name) ? root : nested ? resolve(root, nested[1]) : undefined;
        const localTarget = installation ? relative(installation,target).replaceAll('\\','/') : '';
        if (!dependencyTree || !installation || isAbsolute(link) || !localTarget || localTarget.startsWith('../') || isAbsolute(localTarget) || localTarget === '.cache' || localTarget.startsWith('.cache/') || !lstatSync(target).isFile()) throw Error('Runtime artifact link escaped its installation');
        field('link'); field(name); field(link.replaceAll('\\', '/')); field(targetName);
        field(hashFile(target).digest('hex'));
      } else if (stat.isDirectory()) {
        field('directory'); field(name); visit(path);
      } else if (stat.isFile()) {
        field('file'); field(name); field(String(stat.size));
        field(hashFile(path).digest('hex'));
      } else throw Error('Runtime artifact must be a regular file');
    }
  };
  visit(root);
  return digest.digest('hex');
}

export function createRuntimeManifest(directory) {
  const release = verifiedReleaseDirectory(directory);
  return {
    version: manifestVersion,
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.version,
    nodeExecutableHash: hashFile(process.execPath).digest('hex'),
    releaseCodeHash: releaseCodeHash(release),
    dependencyTreeHash: treeHash(resolve(release, 'node_modules'), { dependencyTree: true }),
    publicTreeHash: treeHash(resolve(release, 'public')),
    excludedPaths: [...excludedPaths],
  };
}

export function verifyRuntimeManifest(expected, directory) {
  if (expected?.version !== manifestVersion) throw runtimeRebuildRequired('Runtime manifest is missing or obsolete; rebuild required');
  if (expected.platform !== process.platform || expected.architecture !== process.arch || expected.nodeVersion !== process.version) throw runtimeRebuildRequired('Runtime platform or Node version differs; rebuild required');
  if (JSON.stringify(expected.excludedPaths) !== JSON.stringify(excludedPaths) || hashFields.some(key => !/^[a-f0-9]{64}$/.test(expected[key] ?? ''))) throw runtimeRebuildRequired('Runtime manifest is invalid; rebuild required');
  const current = createRuntimeManifest(directory);
  if (hashFields.some(key => expected[key] !== current[key])) throw runtimeRebuildRequired('Runtime artifacts changed; rebuild required');
  return current;
}
