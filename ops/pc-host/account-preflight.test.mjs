import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const shell = resolve(process.env.ProgramFiles ?? 'C:/Program Files', 'PowerShell/7/pwsh.exe');
test('Windows host ACLs and standalone Git metadata enforce the account boundary', { skip: process.platform !== 'win32' }, () => {
  const result = spawnSync(shell, ['-NoProfile','-NonInteractive','-File',resolve(directory,'account-preflight.test.ps1')], { encoding:'utf8', windowsHide:true, timeout:30000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /refusal checks passed/);
});
test('sharing the development principal refuses preflight before reading host configuration', { skip: process.platform !== 'win32' }, () => {
  const identity = spawnSync('whoami', [], { encoding:'utf8', windowsHide:true });
  assert.equal(identity.status, 0);
  const result = spawnSync(shell, ['-NoProfile','-NonInteractive','-File',resolve(directory,'account-preflight.ps1'),'-NodePath',process.execPath,'-ConfigPath',resolve(directory,'missing-host-config.json'),'-RuntimeAccount',identity.stdout.trim(),'-DevelopmentAccount',identity.stdout.trim(),'-PowerShellPath',shell], { encoding:'utf8', windowsHide:true, timeout:30000 });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout.trim());
  assert.equal(report.accepted, false);
  assert.match(report.reason, /separate non-administrator/);
});
