import { test, assert } from '../../../tools/harness.js';
import { McpServer, PROTOCOL_VERSION } from '../src/server.js';
import { compileTemplateTool } from '../src/tools/compile-template.js';
import { routesTool } from '../src/tools/routes.js';
import { scaffoldComponentTool, generateComponent } from '../src/tools/scaffold-component.js';
import type { JsonRpcResponse } from '../src/jsonrpc.js';

// A server with the pure (Node-free) tools — the check tool + stdio are covered by the
// Node smoke test (packages/mcp/test/stdio.smoke.mjs).
const makeServer = (): McpServer =>
  new McpServer({ version: '9.9.9' })
    .registerTool(compileTemplateTool)
    .registerTool(routesTool)
    .registerTool(scaffoldComponentTool);

const call = async (
  server: McpServer,
  name: string,
  args: Record<string, unknown>
): Promise<{ text: string; isError: boolean; json: unknown }> => {
  const res: JsonRpcResponse | null = await server.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  });
  const result: { content: Array<{ text: string }>; isError?: boolean } = res!.result as {
    content: Array<{ text: string }>;
    isError?: boolean;
  };
  const text: string = result.content[0].text;
  let json: unknown = undefined;
  try {
    json = JSON.parse(text);
  } catch {
    /* text-only result */
  }
  return { text, isError: !!result.isError, json };
};

/* ───────────────────────── protocol dispatch ───────────────────────── */

test('mcp: initialize returns protocolVersion + serverInfo', async () => {
  const res: JsonRpcResponse | null = await makeServer().handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  const r: { protocolVersion: string; serverInfo: { name: string; version: string } } = res!.result as {
    protocolVersion: string;
    serverInfo: { name: string; version: string };
  };
  assert.equal(r.protocolVersion, PROTOCOL_VERSION);
  assert.equal(r.serverInfo.version, '9.9.9', 'serverInfo carries the injected version');
});

test('mcp: tools/list lists every registered tool with an inputSchema', async () => {
  const res: JsonRpcResponse | null = await makeServer().handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const tools: Array<{ name: string; inputSchema: object }> = (
    res!.result as { tools: Array<{ name: string; inputSchema: object }> }
  ).tools;
  const names: string[] = tools.map((t) => t.name);
  assert.ok(names.includes('weave_compile_template'), 'compile tool listed');
  assert.ok(names.includes('weave_routes'), 'routes tool listed');
  assert.ok(names.includes('weave_scaffold_component'), 'scaffold tool listed');
  assert.ok(tools.every((t) => typeof t.inputSchema === 'object'), 'each has an inputSchema');
});

test('mcp: a notification (no id) gets no response', async () => {
  const res: JsonRpcResponse | null = await makeServer().handle({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  });
  assert.equal(res, null);
});

test('mcp: an unknown method is a JSON-RPC method-not-found error', async () => {
  const res: JsonRpcResponse | null = await makeServer().handle({ jsonrpc: '2.0', id: 5, method: 'no/such' });
  assert.equal(res!.error?.code, -32601);
});

test('mcp: tools/call on an unknown tool is an invalid-params error', async () => {
  const res: JsonRpcResponse | null = await makeServer().handle({
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: { name: 'weave_nope', arguments: {} },
  });
  assert.equal(res!.error?.code, -32602);
});

/* ───────────────────────── compile_template ───────────────────────── */

test('mcp: weave_compile_template compiles a valid template', async () => {
  const { isError, json } = await call(makeServer(), 'weave_compile_template', {
    template: '<button on:click={{ inc }}>{{ count() }}</button>',
    scope: ['inc', 'count'],
  });
  assert.equal(isError, false, 'valid template is not an error');
  const j: { ok: boolean; code: string } = json as { ok: boolean; code: string };
  assert.equal(j.ok, true);
  assert.ok(typeof j.code === 'string' && j.code.length > 0, 'emits code');
});

test('mcp: weave_compile_template reports a compile error as isError', async () => {
  const { isError, text } = await call(makeServer(), 'weave_compile_template', {
    template: '<div>{{ unclosed </div>', // malformed interpolation
  });
  assert.equal(isError, true, 'a broken template is flagged isError');
  assert.ok(/error/i.test(text), 'the message mentions an error');
});

/* ───────────────────────── routes ───────────────────────── */

test('mcp: weave_routes builds the file-based route tree', async () => {
  const { json } = await call(makeServer(), 'weave_routes', {
    files: ['index.ts', 'about.ts', 'user/[id].ts'],
  });
  const { routes } = json as { routes: Array<{ path: string; children?: unknown[] }> };
  const paths: string[] = routes.map((r) => r.path);
  assert.ok(paths.includes(':id') || JSON.stringify(routes).includes(':id'), '[id] maps to :id');
  assert.ok(JSON.stringify(routes).includes('about'), 'about route present');
});

/* ───────────────────────── scaffold ───────────────────────── */

test('mcp: weave_scaffold_component returns files without writing', async () => {
  const { json } = await call(makeServer(), 'weave_scaffold_component', { name: 'UserCard', styleLang: 'scss' });
  const { files } = json as { files: Array<{ path: string; content: string }> };
  const paths: string[] = files.map((f) => f.path);
  assert.ok(paths.includes('user-card/user-card.ts'), 'kebab-cased .ts file');
  assert.ok(paths.includes('user-card/user-card.html'), '.html file');
  assert.ok(paths.includes('user-card/user-card.scss'), 'scss stylesheet');
});

test('generateComponent: styleLang "none" omits the stylesheet', () => {
  const files: Array<{ path: string; content: string }> = generateComponent('Thing', 'none');
  assert.equal(files.length, 2, 'only .ts + .html');
  assert.ok(!files.some((f) => /\.(css|scss)$/.test(f.path)), 'no stylesheet');
});

test('mcp: scaffoldComponentTool is registered under the expected name', () => {
  assert.equal(scaffoldComponentTool.name, 'weave_scaffold_component');
});
