/**
 * Node smoke test for the Weave MCP server over REAL stdio (the parts the browser harness
 * can't reach: the stdio transport + the fs-backed weave_check tool, driven through the
 * actual `weave-mcp` bin). Sends newline-delimited JSON-RPC, matches responses by id.
 *
 * Run: `node packages/mcp/test/stdio.smoke.mjs` (wired as `pnpm verify:mcp`).
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, '..', 'bin', 'weave-mcp.mjs');
const fixture = join(here, 'fixture');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`);
  if (!cond) failures++;
};

// Collect responses keyed by id from the server's stdout (one JSON object per line).
const responses = new Map();
const waiters = new Map();
function onLine(line) {
  const t = line.trim();
  if (!t) return;
  let msg;
  try {
    msg = JSON.parse(t);
  } catch {
    return;
  }
  if (msg.id != null) {
    responses.set(msg.id, msg);
    const w = waiters.get(msg.id);
    if (w) {
      w(msg);
      waiters.delete(msg.id);
    }
  }
}
const waitFor = (id) =>
  responses.has(id)
    ? Promise.resolve(responses.get(id))
    : new Promise((resolve, reject) => {
        waiters.set(id, resolve);
        setTimeout(() => reject(new Error(`timeout waiting for response id ${id}`)), 30000);
      });

const child = spawn(process.execPath, [bin], { cwd: fixture, stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '';
child.stdout.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    onLine(buf.slice(0, nl));
    buf = buf.slice(nl + 1);
  }
});

const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');

console.log('\npackages/mcp/test/stdio.smoke.mjs (real stdio)');
try {
  send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  const init = await waitFor(1);
  ok(init.result?.serverInfo?.name === '@weave-framework/mcp', 'initialize → serverInfo over stdio');
  ok(typeof init.result?.protocolVersion === 'string', 'initialize → protocolVersion');

  send({ jsonrpc: '2.0', method: 'notifications/initialized' }); // no response expected

  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const list = await waitFor(2);
  const names = (list.result?.tools ?? []).map((t) => t.name);
  ok(names.includes('weave_check'), 'tools/list includes weave_check (fs tool)');
  ok(names.includes('weave_compile_template'), 'tools/list includes weave_compile_template');

  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'weave_compile_template', arguments: { template: '<p>{{ n() }}</p>', scope: ['n'] } },
  });
  const compile = await waitFor(3);
  const compileJson = JSON.parse(compile.result.content[0].text);
  ok(compileJson.ok === true && compileJson.code, 'weave_compile_template compiled over stdio');

  send({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'weave_check', arguments: { roots: ['src'] } },
  });
  const check = await waitFor(4);
  // weave_check ran the fs-backed checker and returned a structured result (diagnostics array).
  const checkText = check.result.content[0].text;
  const checkJson = JSON.parse(checkText);
  ok(Array.isArray(checkJson.diagnostics), 'weave_check returned a diagnostics array over stdio');

  // A declared `required` that nothing enforces is a trap. The handler saw `undefined` and reported
  // whatever that produced downstream — this tool answered "Empty template fragment", which sends the
  // agent off to inspect its markup instead of its own call.
  send({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'weave_compile_template', arguments: { scope: [] } },
  });
  const missing = await waitFor(5);
  const missingText = missing.result.content.map((c) => c.text).join('');
  ok(missing.result.isError === true, 'a missing required argument comes back as an isError result');
  ok(/missing required argument: template/.test(missingText), 'and the message names it', missingText);

  // The scaffold used to emit `// styles: ./name.css`, which reads like a directive and is not one:
  // the sibling stylesheet is picked up by convention, and deleting that line changes nothing. Proven
  // by building a scaffolded component in a real app both ways — identical CSS output.
  send({
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: { name: 'weave_scaffold_component', arguments: { name: 'UserCard', styleLang: 'scss' } },
  });
  const scaffold = await waitFor(6);
  const scaffoldTs = JSON.parse(scaffold.result.content[0].text).files.find((f) =>
    f.path.endsWith('.ts')
  ).content;
  ok(!scaffoldTs.includes('// styles:'), 'scaffold emits no fake `// styles:` directive', scaffoldTs);
} catch (e) {
  ok(false, `threw: ${e.message}`);
} finally {
  child.stdin.end();
}

await new Promise((r) => child.on('close', r));
console.log(`\n${'-'.repeat(40)}`);
console.log(failures ? `mcp smoke: ${failures} failed` : 'mcp smoke: all passed');
process.exit(failures ? 1 : 0);
