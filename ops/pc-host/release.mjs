import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, writeFileSync, renameSync, mkdirSync, realpathSync, chmodSync } from 'node:fs';
import { resolve, relative, isAbsolute, parse, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { verifiedReleaseDirectory, verifyRuntimeManifest, runtimeRebuildRequired, hostGitPath, hostGitEnvironment, hostWindowsToolPath } from './runtime-manifest.mjs';
import { validateBackupOwnerConfig } from './backup-owner.mjs';

const forbiddenEnvFiles = ['.env', '.env.local', '.env.production', '.env.production.local'];
const reservedPorts = [8000, 3008, 3109, 3112];
export function applicationLaunch(config,args,{platform=process.platform,ownerUid=process.getuid?.(),readBinary=readFileSync,readMetadata=lstatSync}={}) {
  const fields=['applicationUid','applicationGid','applicationHome','setprivSha256','unshareSha256','mountSha256','sandboxScript','sandboxScriptSha256'];
  if(platform!=='linux') {
    if(fields.some(key=>Object.hasOwn(config,key))) throw Error('Linux application identity on another platform');
    return {command:process.execPath,args};
  }
  if(!fields.some(key=>Object.hasOwn(config,key))&&ownerUid!==0) return {command:process.execPath,args};
  if(ownerUid!==0||!Number.isInteger(config.applicationUid)||config.applicationUid<1000||config.applicationUid>2147483647||
    !Number.isInteger(config.applicationGid)||config.applicationGid<1000||config.applicationGid>2147483647||
    !/^[a-f0-9]{64}$/.test(config.setprivSha256??'')||!isAbsolute(config.applicationHome??'')||resolve(config.applicationHome)===parse(resolve(config.applicationHome)).root) throw Error('Pinned unprivileged Linux application identity required');
  const home=readMetadata(config.applicationHome);
  if(!home.isDirectory()||home.isSymbolicLink()||home.uid!==config.applicationUid||(home.mode&0o077)!==0) throw Error('Private application home required');
  if(!isAbsolute(config.sandboxScript??''))throw Error('Root-owned application sandbox script required');
  const script=readMetadata(config.sandboxScript);
  if(!script.isFile()||script.isSymbolicLink()||script.uid!==0||(script.mode&0o022)!==0)throw Error('Root-owned application sandbox script required');
  for(const [file,pin] of [['/usr/bin/setpriv',config.setprivSha256],['/usr/bin/unshare',config.unshareSha256],['/usr/bin/mount',config.mountSha256],[config.sandboxScript,config.sandboxScriptSha256]]) {
    if(!/^[a-f0-9]{64}$/.test(pin??'')||createHash('sha256').update(readBinary(file)).digest('hex')!==pin) throw Error('Application sandbox command changed');
  }
  return {command:'/usr/bin/unshare',args:['--mount','--propagation','private','/bin/sh',config.sandboxScript,String(config.applicationUid),String(config.applicationGid),process.execPath,...args]};
}
export function validateHostConfig(config, env) {
  if (config.version !== 1 || typeof config.enabled !== 'boolean') throw Error('Explicit host configuration required');
  validateBackupOwnerConfig(config, env);
  for (const key of ['releaseDirectory', 'environmentFile', 'stateDirectory']) if (!isAbsolute(config[key] ?? '')) throw Error(`Absolute ${key} required`);
  const outsideRelease = path => { const delta = relative(config.releaseDirectory, path); return delta === '..' || delta.startsWith(`..${sep}`) || isAbsolute(delta); };
  if (!outsideRelease(config.stateDirectory)) throw Error('Separate state required');
  if (!/^[a-f0-9]{40}$/.test(config.releaseCommit ?? '') || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/.test(config.releaseId ?? '') || config.releaseId.startsWith('dpl_')) throw Error('Pinned release identifiers required');
  for (const key of ['appPort', 'gatewayPort']) if (!Number.isInteger(config[key]) || config[key] < 1024 || config[key] > 65535 || reservedPorts.includes(config[key])) throw Error('Dedicated host ports required');
  if (config.appPort === config.gatewayPort) throw Error('Distinct listeners required');
  const origin = new URL(config.publicOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== config.publicOrigin || origin.username || origin.password || origin.hash) throw Error('Fixed HTTPS origin required');
  if (env.PC_APP_RUNTIME !== 'true' || env.NEXT_PUBLIC_PC_APP_RUNTIME !== 'true' || env.PC_BACKEND_ENABLED !== 'true' || env.NEXT_PUBLIC_PC_BACKEND !== 'true') throw Error('Explicit PC application required');
  if (env.APP_PUBLIC_ORIGIN !== config.publicOrigin || env.NEXT_PUBLIC_SUPABASE_URL !== `${config.publicOrigin}/api/pc-supabase`) throw Error('Single application origin required');
  if (env.VERCEL || env.VERCEL_ENV || env.NEXT_PUBLIC_PC_REST_RELAY_ORIGIN || env.NEXT_PUBLIC_PC_TRIAL === 'true') throw Error('Independent host required');
  if (env.VERCEL_GIT_COMMIT_SHA !== config.releaseCommit || env.PC_APP_RELEASE_ID !== config.releaseId) throw Error('Release environment mismatch');
  const local = env.PC_LOCAL_RUNTIME === 'true';
  if (local !== (env.NEXT_PUBLIC_PC_LOCAL_RUNTIME === 'true')) throw Error('Local runtime flags must agree');
  if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY || (!local && (!env.NEXT_PUBLIC_CLOUD_AUTH_URL || !env.NEXT_PUBLIC_CLOUD_AUTH_ANON_KEY))) throw Error('Explicit authentication and PC credentials required');
  const actionKey = env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY ?? '';
  if (Buffer.from(actionKey, 'base64').length !== 32 || Buffer.from(actionKey, 'base64').toString('base64') !== actionKey) throw Error('Fixed 256-bit Server Action encryption key required');
  const synthetic = env.PC_APP_SYNTHETIC_REVIEW === 'true';
  if (synthetic !== (env.NEXT_PUBLIC_PC_APP_SYNTHETIC_REVIEW === 'true')) throw Error('Synthetic flags must agree');
  if (local) {
    const loopback = value => {
      try { const url = new URL(value); return value === url.origin && url.protocol === 'http:' && url.hostname === '127.0.0.1' && Number(url.port) >= 1024 && Number(url.port) <= 65535 && ![...reservedPorts, config.appPort, config.gatewayPort].includes(Number(url.port)); } catch { return false; }
    };
    if (!loopback(env.PC_LOCAL_AUTH_URL) || !loopback(env.PC_LOCAL_REST_URL) || env.PC_LOCAL_AUTH_URL === env.PC_LOCAL_REST_URL || env.PC_BACKEND_INTERNAL_URL) throw Error('Distinct private local Auth/REST required');
    for (const key of ['NEXT_PUBLIC_CLOUD_AUTH_URL','NEXT_PUBLIC_CLOUD_AUTH_ANON_KEY','NEXT_PUBLIC_CLOUD_AUTH_MODE','R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_NAME']) if (env[key]) throw Error('Local application may not contain cloud Auth/image settings');
    if (env.IMAGE_STORAGE_DRIVER !== 'local' || env.R2_READ_ENABLED !== 'false' || env.R2_WRITE_ENABLED !== 'false') throw Error('Local private images required');
    const root = env.LOCAL_IMAGE_STORAGE_ROOT, size = Number(env.LOCAL_IMAGE_MAX_STORAGE_BYTES);
    if (!isAbsolute(root ?? '') || resolve(root) !== root || root === parse(root).root || !outsideRelease(root) ||
        Buffer.byteLength(env.LOCAL_IMAGE_SIGNING_KEY ?? '') < 32 || !Number.isSafeInteger(size) || size <= 0) throw Error('Separate private image directory, signing key and capacity required');
    if (synthetic && (!/(?:\.example\.test|\.localhost)$/.test(origin.hostname) || env.SHEET_SYNC_ENABLED !== 'false' || env.GOOGLE_DRIVE_CLIENT_SECRET || env.SHEET_SYNC_GAS_URL)) throw Error('Synthetic local release may not enable external providers');
    if(!synthetic) {
      try {const parts=env.NEXT_PUBLIC_SUPABASE_ANON_KEY.split('.'),decode=part=>JSON.parse(Buffer.from(part,'base64url').toString('utf8'));
        if(parts.length!==3||!['HS256','ES256','RS256'].includes(decode(parts[0]).alg)||decode(parts[1]).role!=='anon')throw Error();
      } catch {throw Error('Local public key must be an anon JWT; privileged keys remain private');}
    }
  } else if (synthetic) {
    const loopback = value => {
      try { const url = new URL(value); return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.origin === value && Number(url.port) >= 18180 && Number(url.port) <= 18999; } catch { return false; }
    };
    if (!/(?:\.example\.test|\.localhost)$/.test(origin.hostname) || !loopback(env.PC_BACKEND_INTERNAL_URL) || !loopback(env.NEXT_PUBLIC_CLOUD_AUTH_URL) || env.PC_BACKEND_INTERNAL_URL === env.NEXT_PUBLIC_CLOUD_AUTH_URL || env.NEXT_PUBLIC_CLOUD_AUTH_MODE !== 'test' || env.IMAGE_STORAGE_READ_ONLY !== 'true' || env.R2_READ_ENABLED !== 'false' || env.R2_WRITE_ENABLED !== 'false' || env.SHEET_SYNC_ENABLED !== 'false') throw Error('Independent synthetic targets required');
    for (const key of ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'GOOGLE_DRIVE_CLIENT_SECRET', 'SHEET_SYNC_GAS_URL']) if (env[key]) throw Error('Synthetic release may not contain external provider credentials');
  } else {
    if (env.PC_BACKEND_INTERNAL_URL !== 'http://127.0.0.1:8000' || env.NEXT_PUBLIC_CLOUD_AUTH_MODE === 'test') throw Error('Established PC data and cloud Auth required');
    for (const key of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']) if (!env[key]) throw Error(`Missing ${key}`);
    if (env.R2_READ_ENABLED !== 'true' || env.R2_WRITE_ENABLED !== 'true' || env.IMAGE_STORAGE_READ_ONLY === 'true') throw Error('Preserve private R2 images');
  }
  for (const file of forbiddenEnvFiles) if (lstatExists(resolve(config.releaseDirectory, file))) throw Error('Release may not contain automatically loaded environment files');
}
function lstatExists(path) { try { lstatSync(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
export function digestTree(directory, { exclude = [] } = {}) {
  const digest = createHash('sha256');
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name))) {
      const path = resolve(dir, entry.name);
      if (exclude.includes(relative(directory, path).replaceAll('\\','/'))) continue;
      if (entry.isSymbolicLink()) throw Error('Release tree cannot contain symbolic links');
      if (entry.isDirectory()) visit(path);
      else { const bytes = readFileSync(path); digest.update(relative(directory, path).replaceAll('\\','/')).update('\0').update(String(bytes.length)).update('\0').update(bytes); }
    }
  };
  visit(directory); return digest.digest('hex');
}
export function buildHash(directory) { return digestTree(resolve(directory, '.next'), { exclude: ['cache', 'trace', 'trace-build', 'diagnostics'] }); }
export function sourceProof(directory, commit) {
  const exactDirectory = verifiedReleaseDirectory(directory);
  // An immutable release may be SYSTEM-owned. Trust only this checked path for
  // this command; never change global Git trust or allow a directory wildcard.
  const git = hostGitPath();
  // Windows checkouts already use CRLF normalization from the Git installation.
  // Keep that fixed behavior after excluding mutable system/global settings;
  // the runtime manifest still binds each actual source byte independently.
  const run = args => execFileSync(git, ['-c', `safe.directory=${exactDirectory}`, '-c', `core.autocrlf=${process.platform === 'win32'}`, '-C', exactDirectory, ...args], { encoding: 'utf8', windowsHide: true, env: hostGitEnvironment() }).trim();
  if (run(['rev-parse', 'HEAD']) !== commit || run(['status', '--porcelain', '--untracked-files=normal'])) throw Error('Release requires its exact clean commit');
  return { commit, lockfileHash: createHash('sha256').update(readFileSync(resolve(directory, 'package-lock.json'))).digest('hex'), nodeVersion: process.version };
}
export function environmentHash(env) {
  return createHash('sha256').update(JSON.stringify(Object.entries(env).sort(([a],[b])=>a.localeCompare(b)))).digest('hex');
}
export function privateDirectory(directory) {
  if (!isAbsolute(directory) || resolve(directory) === parse(resolve(directory)).root) throw Error('Dedicated private directory required');
  const tools = process.platform === 'win32' ? { whoami: hostWindowsToolPath('whoami'), icacls: hostWindowsToolPath('icacls') } : undefined;
  const created = !lstatExists(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
  if (normalize(realpathSync(directory)) !== normalize(resolve(directory)) || lstatSync(directory).isSymbolicLink()) throw Error('Private directory may not be redirected');
  if (process.platform === 'win32') {
    if (created) {
      const owner = execFileSync(tools.whoami, { encoding: 'utf8', windowsHide: true }).trim();
      execFileSync(tools.icacls, [directory, '/inheritance:r', '/grant:r', `${owner}:(OI)(CI)(F)`, 'SYSTEM:(OI)(CI)(F)'], { stdio: 'ignore', windowsHide: true });
    }
    const script = "$ErrorActionPreference='Stop'; $owner=[Security.Principal.WindowsIdentity]::GetCurrent().User; $system=[Security.Principal.SecurityIdentifier]::new('S-1-5-18'); $check=Get-Acl -LiteralPath $env:TUAT_HOST_PRIVATE_PATH; if(!$check.AreAccessRulesProtected -or $check.Access.Count -ne 2){throw 'Private ACL invalid'}; foreach($rule in $check.Access){ if($rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @($owner.Value,$system.Value) -or $rule.AccessControlType -ne 'Allow'){throw 'Private ACL invalid'} }";
    execFileSync(resolve(process.env.ProgramFiles, 'PowerShell/7/pwsh.exe'), ['-NoProfile','-NonInteractive','-Command',script], { stdio: 'ignore', windowsHide: true, env: { ...process.env, PSModulePath: resolve(process.env.ProgramFiles, 'PowerShell/7/Modules'), TUAT_HOST_PRIVATE_PATH: directory } });
  } else chmodSync(directory, 0o700);
}
export function writeReceipt(directory, name, value) {
  if (!/^[A-Za-z0-9_-]+\.json$/.test(name)) throw Error('Simple receipt filename required');
  privateDirectory(directory);
  const target = resolve(directory, name);
  if (relative(directory, target) !== name) throw Error('Receipt path escaped');
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  renameSync(temp, target);
}
export function loadHost(configFile) {
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  const env = parseEnv(readFileSync(config.environmentFile, 'utf8'));
  validateHostConfig(config, env);
  return { config, env };
}
export function verifyPrepared(config, env) {
  const receipt = JSON.parse(readFileSync(resolve(config.stateDirectory, 'prepared.json'), 'utf8'));
  if (receipt.version !== 2) throw runtimeRebuildRequired('Prepared receipt is obsolete; rebuild required');
  verifyRuntimeManifest(receipt.runtime, config.releaseDirectory);
  const source = sourceProof(config.releaseDirectory, config.releaseCommit);
  if (receipt.releaseCommit !== config.releaseCommit || receipt.releaseId !== config.releaseId || receipt.environmentHash !== environmentHash(env) || receipt.buildHash !== buildHash(config.releaseDirectory) || receipt.source?.lockfileHash !== source.lockfileHash || receipt.source?.nodeVersion !== source.nodeVersion) throw Error('Prepared release no longer matches');
  if (JSON.parse(readFileSync(resolve(config.releaseDirectory, '.next/required-server-files.json'), 'utf8')).config?.deploymentId !== config.releaseId) throw Error('Build deployment mismatch');
  return receipt;
}
