import Lockout from '../core.mjs';
import { MAX_BYTES } from '../scripts/input.mjs';
import { once } from 'node:events';

// Dependency-free, newline-delimited JSON-RPC over local stdio only.
const protocolVersion = '2025-11-25';
let initialized = false, ready = false;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const error = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
function dispatch(text) {
  let message;
  try { message = JSON.parse(text); } catch { return error(null, -32700, 'Invalid JSON.'); }
  if (!object(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' ||
      (Object.hasOwn(message, 'id') && !(typeof message.id === 'string' || Number.isSafeInteger(message.id))) ||
      (Object.hasOwn(message, 'params') && !object(message.params))) return error(null, -32600, 'Invalid request.');
  const { id, method, params = {} } = message;
  if (!Object.hasOwn(message, 'id')) {
    if (method === 'notifications/initialized' && initialized) ready = true;
    return null;
  }
  const result = value => ({ jsonrpc: '2.0', id, result: value });
  if (method === 'ping') return result({});
  if (method === 'initialize') {
    if (initialized) return error(id, -32600, 'Already initialized.');
    if (typeof params.protocolVersion !== 'string' || !object(params.capabilities) || !object(params.clientInfo) || typeof params.clientInfo.name !== 'string' || typeof params.clientInfo.version !== 'string') return error(id, -32602, 'Invalid initialization parameters.');
    initialized = true;
    return result({ protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'lockout-drill', version: '1.0.0' }, instructions: 'Use fictional metadata only. Results are simulations; Unknown is not safe. Fix counts assume verified independent recovery paths and must not be summed.' });
  }
  if (!ready) return error(id, -32002, 'Initialize and send notifications/initialized first.');
  if (method === 'tools/list') {
    if (params.cursor !== undefined) return error(id, -32602, 'No pagination cursor is supported.');
    return result({ tools: Lockout.tools });
  }
  if (method === 'tools/call') {
    if (!Lockout.tools.some(t => t.name === params.name)) return error(id, -32602, 'Unknown tool.');
    const data = Lockout.callTool(params.name, params.arguments);
    return result({ content: [{ type: 'text', text: JSON.stringify(data) }], ...(data.ok ? { structuredContent: data } : {}), isError: !data.ok });
  }
  return error(id, -32601, 'Method not found.');
}
async function send(message) {
  if (message && !process.stdout.write(JSON.stringify(message) + '\n')) await once(process.stdout, 'drain');
}
// Bound memory even when a peer never sends a newline. Drop oversized frames
// through their delimiter, then recover for the next request.
let pieces = [], size = 0, dropping = false;
for await (const chunk of process.stdin) {
  let offset = 0;
  while (offset < chunk.length) {
    const newline = chunk.indexOf(10, offset);
    const end = newline === -1 ? chunk.length : newline;
    const part = chunk.subarray(offset, end);
    if (!dropping) {
      size += part.length;
      if (size > MAX_BYTES) { dropping = true; pieces = []; }
      else pieces.push(part);
    }
    if (newline !== -1) {
      await send(dropping ? error(null, -32600, 'Message exceeds 1 MiB.') : dispatch(Buffer.concat(pieces).toString('utf8')));
      pieces = []; size = 0; dropping = false;
    }
    offset = end + 1;
  }
}
if (size || dropping) await send(error(null, -32600, 'Unterminated or oversized message.'));
