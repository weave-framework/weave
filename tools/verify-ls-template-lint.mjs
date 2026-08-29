/**
 * The editor half of the template lint: the mistakes that compile clean and fail silently must be
 * underlined where they are, with a quick fix that produces the correct source.
 *
 * These rules shipped in 3.1.0 and the editor knew nothing about them — Volar surfaces the TypeScript
 * diagnostics from the embedded code and the CSS ones from `<style>`, and the lint ran only inside a
 * build. So the editor showed a clean file, `weave check` showed a clean file, and the page was broken.
 * `weave check --fix` closed the terminal half; this asserts the editor half, over a real LSP session
 * against the built server.
 *
 * The assertion that matters is the last one: applying the edit the server offers must yield the
 * correct source, byte for byte. An action that merely EXISTS proves nothing about where it lands.
 *
 * Run after `build:ls` (wired into `pnpm verify:ls`).
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
const serverPath = join(root, 'packages/language-server/dist/server.cjs');
const tsdk = dirname(require.resolve('typescript'));

const fixtureDir = join(process.env.TEMP || '/tmp', 'weave-ls-template-lint');
mkdirSync(fixtureDir, { recursive: true });
writeFileSync(
  join(fixtureDir, 'Card.ts'),
  'export function setup() {\n  const inc = (): void => {};\n  return { inc };\n}\n'
);
const htmlPath = join(fixtureDir, 'Card.html');
// The typo is on line 2 (0-based line 1). `  <button on:` is 13 characters, so `clik` spans 13..17.
const SOURCE = ['<article>', '  <button on:clik={{ inc }}>x</button>', '</article>'].join('\n');
const FIXED = ['<article>', '  <button on:click={{ inc }}>x</button>', '</article>'].join('\n');
writeFileSync(htmlPath, SOURCE);
const uri = pathToFileURL(htmlPath).toString();
const norm = (u) => decodeURIComponent(u).toLowerCase();
const key = norm(uri);

const child = spawn(process.execPath, [serverPath, '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', (d) => (stderr += d.toString()));
let seq = 0;
const pushed = new Map();
const answers = new Map();

function send(method, params, isRequest) {
  const msg = { jsonrpc: '2.0', method, params };
  if (isRequest) msg.id = ++seq;
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  child.stdin.write(body);
  return msg.id;
}
let buf = Buffer.alloc(0);
child.stdout.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const header = buf.indexOf('\r\n\r\n');
    if (header === -1) break;
    const m = /Content-Length: (\d+)/i.exec(buf.slice(0, header).toString());
    if (!m) break;
    const len = Number(m[1]);
    const start = header + 4;
    if (buf.length < start + len) break;
    const json = JSON.parse(buf.slice(start, start + len).toString('utf8'));
    buf = buf.slice(start + len);
    if (json.id !== undefined && json.method) {
      const b = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: json.id, result: null }), 'utf8');
      child.stdin.write(`Content-Length: ${b.length}\r\n\r\n`);
      child.stdin.write(b);
    } else if (json.id !== undefined) {
      answers.set(json.id, json.result);
    } else if (json.method === 'textDocument/publishDiagnostics') {
      pushed.set(norm(json.params.uri), json.params.diagnostics);
    }
  }
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => {
  console.error(`\n✖ ${msg}`);
  if (stderr.trim()) console.error('--- server stderr ---\n' + stderr.trim().split('\n').slice(-15).join('\n'));
  child.kill();
  process.exit(1);
};

send(
  'initialize',
  {
    processId: process.pid,
    rootUri: pathToFileURL(fixtureDir).toString(),
    capabilities: { textDocument: { publishDiagnostics: {}, codeAction: {} } },
    initializationOptions: { typescript: { tsdk } },
  },
  true
);
send('initialized', {});
send('textDocument/didOpen', { textDocument: { uri, languageId: 'weave-html', version: 1, text: SOURCE } });

const lint = () => (pushed.get(key) || []).find((d) => d.source === 'weave' && /on:clik/.test(d.message));
for (let i = 0; i < 40 && !lint(); i++) await wait(250);
if (!lint()) fail('no template-lint diagnostic arrived. Pushed: ' + JSON.stringify(pushed.get(key) || []));

const d = lint();
console.log(`✔ the editor reports it: "${d.message.split('.')[0]}."`);
if (d.severity !== 2) fail(`it must be a warning, not severity ${d.severity}`);
if (d.range.start.line !== 1 || d.range.start.character !== 13 || d.range.end.character !== 17) {
  fail('the underline must cover exactly `clik`, got ' + JSON.stringify(d.range));
}
console.log('✔ underlined exactly the event name, at Card.html:2');

const id = send('textDocument/codeAction', { textDocument: { uri }, range: d.range, context: { diagnostics: [d] } }, true);
for (let i = 0; i < 40 && !answers.has(id); i++) await wait(250);
const actions = answers.get(id);
if (!Array.isArray(actions) || actions.length !== 1) fail('expected exactly one quick fix, got ' + JSON.stringify(actions));

const action = actions[0];
if (action.kind !== 'quickfix') fail('it must be a quickfix, got ' + action.kind);
const edits = action.edit?.changes?.[uri] ?? action.edit?.changes?.[Object.keys(action.edit?.changes ?? {})[0]];
if (!edits || edits.length !== 1) fail('expected one edit, got ' + JSON.stringify(action.edit));

// Apply it exactly as an editor would.
const lines = SOURCE.split('\n');
const e = edits[0];
const line = lines[e.range.start.line];
lines[e.range.start.line] = line.slice(0, e.range.start.character) + e.newText + line.slice(e.range.end.character);
const applied = lines.join('\n');
if (applied !== FIXED) fail('applying the fix must yield the correct source.\n  got:  ' + JSON.stringify(applied) + '\n  want: ' + JSON.stringify(FIXED));

console.log(`✔ "${action.title}" — and applying it yields the correct source, byte for byte`);
console.log('\n✔ the editor reports template mistakes and offers a fix that lands\n');
child.kill();
process.exit(0);
