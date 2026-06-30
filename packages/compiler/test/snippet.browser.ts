import { test, assert } from '../../../tools/harness.js';
import { signal, computed, effect, root, type Signal } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate, parseTemplate } from '@weave-framework/compiler';
import type { TemplateNode } from '@weave-framework/compiler';

const rt: typeof dom & {
  signal: typeof signal;
  computed: typeof computed;
  effect: typeof effect;
  root: typeof root;
} = { ...dom, signal, computed, effect, root };

/** Compile a template (function mode) and instantiate it — runs the real runtime path. */
function render(
  html: string,
  ctx: Record<string, unknown> = {},
  scope: string[] = [],
  components: Record<string, unknown> = {}
): Element {
  const { code } = compileTemplate(html, { mode: 'function', scope });
  const fn: (c: unknown, r: unknown, k: unknown) => Element = new Function('ctx', 'rt', '_c', code) as (c: unknown, r: unknown, k: unknown) => Element;
  return fn(ctx, rt, components);
}

/** Compile a child component template into a `(props) => Node` for the `_c` map. */
function child(html: string, scope: string[] = []): (props: Record<string, unknown>) => Node {
  const { code } = compileTemplate(html, { mode: 'function', scope });
  const fn: (c: unknown, r: unknown, k: unknown) => Node = new Function('ctx', 'rt', '_c', code) as (c: unknown, r: unknown, k: unknown) => Node;
  return (props) => fn(props, rt, {});
}

function host(): HTMLElement {
  const el: HTMLDivElement = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

/* ──────────── parse + codegen ──────────── */

test('@snippet / @render parse into snippet + render nodes', () => {
  const ast: TemplateNode[] = parseTemplate(`<div>@snippet greet(name) { <p>{{ name }}</p> } @render (greet('A'))</div>`);
  const div: { type: string; children: { type: string; name?: string; params?: string[] }[] } = ast[0] as { type: string; children: { type: string; name?: string; params?: string[] }[] };
  const snip: { type: string; name?: string; params?: string[] } = div.children.find((n) => n.type === 'snippet')!;
  const rend: { type: string; name?: string; params?: string[] } = div.children.find((n) => n.type === 'render')!;
  assert.equal(snip.name, 'greet');
  assert.deepEqual(snip.params, ['name']);
  assert.ok(rend, 'has a render node');
});

test('@snippet emits a named function; @render emits mountChild', () => {
  const { code } = compileTemplate(
    `<div>@snippet greet(name) { <p>x</p> } @render (greet('A'))</div>`,
    { mode: 'module' }
  );
  assert.ok(code.includes('function greet(name)'), code);
  assert.ok(code.includes('mountChild('), code);
});

/* ──────────── runtime ──────────── */

test('renders a snippet with a parameter', () => {
  const el: Element = render(`<div>@snippet greet(name) { <p>Hi {{ name }}</p> } @render (greet('Alice'))</div>`);
  host().appendChild(el);
  assert.ok(el.textContent?.includes('Hi Alice'), el.textContent ?? '');
});

test('the same snippet renders multiple times with different args', () => {
  const el: Element = render(
    `<ul>@snippet row(n) { <li>#{{ n }}</li> } @render (row(1)) @render (row(2)) @render (row(3))</ul>`
  );
  host().appendChild(el);
  const text: string = el.textContent ?? '';
  assert.ok(text.includes('#1') && text.includes('#2') && text.includes('#3'), text);
});

test('a snippet can be @render-ed before its declaration (hoisted)', () => {
  const el: Element = render(`<div>@render (greet('early')) @snippet greet(x) { <p>{{ x }}</p> }</div>`);
  host().appendChild(el);
  assert.ok(el.textContent?.includes('early'), el.textContent ?? '');
});

test('a snippet body mixes a param with a reactive ctx signal', () => {
  const count: Signal<number> = signal(0);
  const el: Element = render(
    `<div>@snippet line(label) { <p>{{ label }}: {{ count() }}</p> } @render (line('n'))</div>`,
    { count },
    ['count']
  );
  host().appendChild(el);
  assert.ok(el.textContent?.includes('n: 0'), el.textContent ?? '');
  count.set(5);
  assert.ok(el.textContent?.includes('n: 5'), 'ctx ref inside the snippet stays reactive');
});

test('multiple parameters are passed positionally', () => {
  const el: Element = render(
    `<div>@snippet pair(a, b) { <p>{{ a }}-{{ b }}</p> } @render (pair('x', 'y'))</div>`
  );
  host().appendChild(el);
  assert.ok(el.textContent?.includes('x-y'), el.textContent ?? '');
});

test('a snippet passed to a child component as a prop renders in the child', () => {
  // Child receives `body` as a prop (a snippet fn) and renders it with an arg.
  const Child: (props: Record<string, unknown>) => Node = child(`<section>@render (body('from-child'))</section>`, ['body']);

  const el: Element = render(
    `<div>@snippet tpl(who) { <em>{{ who }}</em> } <Child body={{tpl}}/></div>`,
    {},
    [],
    { Child }
  );
  host().appendChild(el);
  assert.ok(el.textContent?.includes('from-child'), el.textContent ?? '');
  assert.ok(el.querySelector('section em'), 'snippet DOM rendered inside the child');
});
