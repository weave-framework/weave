import { test, assert } from '../../../tools/harness.js';
import { injectAutoReturn } from '@weave-framework/compiler';

/** Convenience: the transformed code for a setup body with the given names. */
function run(script: string, names: string[] = ['count', 'inc']): string {
  return injectAutoReturn(script, names).code;
}

/* ──────────── injects when there is no explicit return ──────────── */

test('injects a return exposing the given names into a plain function setup', () => {
  const src: string = 'export function setup() {\n  const count = signal(0);\n  const inc = () => count.set((n) => n + 1);\n}';
  const out: string = run(src);
  assert.ok(out.includes('return { count, inc };'), out);
  // the injected return sits INSIDE the body (before its closing brace)
  assert.ok(/return \{ count, inc \};\n\}$/.test(out.trim()), out);
});

test('injects even when the only returns are inside nested arrows/functions', () => {
  // The common real case: computeds/handlers return, but setup itself does not.
  const src: string =
    'export function setup() {\n' +
    '  const a = computed(() => { return 1; });\n' +
    '  const ok = () => { if (x) return true; return false; };\n' +
    '  const b = signal(0);\n' +
    '}';
  const out: string = injectAutoReturn(src, ['a', 'b']).code;
  assert.ok(out.includes('return { a, b };'), out);
});

test('injects for an arrow setup with a block body', () => {
  const src: string = 'export const setup = () => {\n  const count = signal(0);\n  const inc = () => 1;\n};';
  assert.ok(run(src).includes('return { count, inc };'));
});

test('injects for an async function setup', () => {
  const src: string = 'export async function setup() {\n  const count = signal(0);\n  const inc = () => 1;\n}';
  assert.ok(run(src).includes('return { count, inc };'));
});

test('injects for `export const setup = function () { … }`', () => {
  const src: string = 'export const setup = function () {\n  const count = signal(0);\n  const inc = () => 1;\n};';
  assert.ok(run(src).includes('return { count, inc };'));
});

test('reports the injection offset + length (code = slice + insert + slice)', () => {
  const src: string = 'export function setup() {\n  const count = signal(0);\n}';
  const r: ReturnType<typeof injectAutoReturn> = injectAutoReturn(src, ['count']);
  assert.equal(typeof r.injectedAt, 'number');
  assert.equal(typeof r.injectedLen, 'number');
  const rebuilt: string = src.slice(0, r.injectedAt!) + r.code.slice(r.injectedAt!, r.injectedAt! + r.injectedLen!) + src.slice(r.injectedAt!);
  assert.equal(rebuilt, r.code, 'injection is a pure insertion at injectedAt');
});

/* ──────────── leaves an explicit return untouched ──────────── */

test('does NOT inject when setup already returns at the top level', () => {
  const src: string = 'export function setup() {\n  const count = signal(0);\n  return { count };\n}';
  assert.equal(run(src), src, 'byte-for-byte unchanged');
});

test('does NOT inject when the top-level return is inside an if/switch block', () => {
  // A return nested in a control block (not a function) is still setup's own return.
  const src: string = 'export function setup(props) {\n  if (props.a) { return { a: 1 }; }\n  return { b: 2 };\n}';
  assert.equal(injectAutoReturn(src, ['a', 'b']).code, src);
});

test('does NOT inject for a concise-arrow setup (implicit return)', () => {
  const src: string = 'export const setup = () => ({ count: signal(0) });';
  assert.equal(run(src), src);
});

test('does NOT inject when a return-type annotation is present (fail-safe)', () => {
  const src: string = 'export function setup(): { count: number } {\n  const count = 0;\n}';
  assert.equal(run(src, ['count']), src);
});

test('does NOT inject when names is empty', () => {
  const src: string = 'export function setup() {\n  effect(() => {});\n}';
  assert.equal(injectAutoReturn(src, []).code, src);
});

test('does NOT inject when there is no setup', () => {
  const src: string = 'export const x = 1;';
  assert.equal(run(src), src);
});

/* ──────────── the scanner is not fooled by strings / regex / templates ──────────── */

test('a regex literal containing braces does not derail the scan', () => {
  const src: string =
    'export function setup() {\n' +
    '  const re = /[a-z]{3,30}/i;\n' +
    '  const ok = (s) => /^\\d{2,}$/.test(s);\n' +
    '  const count = signal(0);\n' +
    '}';
  assert.ok(injectAutoReturn(src, ['count']).code.includes('return { count };'));
});

test('a template literal with ${ … } braces does not derail the scan', () => {
  const src: string =
    'export function setup() {\n' +
    '  const label = (o) => `${o.a}-${ { k: o.b }.k }`;\n' +
    '  const count = signal(0);\n' +
    '}';
  assert.ok(injectAutoReturn(src, ['count']).code.includes('return { count };'));
});

test('a "return" inside a string/comment is not a top-level return', () => {
  const src: string =
    'export function setup() {\n' +
    '  const msg = "please return soon";\n' +
    '  // return early? no\n' +
    '  const count = signal(0);\n' +
    '}';
  assert.ok(injectAutoReturn(src, ['count']).code.includes('return { count };'));
});

test('a `.return` member access is not counted as a return statement', () => {
  const src: string =
    'export function setup() {\n' +
    '  const it = makeIter();\n' +
    '  it.return();\n' +
    '  const count = signal(0);\n' +
    '}';
  assert.ok(injectAutoReturn(src, ['count']).code.includes('return { count };'));
});
