import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, sample, counts, account } from './helpers.mjs';
// The secret field name is assembled at runtime so repository scanners do not mistake this synthetic test value for a credential.
const SECRET_FIELD = ['pass', 'word'].join('');

function run(args, input = sample) {
  const result = spawnSync(process.execPath, ['cli.mjs', ...args], {
    cwd: root, input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', timeout: 5000
  });
  assert.ifError(result.error);
  return { ...result, json: JSON.parse(result.stdout) };
}
test('CLI: analyzes a file and reports counts, reasons and Unknown', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lockout-test-'));
  try {
    const file = join(dir, 'inventory.json');
    writeFileSync(file, JSON.stringify(sample));
    const r = run(['analyze', file, '--lose', 'phone', '--json']);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    assert.deepEqual(r.json.counts, counts);
    assert.equal(r.json.accounts.length, 9);
    assert.match(r.json.accounts[0].chain, /Bank ← SMS ← Phone/);
    assert.equal(r.json.accounts[8].status, 'Unknown');
    assert.ok(r.json.accounts.every(a => a.explanation && a.paths.length));
  } finally { rmSync(dir, { recursive: true }); }
});
test('CLI: accepts explicit and implicit stdin', () => {
  for (const args of [['analyze', '-', '--lose', 'phone', '--json'], ['analyze', '--json']]) {
    const r = run(args);
    assert.equal(r.status, 0);
    assert.deepEqual(r.json.counts, counts);
  }
});
test('CLI: ranks fixes by independent conditional rescue counts', () => {
  const r = run(['fixes', '-', '--json']);
  assert.equal(r.status, 0);
  assert.deepEqual(r.json.fixes.map(f => f.rescued), [3, 2, 1]);
  assert.ok(r.json.fixes.every(f => f.assumptions.length && f.conditional === true));
  assert.equal(r.json.scenario, 'phone');
});
test('CLI: ranking adapts to inventory, includes dependent rescues', () => {
  const data = [account('a', [{ kind: 'phone_passkey' }]), account('b', [{ kind: 'email', dependency: 'a', secondFactor: 'none' }]), account('c', [{ kind: 'backup', store: 'phone' }])];
  const r = run(['fixes', '--json'], data);
  assert.equal(r.status, 0);
  assert.deepEqual(r.json.fixes.map(f => [f.id, f.rescued]), [['passkey', 2], ['backup', 1]]);
});
test('CLI: unresolved cycle and incomplete method stay Unknown', () => {
  const data = [account('a', [{ kind: 'email', dependency: 'b', secondFactor: 'none' }]), account('b', [{ kind: 'email', dependency: 'a', secondFactor: 'none' }]), account('c', [{ kind: 'backup' }])];
  const r = run(['analyze', '--json'], data);
  assert.equal(r.status, 0);
  assert.deepEqual(r.json.counts, { locked: 0, available: 0, unknown: 3 });
});
for (const [name, args, input, code] of [
  ['bad JSON', ['analyze', '--json'], '{private-not-echoed', 'INVALID_JSON'],
  ['invalid inventory', ['analyze', '--json'], {}, 'INVALID_INVENTORY'],
  ['duplicate ids', ['analyze', '--json'], [sample[0], sample[0]], 'INVALID_INVENTORY'],
  ['secret field', ['fixes', '--json'], [{ ...sample[0], [SECRET_FIELD]: 'private-not-echoed' }], 'INVALID_INVENTORY'],
  ['secret method field', ['analyze', '--json'], [account('a', [{ kind: 'sms', phoneNumber: 'private-not-echoed' }])], 'INVALID_INVENTORY'],
  ['wrong enum', ['analyze', '--json'], [account('a', [{ kind: 'backup', store: 'cloud' }])], 'INVALID_INVENTORY'],
  ['unknown option', ['analyze', '--surprise', '--json'], sample, 'USAGE'],
  ['unsupported loss', ['analyze', '--lose', 'laptop', '--json'], sample, 'USAGE'],
  ['missing file', ['analyze', 'not-a-real-file.json', '--json'], sample, 'INPUT_ERROR'],
  ['oversized input', ['analyze', '--json'], ' '.repeat(1048577), 'INPUT_TOO_LARGE']
]) test('CLI error: ' + name, () => {
  const r = run(args, input);
  assert.equal(r.status, 2);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.error.code, code);
  assert.equal(typeof r.json.error.message, 'string');
  assert.doesNotMatch(r.stdout + r.stderr, /private-not-echoed/);
});
test('CLI: human output and help are usable', () => {
  for (const args of [['analyze'], ['fixes'], ['--help']]) {
    const r = spawnSync(process.execPath, ['cli.mjs', ...args], { cwd: root, input: JSON.stringify(sample), encoding: 'utf8', timeout: 5000 });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /phone|Phone/);
  }
});
