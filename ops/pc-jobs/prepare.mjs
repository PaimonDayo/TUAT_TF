// Produce a new, isolated release from tracked HEAD plus the reviewed relay files.
// No env secrets, network, Git mutation, DB writes, tasks or deployment.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const directory = resolve(process.argv[2] ?? '');
const target = process.argv[3];
if (!process.argv[2] || !['pc', 'vercel'].includes(target) || !directory.startsWith(resolve(root, '.contingency') + (process.platform === 'win32' ? '\\' : '/'))) throw Error('Usage: node prepare.mjs <new .contingency directory> pc|vercel');
mkdirSync(directory); // Must not overwrite an existing release.
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const archive = execFileSync('git', ['archive', '--format=tar', commit], { cwd: root, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
execFileSync('tar', ['-xf', '-', '-C', directory], { input: archive, windowsHide: true });
symlinkSync(resolve(root, 'node_modules'), resolve(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
const vercel = JSON.parse(readFileSync(resolve(directory, 'vercel.json'), 'utf8'));
// Only the staged candidate removes cron; the actual workspace stays scheduled.
vercel.crons = [];
writeFileSync(resolve(directory, 'vercel.json'), JSON.stringify(vercel, null, 2) + '\n');
writeFileSync(resolve(directory, 'pc-jobs-release.json'), JSON.stringify({ commit, database: target === 'pc' ? 'pc-loopback' : 'pc-relay', target }, null, 2));
console.log(JSON.stringify({ prepared: true, commit, target, directory, built: false, deployed: false }));
