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
  assert.ok(code.includes('export default _wc'), 'a single default export — the .adopt-tagged component');
  assert.ok(!/export default render;/.test(code), 'the raw `export default render` was stripped');
  assert.ok(code.includes('registerState(ctx.$wid'), 'the render self-registers its ctx under $wid for the snapshot');
  assert.ok(code.includes('from "@weave-framework/runtime/adopt"') && code.includes('from "@weave-framework/runtime/graph"'), 'imports the resumable entries');
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
