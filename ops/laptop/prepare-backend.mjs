import { existsSync } from 'node:fs';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { configPath, writePrivate, readConfig, cloudEnv, localEnv, directory } from './backend-files.mjs';

if (existsSync(configPath)) { console.log('Backend configuration exists; preserved.'); process.exit(0); }
const local = localEnv(), cloud = cloudEnv();
if (!local.SUPABASE_SERVICE_ROLE_KEY || !cloud.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing local/cloud recovery key');
writePrivate(configPath, JSON.stringify({ version: 1, instanceId: randomUUID(), bridgeKey: randomBytes(32).toString('hex'),
  siteUrl: 'https://tuat-tf.vercel.app', maintenance: true, startedAt: null, returnAt: null,
  backupKey: createHash('sha256').update('tuat-pc-backup-v1\0' + cloud.SUPABASE_SERVICE_ROLE_KEY).digest('hex'),
}, null, 2));
const config = readConfig();
const env = { PC_BACKEND_ENABLED: 'true', NEXT_PUBLIC_PC_BACKEND: 'true', NEXT_PUBLIC_SUPABASE_URL: `${config.siteUrl}/api/pc-supabase`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: local.NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: local.SUPABASE_SERVICE_ROLE_KEY,
  PC_BACKEND_BRIDGE_KEY: config.bridgeKey, PC_BACKEND_INSTANCE_ID: config.instanceId, GOOGLE_TOKEN_ENCRYPTION_KEY: local.GOOGLE_TOKEN_ENCRYPTION_KEY,
};
writePrivate(resolve(directory, 'vercel-env.json'), JSON.stringify(env, null, 2));
console.log('Prepared isolated backend configuration and targeted Vercel variables; no secrets displayed or uploaded.');
