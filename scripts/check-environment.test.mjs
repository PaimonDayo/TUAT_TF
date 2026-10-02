import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { checkEnvironment } from './check-environment.mjs';

function fixture(t) {
  const temporaryDirectory = resolve(tmpdir());
  const root = mkdtempSync(join(temporaryDirectory, 'tuat-environment-test-'));
  t.after(() => {
    assert.equal(dirname(resolve(root)), temporaryDirectory);
    assert.ok(basename(root).startsWith('tuat-environment-test-'));
    rmSync(root, { recursive: true, force: true });
  });
  const write = (path, value) => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(value));
  };
  const manifest = { dependencies: { next: '16.3.6', react: '19.2.4', 'react-dom': '19.2.4' }, devDependencies: { typescript: '^5' } };
  const versions = { next: '16.3.6', react: '19.2.4', 'react-dom': '19.2.4', typescript: '5.9.3' };
  const lock = { lockfileVersion: 3, packages: { '': structuredClone(manifest) } };
  for (const [name, version] of Object.entries(versions)) {
    lock.packages[`node_modules/${name}`] = { version };
    write(`node_modules/${name}/package.json`, { name, version });
  }
  write('package.json', manifest);
  write('package-lock.json', lock);
  return { root, manifest, lock, write, check: (nodeVersion = '22.12.0') => checkEnvironment({ root, nodeVersion }) };
}

test('accepts the minimum and newer Node releases when direct dependencies match', (t) => {
  const f = fixture(t);
  for (const version of ['22.12.0', '22.13.0', '24.0.0']) {
    assert.deepEqual(f.check(version), { errors: [], checkedPackages: 4, nodeVersion: version });
  }
});

test('rejects older, invalid and prerelease Node versions', (t) => {
  const f = fixture(t);
  for (const version of ['18.17.0', '20.99.0', '22.11.9', '22.12.0-rc.1', 'invalid']) {
    assert.match(f.check(version).errors.join('\n'), /Node\.js .*22\.12\.0/);
  }
});

test('detects changed, missing and extra dependency declarations in either manifest', (t) => {
  const f = fixture(t);
  f.manifest.dependencies.next = '16.3.7';
  delete f.manifest.dependencies.react;
  f.manifest.dependencies['@example/new'] = '^1';
  f.write('package.json', f.manifest);
  const errors = f.check().errors.join('\n');
  for (const name of ['next', 'react', '@example/new']) assert.ok(errors.includes(`dependencies.${name}`));
});

test('rejects a stale installed Next even when both manifests agree', (t) => {
  const f = fixture(t);
  f.write('node_modules/next/package.json', { version: '16.2.9' });
  const result = f.check();
  assert.equal(result.checkedPackages, 3);
  assert.match(result.errors.join('\n'), /next: .*16\.2\.9.*16\.3\.6/);
});

test('missing packages and missing locked versions cannot report success', (t) => {
  const f = fixture(t);
  rmSync(join(f.root, 'node_modules/react/package.json'));
  delete f.lock.packages['node_modules/typescript'];
  f.write('package-lock.json', f.lock);
  const errors = f.check().errors.join('\n');
  assert.match(errors, /node_modules\/react\/package\.json/);
  assert.match(errors, /typescript.*package-lock\.json/);
});

test('invalid metadata cannot report success', (t) => {
  const f = fixture(t);
  f.write('package.json', []);
  f.write('package-lock.json', { lockfileVersion: 1 });
  const errors = f.check().errors;
  assert.equal(errors.length, 2);
  assert.match(errors[0], /package\.json/);
  assert.match(errors[1], /ルートパッケージ/);
});

test('valid scoped dependencies are checked and invalid names are never resolved as paths', (t) => {
  const f = fixture(t);
  f.manifest.dependencies['@example/tool'] = '1.0.0';
  f.manifest.dependencies['../../private'] = '1.0.0';
  f.lock.packages[''].dependencies = { ...f.manifest.dependencies };
  f.lock.packages['node_modules/@example/tool'] = { version: '1.0.0' };
  f.write('node_modules/@example/tool/package.json', { version: '1.0.0' });
  f.write('package.json', f.manifest);
  f.write('package-lock.json', f.lock);
  const result = f.check();
  assert.equal(result.checkedPackages, 5);
  assert.deepEqual(result.errors, ['package.json に不正な依存パッケージ名があります。']);
});
