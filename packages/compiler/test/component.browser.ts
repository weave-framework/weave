import { test, assert } from '../../../tools/harness.js';
import { signal, computed, effect, root, onDispose, type Signal, type Computed } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import {
  compileTemplate, compileComponent, parseSfc, inferCtxNames, parseTemplate,
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

test('inferCtxNames excludes @for item, $vars, and @let names', () => {
  const f: string[] = inferCtxNames(parseTemplate('<ul>@for (it of items(); track it.id) { <li>{{ $index }}:{{ it.t }}</li> }</ul>'));
  assert.deepEqual(f, ['items']);
  const l: string[] = inferCtxNames(parseTemplate('<div>@let dbl = n() * 2;<b>{{ dbl }}</b></div>'));
  assert.deepEqual(l, ['n']);
});

test('inferCtxNames: a name used outside a @for is still ctx even if a loop shadows it (M4)', () => {
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
