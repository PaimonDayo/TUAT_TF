import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readConfig, writePrivate, configPath, directory } from './backend-files.mjs';
const action = process.argv[2] ?? 'status';
const config = readConfig();
if (action === 'maintenance-on' || action === 'maintenance-off') {
  if (action === 'maintenance-off' && config.returnAt && Date.now() >= Date.parse(config.returnAt)) throw Error('The authorized PC operation period has ended');
  config.maintenance = action === 'maintenance-on';
  writePrivate(configPath, JSON.stringify(config));
  console.log(`Maintenance: ${config.maintenance}`);
} else if (action === 'status') {
  const read = name => { try { return JSON.parse(readFileSync(resolve(directory, name), 'utf8')); } catch { return null; } };
  const runtime = read('runtime-status.json'), backup = read('backup-status.json');
  console.log(JSON.stringify({ phase: config.phase, maintenance: config.maintenance, startedAt: config.startedAt, returnAt: config.returnAt,
    heartbeatAt: runtime?.checkedAt, healthy: runtime?.healthy, backupAt: backup?.completedAt, backupBytes: backup?.bytes }, null, 2));
} else throw Error('Expected status, maintenance-on or maintenance-off');
