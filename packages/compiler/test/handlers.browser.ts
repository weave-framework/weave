import { test, assert } from '../../../tools/harness.js';
import { extractSetupHandlers, extractSetupBindings, extractModuleImports, isInlinable, isDerivable, type SetupHandler } from '@weave-framework/compiler';

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

/* ──────────── setup-body location (the form real components actually use) ──────────── */

test('finds handlers through a RETURN-TYPE ANNOTATION — the idiomatic TS setup (regression: live-verify caught this)', () => {
  // `auto-return`'s locator bails on an annotation (it has no return to inject). Handler extraction must not:
  // this is how nearly every real component is written, and bailing silently skipped ALL inlining.
  const h = extractSetupHandlers(
    'import { signal, type Signal } from "@weave-framework/runtime";\n' +
      'export function setup(): { count: Signal<number>; inc: () => void; reset: () => void } {\n' +
      '  const count = signal(3);\n' +
      '  const inc = () => count.set((n) => n + 1);\n' +
      '  const reset = () => count.set(0);\n' +
      '  return { count, inc, reset };\n}\n'
  );
  assert.equal(h.get('inc')!.source, '() => count.set((n) => n + 1)', 'inc found past the object-type annotation');
  assert.equal(h.get('reset')!.source, '() => count.set(0)', 'reset too');
});

test('finds handlers past a NAMED-type annotation and a generic one', () => {
  const named = extractSetupHandlers('type C = { inc: () => void };\nexport function setup(): C {\n  const inc = () => count.set(1);\n  return { inc };\n}');
  assert.ok(named.has('inc'), 'named return type');
  const generic = extractSetupHandlers('export function setup(): Ctx<{ a: 1 }> {\n  const inc = () => count.set(1);\n  return { inc };\n}');
  assert.ok(generic.has('inc'), 'generic return type containing braces');
});

test('finds handlers in an arrow setup, annotated or not', () => {
  const plain = extractSetupHandlers('export const setup = () => {\n  const inc = () => count.set(1);\n  return { inc };\n};');
  assert.ok(plain.has('inc'), 'arrow setup');
  const annotated = extractSetupHandlers('export const setup = (props): { inc: () => void } => {\n  const inc = () => count.set(1);\n  return { inc };\n};');
  assert.ok(annotated.has('inc'), 'annotated arrow setup');
});

/* ──────────── E1.6 — computeds re-derived on resume ──────────── */

test('extracts every non-function binding in source order (= dependency order), keeping the FULL initializer', () => {
  const b = extractSetupBindings(
    setup('  const count = signal(1);\n  const doubled = computed(() => count() * 2);\n  const quad = computed(() => doubled() * 2);\n  const inc = () => count.set(1);\n  return { count, doubled, quad, inc };')
  );
  // Every non-function binding is a derive CANDIDATE. The `if (ctx.x === undefined)` guard is what decides at
  // RUNTIME whether it is actually rebuilt — so `count`, a signal that crossed the wire, is never clobbered.
  assert.deepEqual([...b.computeds.keys()], ['count', 'doubled', 'quad'], 'declaration order, which is dependency order');
  assert.equal(b.computeds.get('doubled')!.source, 'computed(() => count() * 2)', 'the FULL initializer — its callee is a module import');
  assert.ok(b.handlers.has('inc') && !b.computeds.has('inc'), 'a function is a handler, not a derived binding');
});

test('a binding is derivable only when its initializer resolves on the client', () => {
  const c = (src: string) => ({ source: src });
  // `computed` / `createRouter` resolve because the emitted derive sits in the module that imports them.
  const mod = new Set(['count', 'computed']);
  assert.ok(isDerivable(c('computed(() => count() * 2)'), mod), 'ctx signal + the imported callee');
  assert.ok(!isDerivable(c('computed(() => count() * factor)'), mod), 'an unresolvable name (`factor`) → refuse');
  assert.ok(isDerivable(c('computed(() => doubled() + 1)'), new Set(['doubled', 'computed'])), 'reads an EARLIER derived binding');
  assert.ok(!isDerivable(c('computed(() => count() * 2)'), new Set(['count'])), 'the callee itself must resolve too');
  // the E1.11 case: built purely from module imports, so it needs nothing from the wire
  assert.ok(isDerivable(c('createRouter([route("/", { component: Home })])'), new Set(['createRouter', 'route', 'Home'])),
    'a router built from module imports is reconstructible');
});

test('module imports are collected — they are what a re-derived initializer may reference', () => {
  const imports = extractModuleImports(
    'import { createRouter, route as r } from "@weave-framework/router";\n' +
      'import Home from "./home";\n' +
      'import * as util from "./util";\n' +
      'import "./side-effect.css";\n'
  );
  assert.ok(imports.has('createRouter'), 'named');
  assert.ok(imports.has('r') && !imports.has('route'), 'aliased → the LOCAL name is what resolves in the module');
  assert.ok(imports.has('Home'), 'default');
  assert.ok(imports.has('util'), 'namespace');
  assert.equal(imports.size, 4, 'a side-effect-only import contributes nothing');
});
