// Shared byte limit for local CLI input and individual MCP stdio messages.
export const MAX_BYTES = 1024 * 1024;
export async function readBounded(stream) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > MAX_BYTES) throw Object.assign(new Error('Input exceeds 1 MiB.'), { code: 'INPUT_TOO_LARGE' });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
