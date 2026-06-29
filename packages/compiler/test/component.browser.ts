import { test, assert } from '../../../tools/harness.js';
import { signal, computed, effect, root, onDispose } from '@weave/runtime';
import * as dom from '@weave/runtime/dom';
import {
  compileTemplate, compileComponent, parseSfc, inferCtxNames, parseTemplate,
} from '@weave/compiler';

const rt = { ...dom, signal, computed, effect, root };

/** Compile a template to a reusable `(ctx, slots) => Node` render function. */
function compileRender(html: string, scope: string[]): (ctx: unknown, slots?: unknown) => Node {
  const { code } = compileTemplate(html, { mode: 'function', scope });
  const body = code.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;');
  return new Function('rt', '_c', body)(rt, {}) as (ctx: unknown, slots?: unknown) => Node;
}

function host(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

/* ──────────── auto-scope inference ──────────── */

test('inferCtxNames collects free identifiers', () => {
  const names = inferCtxNames(parseTemplate('<button on:click={inc}>{{ count() }}</button>'));
  assert.deepEqual(names, ['count', 'inc']);
});

test('inferCtxNames excludes JS globals', () => {
  assert.deepEqual(inferCtxNames(parseTemplate('<b>{{ Math.max(n(), 5) }}</b>')), ['n']);
});

test('inferCtxNames excludes arrow parameters', () => {
  const names = inferCtxNames(parseTemplate('<button on:click={() => count.set(n => n + 1)}>x</button>'));
  assert.deepEqual(names, ['count']);
});

test('inferCtxNames collects the use: action name (and its arg)', () => {
  // bare action → just the action name
  assert.deepEqual(inferCtxNames(parseTemplate('<div use:autofocus></div>')), ['autofocus']);
  // action + arg → both, arg deps included
  assert.deepEqual(
    inferCtxNames(parseTemplate('<div use:tooltip={label()}></div>')),
    ['label', 'tooltip']
  );
});

test('inferCtxNames excludes @for item, $vars, and @let names', () => {
  const f = inferCtxNames(parseTemplate('<ul>@for (it of items(); track it.id) { <li>{{ $index }}:{{ it.t }}</li> }</ul>'));
  assert.deepEqual(f, ['items']);
  const l = inferCtxNames(parseTemplate('<div>@let dbl = n() * 2;<b>{{ dbl }}</b></div>'));
  assert.deepEqual(l, ['n']);
});

test('a comment between elements does not shift child-index paths', () => {
  // Regression: the parser split the whitespace around a skipped comment into two
  // adjacent text nodes. The browser merges them when the emitted template HTML is
  // parsed, so every binding after the comment resolved the wrong node (off by one).
  const x = signal('hi');
  const render = compileRender('<div><span>a</span>\n<!-- c -->\n<p>{{ x() }}</p></div>', ['x']);
  const el = render({ x }, {}) as HTMLElement;
  host().appendChild(el);
  const p = el.querySelector('p') as HTMLElement;
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
  const link = nav.children[0];
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
  const render = compileRender('<button on:click={inc}>{{ count() }}</button>', ['count', 'inc']);
  const Counter = dom.defineComponent(render as never, () => {
    const count = signal(0);
    const inc = () => count.set((n) => n + 1);
    return { count, inc };
  });
  const h = host();
  const unmount = dom.mountComponent(Counter, h);
  const btn = h.querySelector('button') as HTMLButtonElement;
  assert.equal(btn.textContent, '0');
  btn.click();
  assert.equal(btn.textContent, '1');
  unmount();
  assert.equal(h.childNodes.length, 0, 'unmount removes the DOM');
});

test('defineComponent exposes props (lazy) alongside setup bindings', () => {
  const render = compileRender('<span>{{ label }} {{ doubled() }}</span>', ['label', 'doubled']);
  const Child = dom.defineComponent(render as never, (props) => {
    const doubled = computed(() => (props.n as number) * 2);
    return { doubled };
  });
  const n = signal(3);
  const node = Child({ get label() { return 'x'; }, get n() { return n(); } }, {}) as Element;
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
  const render = compileRender('<span>{{ task().title }}</span>', ['task']);
  const Card = dom.defineComponent(render as never, (props) => ({
    task: () => props.task as { title: string },
  }));
  const t = signal({ title: 'hi' });
  const node = Card({ get task() { return t(); } }, {}) as Element;
  host().appendChild(node);
  assert.equal(node.textContent, 'hi');
  t.set({ title: 'bye' });
  assert.equal(node.textContent, 'bye', 'reactive through the shadowing accessor');
});

test('mountComponent disposes setup effects on unmount', () => {
  let disposed = false;
  const render = compileRender('<p>{{ v() }}</p>', ['v']);
  const C = dom.defineComponent(render as never, () => {
    const v = signal(1);
    onDispose(() => { disposed = true; });
    return { v };
  });
  const unmount = dom.mountComponent(C, host());
  assert.equal(disposed, false);
  unmount();
  assert.equal(disposed, true, 'owner disposal runs setup cleanups');
});

test('a @for row can be a component (multi-node keyed row)', () => {
  // Bug #7: a `@for` row body that is a component (or any fragment root) compiles
  // to a `<!---->` anchor + mountChild — never a single DOM node. `eachBlock` now
  // brackets such a row with marker comments so the keyed reconciler can move and
  // remove it as one span. Mirrors the demo's `<Link><TaskCard/></Link>` rows.
  const Item = dom.defineComponent(
    compileRender('<li class="item">{{ label() }}</li>', ['label']) as never,
    (props) => ({ label: () => props.text })
  );
  const items = signal([{ id: 1, text: 'a' }, { id: 2, text: 'b' }]);
  const { code } = compileTemplate(
    '<ul>@for (it of items(); track it.id) { <Item text={it.text} /> }</ul>',
    { mode: 'function', scope: ['items'] }
  );
  const body = code.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;');
  const render = new Function('rt', '_c', body)(rt, { Item }) as (ctx: unknown) => Node;
  const el = render({ items }) as HTMLElement;
  host().appendChild(el);
  const texts = () => [...el.querySelectorAll('li')].map((l) => l.textContent);

  assert.deepEqual(texts(), ['a', 'b']);
  const aLi = el.querySelector('li')!;

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
  const sfc =
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
        'import { signal } from "@weave/runtime";\n' +
        'export function setup(){ const count = signal(0); const inc = () => count.set(n => n + 1); return { count, inc }; }',
      template: '<button on:click={inc}>{{ count() }}</button>',
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
