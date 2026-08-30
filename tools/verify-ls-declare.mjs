/**
 * The editor's other half of "the template declares into setup": the quick fix, on the lightbulb.
 *
 * `weave check --fix` writes the declaration from the terminal. This asserts the same thing is offered
 * where the author actually is — and that applying it produces the file a person would have written.
 * Same code on both sides (`declarationFor` / `growSetup`), so the editor and the checker cannot offer
 * different things; this test exists to keep that true.
 *
 * Run after `build:ls` (wired into `pnpm verify:ls`).
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
const serverPath = join(root, 'packages/language-server/dist/server.cjs');
const tsdk = dirname(require.resolve('typescript'));

const dir = join(process.env.TEMP || '/tmp', 'weave-ls-declare');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const TS = 'export function setup(): { n: number } {\n  const n = 1;\n  return { n };\n}\n';
const WANT =
  'export function setup(): { n: number; save: () => void } {\n' +
  '  const n = 1;\n' +
  '  const save = (): void => {\n' +
  '    // TODO\n' +
  '  };\n' +
  '  return { n, save };\n' +
  '}\n';
const HTML = '<article>\n  <button on:click={{ save }}>Save</button>\n</article>\n';
const tsPath = join(dir, 'Card.ts');
writeFileSync(tsPath, TS);
writeFileSync(join(dir, 'Card.html'), HTML);
const uri = pathToFileURL(join(dir, 'Card.html')).toString();

// The SFC form of the same component. Its script lives INSIDE the file, so the edit `growSetup`
// returns — offsets into the script — has to be shifted by where that script begins before it can be
// an edit to this document. `weave check --fix` does that shifting; the editor did not, and simply
// declined on every `.weave` in the project.
const sfcAround = (script) => ['<script>', script + '</script>', '', '<button on:click={{ save }}>Save</button>', ''].join('\n');
const SFC = sfcAround(TS);
const SFC_WANT = sfcAround(WANT);
const sfcPath = join(dir, 'Panel.weave');
writeFileSync(sfcPath, SFC);
const sfcUri = pathToFileURL(sfcPath).toString();

const child = spawn(process.execPath, [serverPath, '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', (d) => (stderr += d.toString()));
let seq = 0;
const answers = new Map();
const send = (m, p, r) => {
  const o = { jsonrpc: '2.0', method: m, params: p };
  if (r) o.id = ++seq;
  const b = Buffer.from(JSON.stringify(o), 'utf8');
  child.stdin.write(`Content-Length: ${b.length}\r\n\r\n`);
  child.stdin.write(b);
  return o.id;
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
    capabilities: { textDocument: { publishDiagnostics: {}, codeAction: {} } },
    initializationOptions: { typescript: { tsdk } },
  },
  true
);
send('initialized', {});
send('textDocument/didOpen', { textDocument: { uri, languageId: 'weave-html', version: 1, text: HTML } });
await wait(4000);

// `  <button on:click={{ save }}>` — `save` sits at character 21 of line 1.
const range = { start: { line: 1, character: 21 }, end: { line: 1, character: 25 } };
const id = send('textDocument/codeAction', { textDocument: { uri }, range, context: { diagnostics: [] } }, true);
for (let i = 0; i < 40 && !answers.has(id); i++) await wait(250);
const actions = answers.get(id);
const declare = (actions ?? []).find((a) => /Declare `save`/.test(a.title ?? ''));
if (!declare) fail('no "Declare `save` in setup()" action was offered, got ' + JSON.stringify(actions));
console.log(`✔ the editor offers "${declare.title}"`);

const changes = declare.edit?.changes ?? {};
const key = Object.keys(changes).find((k) => decodeURIComponent(k).toLowerCase().endsWith('card.ts'));
if (!key) fail('the edit does not target the component .ts, got ' + JSON.stringify(Object.keys(changes)));

const lines = TS.split('\n');
for (const e of [...changes[key]].sort((a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character)) {
  const startLine = e.range.start.line;
  const head = lines.slice(0, startLine).join('\n');
  const tail = lines.slice(e.range.end.line).join('\n');
  const before = lines[startLine].slice(0, e.range.start.character);
  const after = lines[e.range.end.line].slice(e.range.end.character);
  const merged = (head ? head + '\n' : '') + before + e.newText + after + (tail.length > lines[e.range.end.line].length ? '' : '');
  const rest = lines.slice(e.range.end.line + 1);
  lines.length = 0;
  lines.push(...(merged + (rest.length ? '\n' + rest.join('\n') : '')).split('\n'));
}
const got = lines.join('\n');
if (got !== WANT) fail('applying it must produce the file a person would write.\n  got:  ' + JSON.stringify(got) + '\n  want: ' + JSON.stringify(WANT));
console.log('✔ and applying it produces exactly the file `weave check --fix` produces');

// It must not offer twice: with `save` already in the script, nothing is proposed.
writeFileSync(tsPath, WANT);
await wait(1500);
const id2 = send('textDocument/codeAction', { textDocument: { uri }, range, context: { diagnostics: [] } }, true);
for (let i = 0; i < 40 && !answers.has(id2); i++) await wait(250);
const again = (answers.get(id2) ?? []).find((a) => /Declare `save`/.test(a.title ?? ''));
if (again) fail('it offered to declare a name the script already has — that would duplicate it');
console.log('✔ and it is not offered once the script already knows the name');

/* ── The SFC form: one file, script inside it ── */

/** Apply LSP edits to `text`, back to front, by converting each position to an offset. */
function applyLsp(text, edits) {
  const offsetOf = (pos) => {
    let line = 0;
    let i = 0;
    while (line < pos.line && i < text.length) {
      if (text.charCodeAt(i) === 10) line++;
      i++;
    }
    return i + pos.character;
  };
  const sorted = [...edits].sort((a, b) => offsetOf(b.range.start) - offsetOf(a.range.start));
  let out = text;
  for (const e of sorted) out = out.slice(0, offsetOf(e.range.start)) + e.newText + out.slice(offsetOf(e.range.end));
  return out;
}

send('textDocument/didOpen', { textDocument: { uri: sfcUri, languageId: 'weave', version: 1, text: SFC } });
await wait(4000);

// `<button on:click={{ save }}>` is the last line of the SFC; `save` sits at character 20.
const sfcLine = SFC.split('\n').findIndex((l) => l.includes('on:click'));
const sfcCol = SFC.split('\n')[sfcLine].indexOf('save');
const sfcRange = { start: { line: sfcLine, character: sfcCol }, end: { line: sfcLine, character: sfcCol + 4 } };
const id3 = send('textDocument/codeAction', { textDocument: { uri: sfcUri }, range: sfcRange, context: { diagnostics: [] } }, true);
for (let i = 0; i < 40 && !answers.has(id3); i++) await wait(250);
const sfcActions = answers.get(id3);
const sfcDeclare = (sfcActions ?? []).find((a) => /Declare `save`/.test(a.title ?? ''));
if (!sfcDeclare) fail('a `.weave` SFC was offered nothing, got ' + JSON.stringify(sfcActions));
console.log('✔ a `.weave` SFC is offered the same action');

const sfcChanges = sfcDeclare.edit?.changes ?? {};
const sfcKey = Object.keys(sfcChanges).find((k) => decodeURIComponent(k).toLowerCase().endsWith('panel.weave'));
if (!sfcKey) fail('the edit must target the `.weave` itself, got ' + JSON.stringify(Object.keys(sfcChanges)));
const sfcGot = applyLsp(SFC, sfcChanges[sfcKey]);
if (sfcGot !== SFC_WANT) {
  fail(
    'applying it must grow the script INSIDE the SFC.\n  got:  ' +
      JSON.stringify(sfcGot) +
      '\n  want: ' +
      JSON.stringify(SFC_WANT)
  );
}
console.log('✔ and applying it grows the script inside the file, at the right offset');

/* ── A two-way binding: the DOM decides the type, so the editor may offer it too ── */

const BIND_TS = 'export function setup() {\n  const n = 1;\n}\n';
const BIND_WANT =
  "import { signal } from '@weave-framework/runtime';\n\n" +
  'export function setup() {\n  const n = 1;\n  const title = signal(\'\');\n}\n';
const BIND_HTML = '<article>\n  <input bind:value={{ title }}>\n</article>\n';
const bindTsPath = join(dir, 'Field.ts');
writeFileSync(bindTsPath, BIND_TS);
writeFileSync(join(dir, 'Field.html'), BIND_HTML);
const bindUri = pathToFileURL(join(dir, 'Field.html')).toString();
send('textDocument/didOpen', { textDocument: { uri: bindUri, languageId: 'weave-html', version: 1, text: BIND_HTML } });
await wait(3000);

const bindLine = BIND_HTML.split('\n').findIndex((l) => l.includes('bind:value'));
const bindCol = BIND_HTML.split('\n')[bindLine].indexOf('title');
const bindRange = { start: { line: bindLine, character: bindCol }, end: { line: bindLine, character: bindCol + 5 } };
const id4 = send('textDocument/codeAction', { textDocument: { uri: bindUri }, range: bindRange, context: { diagnostics: [] } }, true);
for (let i = 0; i < 40 && !answers.has(id4); i++) await wait(250);
const bindDeclare = (answers.get(id4) ?? []).find((a) => /Declare `title`/.test(a.title ?? ''));
if (!bindDeclare) fail('a `bind:value` was offered nothing, got ' + JSON.stringify(answers.get(id4)));
console.log('✔ a two-way binding is offered the action too');

const bindChanges = bindDeclare.edit?.changes ?? {};
const bindKey = Object.keys(bindChanges).find((k) => decodeURIComponent(k).toLowerCase().endsWith('field.ts'));
if (!bindKey) fail('the edit must target the component .ts, got ' + JSON.stringify(Object.keys(bindChanges)));
const bindGot = applyLsp(BIND_TS, bindChanges[bindKey]);
if (bindGot !== BIND_WANT) {
  fail(
    'applying it must declare the signal AND bring its import.\n  got:  ' +
      JSON.stringify(bindGot) +
      '\n  want: ' +
      JSON.stringify(BIND_WANT)
  );
}
console.log('✔ and applying it declares the signal with the import it needs');

console.log('\n✔ the editor declares a name the template asks for, once, in both authoring forms\n');
child.kill();
process.exit(0);
