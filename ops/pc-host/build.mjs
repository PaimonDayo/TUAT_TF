import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { existsSync, rmSync, openSync, closeSync } from 'node:fs';
import { loadHost, privateDirectory, writeReceipt, buildHash, environmentHash, sourceProof } from './release.mjs';

export async function build(configFile) {
  const { config, env } = loadHost(configFile);
  const source = sourceProof(config.releaseDirectory, config.releaseCommit);
  if (config.enabled) throw Error('Disable candidate before building');
  if (existsSync(resolve(config.stateDirectory, 'runner.lock'))) throw Error('Host lock must be resolved before building');
  privateDirectory(config.stateDirectory);
  rmSync(resolve(config.stateDirectory, 'prepared.json'), { force: true });
  const childEnv = { ...env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' };
  for (const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE']) if (process.env[key]) childEnv[key] = process.env[key];
  const log = openSync(resolve(config.stateDirectory, `build-${Date.now()}.log`), 'wx', 0o600);
  let exitCode;
  try {
    exitCode = await new Promise((resolveExit, reject) => {
      const child = spawn(process.execPath, [resolve(config.releaseDirectory, 'node_modules/next/dist/bin/next'), 'build', '--webpack'], { cwd: config.releaseDirectory, env: childEnv, windowsHide: true, stdio: ['ignore',log,log] });
      child.once('error', reject); child.once('exit', resolveExit);
    });
  } finally { closeSync(log); }
  if (exitCode !== 0) throw Error('Candidate build failed');
  sourceProof(config.releaseDirectory, config.releaseCommit);
  const receipt = { version: 1, releaseCommit: config.releaseCommit, releaseId: config.releaseId, preparedAt: new Date().toISOString(), environmentHash: environmentHash(env), buildHash: buildHash(config.releaseDirectory), source };
  writeReceipt(config.stateDirectory, 'prepared.json', receipt);
  return { prepared: true, releaseCommit: config.releaseCommit, releaseId: config.releaseId };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build(process.argv[2]).then(result => console.log(JSON.stringify(result))).catch(() => { console.error('Candidate build failed; inspect protected diagnostics'); process.exitCode = 1; });
}
