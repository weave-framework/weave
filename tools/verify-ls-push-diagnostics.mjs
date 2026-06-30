/**
 * Regression guard for the LSP4IJ push-diagnostics fix.
 *
 * Some LSP clients (notably WebStorm via LSP4IJ) advertise `workspace/configuration`
 * support but never answer the server's configuration requests. Volar awaits that answer
 * before computing PUSH diagnostics, so template type errors silently never surface — while
 * hover and go-to-definition (which don't need configuration) keep working. The server
 * (`packages/language-server/src/server.ts`) drops the client's `workspace.configuration`
 * capability so Volar uses defaults and pushes diagnostics for every client.
 *
 * This test mimics that client exactly: it advertises configuration, NEVER answers it, and
 * NEVER pulls diagnostics — it asserts a real type error arrives purely by PUSH. Run after
 * `build:ls`. (The broader behaviour is covered by `verify-language-server.mjs`.)
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

const fixtureDir = join(process.env.TEMP || '/tmp', 'weave-ls-push-diag');
mkdirSync(fixtureDir, { recursive: true });
writeFileSync(
  join(fixtureDir, 'Card.ts'),
  'export function setup(props: { n: number }) {\n  const count = (): number => props.n;\n  return { count };\n}\n'
);
const cardHtmlPath = join(fixtureDir, 'Card.html');
const cardHtmlSource = ['<article>', '  <p>{{ count().toUpperCase() }}</p>', '</article>'].join('\n');
writeFileSync(cardHtmlPath, cardHtmlSource);
const cardHtmlUri = pathToFileURL(cardHtmlPath).toString();

// Normalize a file URI for comparison: decode %3A etc. + lowercase (Volar lowercases the
// Windows drive letter and percent-encodes the colon; pathToFileURL does neither).
const norm = (u) => decodeURIComponent(u).toLowerCase();
const wantKey = norm(cardHtmlUri);

const child = spawn(process.execPath, [serverPath, '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', (d) => (stderr += d.toString()));
let seq = 0;
const pushed = new Map(); // normalized uri -> diagnostics[]

function send(method, params, isRequest) {
  const msg = { jsonrpc: '2.0', method, params };
  if (isRequest) msg.id = ++seq;
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
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
      // Server→client request. DELIBERATELY ignore workspace/configuration (the whole
      // point); answer anything else with null so the server doesn't stall elsewhere.
      if (json.method !== 'workspace/configuration') {
        const b = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: json.id, result: null }), 'utf8');
        child.stdin.write(`Content-Length: ${b.length}\r\n\r\n`);
        child.stdin.write(b);
      }
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
    // Advertise configuration support like LSP4IJ — but we never answer the request.
    capabilities: {
      workspace: { configuration: true, didChangeConfiguration: { dynamicRegistration: true } },
      textDocument: { publishDiagnostics: {} },
    },
    initializationOptions: { typescript: { tsdk } },
  },
  true
);
send('initialized', {});
send('textDocument/didOpen', { textDocument: { uri: cardHtmlUri, languageId: 'weave-html', version: 1, text: cardHtmlSource } });

const typeErr = () => (pushed.get(wantKey) || []).find((d) => /toUpperCase|does not exist/.test(d.message));
for (let i = 0; i < 40 && !typeErr(); i++) await wait(250);

if (!typeErr()) {
  fail(
    'no PUSH diagnostic for a config-advertising-but-not-answering client — the workspace/configuration ' +
      'gate is back (see server.ts). Pushed: ' + JSON.stringify([...pushed.keys()])
  );
}
console.log(`✔ push diagnostics: a config-non-answering client (LSP4IJ-style) still gets the type error by PUSH`);
console.log(`  "${typeErr().message.split('\n')[0]}" at Card.html:${typeErr().range.start.line + 1}`);
child.kill();
process.exit(0);
