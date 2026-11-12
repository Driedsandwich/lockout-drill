import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { root, sample, counts } from './helpers.mjs';

test('shared core: module agrees with embedded model and does not mutate inputs', async () => {
  const { default: core } = await import('../core.mjs');
  const original = JSON.stringify(sample);
  assert.deepEqual(core.analyzeLockout(sample).counts, counts);
  assert.deepEqual(core.sample(), sample);
  core.suggestFixes(sample);
  assert.equal(JSON.stringify(sample), original);
});
test('build: checked-in HTML, schema and sample are reproducible', () => {
  const files = ['index.html', 'schema/inventory.schema.json', 'examples/mika.json'];
  const before = files.map(f => readFileSync(root + f, 'utf8'));
  const r = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(files.map(f => readFileSync(root + f, 'utf8')), before);
  assert.match(before[0], /<!-- core:start -->[\s\S]*<script id="lockout-core">[\s\S]*<!-- core:end -->/);
});
test('schema: closed inventory and method objects, fictional sample matches', async () => {
  const { default: core } = await import('../core.mjs');
  const schema = JSON.parse(readFileSync(root + 'schema/inventory.schema.json', 'utf8'));
  const example = JSON.parse(readFileSync(root + 'examples/mika.json', 'utf8'));
  assert.deepEqual(schema, core.inventorySchema);
  assert.equal(schema.items.additionalProperties, false);
  assert.ok(schema.items.properties.methods.items.oneOf.every(s => s.additionalProperties === false));
  assert.deepEqual(example, core.sample());
  assert.deepEqual(core.analyzeLockout(example).counts, counts);
});
