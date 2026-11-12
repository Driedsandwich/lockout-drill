import { createReadStream } from 'node:fs';
import Lockout from './core.mjs';
import { readBounded } from './scripts/input.mjs';

const usage = 'Usage:\n  node cli.mjs analyze [inventory.json|-] [--lose phone] [--json]\n  node cli.mjs fixes [inventory.json|-] [--json]\nOmit the file to read stdin. Use fictional method metadata only.';
const args = process.argv.slice(2);
const json = args.includes('--json');
function fail(code, message) {
  console.log(JSON.stringify({ ok: false, error: { code, message } }));
  process.exitCode = 2;
}
function parse() {
  const [command, ...rest] = args;
  if (!['analyze', 'fixes'].includes(command)) throw new Error(usage);
  let file, lose = 'phone';
  const seen = new Set();
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--json' || arg === '--lose') {
      if (seen.has(arg)) throw new Error(usage);
      seen.add(arg);
      if (arg === '--lose') {
        if (command !== 'analyze' || rest[++i] !== 'phone') throw new Error(usage);
        lose = 'phone';
      }
    } else if (file === undefined && (!arg.startsWith('-') || arg === '-')) file = arg;
    else throw new Error(usage);
  }
  return { command, file, lose };
}
async function main() {
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return; }
  let options;
  try { options = parse(); } catch { fail('USAGE', usage); return; }
  let text;
  try { text = await readBounded(options.file && options.file !== '-' ? createReadStream(options.file) : process.stdin); }
  catch (error) { fail(error.code === 'INPUT_TOO_LARGE' ? error.code : 'INPUT_ERROR', error.code === 'INPUT_TOO_LARGE' ? 'Input exceeds 1 MiB.' : 'Cannot read inventory input.'); return; }
  let inventory;
  try { inventory = JSON.parse(text); } catch { fail('INVALID_JSON', 'Input must be valid JSON.'); return; }
  const result = options.command === 'analyze' ? Lockout.analyzeLockout(inventory, options.lose) : Lockout.suggestFixes(inventory);
  if (!result.ok) { fail(result.error.code, result.error.message); return; }
  if (json) { console.log(JSON.stringify(result)); return; }
  console.log(`Lost phone: ${result.counts.locked} Locked out, ${result.counts.available} Available, ${result.counts.unknown} Unknown`);
  if (result.accounts) for (const a of result.accounts) console.log(`${a.status}: ${a.chain}\n  ${a.explanation}`);
  if (result.fixes) for (const f of result.fixes) console.log(`${f.title}: ${f.rescued} conditional rescues\n  Assumes: ${f.assumptions.join(' ')}`);
  console.log('Simulation only; real recovery is unverified. Unknown is not safe. Fix counts are independent and must not be added.');
}
await main();
