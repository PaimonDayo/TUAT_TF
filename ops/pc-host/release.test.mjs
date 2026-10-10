import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { validateHostConfig, writeReceipt } from './release.mjs';

const config = { version: 1, enabled: false, releaseDirectory: resolve(import.meta.dirname, '../..'), stateDirectory: resolve(import.meta.dirname, '../../../.contingency/host-test-state'), environmentFile: resolve(import.meta.dirname, '../../../.contingency/host-test.env'), releaseCommit: 'a'.repeat(40), releaseId: 'review-fixed', publicOrigin: 'https://pc-review.example.test', appPort: 18200, gatewayPort: 18201 };
const env = { PC_APP_RUNTIME:'true', NEXT_PUBLIC_PC_APP_RUNTIME:'true', PC_BACKEND_ENABLED:'true', NEXT_PUBLIC_PC_BACKEND:'true', APP_PUBLIC_ORIGIN:config.publicOrigin, NEXT_PUBLIC_SUPABASE_URL:config.publicOrigin+'/api/pc-supabase', PC_BACKEND_INTERNAL_URL:'http://127.0.0.1:18180', NEXT_PUBLIC_CLOUD_AUTH_URL:'http://127.0.0.1:18181', NEXT_PUBLIC_CLOUD_AUTH_ANON_KEY:'synthetic', NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic', SUPABASE_SERVICE_ROLE_KEY:'synthetic', VERCEL_GIT_COMMIT_SHA:config.releaseCommit, PC_APP_RELEASE_ID:config.releaseId, NEXT_SERVER_ACTIONS_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'), PC_APP_SYNTHETIC_REVIEW:'true', NEXT_PUBLIC_PC_APP_SYNTHETIC_REVIEW:'true', NEXT_PUBLIC_CLOUD_AUTH_MODE:'test', IMAGE_STORAGE_READ_ONLY:'true', R2_READ_ENABLED:'false', R2_WRITE_ENABLED:'false', SHEET_SYNC_ENABLED:'false' };
test('synthetic host cannot accidentally reach established PC or providers', () => {
  validateHostConfig(config, env);
  for (const changes of [{NEXT_PUBLIC_PC_APP_SYNTHETIC_REVIEW:'false'}, {PC_BACKEND_INTERNAL_URL:'http://127.0.0.1:8000'}, {NEXT_PUBLIC_CLOUD_AUTH_URL:'https://real.supabase.co'}, {R2_SECRET_ACCESS_KEY:'fixture-external'}, {GOOGLE_DRIVE_CLIENT_SECRET:'fixture-external'}, {R2_READ_ENABLED:'true'}, {SHEET_SYNC_ENABLED:'true'}]) assert.throws(()=>validateHostConfig(config,{...env,...changes}));
});
test('release identity/origin/path and canonical key guards fail before writes', () => {
  for (const changes of [{publicOrigin:'http://pc-review.example.test'},{releaseId:'dpl_reserved'},{releaseCommit:'wrong'},{appPort:8000},{stateDirectory:config.releaseDirectory},{stateDirectory:resolve(config.releaseDirectory,'state')}]) assert.throws(()=>validateHostConfig({...config,...changes},env));
  assert.throws(()=>validateHostConfig(config,{...env,NEXT_SERVER_ACTIONS_ENCRYPTION_KEY:env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY+'!'}));
  for (const name of ['../escape.json','C:/escape.json','different/name.json']) assert.throws(()=>writeReceipt(config.stateDirectory,name,{}));
});
