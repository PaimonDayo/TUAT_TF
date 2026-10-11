import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateConfig } from './check-config.mjs';

function filledSyntheticConfig() {
  return {
    name: 'pc-entry', main: './worker.mjs', compatibility_date: '2026-10-11', workers_dev: true,
    vars: { APP_PUBLIC_ORIGIN: 'https://pc-entry.review-account.workers.dev' },
    // Synthetic format-only fixture; this is not an account resource.
    vpc_services: [{ binding: 'PC_APP', service_id: '00000000-0000-0000-0000-000000000000', remote: true }],
  };
}

test('checked-in placeholders cannot pass local configuration validation', async () => {
  const template = JSON.parse(await readFile(new URL('./wrangler.example.json', import.meta.url), 'utf8'));
  assert.throws(() => validateConfig(template), /Replace the Worker name placeholder/);
});

test('fully specified synthetic fixed origin and one VPC binding passes format checks only', () => {
  assert.doesNotThrow(() => validateConfig(filledSyntheticConfig()));
});

test('unfilled service ID and duplicate/extra service bindings are rejected', () => {
  for (const services of [[], [{ binding: 'PC_APP', service_id: 'REPLACE_WITH_ID', remote: true }],
    [filledSyntheticConfig().vpc_services[0], filledSyntheticConfig().vpc_services[0]],
    [{ ...filledSyntheticConfig().vpc_services[0], binding: 'DATABASE' }],
    [{ ...filledSyntheticConfig().vpc_services[0], remote: false }]]) {
    assert.throws(() => validateConfig({ ...filledSyntheticConfig(), vpc_services: services }), /VPC Service|PC_APP/);
  }
});

test('wrong public hostname, noncanonical HTTPS and deployment routes fail locally', () => {
  for (const origin of ['https://other.review-account.workers.dev', 'https://pc-entry.review-account.workers.dev/',
    'http://pc-entry.review-account.workers.dev', 'https://pc-entry.example.test']) {
    assert.throws(() => validateConfig({ ...filledSyntheticConfig(), vars: { APP_PUBLIC_ORIGIN: origin } }), /APP_PUBLIC_ORIGIN/);
  }
  assert.throws(() => validateConfig({ ...filledSyntheticConfig(), routes: ['example.test/*'] }), /Only the fixed entry/);
});

test('alternate entrypoint and unexpected public variables are rejected', () => {
  assert.throws(() => validateConfig({ ...filledSyntheticConfig(), main: './other.mjs' }), /worker.mjs/);
  assert.throws(() => validateConfig({ ...filledSyntheticConfig(), vars: { ...filledSyntheticConfig().vars, TOKEN: 'synthetic' } }), /Only APP_PUBLIC_ORIGIN/);
});
