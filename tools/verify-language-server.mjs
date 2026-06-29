/**
 * Drive the bundled Weave language server over a real LSP/stdio session and assert
 * it behaves: a `.weave` file with a template type error yields a *real* diagnostic
 * mapped into the template, and there are **no** bogus HTML diagnostics (the whole
 * point — the editor must stop treating `.weave` as plain HTML).
 *
 * A hand-rolled JSON-RPC client (Content-Length framing) keeps this dependency-free.
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
const serverPath = join(root, 'packages/language-server/dist/server.cjs');
const tsdk = dirname(require.resolve('typescript')); // .../typescript/lib

/* ---------- a fixture with a deliberate template type error ---------- */
const fixtureDir = join(process.env.TEMP || '/tmp', 'weave-ls-verify');
mkdirSync(fixtureDir, { recursive: true });
const weavePath = join(fixtureDir, 'Widget.weave');
const weaveSource = [
  '<script>',
  'export function setup() {',
  '  return { count: 1, label: "hi" };',
  '}',
  '</script>',
  '',
  '<div class="widget">',
  '  <h1>{{ label }}</h1>',
  '  <p>{{ count.toUpperCase() }}</p>',
  '  <my-custom-element data-x="1"></my-custom-element>',
  '</div>',
].join('\n');
writeFileSync(weavePath, weaveSource);
const weaveUri = pathToFileURL(weavePath).toString();
const badLine = weaveSource.split('\n').findIndex((l) => l.includes('toUpperCase')); // 0-based

/* ---------- separate-file form: Card.ts (component) + Card.html (template) ---------- */
const cardTsPath = join(fixtureDir, 'Card.ts');
const cardTsSource = [
  'export function setup(props: { n: number }) {',
  '  const count = (): number => props.n;',
  '  const label = "hi";',
  '  return { count, label };',
  '}',
].join('\n');
writeFileSync(cardTsPath, cardTsSource);
const cardHtmlPath = join(fixtureDir, 'Card.html');
const cardHtmlSource = [
  '<article class="card">',
  '  <h1>{{ label }}</h1>',
  '  <p>{{ count().toUpperCase() }}</p>',
  '  <custom-thing data-y="2"></custom-thing>',
  '</article>',
].join('\n');
writeFileSync(cardHtmlPath, cardHtmlSource);
const cardHtmlUri = pathToFileURL(cardHtmlPath).toString();
const cardBadLine = cardHtmlSource.split('\n').findIndex((l) => l.includes('toUpperCase'));

/* ---------- component tags: Panel.html uses <Badge> (imported) + <Nope> (unknown) ---------- */
writeFileSync(join(fixtureDir, 'Badge.ts'), 'export function Badge(props: { text: string }): unknown {\n  return props;\n}\n');
const panelTsPath = join(fixtureDir, 'Panel.ts');
writeFileSync(
  panelTsPath,
  ["import { Badge } from './Badge';", 'void Badge;', 'export function setup() {', "  return { title: 'hi' };", '}'].join('\n')
);
const panelHtmlPath = join(fixtureDir, 'Panel.html');
const panelHtmlSource = ['<section>', '  <Badge text="ok" />', '  <Nope />', '</section>'].join('\n');
writeFileSync(panelHtmlPath, panelHtmlSource);
const panelHtmlUri = pathToFileURL(panelHtmlPath).toString();
const nopeLine = panelHtmlSource.split('\n').findIndex((l) => l.includes('<Nope'));
const badgeCol = panelHtmlSource.split('\n')[1].indexOf('Badge');

/* ---------- minimal LSP client over stdio ---------- */
const child = spawn(process.execPath, [serverPath, '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', (d) => (stderr += d.toString()));

let seq = 0;
const pending = new Map();
const diagnostics = new Map(); // uri -> diagnostics[]

function send(method, params, isRequest) {
  const msg = { jsonrpc: '2.0', method, params };
  if (isRequest) msg.id = ++seq;
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  child.stdin.write(body);
  if (isRequest) return new Promise((res) => pending.set(msg.id, res));
}

function reply(id, result) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, result }), 'utf8');
  child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  child.stdin.write(body);
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
      // A server→client request — must be answered or the server stalls
      // (e.g. `workspace/configuration`, `client/registerCapability`).
      let result = null;
      if (json.method === 'workspace/configuration') {
        result = (json.params.items || []).map(() => null);
      }
      reply(json.id, result);
    } else if (json.id !== undefined && pending.has(json.id)) {
      pending.get(json.id)(json.result);
      pending.delete(json.id);
    } else if (json.method === 'textDocument/publishDiagnostics') {
      // Normalize the URI key — the server lowercases the Windows drive letter.
      diagnostics.set(json.params.uri.toLowerCase(), json.params.diagnostics);
    }
  }
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const watchdog = setTimeout(() => fail('timed out (server never completed the session)'), 60000);
watchdog.unref?.();
const fail = (msg) => {
  console.error(`\n✖ ${msg}`);
  if (stderr.trim()) console.error('--- server stderr ---\n' + stderr.trim().split('\n').slice(-20).join('\n'));
  child.kill();
  process.exit(1);
};
const pass = (msg) => console.log(`✔ ${msg}`);

try {
  const initResult = await send(
    'initialize',
    {
      processId: process.pid,
      rootUri: pathToFileURL(fixtureDir).toString(),
      capabilities: {
        textDocument: {
          publishDiagnostics: {},
          diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
        },
      },
      initializationOptions: { typescript: { tsdk } },
    },
    true
  );
  send('initialized', {});
  const pullSupported = !!initResult?.capabilities?.diagnosticProvider;
  pass(`server initialized over LSP/stdio (pull diagnostics: ${pullSupported})`);

  // Open a document and collect its diagnostics (push, with a pull fallback).
  async function diagnose(uri, languageId, text) {
    send('textDocument/didOpen', { textDocument: { uri, languageId, version: 1, text } });
    const k = uri.toLowerCase();
    for (let i = 0; i < 40; i++) {
      await wait(250);
      const d = diagnostics.get(k) || [];
      if (d.length) return d;
      const r = await send('textDocument/diagnostic', { textDocument: { uri } }, true);
      if (r?.items?.length) return r.items;
    }
    return [];
  }

  const htmlNoiseOf = (diags) =>
    diags.filter(
      (d) =>
        d.source === 'html' ||
        /unknown (html )?tag|not allowed here|closing tag|empty tag|self-closing/i.test(d.message)
    );

  /* ===== scenario 1: a single-file .weave SFC ===== */
  let diags = await diagnose(weaveUri, 'weave', weaveSource);
  if (!diags.length) fail('no diagnostics for the .weave file (expected the type error)');

  let typeErr = diags.find((d) => /toUpperCase|does not exist/.test(d.message));
  if (!typeErr) fail(`SFC: expected a 'toUpperCase' type error; got: ${JSON.stringify(diags.map((d) => d.message))}`);
  if (typeErr.range.start.line !== badLine) fail(`SFC: type error mapped to line ${typeErr.range.start.line}, expected ${badLine}`);
  pass(`SFC: real template type error mapped to Widget.weave:${badLine + 1}`);
  if (htmlNoiseOf(diags).length) fail(`SFC: bogus HTML diagnostics: ${JSON.stringify(htmlNoiseOf(diags).map((d) => d.message))}`);
  pass('SFC: no bogus HTML diagnostics');
  if (diags.find((d) => /label/.test(d.message))) fail('SFC: unexpected error on the valid {{ label }} binding');
  pass('SFC: valid bindings report no errors');

  /* ===== scenario 2: separate Card.html + sibling Card.ts (the demo's form) ===== */
  diags = await diagnose(cardHtmlUri, 'weave-html', cardHtmlSource);
  if (!diags.length) fail('separate-file: no diagnostics for Card.html (expected the type error from the sibling .ts)');

  typeErr = diags.find((d) => /toUpperCase|does not exist/.test(d.message));
  if (!typeErr) fail(`separate-file: expected a 'toUpperCase' type error from the sibling setup; got: ${JSON.stringify(diags.map((d) => d.message))}`);
  if (typeErr.range.start.line !== cardBadLine) fail(`separate-file: type error mapped to line ${typeErr.range.start.line}, expected ${cardBadLine}`);
  pass(`separate-file: real type error from Card.ts setup, mapped to Card.html:${cardBadLine + 1} ("${typeErr.message.split('\n')[0]}")`);
  if (htmlNoiseOf(diags).length) fail(`separate-file: bogus HTML diagnostics on Card.html: ${JSON.stringify(htmlNoiseOf(diags).map((d) => d.message))}`);
  pass('separate-file: no bogus HTML diagnostics on Card.html (custom <custom-thing> accepted)');
  if (diags.find((d) => /label/.test(d.message))) fail('separate-file: unexpected error on the valid {{ label }} binding');
  pass('separate-file: valid bindings (from sibling setup) report no errors');

  // go-to-definition: clicking `label` in Card.html should land in Card.ts.
  const labelCol = cardHtmlSource.split('\n')[1].indexOf('label');
  const def = await send('textDocument/definition', { textDocument: { uri: cardHtmlUri }, position: { line: 1, character: labelCol } }, true);
  const defs = Array.isArray(def) ? def : def ? [def] : [];
  const landsInTs = defs.some((d) => (d.uri || d.targetUri || '').toLowerCase().endsWith('card.ts'));
  if (landsInTs) pass('separate-file: go-to-definition on a template variable lands in Card.ts');
  else console.log(`… go-to-definition did not land in Card.ts (defs: ${JSON.stringify(defs.map((d) => d.uri || d.targetUri))}) — revisit in M9.0c`);

  /* ===== scenario 2b: component tags — known <Badge> (imported) + unknown <Nope> ===== */
  diags = await diagnose(panelHtmlUri, 'weave-html', panelHtmlSource);
  const nopeErr = diags.find((d) => /Cannot find name 'Nope'/.test(d.message));
  if (!nopeErr) fail(`component tag: expected "Cannot find name 'Nope'"; got: ${JSON.stringify(diags.map((d) => d.message))}`);
  if (nopeErr.range.start.line !== nopeLine) fail(`component tag: <Nope> error mapped to line ${nopeErr.range.start.line}, expected ${nopeLine}`);
  pass(`component tag: unknown <Nope> flagged at Panel.html:${nopeLine + 1}`);
  if (diags.find((d) => /'?Badge'?/.test(d.message))) fail('component tag: unexpected error on the valid imported <Badge>');
  pass('component tag: valid imported <Badge> reports no error');

  // go-to-definition on the <Badge> tag should land in a component .ts (the import / its source).
  const tagDef = await send('textDocument/definition', { textDocument: { uri: panelHtmlUri }, position: { line: 1, character: badgeCol } }, true);
  const tagDefs = Array.isArray(tagDef) ? tagDef : tagDef ? [tagDef] : [];
  const tagLandsInTs = tagDefs.some((d) => /(panel|badge)\.ts$/i.test((d.uri || d.targetUri || '').toLowerCase()));
  if (!tagLandsInTs) fail(`component tag: go-to-def on <Badge> did not land in a .ts (defs: ${JSON.stringify(tagDefs.map((d) => d.uri || d.targetUri))})`);
  pass('component tag: go-to-definition on <Badge> lands in the component .ts');

  /* ===== scenario 3: a malformed template must NOT crash the server ===== */
  // The editor reparses on every keystroke, so half-typed templates (mismatched/
  // unclosed tags) are the common case. A parse error must degrade to "no types",
  // never escape and kill the process (Volar stops restarting after 5 crashes).
  const brokenPath = join(fixtureDir, 'Broken.weave');
  const brokenSource = ['<script>export function setup() { return {}; }</script>', '<Link>oops</Linkas>'].join('\n');
  writeFileSync(brokenPath, brokenSource);
  const brokenUri = pathToFileURL(brokenPath).toString();
  send('textDocument/didOpen', { textDocument: { uri: brokenUri, languageId: 'weave', version: 1, text: brokenSource } });
  await wait(500);
  if (child.exitCode !== null) fail(`server crashed on a malformed template (exit ${child.exitCode}) — parse errors must not escape`);
  // Prove it is still serving: the earlier good file must still answer a pull request.
  const stillAlive = await send('textDocument/diagnostic', { textDocument: { uri: weaveUri } }, true);
  if (!stillAlive) fail('server stopped responding after a malformed template');
  pass('malformed template: server survived (degraded to no type-checking, no crash)');

  console.log('\nWeave language server verified (SFC + separate .ts/.html + malformed-template resilience).');
  child.kill();
  process.exit(0);
} catch (e) {
  fail(`unexpected error: ${e?.stack || e}`);
}
