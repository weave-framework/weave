/**
 * Renaming a template binding renames the `const` behind it — and everything that reads it.
 *
 * Renaming from a template already worked, and left two names for one thing: TypeScript renames the ctx
 * PROPERTY, cannot rename a shorthand's const through it, and so expands `return { count }` into
 * `return { total: count }`. Correct, and not what anyone meant.
 *
 * The fixture is built so a naive fix FAILS it: `count` is read inside another const in the same setup.
 * Renaming just the declaration would leave that reader pointing at a name that no longer exists — a
 * silently broken file, which is worse than the shorthand it replaced. So the assertion is on the whole
 * file after the edits, not on the declaration alone.
 *
 * Run after `build:ls` (wired into `pnpm verify:ls`).
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
const serverPath = join(root, 'packages/language-server/dist/server.cjs');
const tsdk = dirname(require.resolve('typescript'));

const dir = join(process.env.TEMP || '/tmp', 'weave-ls-rename');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const TS = [
  'export function setup() {',
  '  const count = (): number => 1;',
  '  const twice = (): number => count() * 2;',
  '  return { count, twice };',
  '}',
  '',
].join('\n');
const HTML = ['<article>', '  <p>{{ count() }} / {{ twice() }}</p>', '</article>', ''].join('\n');
const TS_WANT = [
  'export function setup() {',
  '  const total = (): number => 1;',
  '  const twice = (): number => total() * 2;',
  '  return { total, twice };',
  '}',
  '',
].join('\n');
const HTML_WANT = ['<article>', '  <p>{{ total() }} / {{ twice() }}</p>', '</article>', ''].join('\n');

const tsPath = join(dir, 'Card.ts');
const htmlPath = join(dir, 'Card.html');
writeFileSync(tsPath, TS);
writeFileSync(htmlPath, HTML);
const htmlUri = pathToFileURL(htmlPath).toString();
const norm = (u) => decodeURIComponent(u).toLowerCase();

const child = spawn(process.execPath, [serverPath, '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', (d) => (stderr += d.toString()));
let seq = 0;
const answers = new Map();
const send = (method, params, isReq) => {
  const msg = { jsonrpc: '2.0', method, params };
  if (isReq) msg.id = ++seq;
  const b = Buffer.from(JSON.stringify(msg), 'utf8');
  child.stdin.write(`Content-Length: ${b.length}\r\n\r\n`);
  child.stdin.write(b);
  return msg.id;
};
let buf = Buffer.alloc(0);
child.stdout.on('data', (c) => {
  buf = Buffer.concat([buf, c]);
  for (;;) {
    const h = buf.indexOf('\r\n\r\n');
    if (h === -1) break;
    const m = /Content-Length: (\d+)/i.exec(buf.slice(0, h).toString());
    if (!m) break;
    const len = Number(m[1]);
    const st = h + 4;
    if (buf.length < st + len) break;
    const j = JSON.parse(buf.slice(st, st + len).toString('utf8'));
    buf = buf.slice(st + len);
    if (j.id !== undefined && j.method) {
      const b = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: j.id, result: null }), 'utf8');
      child.stdin.write(`Content-Length: ${b.length}\r\n\r\n`);
      child.stdin.write(b);
    } else if (j.id !== undefined) answers.set(j.id, j.result);
  }
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => {
  console.error(`\n✖ ${msg}`);
  if (stderr.trim()) console.error('--- server stderr ---\n' + stderr.trim().split('\n').slice(-12).join('\n'));
  child.kill();
  process.exit(1);
};

send(
  'initialize',
  {
    processId: process.pid,
    rootUri: pathToFileURL(dir).toString(),
    capabilities: { textDocument: { publishDiagnostics: {}, rename: { prepareSupport: true } } },
    initializationOptions: { typescript: { tsdk } },
  },
  true
);
send('initialized', {});
send('textDocument/didOpen', { textDocument: { uri: htmlUri, languageId: 'weave-html', version: 1, text: HTML } });
await wait(4000);

// `  <p>{{ count() }} …` — inside `count`.
const id = send('textDocument/rename', { textDocument: { uri: htmlUri }, position: { line: 1, character: 10 }, newName: 'total' }, true);
for (let i = 0; i < 60 && !answers.has(id); i++) await wait(250);
const edit = answers.get(id);
if (!edit?.changes) fail('rename returned nothing: ' + JSON.stringify(edit));

/** Apply an LSP edit list — last position first, so earlier edits do not shift later ones. */
const apply = (text, edits) => {
  const lines = text.split('\n');
  const sorted = [...edits].sort(
    (a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character
  );
  for (const e of sorted) {
    if (e.range.start.line !== e.range.end.line) throw new Error('multi-line edit not expected');
    const l = lines[e.range.start.line];
    lines[e.range.start.line] = l.slice(0, e.range.start.character) + e.newText + l.slice(e.range.end.character);
  }
  return lines.join('\n');
};

const byFile = {};
for (const [uri, edits] of Object.entries(edit.changes)) byFile[norm(uri)] = edits;
const htmlEdits = byFile[norm(htmlUri)];
const tsEdits = byFile[norm(pathToFileURL(tsPath).toString())];
if (!htmlEdits) fail('no edits for the template. Files: ' + JSON.stringify(Object.keys(edit.changes)));
if (!tsEdits) fail('no edits for the .ts — the rename stopped at the template. Files: ' + JSON.stringify(Object.keys(edit.changes)));

const gotHtml = apply(HTML, htmlEdits);
const gotTs = apply(TS, tsEdits);
if (gotHtml !== HTML_WANT) fail('template after the rename:\n  got:  ' + JSON.stringify(gotHtml) + '\n  want: ' + JSON.stringify(HTML_WANT));
console.log('✔ the template binding is renamed');
if (gotTs !== TS_WANT) fail('.ts after the rename:\n  got:  ' + JSON.stringify(gotTs) + '\n  want: ' + JSON.stringify(TS_WANT));
console.log('✔ the const, the reader that uses it, and the return shorthand all follow');
console.log('\n✔ renaming a template binding renames the const behind it, and everything that reads it\n');
child.kill();
process.exit(0);
