import { test, assert } from '../../../tools/harness.js';
import { extractSetupHandlers, extractSetupBindings, extractModuleImports, isInlinable, isDerivable, unresolvedRefs, type SetupHandler } from '@weave-framework/compiler';

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

/* ──────────── E1.18: the analysis must not read TYPES or a handler's own locals as ctx refs ──────────── */

test('E1.18: a handler`s own block-body locals and TYPE annotations are not unresolved refs', () => {
  // The real `<Checkbox>` shape. It warned that `onNativeChange` "reads `el`, `HTMLInputElement`, `next`,
  // `boolean`, `props`" — but `el`/`next` are the handler's OWN locals and `HTMLInputElement`/`boolean` are
  // TYPE names, erased at runtime. Only `props` is a genuine unresolved ref. False causes make every warning
  // untrustworthy and refuse handlers that would have inlined fine.
  const script: string = setup(
    '  const input = signal(null);\n' +
      '  const onNativeChange = (): void => {\n' +
      '    const el: HTMLInputElement | null = input();\n' +
      '    if (!el) return;\n' +
      '    const next: boolean = el.checked;\n' +
      '    input.set(el);\n' +
      '  };\n' +
      '  return { input, onNativeChange };'
  );
  const h = extractSetupHandlers(script).get('onNativeChange')!;
  assert.ok(h, 'the handler was extracted');
  assert.deepEqual(
    unresolvedRefs(h.source, new Set(['input']), h.params, 'onNativeChange').sort(),
    [],
    'no false causes — the locals and the type names are gone, and `input` is in ctx',
  );
  assert.ok(isInlinable(h, new Set(['input']), 'onNativeChange'), 'so it inlines instead of being refused');
});

test('E1.18: a REAL unresolved ref still reports, and reports only itself', () => {
  const script: string = setup(
    '  const input = signal(null);\n' +
      '  const onChange = (): void => {\n' +
      '    const el: HTMLInputElement | null = input();\n' +
      '    const next: boolean = !!el;\n' +
      '    missing.set(next);\n' +
      '  };\n' +
      '  return { input, onChange };'
  );
  const h = extractSetupHandlers(script).get('onChange')!;
  assert.deepEqual(
    unresolvedRefs(h.source, new Set(['input']), h.params, 'onChange'),
    ['missing'],
    'the genuine culprit is named, and nothing else is',
  );
});

test('E1.18: a local declared in the handler does not mask a same-named ctx binding elsewhere', () => {
  // `count` is a ctx signal AND a local name in another handler — the local must not make the ctx ref vanish
  // from a DIFFERENT handler's analysis (the locals set is per-handler, not global).
  const script: string = setup(
    '  const count = signal(0);\n' +
      '  const a = (): void => { const tmp: number = 1; count.set(tmp); };\n' +
      '  const b = (): void => { missing.set(count()); };\n' +
      '  return { count, a, b };'
  );
  const hs = extractSetupHandlers(script);
  assert.deepEqual(unresolvedRefs(hs.get('a')!.source, new Set(['count']), [], 'a'), [], 'a: tmp is its own local');
  assert.deepEqual(unresolvedRefs(hs.get('b')!.source, new Set(['count']), [], 'b'), ['missing'], 'b: unaffected by a`s local');
});

test('E1.18: a PARAMETER type annotation is not a ref, but a default value still is', () => {
  // `<Sidenav>`'s `onKeydown` blamed `KeyboardEvent` — a param type. A param DEFAULT is real code though, so
  // the strip must stop at the `=`; and a ternary default (`= a ? b : c`) has a `:` that must survive.
  const script: string = setup(
    '  const step = signal(1);\n' +
      '  const onKeydown = (e: KeyboardEvent, mode: "a" | "b" = "a", n: number = pick ? 1 : 2): void => {\n' +
      '    step.set(e.key.length + n + mode.length);\n' +
      '  };\n' +
      '  return { step, onKeydown };'
  );
  const h = extractSetupHandlers(script).get('onKeydown')!;
  assert.deepEqual(
    unresolvedRefs(h.source, new Set(['step']), h.params, 'onKeydown'),
    ['pick'],
    'the param TYPES are gone; only `pick` — read by a default VALUE — is a genuine ref',
  );
});

test('E1.18: COMMENT prose and an `as` type assertion are not refs', () => {
  // `freeIdentifiers` skips strings and template literals but NOT comments, so every word of a doc comment was
  // read as a ctx reference: a real <Radio> handler blamed `Sync`, `the`, `navigates`, `already`… That is how a
  // warning list reaches 30 names and becomes worthless.
  const script: string = setup(
    '  const step = signal(1);\n' +
      '  const onKeydown = (e: KeyboardEvent): void => {\n' +
      '    // Sync the current tab so it navigates from the already focused segment.\n' +
      '    /* Arrow moves relative to the selected one. */\n' +
      '    const el = e.target as HTMLInputElement;\n' +
      '    step.set(el.value.length);\n' +
      '  };\n' +
      '  return { step, onKeydown };'
  );
  const h = extractSetupHandlers(script).get('onKeydown')!;
  assert.deepEqual(
    unresolvedRefs(h.source, new Set(['step']), h.params, 'onKeydown'),
    [],
    'comment words and the asserted type are gone — nothing here is a real ref',
  );
  assert.ok(isInlinable(h, new Set(['step']), 'onKeydown'), 'and the handler inlines');
});

test('E1.18: a ref mentioned ONLY in a comment is not resurrected, but real code after `as` still counts', () => {
  const script: string = setup(
    '  const step = signal(1);\n' +
      '  const go = (): void => {\n' +
      '    // mentions missingInComment which does not exist\n' +
      '    const v = step() as number;\n' +
      '    realMissing.set(v);\n' +
      '  };\n' +
      '  return { step, go };'
  );
  const h = extractSetupHandlers(script).get('go')!;
  assert.deepEqual(unresolvedRefs(h.source, new Set(['step']), h.params, 'go'), ['realMissing'],
    'only the genuine one, from real code');
});

test('E1.19: an arrow with a return type AND an expression body extracts its whole body', () => {
  // `(opt: T): boolean => opt.v === sel()` — the extractor stopped at the return type and produced a source
  // ending in `=>`, i.e. NO BODY. It was invisible while such helpers were never emitted; E1.19 emits them, so
  // the real <ButtonToggle> compiled to `const isSelected = (opt: ButtonToggleOption): boolean =>;` and the
  // BUILD failed with `Unexpected ";"`. A block body was fine, which is why 1374 tests never saw it.
  const hs = extractSetupHandlers(
    setup(
      '  const sel = signal("a");\n' +
        '  const isSelected = (opt: { value: string }): boolean => opt.value === sel();\n' +
        '  const plain = (x: number): number => x * 2;\n' +
        '  return { sel, isSelected, plain };'
    )
  );
  assert.ok(/opt\.value === sel\(\)\s*$/.test(hs.get('isSelected')!.source), `body kept; got: ${hs.get('isSelected')?.source}`);
  assert.ok(/x \* 2\s*$/.test(hs.get('plain')!.source), `body kept; got: ${hs.get('plain')?.source}`);
  assert.ok(!/=>\s*$/.test(hs.get('isSelected')!.source), 'and the source never ends at the arrow (that emitted `=>;`)');
});

test('E1.19: an arrow whose body starts on the NEXT LINE keeps its body — the real <ButtonToggle> shape', () => {
  // This is what actually broke the build: the body sits on the line AFTER `=>`, which is how prettier wraps a
  // long ternary. Same-line bodies extracted fine, so nothing caught it.
  const hs = extractSetupHandlers(
    setup(
      '  const sel = signal("a");\n' +
        '  const isSelected = (opt: { value: string }): boolean =>\n' +
        '    sel() === opt.value ? true : false;\n' +
        '  return { sel, isSelected };'
    )
  );
  assert.ok(!/=>\s*$/.test(hs.get('isSelected')!.source), `must not end at the arrow; got: ${hs.get('isSelected')?.source}`);
  assert.ok(/opt\.value \? true : false\s*$/.test(hs.get('isSelected')!.source), `whole body; got: ${hs.get('isSelected')?.source}`);
});

test('E1.18: an OPTIONAL parameter (`e?: Event`) is still its own param, not an unresolved ref', () => {
  // The real docs demos: `const save = (e?: Event): void => …`. The `?` clung to the name, so neither the
  // param list nor the free-id scan recognised `e` — the handler was blamed for reading its own argument.
  const script: string = setup(
    '  const n = signal(0);\n' +
      '  const save = (e?: Event, extra?: string): void => {\n' +
      '    e?.preventDefault();\n' +
      '    n.set(extra ? 1 : 2);\n' +
      '  };\n' +
      '  return { n, save };'
  );
  const h = extractSetupHandlers(script).get('save')!;
  assert.deepEqual(h.params.slice().sort(), ['e', 'extra'], `optional params read cleanly; got ${JSON.stringify(h.params)}`);
  assert.deepEqual(unresolvedRefs(h.source, new Set(['n']), h.params, 'save'), [], 'and nothing is blamed');
});
