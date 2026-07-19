import ts from 'typescript';
import { test, assert } from '../../../tools/harness.js';
import { unresolvedRefs } from '@weave-framework/compiler';
import { unresolvedRefsTs, PARSE_FAILED } from '../src/ts-refs.js';
import { isJsGlobal } from '../src/scope.js';

/**
 * Setup-source reference analysis on the TypeScript AST (`ts-refs.ts`).
 *
 * `unresolvedRefs` decides whether a `setup` binding can be inlined into the resumed `handlers(ctx)` factory:
 * an empty answer means every name it reads will resolve on the client, and a non-empty one refuses the binding
 * — which makes the control INERT after resume (it falls back to a `ctx.<name>` that no longer exists). So a
 * FALSE positive here is not cosmetic: it silently kills a working button.
 *
 * This is the only test file in the repo that bundles TypeScript, and deliberately so — `ts` is injected rather
 * than imported precisely so the other 54 compiler-touching browser bundles stay free of it.
 */

const CTX: ReadonlySet<string> = new Set(['items', 'count']);
const refs = (source: string, params: readonly string[] = []): string[] =>
  unresolvedRefsTs(ts, source, CTX, params, undefined, undefined, isJsGlobal);

/* ──────────── the defects the lexical path has (each fails without ts-refs.ts) ──────────── */

test('a destructured parameter is not blamed as an unresolved reference', () => {
  const source: string = '(e) => items().map(({ id, label }) => id + label)';
  // The lexical scanner's `arrowParams` splits a parameter list on commas and strips brackets, so the FIRST
  // name of an object pattern is lost — it reports the handler as reading its own `id`.
  assert.deepEqual(unresolvedRefs(source, CTX), ['id'], 'the lexical path still shows the defect');
  assert.deepEqual(refs(source), [], 'the AST path binds every name the pattern introduces');
});

test('a nested destructured parameter is not blamed either', () => {
  const source: string = '({ a: { b } }) => b + 1';
  assert.deepEqual(unresolvedRefs(source, CTX), ['b'], 'the lexical path still shows the defect');
  assert.deepEqual(refs(source), [], 'nesting is walked to the leaf bindings');
});

/* ──────────── it must not have become merely permissive ──────────── */

test('a genuinely missing name is still reported', () => {
  assert.deepEqual(refs('() => somethingUndeclared + count()'), ['somethingUndeclared']);
});

test('a setup local the client never receives is still reported', () => {
  assert.deepEqual(refs('() => count.set(step)'), ['step'], '`step` is a setup local, not a ctx binding');
});

test('each unresolved name is blamed once, in first-seen order', () => {
  assert.deepEqual(refs('() => { zeta(); alpha(); zeta(); }'), ['zeta', 'alpha']);
});

/* ──────────── what the AST knows that the lexical path approximated ──────────── */

test('type annotations reference nothing at runtime', () => {
  // The type names here are deliberately NOT in `NON_CTX` (`KeyboardEvent`, `HTMLElement` and friends are, so
  // using one would let this pass even with type-skipping removed — it did, until a mutation run caught it).
  // A user-defined type is erased at runtime and must be invisible to this analysis on its own merits.
  assert.deepEqual(refs('(e: RowProps): SortOrder => { const n: TableColumn | null = null; count.set(0); return n; }'), []);
});

test('a type argument is not a value reference', () => {
  assert.deepEqual(refs('() => count.set(0 as unknown as ColumnWidth)'), []);
  assert.deepEqual(refs('() => items().map<CellValue>((r) => r)'), []);
});

test('a property name is not a reference, but a computed key is', () => {
  assert.deepEqual(refs('() => ({ nope: count() })'), [], 'an object key names a property');
  assert.deepEqual(refs('() => items().nope'), [], 'a member access reads only the object');
  assert.deepEqual(refs('() => ({ [dynamicKey]: 1 })'), ['dynamicKey'], 'a computed key IS code');
});

test('object shorthand is a reference', () => {
  assert.deepEqual(refs('() => ({ count })'), [], 'resolves — `count` is a ctx binding');
  assert.deepEqual(refs('() => ({ missing })'), ['missing']);
});

test('declarations bind, at every depth and in every form', () => {
  assert.deepEqual(refs('() => { const [k, v] = items(); return k + v; }'), []);
  assert.deepEqual(refs('() => { for (const { id } of items()) count.set(id); }'), []);
  assert.deepEqual(refs('() => { try { count(); } catch (err) { return err; } }'), []);
  assert.deepEqual(refs('() => { function helper(a) { return a; } return helper(1); }'), []);
});

test('a function declared below its use is hoisted', () => {
  assert.deepEqual(refs('() => { const r = later(); function later() { return 1; } return r; }'), []);
});

test('a parameter default may read an earlier parameter', () => {
  assert.deepEqual(refs('(a, b = a) => a + b'), []);
});

test('own parameters, self-reference and the emitted callee are all resolvable', () => {
  assert.deepEqual(
    unresolvedRefsTs(ts, 'function (e) { return recurse(e); }', CTX, ['e'], 'recurse', 'computed', isJsGlobal),
    []
  );
});

test('JS globals resolve through the same list the lexical path uses', () => {
  assert.deepEqual(refs('() => { console.log(Math.max(1, 2)); return JSON.stringify(items()); }'), []);
});

/* ──────────── fail-safe ──────────── */

test('an unparsable fragment refuses rather than reporting nothing', () => {
  // Guards the TypeScript-internal `parseDiagnostics` this relies on: were a future TypeScript to drop the
  // field, the refusal would silently stop happening and every malformed body would be ACCEPTED — inlined into
  // the factory to throw on the client. This test is what makes that a gate failure instead.
  const answer: string[] = refs('(a, => { broken');
  assert.deepEqual(answer, [PARSE_FAILED], 'the sentinel is returned');
  assert.ok(answer.length > 0, 'non-empty ⇒ the caller refuses the binding');
});
