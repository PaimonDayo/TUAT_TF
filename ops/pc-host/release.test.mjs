import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { validateHostConfig, writeReceipt, verifyPrepared, sourceProof, environmentHash, buildHash, privateDirectory,applicationLaunch } from './release.mjs';
import { createHash } from 'node:crypto';

test('Linux controller drops compiler/application privileges with a pinned command',()=>{
  const binary=Buffer.from('synthetic sandbox binary'),pin=createHash('sha256').update(binary).digest('hex');
  const config={applicationUid:65530,applicationGid:65530,applicationHome:resolve(tmpdir(),'private-app-home'),setprivSha256:pin,unshareSha256:pin,mountSha256:pin,sandboxScript:resolve(tmpdir(),'root-sandbox.sh'),sandboxScriptSha256:pin};
  const options={platform:'linux',ownerUid:0,readBinary:()=>binary,readMetadata:path=>path===config.applicationHome?{isDirectory:()=>true,isSymbolicLink:()=>false,uid:65530,mode:0o700}:{isFile:()=>true,isSymbolicLink:()=>false,uid:0,mode:0o500}};
  assert.deepEqual(applicationLaunch(config,['candidate-next','start'],options),{command:'/usr/bin/unshare',args:['--mount','--propagation','private','/bin/sh',config.sandboxScript,'65530','65530',process.execPath,'candidate-next','start']});
  for(const change of [{applicationUid:0},{applicationGid:0},{applicationUid:NaN},{applicationGid:3.5},{setprivSha256:'0'.repeat(64)}])
    assert.throws(()=>applicationLaunch({...config,...change},[],options));
  assert.throws(()=>applicationLaunch({},[],options));
  assert.throws(()=>applicationLaunch(config,[],{...options,ownerUid:65530}));
  assert.throws(()=>applicationLaunch(config,[],{...options,platform:'win32'}));
  for(const metadata of [{isDirectory:()=>false},{isSymbolicLink:()=>true},{uid:0},{mode:0o777}])
    assert.throws(()=>applicationLaunch(config,[],{...options,readMetadata:path=>path===config.applicationHome?{...options.readMetadata(path),...metadata}:options.readMetadata(path)}));
  for(const changed of [{sandboxScriptSha256:'0'.repeat(64)},{unshareSha256:'0'.repeat(64)},{mountSha256:'0'.repeat(64)}])assert.throws(()=>applicationLaunch({...config,...changed},[],options));
  assert.throws(()=>applicationLaunch(config,[],{...options,readMetadata:path=>path===config.sandboxScript?{...options.readMetadata(path),uid:65530}:options.readMetadata(path)}));
  assert.deepEqual(applicationLaunch({},['next'],{platform:'win32'}),{command:process.execPath,args:['next']});
});
import { createRuntimeManifest, verifyRuntimeManifest, hostGitPath, hostGitEnvironment, hostWindowsToolPath } from './runtime-manifest.mjs';

const config = { version: 1, enabled: false, releaseDirectory: resolve(import.meta.dirname, '../..'), stateDirectory: resolve(import.meta.dirname, '../../../.contingency/host-test-state'), environmentFile: resolve(import.meta.dirname, '../../../.contingency/host-test.env'), backupConfigFile: resolve(import.meta.dirname, '../../../.contingency/backup-test.json'), expectedBackupInstanceId: '00000000-0000-4000-8000-000000000001', expectedBackupDatabaseSystemIdentifier: '1234567890123456789', releaseCommit: 'a'.repeat(40), releaseId: 'review-fixed', publicOrigin: 'https://pc-review.example.test', appPort: 18200, gatewayPort: 18201 };
const env = { PC_APP_RUNTIME:'true', NEXT_PUBLIC_PC_APP_RUNTIME:'true', PC_BACKEND_ENABLED:'true', NEXT_PUBLIC_PC_BACKEND:'true', APP_PUBLIC_ORIGIN:config.publicOrigin, NEXT_PUBLIC_SUPABASE_URL:config.publicOrigin+'/api/pc-supabase', PC_BACKEND_INTERNAL_URL:'http://127.0.0.1:18180', NEXT_PUBLIC_CLOUD_AUTH_URL:'http://127.0.0.1:18181', NEXT_PUBLIC_CLOUD_AUTH_ANON_KEY:'synthetic', NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic', SUPABASE_SERVICE_ROLE_KEY:'synthetic', VERCEL_GIT_COMMIT_SHA:config.releaseCommit, PC_APP_RELEASE_ID:config.releaseId, NEXT_SERVER_ACTIONS_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'), PC_APP_SYNTHETIC_REVIEW:'true', NEXT_PUBLIC_PC_APP_SYNTHETIC_REVIEW:'true', NEXT_PUBLIC_CLOUD_AUTH_MODE:'test', IMAGE_STORAGE_READ_ONLY:'true', R2_READ_ENABLED:'false', R2_WRITE_ENABLED:'false', SHEET_SYNC_ENABLED:'false' };
test('synthetic host cannot accidentally reach established PC or providers', () => {
  validateHostConfig(config, env);
  for (const changes of [{NEXT_PUBLIC_PC_APP_SYNTHETIC_REVIEW:'false'}, {PC_BACKEND_INTERNAL_URL:'http://127.0.0.1:8000'}, {NEXT_PUBLIC_CLOUD_AUTH_URL:'https://real.supabase.co'}, {R2_SECRET_ACCESS_KEY:'fixture-external'}, {GOOGLE_DRIVE_CLIENT_SECRET:'fixture-external'}, {R2_READ_ENABLED:'true'}, {SHEET_SYNC_ENABLED:'true'}]) assert.throws(()=>validateHostConfig(config,{...env,...changes}));
});
test('local Auth/image release is explicit and rejects cloud, public ports and release-local image data', () => {
  const local={...env,PC_LOCAL_RUNTIME:'true',NEXT_PUBLIC_PC_LOCAL_RUNTIME:'true',PC_LOCAL_AUTH_URL:'http://127.0.0.1:18001',PC_LOCAL_REST_URL:'http://127.0.0.1:18002',
    PC_BACKEND_INTERNAL_URL:'',NEXT_PUBLIC_CLOUD_AUTH_URL:'',NEXT_PUBLIC_CLOUD_AUTH_ANON_KEY:'',NEXT_PUBLIC_CLOUD_AUTH_MODE:'',
    IMAGE_STORAGE_DRIVER:'local',LOCAL_IMAGE_STORAGE_ROOT:resolve(config.stateDirectory,'images'),LOCAL_IMAGE_SIGNING_KEY:'synthetic-local-key-only'.repeat(3),LOCAL_IMAGE_MAX_STORAGE_BYTES:'8000000000'};
  validateHostConfig(config,local);
  for(const changes of [{NEXT_PUBLIC_PC_LOCAL_RUNTIME:'false'},{NEXT_PUBLIC_CLOUD_AUTH_URL:'https://issuer.supabase.co'},{R2_SECRET_ACCESS_KEY:'synthetic'},
    {PC_LOCAL_AUTH_URL:'http://0.0.0.0:18001'},{PC_LOCAL_REST_URL:local.PC_LOCAL_AUTH_URL},{PC_LOCAL_REST_URL:'http://127.0.0.1:18200'},
    {LOCAL_IMAGE_STORAGE_ROOT:resolve(config.releaseDirectory,'public/images')},{LOCAL_IMAGE_STORAGE_ROOT:resolve(config.releaseDirectory,'..private/images')},{LOCAL_IMAGE_SIGNING_KEY:'short'},{R2_READ_ENABLED:'true'}]) assert.throws(()=>validateHostConfig(config,{...local,...changes}));
});
test('release identity/origin/path and canonical key guards fail before writes', () => {
  for (const changes of [{publicOrigin:'http://pc-review.example.test'},{releaseId:'dpl_reserved'},{releaseCommit:'wrong'},{appPort:8000},{stateDirectory:config.releaseDirectory},{stateDirectory:resolve(config.releaseDirectory,'state')}]) assert.throws(()=>validateHostConfig({...config,...changes},env));
  assert.throws(()=>validateHostConfig(config,{...env,NEXT_SERVER_ACTIONS_ENCRYPTION_KEY:env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY+'!'}));
  for (const name of ['../escape.json','C:/escape.json','different/name.json']) assert.throws(()=>writeReceipt(config.stateDirectory,name,{}));
});

function releaseFixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'pc-runtime-receipt-'));
  t.after(() => {
    const location = relative(tmpdir(), base);
    assert.ok(location && !location.startsWith('..') && !isAbsolute(location));
    rmSync(base, { recursive: true, force: true });
  });
  const releaseDirectory = join(base, 'release');
  const stateDirectory = join(base, 'state');
  const hooks = join(base, 'empty-hooks');
  for (const directory of [stateDirectory, hooks, join(releaseDirectory, 'public'), join(releaseDirectory, '.next'), join(releaseDirectory, 'node_modules/transitive')]) mkdirSync(directory, { recursive: true });
  writeFileSync(join(releaseDirectory, '.gitignore'), '/node_modules/\n/.next/\n');
  writeFileSync(join(releaseDirectory, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}\n');
  writeFileSync(join(releaseDirectory, 'runtime-entry.mjs'), 'export const fixed = true;\n');
  writeFileSync(join(releaseDirectory, 'public/asset.txt'), 'public release asset');
  writeFileSync(join(releaseDirectory, 'node_modules/transitive/index.js'), 'export const value = 1;\n');
  writeFileSync(join(releaseDirectory, 'node_modules/transitive/addon.node'), Buffer.from([0, 1, 2, 3]));
  writeFileSync(join(releaseDirectory, '.next/required-server-files.json'), JSON.stringify({ config: { deploymentId: config.releaseId } }));
  const git = args => execFileSync('git', ['-C', releaseDirectory, '-c', `core.hooksPath=${hooks}`, '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { encoding: 'utf8', windowsHide: true }).trim();
  git(['init', '--quiet']);
  git(['add', '--', '.gitignore', 'package-lock.json', 'runtime-entry.mjs', 'public/asset.txt']);
  git(['-c', 'user.name=Runtime fixture', '-c', 'user.email=fixture@example.test', 'commit', '--quiet', '-m', 'Fixture release']);
  const fixtureConfig = { ...config, releaseDirectory, stateDirectory, environmentFile: join(stateDirectory, 'environment.env'), releaseCommit: git(['rev-parse', 'HEAD']) };
  const fixtureEnv = { ...env, VERCEL_GIT_COMMIT_SHA: fixtureConfig.releaseCommit };
  const receipt = { version: 2, releaseCommit: fixtureConfig.releaseCommit, releaseId: fixtureConfig.releaseId, environmentHash: environmentHash(fixtureEnv), buildHash: buildHash(releaseDirectory), source: sourceProof(releaseDirectory, fixtureConfig.releaseCommit), runtime: createRuntimeManifest(releaseDirectory) };
  return { config: fixtureConfig, env: fixtureEnv, receipt, git, save: value => writeFileSync(join(stateDirectory, 'prepared.json'), JSON.stringify(value)) };
}

test('legacy prepared receipts require an explicit rebuild', t => {
  const f = releaseFixture(t);
  f.save({ ...f.receipt, version: 1 });
  assert.throws(() => verifyPrepared(f.config, f.env), /rebuild/i);
});

test('the legacy-receipt CLI reports rebuild without echoing configuration or credentials', t => {
  const f = releaseFixture(t);
  f.save({ ...f.receipt, version: 1 });
  const configFile = join(f.config.stateDirectory, 'config.json');
  writeFileSync(configFile, JSON.stringify(f.config));
  writeFileSync(f.config.environmentFile, Object.entries(f.env).map(([key, value]) => `${key}=${value}`).join('\n'));
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, 'run.mjs'), configFile], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), 'PC host receipt requires a rebuild; no host was started.');
});

test('prepared receipt rejects changed transitive JavaScript and native dependency bytes', async t => {
  for (const name of ['index.js', 'addon.node']) await t.test(name, child => {
    const f = releaseFixture(child);
    f.save(f.receipt);
    assert.equal(verifyPrepared(f.config, f.env).releaseCommit, f.config.releaseCommit);
    writeFileSync(join(f.config.releaseDirectory, 'node_modules/transitive', name), 'changed runtime bytes');
    // These files are Git-ignored: the runtime manifest must catch this drift.
    assert.doesNotThrow(() => sourceProof(f.config.releaseDirectory, f.config.releaseCommit));
    assert.throws(() => verifyPrepared(f.config, f.env), /Runtime artifacts changed/);
  });
});

test('public bytes and the Node executable are bound independently of Git cleanliness', t => {
  const f = releaseFixture(t);
  writeFileSync(join(f.config.releaseDirectory, 'public/asset.txt'), 'different public bytes');
  assert.throws(() => verifyRuntimeManifest(f.receipt.runtime, f.config.releaseDirectory), /Runtime artifacts changed/);
  writeFileSync(join(f.config.releaseDirectory, 'public/asset.txt'), 'public release asset');
  assert.throws(() => verifyRuntimeManifest({ ...f.receipt.runtime, nodeExecutableHash: '0'.repeat(64) }, f.config.releaseDirectory), /Runtime artifacts changed/);
});

test('runtime code drift cannot be hidden with a Git skip-worktree entry', t => {
  const f = releaseFixture(t);
  f.save(f.receipt);
  f.git(['update-index', '--skip-worktree', '--', 'runtime-entry.mjs']);
  writeFileSync(join(f.config.releaseDirectory, 'runtime-entry.mjs'), 'export const fixed = false;\n');
  assert.doesNotThrow(() => sourceProof(f.config.releaseDirectory, f.config.releaseCommit));
  assert.throws(() => verifyPrepared(f.config, f.env), /Runtime artifacts changed/);
});

test('Git proof ignores ambient includes, external helpers and metadata overrides', t => {
  const f = releaseFixture(t);
  const root = f.config.releaseDirectory;
  writeFileSync(join(root, '.gitattributes'), 'runtime-entry.mjs filter=reviewProbe\n');
  f.git(['add', '--', '.gitattributes']);
  f.git(['-c', 'user.name=Runtime fixture', '-c', 'user.email=fixture@example.test', 'commit', '--quiet', '-m', 'Fixture attribute binding']);
  const commit = f.git(['rev-parse', 'HEAD']);
  const baseline = createRuntimeManifest(root);
  const sentinel = join(f.config.stateDirectory, 'external-helper-ran');
  const probe = join(f.config.stateDirectory, 'external-helper.mjs');
  writeFileSync(probe, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'SYNTHETIC_HELPER'); process.stdout.write('untrusted');\n`);
  const command = JSON.stringify(`"${process.execPath.replaceAll('\\', '/')}" "${probe.replaceAll('\\', '/')}"`);
  const included = join(f.config.stateDirectory, 'external.gitconfig');
  const externalConfig = join(f.config.stateDirectory, 'ambient.gitconfig');
  writeFileSync(included, `[core]\nfsmonitor = ${command}\nignoreStat = true\n[filter "reviewProbe"]\nclean = ${command}\nrequired = true\n`);
  writeFileSync(externalConfig, `[include]\npath = ${JSON.stringify(included.replaceAll('\\', '/'))}\n`);
  const overrides = {
    GIT_CONFIG_GLOBAL: externalConfig, GIT_CONFIG_SYSTEM: externalConfig, GIT_CONFIG_NOSYSTEM: '0',
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: JSON.parse(command),
    HOME: f.config.stateDirectory, XDG_CONFIG_HOME: f.config.stateDirectory,
    SUPABASE_SERVICE_ROLE_KEY: 'SYNTHETIC_MUST_NOT_REACH_GIT',
  };
  const keys = [...Object.keys(overrides), 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE'];
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, overrides);
    const childEnvironment = hostGitEnvironment();
    assert.equal(childEnvironment.GIT_CONFIG_NOSYSTEM, '1');
    assert.equal(childEnvironment.GIT_CONFIG_GLOBAL, process.platform === 'win32' ? 'NUL' : '/dev/null');
    assert.equal(childEnvironment.SUPABASE_SERVICE_ROLE_KEY, undefined);
    assert.equal(childEnvironment.GIT_CONFIG_COUNT, undefined);
    assert.equal(childEnvironment.HOME, undefined);
    assert.equal(childEnvironment.PATH, undefined);
    assert.equal(sourceProof(root, commit).commit, commit);
    assert.doesNotThrow(() => verifyRuntimeManifest(baseline, root));
    assert.equal(existsSync(sentinel), false);
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']) process.env[key] = join(f.config.stateDirectory, 'missing-external-metadata');
    assert.equal(sourceProof(root, commit).commit, commit);
    assert.doesNotThrow(() => verifyRuntimeManifest(baseline, root));
    assert.throws(() => sourceProof(root, '0'.repeat(40)), /exact clean commit/);
    writeFileSync(join(root, 'runtime-entry.mjs'), 'export const fixed = false;\n');
    assert.throws(() => sourceProof(root, commit), /exact clean commit/);
    assert.throws(() => verifyRuntimeManifest(baseline, root), /Runtime artifacts changed/);
    assert.equal(existsSync(sentinel), false);
  } finally {
    for (const key of keys) if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
  }
});

test('Windows CRLF remains Git-clean while actual source bytes stay receipt-bound', { skip: process.platform !== 'win32' }, t => {
  const f = releaseFixture(t);
  const root = f.config.releaseDirectory;
  const source = join(root, 'runtime-entry.mjs');
  writeFileSync(source, 'export const fixed = true;\r\n');
  // Refresh the synthetic index with normal Windows checkout normalization.
  // Its blob/commit stays LF; the working bytes and index stat become CRLF.
  f.git(['-c', 'core.autocrlf=true', 'add', '--', 'runtime-entry.mjs']);
  writeFileSync(source, 'export const fixed = true;\r\n');
  assert.doesNotThrow(() => sourceProof(root, f.config.releaseCommit));
  assert.throws(() => verifyRuntimeManifest(f.receipt.runtime, root), /Runtime artifacts changed/);
  const rebuilt = createRuntimeManifest(root);
  assert.doesNotThrow(() => verifyRuntimeManifest(rebuilt, root));
  writeFileSync(source, 'export const fixed = false;\r\n');
  assert.throws(() => sourceProof(root, f.config.releaseCommit), /exact clean commit/);
  assert.throws(() => verifyRuntimeManifest(rebuilt, root), /Runtime artifacts changed/);
});

test('added or removed ignored dependencies also invalidate the receipt', t => {
  const f = releaseFixture(t);
  f.save(f.receipt);
  const added = join(f.config.releaseDirectory, 'node_modules/transitive/added.js');
  writeFileSync(added, 'unexpected module');
  assert.throws(() => verifyPrepared(f.config, f.env), /Runtime artifacts changed/);
  rmSync(added);
  rmSync(join(f.config.releaseDirectory, 'node_modules/transitive/addon.node'));
  assert.throws(() => verifyPrepared(f.config, f.env), /Runtime artifacts changed/);
});

test('foreign platform, architecture, Node version and obsolete manifest fail closed', t => {
  const f = releaseFixture(t);
  for (const change of [{platform: process.platform === 'win32' ? 'linux' : 'win32'}, {architecture: process.arch === 'x64' ? 'arm64' : 'x64'}, {nodeVersion:'v0.0.0'}, {version:0}]) {
    f.save({ ...f.receipt, runtime: { ...f.receipt.runtime, ...change } });
    assert.throws(() => verifyPrepared(f.config, f.env), /rebuild required/);
  }
  f.save({ ...f.receipt, runtime: undefined });
  assert.throws(() => verifyPrepared(f.config, f.env), /rebuild required/);
});

test('only the named root tool cache is mutable', t => {
  const f = releaseFixture(t);
  const root = f.config.releaseDirectory;
  mkdirSync(join(root, 'node_modules/.cache'), { recursive: true });
  writeFileSync(join(root, 'node_modules/.cache/tool-state'), 'temporary cache');
  assert.doesNotThrow(() => verifyRuntimeManifest(f.receipt.runtime, root));
  assert.throws(() => verifyRuntimeManifest({ ...f.receipt.runtime, excludedPaths: ['node_modules'] }, root), /invalid/);
  mkdirSync(join(root, 'node_modules/transitive/.cache'), { recursive: true });
  writeFileSync(join(root, 'node_modules/transitive/.cache/module.js'), 'package file');
  assert.throws(() => verifyRuntimeManifest(f.receipt.runtime, root), /Runtime artifacts changed/);
});

test('PATH shadow tools cannot replace pinned Git or Windows ACL tools', t => {
  const f = releaseFixture(t);
  const shadow = join(f.config.stateDirectory, 'shadow-bin');
  mkdirSync(shadow);
  for (const name of ['git', 'whoami', 'icacls']) {
    const path = join(shadow, process.platform === 'win32' ? `${name}.exe` : name);
    writeFileSync(path, process.platform === 'win32' ? 'not an executable' : '#!/bin/sh\nexit 99\n');
    if (process.platform !== 'win32') chmodSync(path, 0o755);
  }
  const pathKey = process.platform === 'win32' && Object.hasOwn(process.env, 'Path') ? 'Path' : 'PATH';
  const original = process.env[pathKey];
  try {
    process.env[pathKey] = shadow;
    const expectedGit = process.platform === 'win32' ? resolve(process.env.ProgramFiles, 'Git/cmd/git.exe') : '/usr/bin/git';
    assert.equal(hostGitPath(), expectedGit);
    assert.doesNotThrow(() => sourceProof(f.config.releaseDirectory, f.config.releaseCommit));
    assert.doesNotThrow(() => verifyRuntimeManifest(f.receipt.runtime, f.config.releaseDirectory));
    if (process.platform === 'win32') {
      for (const name of ['whoami', 'icacls']) assert.equal(hostWindowsToolPath(name), resolve(process.env.SystemRoot, `System32/${name}.exe`));
      assert.doesNotThrow(() => privateDirectory(join(f.config.stateDirectory, 'private-tool-proof')));
    }
  } finally {
    if (original === undefined) delete process.env[pathKey]; else process.env[pathKey] = original;
  }
});

test('unavailable pinned tools fail clearly without PATH fallback or private-directory creation', { skip: process.platform !== 'win32' }, t => {
  const f = releaseFixture(t);
  const originalPrograms = process.env.ProgramFiles;
  const originalWindows = process.env.SystemRoot;
  try {
    process.env.ProgramFiles = f.config.stateDirectory;
    assert.throws(() => sourceProof(f.config.releaseDirectory, f.config.releaseCommit), error => error.code === 'ERR_PC_HOST_TOOL_UNAVAILABLE' && /Pinned Git/.test(error.message));
    process.env.ProgramFiles = originalPrograms;
    process.env.SystemRoot = f.config.stateDirectory;
    const privatePath = join(f.config.stateDirectory, 'must-not-create');
    assert.throws(() => privateDirectory(privatePath), error => error.code === 'ERR_PC_HOST_TOOL_UNAVAILABLE' && /Pinned whoami/.test(error.message));
    assert.equal(existsSync(privatePath), false);
  } finally {
    if (originalPrograms === undefined) delete process.env.ProgramFiles; else process.env.ProgramFiles = originalPrograms;
    if (originalWindows === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = originalWindows;
  }
});

test('redirected releases and dependency/cache junctions are rejected', async t => {
  for (const name of ['node_modules/external', 'node_modules/.cache']) await t.test(name, child => {
    const f = releaseFixture(child);
    symlinkSync(f.config.stateDirectory, join(f.config.releaseDirectory, name), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => createRuntimeManifest(f.config.releaseDirectory), /redirected|escaped/);
  });
  const f = releaseFixture(t);
  const redirected = join(f.config.stateDirectory, 'redirected-release');
  symlinkSync(f.config.releaseDirectory, redirected, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => sourceProof(redirected, f.config.releaseCommit), /redirected/);
});

test('internal npm executable links are bound and external links rejected', { skip: process.platform === 'win32' }, t => {
  const f = releaseFixture(t);
  const root = f.config.releaseDirectory;
  mkdirSync(join(root, 'node_modules/.bin'));
  symlinkSync('../transitive/index.js', join(root, 'node_modules/.bin/fixture'));
  mkdirSync(join(root,'node_modules/parent/node_modules/.bin'),{recursive:true});
  mkdirSync(join(root,'node_modules/parent/node_modules/tool'));
  writeFileSync(join(root,'node_modules/parent/node_modules/tool/cli.js'),'nested executable bytes');
  symlinkSync('../tool/cli.js',join(root,'node_modules/parent/node_modules/.bin/tool'));
  const manifest = createRuntimeManifest(root);
  assert.doesNotThrow(() => verifyRuntimeManifest(manifest, root));
  writeFileSync(join(root,'node_modules/parent/node_modules/tool/cli.js'),'changed nested bytes');
  assert.throws(()=>verifyRuntimeManifest(manifest,root),/changed/);
  rmSync(join(root,'node_modules/parent/node_modules/.bin/tool'));
  symlinkSync('../../../transitive/index.js',join(root,'node_modules/parent/node_modules/.bin/tool'));
  assert.throws(()=>createRuntimeManifest(root),/escaped/);
  rmSync(join(root,'node_modules/parent/node_modules/.bin/tool'));
  rmSync(join(root, 'node_modules/.bin/fixture'));
  writeFileSync(join(f.config.stateDirectory, 'external.js'), 'external bytes');
  symlinkSync('../../../state/external.js', join(root, 'node_modules/.bin/fixture'));
  assert.throws(() => createRuntimeManifest(root), /escaped/);
});
