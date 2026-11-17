import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { root, sample, counts } from './helpers.mjs';
// The secret field name is assembled at runtime so repository scanners do not mistake this synthetic test value for a credential.
const SECRET_FIELD = ['pass', 'word'].join('');
const request = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
const init = version => request(1, 'initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'test', version: '1' } });
const ready = { jsonrpc: '2.0', method: 'notifications/initialized' };
function exchange(messages, initialize = true) {
  const input = (initialize ? [init('2025-11-25'), ready, ...messages] : messages).map(m => typeof m === 'string' ? m : JSON.stringify(m)).join('\n') + '\n';
  const r = spawnSync(process.execPath, ['mcp/server.mjs'], { cwd: root, input, encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1048576 });
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  return r.stdout.trim().split('\n').map(line => JSON.parse(line));
}
test('MCP: initializes, lists two typed tools and handles ping', () => {
  const [hello, list, ping] = exchange([request(2, 'tools/list'), request(3, 'ping')]);
  assert.equal(hello.result.protocolVersion, '2025-11-25');
  assert.deepEqual(hello.result.capabilities, { tools: { listChanged: false } });
  assert.deepEqual(list.result.tools.map(t => t.name), ['analyze_lockout', 'suggest_fixes']);
  for (const t of list.result.tools) {
    assert.equal(t.inputSchema.type, 'object');
    assert.ok(t.inputSchema.required.includes('inventory'));
    assert.equal(t.inputSchema.additionalProperties, false);
    assert.equal(t.outputSchema.type, 'object');
    assert.equal(t.annotations.readOnlyHint, true);
    assert.equal(t.annotations.openWorldHint, false);
  }
  assert.deepEqual(ping.result, {});
});
test('MCP: analyze returns structured and text results, preserving Unknown', () => {
  const [, r] = exchange([request('analyze', 'tools/call', { name: 'analyze_lockout', arguments: { inventory: sample, lose: 'phone' } })]);
  assert.equal(r.id, 'analyze');
  assert.equal(r.result.isError, false);
  assert.deepEqual(r.result.structuredContent.counts, counts);
  assert.equal(r.result.structuredContent.accounts[8].status, 'Unknown');
  assert.deepEqual(JSON.parse(r.result.content[0].text), r.result.structuredContent);
});
test('MCP: fixes return sorted conditional simulations', () => {
  const [, r] = exchange([request(2, 'tools/call', { name: 'suggest_fixes', arguments: { inventory: sample } })]);
  assert.deepEqual(r.result.structuredContent.fixes.map(f => f.rescued), [3, 2, 1]);
  assert.ok(r.result.structuredContent.fixes.every(f => f.conditional && f.assumptions.length));
});
test('MCP: negotiates an unsupported protocol to a supported version', () => {
  const [r] = exchange([init('2099-01-01')], false);
  assert.equal(r.result.protocolVersion, '2025-11-25');
});
test('MCP: rejects use before initialization', () => {
  const [r] = exchange([request(1, 'tools/list')], false);
  assert.equal(r.error.code, -32002);
});
test('MCP: invalid initialize parameters can be corrected', () => {
  const [bad, good] = exchange([request(1, 'initialize', {}), init('2025-11-25')], false);
  assert.equal(bad.error.code, -32602);
  assert.equal(good.result.protocolVersion, '2025-11-25');
});
test('MCP: malformed frames, invalid requests and unknown methods recover', () => {
  const [, parse, invalid, unknown, ping] = exchange(['{', [], request(3, 'missing'), request(4, 'ping')]);
  assert.equal(parse.error.code, -32700);
  assert.equal(parse.id, null);
  assert.equal(invalid.error.code, -32600);
  assert.equal(unknown.error.code, -32601);
  assert.deepEqual(ping.result, {});
});
test('MCP: notifications do not receive responses', () => {
  const results = exchange([{ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 99 } }, request(2, 'ping')]);
  assert.equal(results.length, 2);
  assert.equal(results[1].id, 2);
});
test('MCP: unknown tool is a protocol error', () => {
  const [, r] = exchange([request(2, 'tools/call', { name: 'missing', arguments: {} })]);
  assert.equal(r.error.code, -32602);
});
test('MCP: tool input errors have JSON error data and do not echo values', () => {
  for (const args of [{}, { inventory: {} }, { inventory: sample, lose: 'tablet' }, { inventory: sample, [SECRET_FIELD]: 'private-not-echoed' }, { inventory: [{ ...sample[0], [SECRET_FIELD]: 'private-not-echoed' }] }]) {
    const [, r] = exchange([request(2, 'tools/call', { name: 'analyze_lockout', arguments: args })]);
    assert.equal(r.result.isError, true);
    const data = JSON.parse(r.result.content[0].text);
    assert.equal(data.ok, false);
    assert.equal(typeof data.error.code, 'string');
    assert.doesNotMatch(JSON.stringify(r), /private-not-echoed/);
  }
});
test('MCP: oversized frames are rejected and the next frame still works', () => {
  const [, bad, ping] = exchange([' '.repeat(1048577), request(2, 'ping')]);
  assert.equal(bad.error.code, -32600);
  assert.deepEqual(ping.result, {});
});
