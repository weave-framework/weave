import { test, assert } from '../../../tools/harness.js';
import { extractSetupHandlers, isInlinable, type SetupHandler } from '@weave-framework/compiler';

/**
 * E1.5 — named-handler resume. `extractSetupHandlers` pulls each top-level `setup` binding that is a function
 * out of the script (so the emit can inline its body into the `handlers(ctx)` factory), and `isInlinable`
 * proves the body will actually resolve against the resumed ctx. Both are fail-safe: anything the scanner
 * can't bound confidently, or that references a `setup` local which never reaches the client, is refused —
 * the emit then falls back to today's `ctx.<name>` rather than producing a client ReferenceError.
 */

const setup = (body: string): string =>
  `import { signal } from "@weave-framework/runtime";\nexport function setup() {\n${body}\n}\n`;

/* ──────────── extraction ──────────── */

test('extracts a top-level const arrow handler', () => {
  const h: Map<string, SetupHandler> = extractSetupHandlers(
    setup('  const count = signal(0);\n  const inc = () => count.set((n) => n + 1);\n  return { count, inc };')
  );
  assert.ok(h.has('inc'), 'found `inc`');
  assert.equal(h.get('inc')!.source, '() => count.set((n) => n + 1)', 'captured the arrow source exactly');
  assert.ok(!h.has('count'), 'a signal (not a function) is not a handler');
});

test('extracts an arrow with params + a block body', () => {
  const h = extractSetupHandlers(setup('  const pick = (e, i) => { sel.set(i); e.preventDefault(); };\n  return { pick };'));
  assert.equal(h.get('pick')!.source, '(e, i) => { sel.set(i); e.preventDefault(); }', 'block body captured whole');
  assert.deepEqual(h.get('pick')!.params, ['e', 'i'], 'params recorded');
});

test('extracts a single bare-param arrow + a function declaration + async forms', () => {
  const h = extractSetupHandlers(
    setup(
      '  const one = e => open.set(!open());\n' +
        '  function two(a) { count.set(a); }\n' +
        '  const three = async () => { await save(); };\n' +
        '  async function four() { await load(); }\n' +
        '  return { one, two, three, four };'
    )
  );
  assert.deepEqual(h.get('one')!.params, ['e'], 'bare-param arrow');
  assert.equal(h.get('two')!.source, 'function (a) { count.set(a); }', 'fn declaration → anonymous fn expression');
  assert.deepEqual(h.get('two')!.params, ['a'], 'fn declaration params');
  assert.ok(h.get('three')!.source.startsWith('async ()'), 'async arrow');
  assert.ok(h.get('four')!.source.startsWith('async function ('), 'async fn declaration');
});

test('skips what it cannot bound confidently — nested, reassigned, destructured, non-function', () => {
  const h = extractSetupHandlers(
    setup(
      '  const count = signal(0);\n' +
        '  const outer = () => { const nested = () => 1; return nested(); };\n' +
        '  let mut = () => 1;\n' +
        '  mut = () => 2;\n' +
        '  const { a } = props;\n' +
        '  const label = "x";\n' +
        '  return { count, outer };'
    )
  );
  assert.ok(h.has('outer'), 'the top-level handler is found');
  assert.ok(!h.has('nested'), 'a nested helper is NOT a component binding');
  assert.ok(!h.has('mut'), 'a reassigned binding is not a stable definition → skipped');
  assert.ok(!h.has('a'), 'destructuring is not a simple binding');
  assert.ok(!h.has('label'), 'a string is not a handler');
});

test('fail-safe: an unlocatable setup body yields no handlers (no guessing)', () => {
  assert.equal(extractSetupHandlers('export const setup = () => ({ a: 1 });').size, 0, 'concise arrow body → none');
  assert.equal(extractSetupHandlers('const inc = () => 1;').size, 0, 'no setup at all → none');
});

/* ──────────── inlinability (the safety gate) ──────────── */

const handler = (source: string, params: string[] = []): SetupHandler => ({ source, params });

test('inlinable when every free identifier is a ctx binding, a global, or its own param', () => {
  const ctx = new Set(['count', 'open']);
  assert.ok(isInlinable(handler('() => count.set((n) => n + 1)'), ctx), 'ctx signal + a nested arrow param');
  assert.ok(isInlinable(handler('() => open.set((v) => !v)'), ctx), 'toggle');
  assert.ok(isInlinable(handler('(e) => { e.preventDefault(); count.set(0); }', ['e']), ctx), 'own param + ctx');
  assert.ok(isInlinable(handler('() => console.log(JSON.stringify(count()))'), ctx), 'JS globals are fine');
  assert.ok(isInlinable(handler('function (e) { count.set(e.x); }', ['e']), ctx), 'fn-form params are subtracted');
});

test('NOT inlinable when it touches a setup local that never reaches the client', () => {
  const ctx = new Set(['count']);
  assert.ok(!isInlinable(handler('() => count.set((n) => n + step)'), ctx), 'a non-ctx local (`step`) → refuse');
  assert.ok(!isInlinable(handler('() => helper()'), ctx), 'a call to another setup fn → refuse');
  assert.ok(!isInlinable(handler('() => other.set(1)'), ctx), 'a signal that setup did not return → refuse');
});

test('a param shadowing a ctx name is a local, not ctx (the rewrite agrees)', () => {
  // `(count) => count + 1` binds its own `count`; it must NOT be read as the ctx signal.
  assert.ok(isInlinable(handler('(count) => count + 1', ['count']), new Set<string>()), 'shadowing param needs no ctx');
});

test('self-reference (recursion) does not block inlining', () => {
  assert.ok(isInlinable(handler('function () { tick(); }', []), new Set(['count']), 'tick'), 'own name is not a ctx miss');
});
