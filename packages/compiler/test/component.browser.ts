import { test, assert } from '../../../tools/harness.js';
import { signal, computed, effect, root, onDispose, type Signal, type Computed } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import {
  compileTemplate, compileComponent, parseSfc, inferCtxNames, parseTemplate, extractSources, injectAutoReturn,
} from '@weave-framework/compiler';

const rt: typeof dom & {
  signal: typeof signal;
  computed: typeof computed;
  effect: typeof effect;
  root: typeof root;
} = { ...dom, signal, computed, effect, root };

/** Compile a template to a reusable `(ctx, slots) => Node` render function. */
function compileRender(html: string, scope: string[]): (ctx: unknown, slots?: unknown) => Node {
  const { code } = compileTemplate(html, { mode: 'function', scope });
  const body: string = code.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;');
  return new Function('rt', '_c', body)(rt, {}) as (ctx: unknown, slots?: unknown) => Node;
}

function host(): HTMLElement {
  const el: HTMLDivElement = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

/* ──────────── auto-scope inference ──────────── */

test('inferCtxNames collects free identifiers', () => {
  const names: string[] = inferCtxNames(parseTemplate('<button on:click={{inc}}>{{ count() }}</button>'));
  assert.deepEqual(names, ['count', 'inc']);
});

test('inferCtxNames excludes JS globals', () => {
  assert.deepEqual(inferCtxNames(parseTemplate('<b>{{ Math.max(n(), 5) }}</b>')), ['n']);
});

test('inferCtxNames excludes common DOM/timer globals (A4)', () => {
  // Regression: `setTimeout`/`confirm`/etc. were inferred as ctx → compiled to
  // `ctx.setTimeout(...)` → runtime TypeError. They must resolve to the real globals.
  assert.deepEqual(
    inferCtxNames(parseTemplate('<button on:click={{ () => setTimeout(close, 200) }}>x</button>')),
    ['close']
  );
  assert.deepEqual(
    inferCtxNames(parseTemplate('<button on:click={{ () => confirm(msg()) && remove() }}>x</button>')),
    ['msg', 'remove']
  );
});

test('inferCtxNames excludes arrow parameters', () => {
  const names: string[] = inferCtxNames(parseTemplate('<button on:click={{() => count.set(n => n + 1)}}>x</button>'));
  assert.deepEqual(names, ['count']);
});

test('inferCtxNames collects the use: action name (and its arg)', () => {
  // bare action → just the action name
  assert.deepEqual(inferCtxNames(parseTemplate('<div use:autofocus></div>')), ['autofocus']);
  // action + arg → both, arg deps included
  assert.deepEqual(
    inferCtxNames(parseTemplate('<div use:tooltip={{label()}}></div>')),
    ['label', 'tooltip']
  );
});

test('inferCtxNames: an explicit object-literal key in a use: arg is not a ctx name', () => {
  // Regression (dogfooding @weave-framework/ui ripple): `{ centered: true }`'s KEY was collected as
  // ctx data, so the emitted arg became `{ ctx.centered: true }`. Only the action name is ctx here.
  assert.deepEqual(inferCtxNames(parseTemplate('<div use:ripple={{ { centered: true } }}></div>')), ['ripple']);
  // an explicit key with a ctx VALUE still collects the value (but never the key)
  assert.deepEqual(
    inferCtxNames(parseTemplate('<div use:ripple={{ { centered: active() } }}></div>')),
    ['active', 'ripple']
  );
  // shorthand IS a value reference and must still be collected
  assert.deepEqual(inferCtxNames(parseTemplate('<div use:ripple={{ { centered } }}></div>')), ['centered', 'ripple']);
});

test('compileComponent: an inline object-literal arg keeps its keys literal (not ctx.<key>)', () => {
  const { code } = compileComponent({
    template: '<div use:ripple={{ { centered: true } }}></div>',
  });
  assert.ok(code.includes('{ centered: true }'), `key must stay literal; got:\n${code}`);
  assert.ok(!code.includes('ctx.centered'), `key must not be scope-prefixed; got:\n${code}`);
});

test('inferCtxNames excludes @for item, $vars, and @let names', () => {
  const f: string[] = inferCtxNames(parseTemplate('<ul>@for (it of items(); track it.id) { <li>{{ $index }}:{{ it.t }}</li> }</ul>'));
  assert.deepEqual(f, ['items']);
  const l: string[] = inferCtxNames(parseTemplate('<div>@let dbl = n() * 2;<b>{{ dbl }}</b></div>'));
  assert.deepEqual(l, ['n']);
});

test('inferCtxNames: a name used outside a @for is still ctx even if a loop shadows it', () => {
  // `item` is component data in the heading AND, separately, a loop var inside @for — the loop's
  // block-local binding must not erase the ctx usage elsewhere (declared is per-scope, not global).
  const names: string[] = inferCtxNames(
    parseTemplate('<h1>{{ item }}</h1><ul>@for (item of items(); track item.id) { <li>{{ item.t }}</li> }</ul>'),
  );
  assert.deepEqual(names, ['item', 'items']);
});

test('a comment between elements does not shift child-index paths', () => {
  // Regression: the parser split the whitespace around a skipped comment into two
  // adjacent text nodes. The browser merges them when the emitted template HTML is
  // parsed, so every binding after the comment resolved the wrong node (off by one).
  const x: Signal<string> = signal('hi');
  const render: (ctx: unknown, slots?: unknown) => Node = compileRender('<div><span>a</span>\n<!-- c -->\n<p>{{ x() }}</p></div>', ['x']);
  const el: HTMLElement = render({ x }, {}) as HTMLElement;
  host().appendChild(el);
  const p: HTMLElement = el.querySelector('p') as HTMLElement;
  assert.equal(p.textContent, 'hi', 'interpolation landed in <p>, not a stray text node');
  x.set('bye');
  assert.equal(p.textContent, 'bye');
});

test('a capitalized component named like a void element is not void', () => {
  // `<link>` is a void HTML element, but `<Link>` is the router component — it must
  // keep its children + close tag, or `</Link>` mismatches the parent (regression).
  const [nav] = parseTemplate('<nav><Link to="/">Board</Link></nav>') as Array<{
    children: Array<{ tag: string; selfClosing: boolean; children: unknown[] }>;
  }>;
  const link: { tag: string; selfClosing: boolean; children: unknown[] } = nav.children[0];
  assert.equal(link.tag, 'Link');
  assert.equal(link.selfClosing, false);
  assert.equal(link.children.length, 1, 'keeps its text child');
  // The lowercase void element still self-closes.
  const [p] = parseTemplate('<p>a<br>b</p>') as Array<{
    children: Array<{ tag: string; selfClosing: boolean }>;
  }>;
  assert.equal(p.children[1].tag, 'br');
  assert.equal(p.children[1].selfClosing, true);
});

/* ──────────── defineComponent runtime ──────────── */

test('defineComponent wires setup + render and mounts/unmounts', () => {
  const render: (ctx: unknown, slots?: unknown) => Node = compileRender('<button on:click={{inc}}>{{ count() }}</button>', ['count', 'inc']);
  const Counter: dom.Component = dom.defineComponent(render as never, () => {
    const count: Signal<number> = signal(0);
    const inc = (): number => count.set((n) => n + 1);
    return { count, inc };
  });
  const h: HTMLElement = host();
  const unmount: () => void = dom.mountComponent(Counter, h);
  const btn: HTMLButtonElement = h.querySelector('button') as HTMLButtonElement;
  assert.equal(btn.textContent, '0');
  btn.click();
  assert.equal(btn.textContent, '1');
  unmount();
  assert.equal(h.childNodes.length, 0, 'unmount removes the DOM');
});

test('defineComponent exposes props (lazy) alongside setup bindings', () => {
  const render: (ctx: unknown, slots?: unknown) => Node = compileRender('<span>{{ label }} {{ doubled() }}</span>', ['label', 'doubled']);
  const Child: dom.Component = dom.defineComponent(render as never, (props) => {
    const doubled: Computed<number> = computed(() => (props.n as number) * 2);
    return { doubled };
  });
  const n: Signal<number> = signal(3);
  const node: Element = Child({ get label() { return 'x'; }, get n() { return n(); } }, {}) as Element;
  host().appendChild(node);
  assert.equal(node.textContent, 'x 6');
  n.set(5);
  assert.equal(node.textContent, 'x 10', 'binding over a reactive prop updates');
});

test('a setup binding may shadow a like-named (getter-only) prop', () => {
  // Regression: ctx was built with Object.assign, whose [[Set]] honours a getter-only
  // prop of the same name on the prototype and throws. A binding must be able to
  // shadow a like-named prop (the documented case) — common when re-exposing a prop
  // as a typed accessor (`task: () => props.task`).
  const render: (ctx: unknown, slots?: unknown) => Node = compileRender('<span>{{ task().title }}</span>', ['task']);
  const Card: dom.Component = dom.defineComponent(render as never, (props) => ({
    task: () => props.task as { title: string },
  }));
  const t: Signal<{ title: string }> = signal({ title: 'hi' });
  const node: Element = Card({ get task() { return t(); } }, {}) as Element;
  host().appendChild(node);
  assert.equal(node.textContent, 'hi');
  t.set({ title: 'bye' });
  assert.equal(node.textContent, 'bye', 'reactive through the shadowing accessor');
});

test('defineComponent forwards a real on:X event to the child root', () => {
  // `<Child on:click={{h}} />` compiles to an `onClick` prop + a `$events:['onClick']` marker.
  // The runtime forwards only `$events` keys to the rendered root, so the consumer's listener
  // fires from the root element even though the child never wires click itself.
  let calls: number = 0;
  const handler = (): void => { calls++; };
  const render: (ctx: unknown, slots?: unknown) => Node = compileRender('<button>x</button>', []);
  const Child: dom.Component = dom.defineComponent(render as never);
  const node: Element = Child({ onClick: handler, '$events': ['onClick'] }, {}) as Element;
  host().appendChild(node);
  (node as HTMLButtonElement).click();
  assert.equal(calls, 1, 'on:X forwarded to the root and fired');
});

test('defineComponent does NOT forward a data-callback prop (no double-fire)', () => {
  // Regression for the composed-<Checkbox> double-fire. A data-callback prop (`onChange`, NOT
  // an `on:X` event → absent from `$events`) is consumed INSIDE the child: an inner <input>'s
  // change fires a setup binding that calls `props.onChange`. That change BUBBLES to the root
  // <label>. If the runtime also auto-forwarded `onChange` to the root (the old behaviour), the
  // bubbled event would invoke it a SECOND time. With the `$events` marker it must fire once.
  let calls: number = 0;
  const handler = (): void => { calls++; };
  const render: (ctx: unknown, slots?: unknown) => Node =
    compileRender('<label><input type="checkbox" on:change={{fire}} /></label>', ['fire']);
  const Child: dom.Component = dom.defineComponent(render as never, (props) => ({
    fire: () => (props.onChange as () => void)(),
  }));
  // No `$events` (onChange is a data prop, not an on:X event) — exactly what the compiler emits.
  const node: Element = Child({ get onChange() { return handler; } }, {}) as Element;
  host().appendChild(node);
  (node.querySelector('input') as HTMLInputElement).click(); // toggles → bubbling `change`
  assert.equal(calls, 1, 'data-callback fires once, not forwarded to the root as a DOM listener');
});

test('mountComponent disposes setup effects on unmount', () => {
  let disposed: boolean = false;
  const render: (ctx: unknown, slots?: unknown) => Node = compileRender('<p>{{ v() }}</p>', ['v']);
  const C: dom.Component = dom.defineComponent(render as never, () => {
    const v: Signal<number> = signal(1);
    onDispose(() => { disposed = true; });
    return { v };
  });
  const unmount: () => void = dom.mountComponent(C, host());
  assert.equal(disposed, false);
  unmount();
  assert.equal(disposed, true, 'owner disposal runs setup cleanups');
});

test('a @for row can be a component (multi-node keyed row)', () => {
  // Bug #7: a `@for` row body that is a component (or any fragment root) compiles
  // to a `<!---->` anchor + mountChild — never a single DOM node. `eachBlock` now
  // brackets such a row with marker comments so the keyed reconciler can move and
  // remove it as one span. Mirrors the demo's `<Link><TaskCard/></Link>` rows.
  const Item: dom.Component = dom.defineComponent(
    compileRender('<li class="item">{{ label() }}</li>', ['label']) as never,
    (props) => ({ label: () => props.text })
  );
  const items: Signal<{ id: number; text: string }[]> = signal([{ id: 1, text: 'a' }, { id: 2, text: 'b' }]);
  const { code } = compileTemplate(
    '<ul>@for (it of items(); track it.id) { <Item text={{it.text}} /> }</ul>',
    { mode: 'function', scope: ['items'] }
  );
  const body: string = code.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;');
  const render: (ctx: unknown) => Node = new Function('rt', '_c', body)(rt, { Item }) as (ctx: unknown) => Node;
  const el: HTMLElement = render({ items }) as HTMLElement;
  host().appendChild(el);
  const texts = (): (string | null)[] => [...el.querySelectorAll('li')].map((l) => l.textContent);

  assert.deepEqual(texts(), ['a', 'b']);
  const aLi: HTMLLIElement = el.querySelector('li')!;

  items.set((xs) => [...xs, { id: 3, text: 'c' }]); // append
  assert.deepEqual(texts(), ['a', 'b', 'c']);

  items.set([{ id: 3, text: 'c' }, { id: 1, text: 'a' }, { id: 2, text: 'b' }]); // reorder
  assert.deepEqual(texts(), ['c', 'a', 'b']);
  assert.is([...el.querySelectorAll('li')].find((l) => l.textContent === 'a'), aLi, 'row node reused across reorder');

  items.set([{ id: 3, text: 'C' }, { id: 2, text: 'b' }]); // remove id:1, update id:3's prop
  assert.deepEqual(texts(), ['C', 'b'], 'span removed + reused row reflects new prop');
});

/* ──────────── SFC split + full transform ──────────── */

test('parseSfc splits script / template / style', () => {
  const sfc: string =
    '<script>export function setup(){ return {}; }</script>\n' +
    '<button>{{ x() }}</button>\n' +
    '<style>button{color:red}</style>';
  const { script, template, styles } = parseSfc(sfc);
  assert.ok(script!.includes('export function setup'));
  assert.equal(template, '<button>{{ x() }}</button>');
  assert.ok(styles!.includes('color:red'));
});

test('extractSources joins a concatenated `template` string (multi-line + splits)', () => {
  // Components often split a long template across lines with `+` for readability
  // (every @weave-framework/ui component does). The static extractor must join them, or a
  // consumer build sees a truncated `<button …` and fails with "Expected '>'".
  const script: string =
    "export const template: string =\n" +
    "  '<button class={{ c() }}' +\n" +
    "  ' disabled={{ d() }}>' +\n" +
    "  '<slot></slot></button>';\n" +
    'export function setup(){ return {}; }';
  const { template } = extractSources(script);
  assert.equal(template, '<button class={{ c() }} disabled={{ d() }}><slot></slot></button>');
});

test('extractSources rejects a non-static `+` join (fail loud)', () => {
  const script: string = "export const template = '<div>' + title + '</div>';";
  let message: string = '';
  try {
    extractSources(script);
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  assert.ok(/static string/.test(message), `expected a "static string" error, got: ${message || '(none)'}`);
});

test('compileComponent emits a defineComponent module + scoped CSS sharing one hash', () => {
  const { code, css, hash } = compileComponent(
    {
      script:
        'import { signal } from "@weave-framework/runtime";\n' +
        'export function setup(){ const count = signal(0); const inc = () => count.set(n => n + 1); return { count, inc }; }',
      template: '<button on:click={{inc}}>{{ count() }}</button>',
      styles: 'button { color: red }',
    },
    { filename: 'counter' }
  );
  assert.ok(code.includes('function render(ctx, slots)'), 'render demoted to a local');
  assert.ok(!code.includes('export default function render'), 'no default render export');
  assert.ok(code.includes('export default defineComponent(render, setup)'), 'wires setup + render');
  assert.ok(code.includes('import { defineComponent }'), 'imports defineComponent');
  assert.ok(css.includes(`button[data-w-${hash}]`), 'CSS scoped with the shared hash');
  assert.ok(code.includes(`data-w-${hash}`), 'template stamped with the same hash');
});

test('compileComponent without setup emits defineComponent(render)', () => {
  const { code, css } = compileComponent({ template: '<p>hi</p>' });
  assert.ok(code.includes('export default defineComponent(render)'), code);
  assert.equal(css, '', 'no styles → empty css');
});

test('compileComponent resumable: attaches render.adopt to the component (nested-resume ready), one default export', () => {
  const { code } = compileComponent(
    {
      script:
        'import { signal } from "@weave-framework/runtime";\n' +
        'export function setup(){ const label = signal("hi"); return { label }; }',
      template: '<b>{{ label() }}</b>',
    },
    { filename: 'chip', resumable: true }
  );
  assert.ok(code.includes('function render(ctx, slots)'), 'render is a local declaration');
  assert.ok(code.includes('function adopt(_r'), 'the resumable adopt variant is emitted');
  assert.ok(code.includes('_wc.adopt = render.adopt'), 'the component carries .adopt for a parent to resume it');
  assert.ok(code.includes('_wc.handlers = render.handlers'), 'the component carries .handlers for the client resume entry (resumePage)');
  assert.ok(code.includes('export default _wc'), 'a single default export — the .adopt-tagged component');
  assert.ok(!/export default render;/.test(code), 'the raw `export default render` was stripped');
  assert.ok(code.includes('registerState(ctx.$wid'), 'the render self-registers its ctx under $wid for the snapshot');
  assert.ok(code.includes('from "@weave-framework/runtime/adopt"') && code.includes('from "@weave-framework/runtime/graph"'), 'imports the resumable entries');
});

/* ──────────── E1.5 — named-handler resume (compile-time inlining) ──────────── */

const counter = (body: string): string =>
  'import { signal } from "@weave-framework/runtime";\nexport function setup(){ const count = signal(0);\n' + body + '\nreturn { count, inc }; }';

test('E1.5: a NAMED handler is inlined into the factory — `{{ inc }}` resumes like an inline handler', () => {
  const { code } = compileComponent(
    { script: counter('const inc = () => count.set((n) => n + 1);'), template: '<button on:click={{ inc }}>{{ count() }}</button>' },
    { filename: 'ctr', resumable: true }
  );
  // The factory must carry inc's BODY (closing over the resumed ctx.count), not a ref to the dropped function.
  assert.ok(/"w0":\s*\(\)\s*=>\s*ctx\.count\.set\(\(n\)\s*=>\s*n \+ 1\)/.test(code), `factory inlines inc's body; got:\n${code}`);
  assert.ok(!/"w0":\s*ctx\.inc\b/.test(code), 'no bare ctx.inc — it is undefined on the client (a function cannot serialize)');
});

test('E1.19: a handler calling a setup-local HELPER inlines — the helper is rebuilt as a factory local', () => {
  // A helper is dropped from the snapshot like any function, and `derive` never rebuilds functions — so until
  // E1.19 a handler calling one was refused (the commonest real cause left on the docs site: `setOpened`,
  // `openPanel`, `rovingIndex`). It does not need to cross the wire: the factory can simply re-declare it over
  // the resumed ctx, exactly as it inlines a handler body.
  const { code } = compileComponent(
    { script: counter('const helper = () => count.set(0);\nconst inc = () => helper();'), template: '<button on:click={{ inc }}>{{ count() }}</button>' },
    { filename: 'ctr2', resumable: true }
  );
  const factory: string = code.split('function handlers(')[1]?.split('\n}')[0] ?? '';
  assert.ok(/const helper = \(\) => ctx\.count\.set\(0\)/.test(factory),
    `the helper is declared in the factory, rewritten over ctx; got:\n${factory}`);
  assert.ok(/"w0":\s*\(\) => helper\(\)/.test(factory), 'and the site inlines to a call of that local, not ctx.inc');
  assert.ok(!/"w0":\s*ctx\.inc\b/.test(code), 'the old fall-back is gone');
});

test('E1.19: mutually recursive helpers both resolve (a single declaration-order pass would refuse one)', () => {
  const { code } = compileComponent(
    {
      script: counter('const ping = () => pong();\nconst pong = () => count.set(1);\nconst inc = () => ping();'),
      template: '<button on:click={{ inc }}>{{ count() }}</button>',
    },
    { filename: 'ctr2c', resumable: true }
  );
  const factory: string = code.split('function handlers(')[1]?.split('\n}')[0] ?? '';
  assert.ok(/const ping =/.test(factory) && /const pong =/.test(factory), `both helpers emitted; got:\n${factory}`);
  assert.ok(/"w0":\s*\(\) => ping\(\)/.test(factory), 'and the site resolves through them');
});

test('E1.19 fail-safe: a handler reading something genuinely unreachable still falls back to ctx.<name>', () => {
  // (`props` stood here until E1.20 made it the factory's parameter.) A `new` expression is not a shape derive
  // rebuilds, and a class instance cannot cross the wire — so nothing can produce `cart` on the client and the
  // site must stay inert-but-safe rather than inline a body that throws on the first click.
  const { code } = compileComponent(
    {
      script: counter('const cart = new Cart();\nconst inc = () => count.set(cart.total);'),
      template: '<button on:click={{ inc }}>{{ count() }}</button>',
    },
    { filename: 'ctr2d', resumable: true }
  );
  assert.ok(/"w0":\s*ctx\.inc\b/.test(code), 'keep ctx.inc rather than inline a body that reads an unrebuildable `cart`');
});

test('E1.11: a handler reading a plain setup local IS inlined — `derive` rebuilds the local', () => {
  const { code } = compileComponent(
    { script: counter('const step = 2;\nconst inc = () => count.set((n) => n + step);'), template: '<button on:click={{ inc }}>{{ count() }}</button>' },
    { filename: 'ctr2b', resumable: true }
  );
  assert.ok(/if \(ctx\.step === undefined\) ctx\.step = 2;/.test(code), '`step` never crossed the wire → derive rebuilds it');
  assert.ok(/"w0":\s*\(\)\s*=>\s*ctx\.count\.set\(\(n\)\s*=>\s*n \+ ctx\.step\)/.test(code), 'so the handler inlines against it');
});

test('E1.5: an INLINE handler is untouched (already resumable) and eager never inlines', () => {
  const inline = compileComponent(
    { script: counter('const inc = () => count.set((n) => n + 1);'), template: '<button on:click={{ () => count.set((n) => n + 2) }}>{{ count() }}</button>' },
    { filename: 'ctr3', resumable: true }
  );
  assert.ok(/"w0":\s*\(\)\s*=>\s*ctx\.count\.set\(\(n\)\s*=>\s*n \+ 2\)/.test(inline.code), 'the inline body is emitted as written');
  // Eager: no factory at all, and the listener still references the named binding directly.
  const eager = compileComponent(
    { script: counter('const inc = () => count.set((n) => n + 1);'), template: '<button on:click={{ inc }}>{{ count() }}</button>' },
    { filename: 'ctr4' }
  );
  assert.ok(!eager.code.includes('function handlers'), 'eager emits no handlers factory');
  assert.ok(/listen\([^,]+,\s*"click",\s*ctx\.inc\)/.test(eager.code), 'eager still wires ctx.inc directly (byte-for-byte)');
});

test('compileComponent resumable: an eager build is unchanged (no adopt, direct default export)', () => {
  const { code } = compileComponent({ template: '<b>{{ label() }}</b>', script: 'export function setup(){ return {}; }' });
  assert.ok(code.includes('export default defineComponent('), 'eager keeps the direct default export');
  assert.ok(!code.includes('.adopt') && !code.includes('registerState'), 'eager emits no adopt / no resume wiring');
});

/* ──────────── A5 — bind: on a component passes the signal ──────────── */

test('bind:value on a component passes the signal by reference (A5)', () => {
  const { code } = compileComponent({ template: '<Input bind:value={{ name }} />' });
  assert.ok(/value:\s*ctx\.name/.test(code), `bind → signal ref; got:\n${code}`);
  assert.ok(!/get value\(\)/.test(code), 'not a getter — the raw signal is passed');
});

test('an auto-exposed setup + bind: on a child wires two-way (A5, runtime)', () => {
  // Child receives the signal as `value`, reads it and writes it back.
  const childRender: (ctx: unknown, slots?: unknown) => Node = compileRender('<input on:input={{ (e) => value.set(e.target.value) }} />', ['value']);
  const Child: dom.Component = dom.defineComponent(childRender as never, (props) => ({ value: props.value }));
  const name: Signal<string> = signal('a');
  const parentRender: (ctx: unknown) => Node = (() => {
    const { code } = compileTemplate('<div><Child bind:value={{ name }} /></div>', { mode: 'function', scope: ['name'] });
    const body: string = code.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;');
    return new Function('rt', '_c', body)(rt, { Child }) as (ctx: unknown) => Node;
  })();
  const node: HTMLElement = parentRender({ name }) as HTMLElement;
  host().appendChild(node);
  const input: HTMLInputElement = node.querySelector('input') as HTMLInputElement;
  input.value = 'typed';
  input.dispatchEvent(new Event('input'));
  assert.equal(name(), 'typed', 'child wrote back through the shared signal (two-way)');
});

/* ──────────── A2 — propDefaults ──────────── */

test('compileComponent passes propDefaults as the 3rd defineComponent arg (A2)', () => {
  const { code } = compileComponent({
    script: 'export const propDefaults = { type: "button" };\nexport function setup(props){ return {}; }',
    template: '<button>{{ type }}</button>',
  });
  assert.ok(code.includes('defineComponent(render, setup, propDefaults)'), `expected 3-arg wiring; got:\n${code}`);
});

test('propDefaults fills an absent prop; a passed prop wins and stays reactive (A2)', () => {
  const render: (ctx: unknown, slots?: unknown) => Node = compileRender('<b>{{ size }}:{{ variant }}</b>', ['size', 'variant']);
  const C: dom.Component = dom.defineComponent(render as never, undefined, { size: 'md', variant: 'primary' });
  const v: Signal<string> = signal('secondary');
  const node: Element = C({ get variant() { return v(); } }, {}) as Element; // parent passes only `variant`
  host().appendChild(node);
  assert.equal(node.textContent, 'md:secondary', 'absent `size` defaulted; passed `variant` used');
  v.set('danger');
  assert.equal(node.textContent, 'md:danger', 'a passed (reactive) prop still updates over defaults');
});

test('propDefaults: an explicitly-passed value (even falsy) beats the default (A2)', () => {
  const render: (ctx: unknown, slots?: unknown) => Node = compileRender('<b>{{ String(open) }}</b>', ['open']);
  const C: dom.Component = dom.defineComponent(render as never, undefined, { open: true });
  const node: Element = C({ open: false }, {}) as Element; // explicit false must win
  host().appendChild(node);
  assert.equal(node.textContent, 'false', 'explicit false beats the `true` default');
});

/* ──────────── A1 — bare boolean attribute on a component ──────────── */

test('a bare attribute on a component is the boolean prop true (A1)', () => {
  const { code } = compileComponent({ template: '<Button disabled>Save</Button>' });
  assert.ok(/disabled:\s*true/.test(code), `bare → true; got:\n${code}`);
});

test('a quoted / explicitly-empty attribute on a component stays a string (A1)', () => {
  const { code } = compileComponent({ template: '<Button label="Go" hint="">x</Button>' });
  assert.ok(code.includes('label: "Go"'), `quoted stays string; got:\n${code}`);
  assert.ok(/hint:\s*""/.test(code) && !/hint:\s*true/.test(code), `explicit empty stays ""; got:\n${code}`);
});

test('a bare attribute on a DOM element is unchanged (renders bare, not a prop)', () => {
  const { code } = compileComponent({ template: '<button disabled>x</button>' });
  assert.ok(code.includes('<button disabled>') || / disabled/.test(code), `native bare attr unchanged; got:\n${code}`);
  assert.ok(!/disabled:\s*true/.test(code), 'native element does not build a props object');
});

/* ──────────── auto-expose (setup without an explicit return) ──────────── */

test('compileComponent auto-exposes the template names when setup omits return', () => {
  const { code } = compileComponent({
    script:
      'import { signal } from "@weave-framework/runtime";\n' +
      'export function setup(){ const count = signal(0); const inc = () => count.set((n) => n + 1); }',
    template: '<button on:click={{inc}}>{{ count() }}</button>',
  });
  assert.ok(code.includes('return { count, inc };'), `expected an injected return; got:\n${code}`);
  assert.ok(code.includes('export default defineComponent(render, setup)'), 'still wires setup + render');
});

test('compileComponent leaves an explicit return untouched (no duplicate)', () => {
  const { code } = compileComponent({
    script: 'export function setup(){ const count = 1; return { count }; }',
    template: '<b>{{ count }}</b>',
  });
  assert.equal((code.match(/return \{/g) ?? []).length, 1, `exactly the author's return; got:\n${code}`);
});

test('an auto-exposed (return-injected) setup mounts and updates for real', () => {
  // End-to-end: transform a return-less setup, then drive a real render with it.
  const injected: string = injectAutoReturn(
    'export function setup(){ const count = rt.signal(0); const inc = () => count.set((n) => n + 1); }',
    ['count', 'inc']
  ).code;
  const setup = new Function('rt', injected.replace('export function', 'function') + '\nreturn setup;')(rt) as () => unknown;
  const render: (ctx: unknown, slots?: unknown) => Node = compileRender('<button on:click={{inc}}>{{ count() }}</button>', ['count', 'inc']);
  const C: dom.Component = dom.defineComponent(render as never, setup as never);
  const h: HTMLElement = host();
  const unmount: () => void = dom.mountComponent(C, h);
  const btn: HTMLButtonElement = h.querySelector('button') as HTMLButtonElement;
  assert.equal(btn.textContent, '0');
  btn.click();
  assert.equal(btn.textContent, '1', 'reactive binding from an auto-exposed setup');
  unmount();
});

/* ──────────── RFC 0008 — component-file extension (`export const extend`) ──────────── */

test('compileComponent: `export const extend` wraps setup with extendSetup(extend, setup)', () => {
  const { code } = compileComponent({
    script:
      'import List from "./list";\n' +
      'export const extend = List;\n' +
      'export function setup(props, base) { return { ...base, extra: () => 1 }; }',
    template: '<div>{{ extra() }}</div>',
  });
  assert.ok(
    code.includes('export default defineComponent(render, extendSetup(extend, setup));'),
    `expected extendSetup(extend, setup); got:\n${code}`
  );
  assert.ok(code.includes('extendSetup') && /import \{ defineComponent, extendSetup \}/.test(code), 'extendSetup is imported');
});

test('compileComponent: an extension with extendProps threads the props seam', () => {
  const { code } = compileComponent({
    script:
      'import List from "./list";\n' +
      'export const extend = List;\n' +
      'export function extendProps(props) { return props; }\n' +
      'export function setup(props, base) { return base; }',
    template: '<div>{{ items() }}</div>',
  });
  assert.ok(
    code.includes('extendSetup(extend, setup, extendProps)'),
    `expected extendSetup(extend, setup, extendProps); got:\n${code}`
  );
});

test('compileComponent: an extension with no own setup passes undefined for it', () => {
  const { code } = compileComponent({
    script: 'import List from "./list";\nexport const extend = List;',
    template: '<div>{{ items() }}</div>',
  });
  assert.ok(
    code.includes('extendSetup(extend, undefined)'),
    `expected extendSetup(extend, undefined); got:\n${code}`
  );
});

/* ──────────── E1.6 — computeds re-derived on resume ──────────── */

test('E1.6: computeds compile to a derive(ctx) — the resumed page rebuilds what could not serialize', () => {
  const { code } = compileComponent(
    {
      script:
        'import { signal, computed } from "@weave-framework/runtime";\n' +
        'export function setup(): { count: Signal<number>; doubled: () => number; inc: () => void } {\n' +
        '  const count = signal(3);\n' +
        '  const doubled = computed(() => count() * 2);\n' +
        '  const inc = () => count.set((n) => n + 1);\n' +
        '  return { count, doubled, inc };\n}',
      template: '<button on:click={{ inc }}>{{ count() }} / {{ doubled() }}</button>',
    },
    { filename: 'dbl', resumable: true }
  );
  assert.ok(/function derive\(ctx\)/.test(code), 'a derive(ctx) is emitted');
  assert.ok(/ctx\.doubled = computed\(\(\) => ctx\.count\(\) \* 2\)/.test(code), `the computed is rebuilt over the resumed ctx; got:\n${code}`);
  assert.ok(code.includes('_wc.derive = render.derive'), 'the component carries .derive for resumePage / adoptComponent');
  assert.ok(/from "@weave-framework\/runtime"/.test(code) && /\bcomputed\b/.test(code), 'computed is imported for the derive');
});

test('E1.6: a computed touching a non-ctx local is NOT derived (fail-safe), and eager emits no derive', () => {
  const unsafe = compileComponent(
    {
      script:
        'import { signal, computed } from "@weave-framework/runtime";\n' +
        'export function setup() {\n  const count = signal(1);\n  const factorOf = () => 3;\n' +
        '  const scaled = computed(() => count() * factorOf());\n  return { count, scaled };\n}',
      template: '<p>{{ scaled() }}</p>',
    },
    { filename: 'unsafe', resumable: true }
  );
  assert.ok(!/ctx\.scaled = /.test(unsafe.code), '`factor` never reaches the client → no derive rather than a broken one');

  const eager = compileComponent(
    {
      script:
        'import { signal, computed } from "@weave-framework/runtime";\n' +
        'export function setup() {\n  const count = signal(1);\n  const doubled = computed(() => count() * 2);\n  return { count, doubled };\n}',
      template: '<p>{{ doubled() }}</p>',
    },
    { filename: 'eagerdbl' }
  );
  assert.ok(!eager.code.includes('function derive'), 'eager emits no derive (byte-for-byte)');
});

/* ──────────── E1.5/E1.6 — build warnings for what won't survive resume ──────────── */

test('warns when a NAMED handler cannot be inlined (dead after resume), naming the culprit', () => {
  const { warnings } = compileComponent(
    {
      script:
        'import { signal } from "@weave-framework/runtime";\n' +
        'export function setup(){ const count = signal(0); const helper = () => count.set(0);\n' +
        '  const inc = () => count.set((n) => n + step);\n  return { count, inc }; }',
      template: '<button on:click={{ inc }}>{{ count() }}</button>',
    },
    { filename: 'w1', resumable: true }
  );
  assert.ok(warnings && warnings.length === 1, 'one warning');
  assert.ok(/handler `inc`/.test(warnings![0]) && /will not work after resume/.test(warnings![0]), 'names the handler + effect');
  assert.ok(/`step`/.test(warnings![0]) && /setup\(\) does not return/.test(warnings![0]), 'names WHY (reads `step`)');
});

test('warns when a computed cannot be rebuilt — the resume-throws case', () => {
  const { warnings } = compileComponent(
    {
      script:
        'import { signal, computed } from "@weave-framework/runtime";\n' +
        'export function setup(){ const count = signal(0); const factorOf = () => 3;\n' +
        '  const scaled = computed(() => count() * factorOf());\n  return { count, scaled }; }',
      template: '<p>{{ scaled() }}</p>',
    },
    { filename: 'w2', resumable: true }
  );
  assert.ok(warnings && warnings.some((w) => /computed `scaled`/.test(w) && /Resuming this page will fail/.test(w) && /`factorOf`/.test(w)), `expected a computed warning; got ${JSON.stringify(warnings)}`);
});

test('warns when a handler definition cannot be READ from setup (not a plain const/fn)', () => {
  const { warnings } = compileComponent(
    {
      // `inc` comes from a helper call — the extractor can't read a body → dead, but we still say so.
      script:
        'import { signal } from "@weave-framework/runtime";\n' +
        'import { makeInc } from "./x";\n' +
        'export function setup(){ const count = signal(0); const inc = makeInc(count);\n  return { count, inc }; }',
      template: '<button on:click={{ inc }}>{{ count() }}</button>',
    },
    { filename: 'w3', resumable: true }
  );
  assert.ok(warnings && warnings.some((w) => /handler `inc`/.test(w) && /could not be read from setup/.test(w)), `expected an unreadable-handler warning; got ${JSON.stringify(warnings)}`);
});

test('NO warnings for safe handlers/computeds, and NEVER for an eager build', () => {
  const safe = compileComponent(
    {
      script:
        'import { signal, computed } from "@weave-framework/runtime";\n' +
        'export function setup(){ const count = signal(0);\n  const doubled = computed(() => count() * 2);\n  const inc = () => count.set((n) => n + 1);\n  return { count, doubled, inc }; }',
      template: '<button on:click={{ inc }}>{{ count() }} {{ doubled() }}</button>',
    },
    { filename: 'ok', resumable: true }
  );
  assert.ok(!safe.warnings, 'a fully-resumable component warns about nothing');

  const eager = compileComponent(
    {
      script:
        'import { signal } from "@weave-framework/runtime";\n' +
        'export function setup(){ const count = signal(0); const helper = () => count.set(0);\n  const inc = () => count.set((n) => n + step);\n  return { count, inc }; }',
      template: '<button on:click={{ inc }}>{{ count() }}</button>',
    },
    { filename: 'eagerw' } // NOT resumable → resume can't happen → nothing to warn about
  );
  assert.ok(!eager.warnings, 'eager builds never emit resume warnings');
});

test('E1.5: a handler using a RETURNED signal the template never reads still inlines (not wrongly refused)', () => {
  // `count` is returned + serialized, but the template only shows `scaled()` and the button — so `count`
  // is not in the template scope. The handler must still inline (regression: it was refused + mis-warned).
  const { code, warnings } = compileComponent(
    {
      script:
        'import { signal, computed, type Signal } from "@weave-framework/runtime";\n' +
        'export function setup(): { scaled: () => number; bump: () => void } {\n' +
        '  const count = signal(0);\n' +
        '  const scaled = computed(() => count() * 2);\n' +
        '  const bump = () => count.set((n) => n + 1);\n' +
        '  return { count, scaled, bump };\n}',
      template: '<button on:click={{ bump }}>{{ scaled() }}</button>',
    },
    { filename: 'ret', resumable: true }
  );
  assert.ok(/"w0":\s*\(\)\s*=>\s*ctx\.count\.set\(\(n\)\s*=>\s*n \+ 1\)/.test(code), `bump inlines against ctx.count; got:\n${code}`);
  assert.ok(/ctx\.scaled = computed\(\(\) => ctx\.count\(\) \* 2\)/.test(code), 'scaled derives against ctx.count');
  assert.ok(!warnings, `no warning — everything resolves; got ${JSON.stringify(warnings)}`);
});

/* ──────────── E1.13 — a component-level `on:` resumes ──────────── */

test('E1.13: `<Button on:click={{ fn }}>` re-attaches on adopt — a component event is not a DOM resume site', () => {
  const { code } = compileComponent(
    {
      script:
        'import { signal } from "@weave-framework/runtime";\n' +
        'import Button from "./button";\n' +
        'export function setup(){ const theme = signal("light");\n' +
        '  const toggle = () => theme.set("dark");\n  return { theme, toggle }; }',
      template: '<div><Button on:click={{ toggle }}>x</Button></div>',
    },
    { filename: 'cev', resumable: true }
  );
  // CREATE: unchanged — the handler rides as an onClick prop that defineComponent forwards to the child root.
  assert.ok(/onClick:\s*ctx\.toggle/.test(code), 'create still forwards the handler as a prop');
  // ADOPT: defineComponent's forwarding never runs, so adoptComponent re-attaches it — with the INLINED body,
  // since `ctx.toggle` is undefined on a resumed client (the docs theme button was dead on exactly this).
  const adoptPart: string = code.split('function adopt(')[1] ?? '';
  // (not anchored on the closing paren — E1.17 appends the child's slots after the events arg)
  assert.ok(/adoptComponent\([^;]*\{ onClick: \(\) => ctx\.theme\.set\("dark"\) \}/.test(adoptPart),
    `adopt hands the inlined handler to adoptComponent; got:\n${adoptPart.slice(0, 400)}`);
});

test('E1.13: a component `on:` whose handler cannot be inlined is REPORTED (it would be silently dead)', () => {
  const { warnings } = compileComponent(
    {
      script:
        'import { signal } from "@weave-framework/runtime";\n' +
        'import Button from "./button";\n' +
        // (a setup-local helper until E1.19 made those factory locals, then `props` until E1.20 wired it in;
        //  a `new` expression is not a shape derive can rebuild, so it is genuinely unreachable)
        'export function setup(){ const theme = signal("light"); const store = new Store();\n' +
        '  const toggle = () => theme.set(store.next);\n  return { theme, toggle }; }',
      template: '<div><Button on:click={{ toggle }}>x</Button></div>',
    },
    { filename: 'cev2', resumable: true }
  );
  assert.ok(warnings && warnings.some((w) => /handler `toggle`/.test(w) && /will not work after resume/.test(w)),
    `a dead component-event handler must warn; got ${JSON.stringify(warnings)}`);
});

/* ──────────── E1.14 — the compiler says WHY a component cannot be adopted ──────────── */

test('E1.14: a non-adoptable template REPORTS its cause (the whole subtree would silently client-render)', () => {
  // `gen.adoptable = false` used to be set in ~17 places with no diagnostic at all — so a component whose
  // entire subtree fell back to client rendering said nothing. That silence is what made a docs page look
  // resumed when nothing had run. Each cause must now name itself, and name the construct in the author's terms.
  const { warnings } = compileComponent(
    { script: 'export function setup(){ return {}; }', template: '<div><b use:tooltip>x</b></div>' },
    { filename: 'na', resumable: true }
  );
  assert.ok(warnings && warnings.some((w) => /cannot be resumed/.test(w) && /use:tooltip/.test(w)),
    `must name the offending construct; got ${JSON.stringify(warnings)}`);
});

test('E1.14: the cause names the NODE as authored, not an AST type', () => {
  // "an `element` node" is useless in a 200-line template; `<aside>` is actionable — naming the tag is exactly
  // how the real docs blocker was located. (This test originally used `<Foo /><Link>x</Link>`, which WAS the
  // blocker; E1.15 made that shape adoptable, so the message quality is now pinned on a real refusal: an
  // element whose subtree holds its own block cannot rebase onto the post-block cursor.)
  const { warnings } = compileComponent(
    { script: 'export function setup(){ return {}; }', template: '<div>@if (x) { <i>a</i> }<aside>@if (y) { <b>c</b> }</aside></div>' },
    { filename: 'na2', resumable: true }
  );
  assert.ok(warnings && warnings.some((w) => /`<aside>`/.test(w)), `must name <aside>; got ${JSON.stringify(warnings)}`);
});

test('E1.15: a component or block placed after another one is adoptable; a `use:` at any position is not', () => {
  // The gate refused EVERY second block/component per level. Only the kind decides now — pinned cheaply here so
  // the round-trip test in resumable.browser.ts is not the sole guard.
  const adoptable = (template: string): boolean =>
    /function adopt\(/.test(compileTemplate(template, { mode: 'module', resumable: true }).code);
  assert.ok(adoptable('<div><Foo /><Bar /></div>'), 'two sibling components');
  assert.ok(adoptable('<div><Foo />@if (x) { <b>a</b> }</div>'), 'a block after a component');
  assert.ok(adoptable('<div>@if (x) { <b>a</b> }<Foo /></div>'), 'a component after a block');
  assert.ok(adoptable('<div>@if (x) { <b>a</b> }@for (i of xs) { <i>{{ i }}</i> }</div>'), 'two sibling blocks');
  assert.ok(adoptable('<div><Foo /><slot /></div>'), 'a <slot> after a component (it island-replays since E1.17)');
  assert.ok(!adoptable('<div><Foo /><b use:tip>x</b></div>'), 'a `use:` action has no adopt path at all — still refused');
});

test('E1.14: an adoptable component reports nothing', () => {
  const { warnings } = compileComponent(
    { script: 'import { signal } from "@weave-framework/runtime";\nexport function setup(){ const n = signal(0); return { n }; }', template: '<p>{{ n() }}</p>' },
    { filename: 'ok2', resumable: true }
  );
  assert.ok(!warnings, `a fully adoptable component is silent; got ${JSON.stringify(warnings)}`);
});

/* ──────────── E1.20 — `props` reaches the resumed handlers factory ──────────── */

test('E1.20: a handler reading `props` inlines — the factory takes props as a parameter', () => {
  // `props` was the LAST root cause: a helper like `setOpened` reads it, so the helper could not be emitted, so
  // every handler calling the helper was refused and blamed the HELPER. One cause wearing many names.
  const { code } = compileComponent(
    { script: counter('const inc = () => count.set(props.start);'), template: '<button on:click={{ inc }}>{{ count() }}</button>' },
    { filename: 'p1', resumable: true }
  );
  assert.ok(/function handlers\(ctx, props\)/.test(code), 'the factory takes props');
  assert.ok(/"w0":\s*\(\) => ctx\.count\.set\(props\.start\)/.test(code), '`props` stays bare — it is the factory parameter, not ctx');
  assert.ok(!/"w0":\s*ctx\.inc\b/.test(code), 'no longer falls back');
});

test('E1.20: a HELPER reading `props` is emitted, so the handler calling it inlines too (the real cascade)', () => {
  const { code } = compileComponent(
    {
      script: counter('const setOpened = (v) => count.set(props.base + v);\nconst inc = () => setOpened(1);'),
      template: '<button on:click={{ inc }}>{{ count() }}</button>',
    },
    { filename: 'p2', resumable: true }
  );
  const factory: string = code.split('function handlers(')[1]?.split('\n}')[0] ?? '';
  assert.ok(/const setOpened = \(v\) => ctx\.count\.set\(props\.base \+ v\)/.test(factory), `helper emitted; got:\n${factory}`);
  assert.ok(/"w0":\s*\(\) => setOpened\(1\)/.test(factory), 'and the handler resolves through it');
});

test('E1.20: the child adopt emit hands the child its OWN props', () => {
  const { code } = compileComponent(
    {
      script: 'import { signal } from "@weave-framework/runtime";\nimport Child from "./child";\nexport function setup(){ const n = signal(1); return { n }; }',
      template: '<div><Child tone={{ n() }} /></div>',
    },
    { filename: 'p3', resumable: true }
  );
  const adoptPart: string = code.split('function adopt(')[1] ?? '';
  assert.ok(/adoptComponent\([^;]*get tone\(\)/.test(adoptPart),
    `the props the parent passes must reach adoptComponent; got:\n${adoptPart.slice(0, 400)}`);
});
