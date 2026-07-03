import { test, assert } from '../../../tools/harness.js';
import { rewrite, ctxScope, childScope, type Scope, type RewriteSegment } from '@weave-framework/compiler';

/** Assert the verbatim invariant: each segment quotes identical text on both sides. */
function assertVerbatim(expr: string, code: string, segments: RewriteSegment[]): void {
  for (const s of segments) {
    assert.equal(
      code.slice(s.gen, s.gen + s.len),
      expr.slice(s.src, s.src + s.len),
      `segment src=${s.src} gen=${s.gen} len=${s.len} not verbatim`
    );
  }
}

/** Assert segments tile the whole source [0, expr.length) with no gap/overlap. */
function assertFullSourceCoverage(expr: string, segments: RewriteSegment[]): void {
  const ordered: RewriteSegment[] = [...segments].sort((a, b) => a.src - b.src);
  let at: number = 0;
  for (const s of ordered) {
    assert.equal(s.src, at, `coverage gap/overlap at src=${at} (segment src=${s.src})`);
    at = s.src + s.len;
  }
  assert.equal(at, expr.length, `source not fully covered: reached ${at} of ${expr.length}`);
}

test('rewrite: ctx binding prefixes __ctx. and maps the name verbatim', () => {
  const expr: string = 'count';
  const r: ReturnType<typeof rewrite> = rewrite(expr, ctxScope(['count']), '__ctx');
  assert.equal(r.code, '__ctx.count');
  assert.equal(r.reactive, true);
  // single segment: the name, mapped past the inserted `__ctx.` prefix
  assert.deepEqual(r.segments, [{ src: 0, gen: 6, len: 5 }]);
  assertVerbatim(expr, r.code, r.segments);
  assertFullSourceCoverage(expr, r.segments);
});

test('rewrite: trailing operators stay mapped after a ctx rewrite', () => {
  const expr: string = 'count + 1';
  const r: ReturnType<typeof rewrite> = rewrite(expr, ctxScope(['count']), '__ctx');
  assert.equal(r.code, '__ctx.count + 1');
  assertVerbatim(expr, r.code, r.segments);
  assertFullSourceCoverage(expr, r.segments);
  // The name and the trailing ` + 1` are contiguous on both sides (the only break
  // was the inserted `__ctx.`), so they merge into one run starting past the prefix.
  assert.deepEqual(r.segments, [{ src: 0, gen: 6, len: 9 }]);
  // the literal ` + 1` (source 5..9) is covered and maps to gen 11..15
  const seg: RewriteSegment | undefined = r.segments.find((s) => s.src <= 5 && 5 < s.src + s.len);
  assert.ok(seg);
  assert.equal(r.code.slice(seg!.gen + (5 - seg!.src), seg!.gen + seg!.len), ' + 1');
});

test('rewrite: property names after a ctx member are not rewritten but stay mapped', () => {
  const expr: string = 'obj.count';
  const r: ReturnType<typeof rewrite> = rewrite(expr, ctxScope(['obj', 'count']), '__ctx');
  assert.equal(r.code, '__ctx.obj.count'); // `count` is a property, left alone
  assertVerbatim(expr, r.code, r.segments);
  assertFullSourceCoverage(expr, r.segments);
});

test('rewrite: local bindings emit the bare name, fully mapped', () => {
  const scope: Scope = new Map([['todo', { kind: 'local' }]]);
  const expr: string = 'todo.title';
  const r: ReturnType<typeof rewrite> = rewrite(expr, scope, '__ctx');
  assert.equal(r.code, 'todo.title');
  assert.equal(r.reactive, true);
  assertVerbatim(expr, r.code, r.segments);
  assertFullSourceCoverage(expr, r.segments);
});

test('rewrite: string literals are copied verbatim and mapped', () => {
  const expr: string = "'a' + x";
  const r: ReturnType<typeof rewrite> = rewrite(expr, ctxScope(['x']), '__ctx');
  assert.equal(r.code, "'a' + __ctx.x");
  assertVerbatim(expr, r.code, r.segments);
  assertFullSourceCoverage(expr, r.segments);
});

test('rewrite: globals are untouched and stay mapped', () => {
  const expr: string = 'Math.max(count, 0)';
  const r: ReturnType<typeof rewrite> = rewrite(expr, ctxScope(['count']), '__ctx');
  assert.equal(r.code, 'Math.max(__ctx.count, 0)');
  assertVerbatim(expr, r.code, r.segments);
  assertFullSourceCoverage(expr, r.segments);
});

test('rewrite: runtime accessor (call) leaves the synthesized call unmapped', () => {
  const scope: Scope = childScope(new Map(), { todo: '$todo' });
  const expr: string = 'todo.done';
  const r: ReturnType<typeof rewrite> = rewrite(expr, scope); // default ctxRef, runtime mode
  assert.equal(r.code, '$todo().done');
  // `todo` → `$todo()` is synthesized (no source counterpart); `.done` stays mapped
  assertVerbatim(expr, r.code, r.segments);
  const done: RewriteSegment | undefined = r.segments.find((s) => expr.slice(s.src, s.src + s.len) === '.done');
  assert.ok(done, 'the .done tail should remain mapped');
});

test('rewrite: bindings inside a template literal ${ } are resolved', () => {
  const expr: string = '`Hi ${name}, you have ${count} left`';
  const r: ReturnType<typeof rewrite> = rewrite(expr, ctxScope(['name', 'count']), '__ctx');
  assert.equal(r.code, '`Hi ${__ctx.name}, you have ${__ctx.count} left`');
  assert.equal(r.reactive, true);
  assertVerbatim(expr, r.code, r.segments);
  assertFullSourceCoverage(expr, r.segments);
});

test('rewrite: a literal quote-string inside ${ } is left alone', () => {
  const expr: string = '`${ok ? "yes" : "no"}`';
  const r: ReturnType<typeof rewrite> = rewrite(expr, ctxScope(['ok']), '__ctx');
  assert.equal(r.code, '`${__ctx.ok ? "yes" : "no"}`');
  assertVerbatim(expr, r.code, r.segments);
  assertFullSourceCoverage(expr, r.segments);
});

test('rewrite: object shorthand expands to key: value', () => {
  assert.equal(rewrite('{ name }', ctxScope(['name']), '__ctx').code, '{ name: __ctx.name }');
  assert.equal(rewrite('{ a, b }', ctxScope(['a', 'b']), '__ctx').code, '{ a: __ctx.a, b: __ctx.b }');
  // a real property value (`key: expr`) is NOT treated as shorthand
  assert.equal(rewrite('{ id: x }', ctxScope(['x']), '__ctx').code, '{ id: __ctx.x }');
});

test('rewrite: object shorthand with a runtime accessor expands too', () => {
  const scope: Scope = childScope(new Map(), { todo: '$todo' });
  assert.equal(rewrite('{ todo }', scope).code, '{ todo: $todo() }');
});

test('rewrite: an explicit object-literal key is never scope-prefixed', () => {
  // The KEY of `{ key: value }` is a property name, not a reference — even when a ctx binding
  // of the same name exists it must stay literal (regression: `use:ripple={{ { centered: true } }}`
  // emitted `{ ctx.centered: true }`, invalid JS). The VALUE still rewrites normally.
  assert.equal(rewrite('{ centered: true }', ctxScope(['centered']), '__ctx').code, '{ centered: true }');
  assert.equal(rewrite('{ centered: on }', ctxScope(['centered', 'on']), '__ctx').code, '{ centered: __ctx.on }');
  // second/later keys after a comma are keys too
  assert.equal(
    rewrite('{ a: 1, centered: true }', ctxScope(['a', 'centered']), '__ctx').code,
    '{ a: 1, centered: true }'
  );
  const r: ReturnType<typeof rewrite> = rewrite('{ centered: true }', ctxScope(['centered']), '__ctx');
  assertVerbatim('{ centered: true }', r.code, r.segments);
  assertFullSourceCoverage('{ centered: true }', r.segments);
});

test('rewrite: shorthand still expands (not confused with an explicit key)', () => {
  // The key/value distinction hinges on the char after the name (`:` = explicit key, `,`/`}` = shorthand).
  assert.equal(rewrite('{ centered }', ctxScope(['centered']), '__ctx').code, '{ centered: __ctx.centered }');
});

test('rewrite: a ternary branch after `:` is not mistaken for an object key', () => {
  // `x` follows `:` but the preceding non-space is `?`/an operand, not `{`/`,` — so it stays a value.
  assert.equal(rewrite('ok ? y : x', ctxScope(['ok', 'y', 'x']), '__ctx').code, '__ctx.ok ? __ctx.y : __ctx.x');
});

test('rewrite: code output is unchanged vs the pre-segment behavior (regression guard)', () => {
  // A spread of shapes; `code` must match the historical contract exactly.
  assert.equal(rewrite('a ? b : c', ctxScope(['a', 'b', 'c']), '__ctx').code, '__ctx.a ? __ctx.b : __ctx.c');
  assert.equal(rewrite('items.length', ctxScope(['items']), '__ctx').code, '__ctx.items.length');
  assert.equal(rewrite('1 + 2', ctxScope([]), '__ctx').code, '1 + 2');
  assert.equal(rewrite('fn(x)', ctxScope(['fn', 'x']), '__ctx').code, '__ctx.fn(__ctx.x)');
});
