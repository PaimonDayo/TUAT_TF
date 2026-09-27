// Build the disabled, pinned local release. Never dispatch jobs.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import { validateConfig } from './run.mjs';
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const env = parseEnv(readFileSync(config.environmentFile, 'utf8'));
validateConfig(config, env);
if (config.enabled) throw Error('Disable and drain jobs before building a release');
const manifest = JSON.parse(readFileSync(resolve(config.releaseDirectory, 'pc-jobs-release.json'), 'utf8'));
if (manifest.commit !== config.releaseCommit) throw Error('Commit mismatch');
for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE']) if (process.env[key]) env[key] = process.env[key];
const child = spawn(process.execPath, [resolve(config.releaseDirectory, 'node_modules/next/dist/bin/next'), 'build'], { cwd: config.releaseDirectory, env: { ...env, NODE_ENV: 'production' }, stdio: 'inherit', windowsHide: true });
child.on('error', () => { process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
