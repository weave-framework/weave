import { test, assert } from '../../../tools/harness.js';
import { extractSetupHandlers, extractSetupBindings, extractModuleImports, isInlinable, isDerivable, unresolvedRefs, setupCallsHook, type SetupHandler, type SetupBindings } from '@weave-framework/compiler';

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
  const h: Map<string, SetupHandler> = extractSetupHandlers(setup('  const pick = (e, i) => { sel.set(i); e.preventDefault(); };\n  return { pick };'));
  assert.equal(h.get('pick')!.source, '(e, i) => { sel.set(i); e.preventDefault(); }', 'block body captured whole');
  assert.deepEqual(h.get('pick')!.params, ['e', 'i'], 'params recorded');
});

test('extracts a single bare-param arrow + a function declaration + async forms', () => {
  const h: Map<string, SetupHandler> = extractSetupHandlers(
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
  const h: Map<string, SetupHandler> = extractSetupHandlers(
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
  const ctx: Set<string> = new Set(['count', 'open']);
  assert.ok(isInlinable(handler('() => count.set((n) => n + 1)'), ctx), 'ctx signal + a nested arrow param');
  assert.ok(isInlinable(handler('() => open.set((v) => !v)'), ctx), 'toggle');
  assert.ok(isInlinable(handler('(e) => { e.preventDefault(); count.set(0); }', ['e']), ctx), 'own param + ctx');
  assert.ok(isInlinable(handler('() => console.log(JSON.stringify(count()))'), ctx), 'JS globals are fine');
  assert.ok(isInlinable(handler('function (e) { count.set(e.x); }', ['e']), ctx), 'fn-form params are subtracted');
});

test('NOT inlinable when it touches a setup local that never reaches the client', () => {
  const ctx: Set<string> = new Set(['count']);
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
  const h: Map<string, SetupHandler> = extractSetupHandlers(
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
  const named: Map<string, SetupHandler> = extractSetupHandlers('type C = { inc: () => void };\nexport function setup(): C {\n  const inc = () => count.set(1);\n  return { inc };\n}');
  assert.ok(named.has('inc'), 'named return type');
  const generic: Map<string, SetupHandler> = extractSetupHandlers('export function setup(): Ctx<{ a: 1 }> {\n  const inc = () => count.set(1);\n  return { inc };\n}');
  assert.ok(generic.has('inc'), 'generic return type containing braces');
});

test('finds handlers in an arrow setup, annotated or not', () => {
  const plain: Map<string, SetupHandler> = extractSetupHandlers('export const setup = () => {\n  const inc = () => count.set(1);\n  return { inc };\n};');
  assert.ok(plain.has('inc'), 'arrow setup');
  const annotated: Map<string, SetupHandler> = extractSetupHandlers('export const setup = (props): { inc: () => void } => {\n  const inc = () => count.set(1);\n  return { inc };\n};');
  assert.ok(annotated.has('inc'), 'annotated arrow setup');
});

/* ──────────── E1.6 — computeds re-derived on resume ──────────── */

test('extracts every non-function binding in source order (= dependency order), keeping the FULL initializer', () => {
  const b: SetupBindings = extractSetupBindings(
    setup('  const count = signal(1);\n  const doubled = computed(() => count() * 2);\n  const quad = computed(() => doubled() * 2);\n  const inc = () => count.set(1);\n  return { count, doubled, quad, inc };')
  );
  // Every non-function binding is a derive CANDIDATE. The `if (ctx.x === undefined)` guard is what decides at
  // RUNTIME whether it is actually rebuilt — so `count`, a signal that crossed the wire, is never clobbered.
  assert.deepEqual([...b.computeds.keys()], ['count', 'doubled', 'quad'], 'declaration order, which is dependency order');
  assert.equal(b.computeds.get('doubled')!.source, 'computed(() => count() * 2)', 'the FULL initializer — its callee is a module import');
  assert.ok(b.handlers.has('inc') && !b.computeds.has('inc'), 'a function is a handler, not a derived binding');
});

test('a binding is derivable only when its initializer resolves on the client', () => {
  const c: (src: string) => { source: string } = (src: string) => ({ source: src });
  // `computed` / `createRouter` resolve because the emitted derive sits in the module that imports them.
  const mod: Set<string> = new Set(['count', 'computed']);
  assert.ok(isDerivable(c('computed(() => count() * 2)'), mod), 'ctx signal + the imported callee');
  assert.ok(!isDerivable(c('computed(() => count() * factor)'), mod), 'an unresolvable name (`factor`) → refuse');
  assert.ok(isDerivable(c('computed(() => doubled() + 1)'), new Set(['doubled', 'computed'])), 'reads an EARLIER derived binding');
  assert.ok(!isDerivable(c('computed(() => count() * 2)'), new Set(['count'])), 'the callee itself must resolve too');
  // the E1.11 case: built purely from module imports, so it needs nothing from the wire
  assert.ok(isDerivable(c('createRouter([route("/", { component: Home })])'), new Set(['createRouter', 'route', 'Home'])),
    'a router built from module imports is reconstructible');
});

test('module imports are collected — they are what a re-derived initializer may reference', () => {
  const imports: Set<string> = extractModuleImports(
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
  const h: SetupHandler = extractSetupHandlers(script).get('onNativeChange')!;
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
  const h: SetupHandler = extractSetupHandlers(script).get('onChange')!;
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
  const hs: Map<string, SetupHandler> = extractSetupHandlers(script);
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
  const h: SetupHandler = extractSetupHandlers(script).get('onKeydown')!;
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
  const h: SetupHandler = extractSetupHandlers(script).get('onKeydown')!;
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
  const h: SetupHandler = extractSetupHandlers(script).get('go')!;
  assert.deepEqual(unresolvedRefs(h.source, new Set(['step']), h.params, 'go'), ['realMissing'],
    'only the genuine one, from real code');
});

test('E1.19: an arrow with a return type AND an expression body extracts its whole body', () => {
  // `(opt: T): boolean => opt.v === sel()` — the extractor stopped at the return type and produced a source
  // ending in `=>`, i.e. NO BODY. It was invisible while such helpers were never emitted; E1.19 emits them, so
  // the real <ButtonToggle> compiled to `const isSelected = (opt: ButtonToggleOption): boolean =>;` and the
  // BUILD failed with `Unexpected ";"`. A block body was fine, which is why 1374 tests never saw it.
  const hs: Map<string, SetupHandler> = extractSetupHandlers(
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
  const hs: Map<string, SetupHandler> = extractSetupHandlers(
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
  const h: SetupHandler = extractSetupHandlers(script).get('save')!;
  assert.deepEqual(h.params.slice().sort(), ['e', 'extra'], `optional params read cleanly; got ${JSON.stringify(h.params)}`);
  assert.deepEqual(unresolvedRefs(h.source, new Set(['n']), h.params, 'save'), [], 'and nothing is blamed');
});

test('E1.28: a call`s TYPE ARGUMENTS are not refs, but a comparison is left alone', () => {
  // `signal<Element | null>(null)` — `Element` is a type, erased at runtime. The old asDerivedInit dropped type
  // args, which quietly kept them out of the analysis too; widening it (E1.28) brought every element-ref drop
  // straight back (226 on the docs) until this was handled where it belongs.
  assert.deepEqual(
    unresolvedRefs('signal<Element | null>(null)', new Set(['signal']), [], 'host'),
    [],
    'the type argument is gone',
  );
  // a real comparison must survive: `a < b` is not a type-arg list (its match is not followed by `(`)
  assert.deepEqual(
    unresolvedRefs('go(a < b, c > d)', new Set(['go']), [], 'x').sort(),
    ['a', 'b', 'c', 'd'],
    'a comparison is left alone',
  );
});

test('E1.29: a binding annotated with a FUNCTION TYPE is still extracted — its `=>` is not the assignment', () => {
  // The real <Sidenav>: `const narrow: () => boolean = breakpointSignal(bp)`. readVarDecl skipped the
  // annotation by scanning for the first top-level `=` — which is the ARROW's, so it bailed and the binding
  // vanished from the extraction entirely, taking `effectiveMode` and everything behind it with it.
  const f: SetupBindings = extractSetupBindings(
    setup(
      '  const bp = "sm";\n' +
        '  const narrow: () => boolean = breakpointSignal(bp);\n' +
        '  const pick: (a: number) => string = fmt(bp);\n' +
        '  return { narrow, pick };'
    )
  );
  assert.equal(f.computeds.get('narrow')?.source, 'breakpointSignal(bp)', 'the initializer, not the annotation');
  assert.equal(f.computeds.get('pick')?.source, 'fmt(bp)', 'and with parameters in the function type too');
});

test('E1.30: a reassigned VALUE is still extracted (a reassigned FUNCTION is not)', () => {
  // `let dragging = false; … dragging = true` — a transient flag the real <Slider> keeps in setup's closure.
  // The drop exists because inlining a FUNCTION whose definition was replaced would use a stale body; a value
  // has no body, only an initial value, and it never crossed the wire anyway (it is a local), so rebuilding it
  // from its initializer is exactly what derive does for every other local.
  const f: SetupBindings = extractSetupBindings(
    setup(
      '  let dragging = false;\n' +
        '  let mut = () => 1;\n' +
        '  mut = () => 2;\n' +
        '  const start = () => { dragging = true; };\n' +
        '  return { start };'
    )
  );
  assert.equal(f.computeds.get('dragging')?.source, 'false', 'the reassigned VALUE keeps its initializer');
  assert.ok(!f.handlers.has('mut'), 'a reassigned FUNCTION is still dropped — its body is not stable');
  assert.ok(f.handlers.has('start'), 'and the handler that mutates the flag is untouched');
});

test('E1.31: an arrow`s RETURN type is not a ref, with or without parameters', () => {
  // `(): DOMRect | null => {…}` — the param branch consumed the `)`, so the branch that strips a return type
  // never saw it, and the real <Slider>'s `trackRect` was blamed for reading `DOMRect`. That refusal cascaded:
  // `valueFromClientX` calls it, and both pointer handlers call that.
  const script: string = setup(
    '  const host = signal(null);\n' +
      '  const rect = (): DOMRect | null => {\n' +
      '    const el: Element | null = host();\n' +
      '    return el ? el.getBoundingClientRect() : null;\n' +
      '  };\n' +
      '  const at = (x: number): number => (rect()?.width ?? 0) + x;\n' +
      '  return { host };'
  );
  const hs: Map<string, SetupHandler> = extractSetupHandlers(script);
  assert.deepEqual(unresolvedRefs(hs.get('rect')!.source, new Set(['host']), hs.get('rect')!.params, 'rect'), [],
    'a bare `()` with a return type');
  assert.deepEqual(unresolvedRefs(hs.get('at')!.source, new Set(['rect']), hs.get('at')!.params, 'at'), [],
    'and one with parameters');
});

test('E1.32: a declaration with NO initializer is still a binding — it is simply undefined', () => {
  // `let timer: ReturnType<typeof setTimeout> | undefined;` — the docs' <CodeBlock>. readVarDecl requires an
  // `=`, so it was not extracted at all and every handler touching `timer` was refused. An uninitialized `let`
  // IS its value: undefined. Rebuilding it that way is exactly what setup's closure started with.
  const f: SetupBindings = extractSetupBindings(
    setup(
      '  let timer: ReturnType<typeof setTimeout> | undefined;\n' +
        '  let plain;\n' +
        '  const n = signal(0);\n' +
        '  const go = () => { timer = setTimeout(() => n.set(1), 10); };\n' +
        '  return { n, go };'
    )
  );
  assert.equal(f.computeds.get('timer')?.source, 'undefined', 'an annotated declaration with no initializer');
  assert.equal(f.computeds.get('plain')?.source, 'undefined', 'and a bare one');
  assert.deepEqual(
    unresolvedRefs(f.handlers.get('go')!.source, new Set(['n', 'timer']), [], 'go'),
    [],
    'so the handler that assigns it resolves',
  );
});

test('E1.34: a handler defined INLINE in setup`s return object is extracted', () => {
  // `return { count, inc: () => count.set(n => n + 1) }` — the shape most of the docs demos and much of
  // @weave-framework/ui use. The extractor only read `const`/`function` declarations, so every one of these was
  // "its definition could not be read from setup()" and fell back to a dead `ctx.inc`.
  const f: SetupBindings = extractSetupBindings(
    setup(
      '  const count = signal(2);\n' +
        '  return {\n' +
        '    count,\n' +
        '    inc: (): void => count.set((n) => n + 1),\n' +
        '    reset: () => { count.set(0); },\n' +
        '    label: (n: number): string => `#${n}`,\n' +
        '    plain: 42,\n' +
        '  };'
    )
  );
  assert.equal(f.handlers.get('inc')?.source, '(): void => count.set((n) => n + 1)', 'an annotated arrow value');
  assert.equal(f.handlers.get('reset')?.source, '() => { count.set(0); }', 'a block-bodied one');
  assert.deepEqual(f.handlers.get('label')?.params, ['n'], 'params are read');
  assert.ok(!f.handlers.has('plain'), 'a non-function value is not a handler');
  assert.ok(!f.handlers.has('count'), 'and a shorthand is a reference, not a definition');
});

test('E1.34: an inline return handler is inlinable when its body resolves', () => {
  const f: SetupBindings = extractSetupBindings(setup('  const count = signal(0);\n  return { count, inc: () => count.set(1) };'));
  assert.ok(isInlinable(f.handlers.get('inc')!, new Set(['count']), 'inc'), 'resolves against the resumed ctx');
});

test('E1.35: a function DECLARATION with a return type is read — the annotation is not a wall', () => {
  // `function openPanel(): void { … }` — <Autocomplete>, <DateRangePicker>, <Menu>. readFunctionDecl required
  // the body brace RIGHT after `)` and bailed on the annotation ("fail-safe skip"), so the helper vanished and
  // every handler calling it was refused. Skipping a return type is the same thing E1.5-3 already had to do for
  // `setup` itself.
  const f: SetupBindings = extractSetupBindings(
    setup(
      '  const open = signal(false);\n' +
        '  function openPanel(): void { open.set(true); }\n' +
        '  function label(n: number): string { return `#${n}`; }\n' +
        '  function plain() { open.set(false); }\n' +
        '  const onClick = () => openPanel();\n' +
        '  return { open, onClick };'
    )
  );
  assert.equal(f.handlers.get('openPanel')?.source, 'function () { open.set(true); }', 'a bare `(): void` body');
  assert.deepEqual(f.handlers.get('label')?.params, ['n'], 'params + a named return type');
  assert.ok(f.handlers.has('plain'), 'an unannotated declaration still works');
  // (whether `openPanel` then RESOLVES for a caller is resumableSetup's settled set, not the extractor's — the
  //  component-level test in component.browser.ts covers that end of it)
  assert.ok(f.handlers.has('onClick'), 'and the handler that calls it is extracted alongside');
});

test('E1.36: a GENERIC setup is located — a default type param may contain braces', () => {
  // `export function setup<T = { value: string; label: string }>(props: P<T>): C {` — the real <Autocomplete>,
  // <Select>, <Menu>. The locator did not expect type PARAMETERS, and the braces inside the default swallowed
  // the body, so NOTHING was extracted from those components at all: every handler in them was dead.
  const h: Map<string, SetupHandler> = extractSetupHandlers(
    'import { signal } from "@weave-framework/runtime";\n' +
      'export function setup<T = { value: string; label: string }>(props: Props<T>): Ctx {\n' +
      '  const open = signal(false);\n' +
      '  function openPanel(): void { open.set(true); }\n' +
      '  const onClick = () => openPanel();\n' +
      '  return { open, onClick };\n}\n'
  );
  assert.ok(h.has('openPanel'), 'the helper is found past the type parameters');
  assert.ok(h.has('onClick'), 'and the handler');

  // a simple generic, and a constrained one
  const simple: Map<string, SetupHandler> = extractSetupHandlers('export function setup<T>(props: P<T>) {\n  const a = () => 1;\n  return { a };\n}');
  assert.ok(simple.has('a'), 'a bare type parameter');
  const bound: Map<string, SetupHandler> = extractSetupHandlers('export function setup<T extends { id: string }>(props: P<T>) {\n  const a = () => 1;\n  return { a };\n}');
  assert.ok(bound.has('a'), 'a constrained one whose bound has braces');
});

test('E1.37: a wrapped TERNARY (and other leading operators) continue the initializer', () => {
  // The real <Table>: `const rows = isDataSource(p) \n ? p.connect() \n : signal(p ?? [])`. E1.19 taught declEnd
  // that a TRAILING operator continues a line; a LEADING one does too, and `:` was not in the list — so the
  // initializer was cut after the `?` branch and emitted `? props.dataSource.connect();`, failing the BUILD.
  const f: SetupBindings = extractSetupBindings(
    setup(
      '  const rows = isDataSource(props.src)\n' +
        '    ? props.src.connect()\n' +
        '    : signal(props.src ?? []);\n' +
        '  const sum = base\n' +
        '    + extra;\n' +
        '  const name = first\n' +
        '    || fallback;\n' +
        '  return { rows };'
    )
  );
  assert.ok(/: signal\(props\.src \?\? \[\]\)$/.test(f.computeds.get('rows')!.source),
    `the whole ternary; got: ${JSON.stringify(f.computeds.get('rows')?.source)}`);
  assert.ok(/\+ extra$/.test(f.computeds.get('sum')!.source), `a wrapped +; got: ${JSON.stringify(f.computeds.get('sum')?.source)}`);
  assert.ok(/\|\| fallback$/.test(f.computeds.get('name')!.source), `a wrapped ||; got: ${JSON.stringify(f.computeds.get('name')?.source)}`);
});

test('E1.37: a genuinely finished statement still ends at the newline', () => {
  const f: SetupBindings = extractSetupBindings(setup('  const a = 1;\n  const b = 2\n  const c = 3\n  return { a, b, c };'));
  assert.equal(f.computeds.get('a')?.source, '1', 'a semicolon ends it');
  assert.equal(f.computeds.get('b')?.source, '2', 'and so does a newline after a complete expression');
  assert.equal(f.computeds.get('c')?.source, '3', 'even the last one before a return');
});

test('E1.39: a `function` expression`s parameter types are stripped too, not just an arrow`s', () => {
  // `function closePanel(returnFocus: boolean): void { … }` — the real <Select>. The param strip only fired when
  // the `)` was followed by `=>`, so a function BODY (`{`) left every param type in, and `closePanel` was blamed
  // for reading `boolean`. Transitive blame (E1.38) is what surfaced it: the site said `closePanel`, the root
  // said `boolean`.
  assert.deepEqual(
    unresolvedRefs('function (returnFocus: boolean, n: Count): void { open.set(returnFocus); }', new Set(['open']), ['returnFocus', 'n'], 'closePanel'),
    [],
    'the param types are gone',
  );
  // an `if (…) { }` is NOT a param list — its condition must survive untouched
  assert.deepEqual(
    unresolvedRefs('function () { if (a ? b : c) { open.set(d); } }', new Set(['open']), [], 'x').sort(),
    ['a', 'b', 'c', 'd'],
    'a ternary inside a condition is not mistaken for an annotation',
  );
});

test('E1.41: a DESTRUCTURED declaration binds its names — array, object, rename, rest, defaults', () => {
  // `for (const [v, el] of optionEls)` — the real <Select>'s `syncSelected`, blamed for reading `v` and `el`.
  // A superset would be unsafe here (a missed ref means inlining a body that throws), so each shape is exact.
  const check = (body: string, ctx: string[] = []): string[] =>
    unresolvedRefs(`() => { ${body} }`, new Set(ctx), [], 'h');

  assert.deepEqual(check('for (const [v, el] of pairs) { use(v, el); }', ['pairs', 'use']), [], 'an array pattern');
  assert.deepEqual(check('const { a, b } = src; use(a, b);', ['src', 'use']), [], 'an object pattern');
  assert.deepEqual(check('const { a: x, ...rest } = src; use(x, rest);', ['src', 'use']), [], 'rename + rest');
  assert.deepEqual(check('const [first = 1] = src; use(first);', ['src', 'use']), [], 'a default');
  // a default VALUE is real code and must still report
  assert.deepEqual(check('const [first = missing] = src; use(first);', ['src', 'use']), ['missing'], 'a default value is a ref');
  // and an object pattern's KEY is not a binding — the renamed name is
  assert.deepEqual(check('const { a: x } = src; use(a);', ['src', 'use']), ['a'], 'the key is not bound; `a` is unresolved');
});

test('E1.42: a comma inside TYPE ARGUMENTS does not end the initializer', () => {
  // `const optionEls: Map<string, HTMLElement> = new Map<string, HTMLElement>()` — the real <Select>. declEnd
  // stops at a top-level `,`, and it did not track `<…>`, so the initializer came back as `new Map<string`.
  // It never reached the emit only because that fragment was then blamed for reading `string` and refused —
  // i.e. the truncation was hiding behind a false diagnostic.
  const f: SetupBindings = extractSetupBindings(
    setup(
      '  const optionEls: Map<string, HTMLElement> = new Map<string, HTMLElement>();\n' +
        '  const pair = fn<A, B>(1, 2);\n' +
        '  return { optionEls };'
    )
  );
  assert.equal(f.computeds.get('optionEls')?.source, 'new Map<string, HTMLElement>()', 'the whole initializer');
  assert.equal(f.computeds.get('pair')?.source, 'fn<A, B>(1, 2)', 'and a call with type arguments');
  assert.deepEqual(unresolvedRefs(f.computeds.get('optionEls')!.source, new Set(), [], 'optionEls'), [],
    'with no type names left to blame');
});

test('E1.43: a FUNCTION-TYPE annotation and a function-type `as` cast are fully skipped', () => {
  // The real <Tree>: `const getLevel: (node: N) => number = props.getLevel as (node: N) => number;`. Two
  // separate holes, both leaking `number`: endOfAnnotation stopped at the `=` of the annotation's OWN `=>`
  // (the E1.29 class, in the other scanner), and skipTypeRef could not read a function type after `as`.
  assert.deepEqual(
    unresolvedRefs('() => { const f: (node: N) => number = props.get as (node: N) => number; use(f); }', new Set(['props', 'use']), [], 'h'),
    [],
    'neither the annotation nor the cast leaves a type name',
  );
  // real code after the cast still counts
  assert.deepEqual(
    unresolvedRefs('() => { const f = props.get as (n: N) => number; missing(f); }', new Set(['props']), [], 'h'),
    ['missing'],
    'and the call after it is still a ref',
  );
});

test('E1.45: a doc COMMENT before the hook does not disguise it as a property access', () => {
  // The real <Expansion>: its onMount is preceded by a comment ending in a full stop. Reading the last
  // non-space character out of the RAW text found that `.` and called the hook a property access, so it went
  // unseen and the component adopted when it must not.
  const script: string =
    'import { onMount, signal } from "@weave-framework/runtime";\n' +
    'export function setup() {\n  const host = signal(null);\n' +
    '  // Bodies are appended once the regions are in the DOM (deferred to onMount, like Form Field.).\n' +
    '  onMount(() => { host()?.append("x"); });\n' +
    '  return { host };\n}\n';
  assert.equal(setupCallsHook(script, new Set(['onMount'])), 'onMount', 'found past the comment');

  // a genuine property access is still not this module's hook
  const method: string =
    'export function setup(props) {\n  props.lifecycle.onMount(() => {});\n  return {};\n}\n';
  assert.equal(setupCallsHook(method, new Set(['onMount'])), null, '`x.onMount()` belongs to someone else');
});

test("E1.49: a comment above a return-object entry does not swallow it (nor everything after)", () => {
  // The real <Sidenav> documents `drawerModal` with a line above it. `returnEntries` read the part, saw `/`,
  // found no identifier and skipped it — so `drawerModal` never reached the resumed ctx and a resumed page
  // threw `drawerModal is not a function`. Every entry AFTER a commented one was lost the same way.
  const script: string = [
    'export function setup() {',
    '  return {',
    '    before: (): number => 1,',
    '    // Declare modality to AT while the over-mode drawer is open.',
    "    documented: (): string => 'x',",
    '    after: (): boolean => true,',
    '  };',
    '}',
  ].join('\n');
  const found: SetupBindings = extractSetupBindings(script);
  const names: string[] = [...found.handlers.keys()];
  assert.ok(names.includes('documented'), `the commented entry is extracted; got ${JSON.stringify(names)}`);
  assert.ok(names.includes('after'), 'and so is everything after it');
  assert.ok(names.includes('before'), 'and before it');
});
