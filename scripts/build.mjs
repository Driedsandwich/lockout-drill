import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import Lockout from '../core.mjs';

const root = new URL('../', import.meta.url);
async function writeGenerated(path, content) {
  try {
    if (await readFile(path, 'utf8') === content) return;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = new URL(path.href + '.' + process.pid + '.tmp');
  await writeFile(temporary, content);
  await rename(temporary, path);
}
const htmlPath = new URL('index.html', root);
const html = await readFile(htmlPath, 'utf8');
const start = '<!-- core:start -->', end = '<!-- core:end -->';
if (html.split(start).length !== 2 || html.split(end).length !== 2 || html.indexOf(start) >= html.indexOf(end)) {
  throw new Error('Expected one ordered pair of core build markers.');
}
const source = await readFile(new URL('core.mjs', root), 'utf8');
const suffix = '\nexport default Lockout;\n';
if (!source.endsWith(suffix)) throw new Error('Unexpected core export format.');
const embedded = source.slice(0, -suffix.length);
if (/<\/script/i.test(embedded)) throw new Error('Core contains an unsafe script terminator.');
const output = html.slice(0, html.indexOf(start) + start.length) + '\n<script id="lockout-core">\n' + embedded + '\n</script>\n' + html.slice(html.indexOf(end));
await writeGenerated(htmlPath, output);
for (const [file, data] of [['schema/inventory.schema.json', Lockout.inventorySchema], ['examples/mika.json', Lockout.sample()]]) {
  await mkdir(new URL(file.split('/')[0] + '/', root), { recursive: true });
  await writeGenerated(new URL(file, root), JSON.stringify(data, null, 2) + '\n');
}
