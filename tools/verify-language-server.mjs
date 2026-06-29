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

  send('textDocument/didOpen', {
    textDocument: { uri: weaveUri, languageId: 'weave', version: 1, text: weaveSource },
  });

  // Collect diagnostics: try pull (`textDocument/diagnostic`) and push, whichever
  // the server provides. Retry a few times while the TS program builds.
  const key = weaveUri.toLowerCase();
  let diags = [];
  for (let i = 0; i < 40; i++) {
    await wait(250);
    diags = diagnostics.get(key) || [];
    if (diags.length) break;
    // Fall back to a pull request (the provider may be registered dynamically).
    const r = await send('textDocument/diagnostic', { textDocument: { uri: weaveUri } }, true);
    if (r?.items?.length) {
      diags = r.items;
      break;
    }
  }

  if (!diags.length) fail('no diagnostics for the .weave file (expected the type error)');

  // 1) The real template type error must be present, mapped to the template line.
  const typeErr = diags.find((d) => /toUpperCase|does not exist/.test(d.message));
  if (!typeErr) fail(`expected a 'toUpperCase' type error; got: ${JSON.stringify(diags.map((d) => d.message))}`);
  if (typeErr.range.start.line !== badLine) {
    fail(`type error mapped to line ${typeErr.range.start.line}, expected the template line ${badLine}`);
  }
  pass(`real template type error mapped to Widget.weave:${badLine + 1} ("${typeErr.message.split('\n')[0]}")`);

  // 2) No bogus HTML diagnostics (unknown tag, attribute not allowed, closing tag, …).
  const htmlNoise = diags.filter(
    (d) => d.source === 'html' || /unknown (html )?tag|not allowed here|closing tag|empty tag|self-closing/i.test(d.message)
  );
  if (htmlNoise.length) fail(`got bogus HTML diagnostics: ${JSON.stringify(htmlNoise.map((d) => d.message))}`);
  pass(`no bogus HTML diagnostics (custom <my-custom-element> + bindings accepted)`);

  // 3) The good binding {{ label }} must NOT error.
  const labelErr = diags.find((d) => /label/.test(d.message));
  if (labelErr) fail(`unexpected error on the valid {{ label }} binding: ${labelErr.message}`);
  pass('valid bindings report no errors');

  console.log('\nWeave language server verified (M9.0b).');
  child.kill();
  process.exit(0);
} catch (e) {
  fail(`unexpected error: ${e?.stack || e}`);
}
