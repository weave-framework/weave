import { test, assert } from '../../../tools/harness.js';
import { signal, computed, effect, root, type Signal } from '@weave/runtime';
import * as dom from '@weave/runtime/dom';
import { compileTemplate } from '@weave/compiler';

// The runtime object the compiled (function-mode) code references as `rt`.
const rt: typeof dom & {
  signal: typeof signal;
  computed: typeof computed;
  effect: typeof effect;
  root: typeof root;
} = { ...dom, signal, computed, effect, root };

/** Compile a template to a render function and instantiate it (simulates the compiler's output running). */
function render(
  html: string,
  ctx: Record<string, unknown>,
  scope: string[],
  components: Record<string, unknown> = {}
): Element {
  const { code } = compileTemplate(html, { mode: 'function', scope });
  const fn: (ctx: unknown, rt: unknown, _c: unknown) => Element = new Function('ctx', 'rt', '_c', code) as (ctx: unknown, rt: unknown, _c: unknown) => Element;
  return fn(ctx, rt, components);
}

/**
 * Compile a template into a reusable component `(props, slots) => Node`.
 * Mirrors what a child component's compiled render is: ctx = props.
 * (We strip the harness's trailing `return render(ctx, {})` and hand back `render` itself.)
 */
function compileComponent(html: string, scope: string[] = []): (props: unknown, slots?: unknown) => Node {
  const { code } = compileTemplate(html, { mode: 'function', scope });
  const body: string = code.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;');
  return new Function('rt', '_c', body)(rt, {}) as (props: unknown, slots?: unknown) => Node;
}

function host(): HTMLElement {
  const el: HTMLDivElement = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

test('static element compiles and renders', () => {
  const el: Element = render('<p class="x">hi</p>', {}, []);
  host().appendChild(el);
  assert.equal((el as HTMLElement).outerHTML, '<p class="x">hi</p>');
});

test('reactive interpolation updates the same text node', () => {
  const count: Signal<number> = signal(7);
  const el: Element = render('<span>n: {{ count() }}</span>', { count }, ['count']);
  host().appendChild(el);
  assert.equal(el.textContent, 'n: 7');
  const dyn: Text = el.childNodes[1] as Text;
  count.set(8);
  assert.equal(el.textContent, 'n: 8');
  assert.is(el.childNodes[1], dyn, 'same text node reused');
});

test('static interpolation uses setText (no reactivity)', () => {
  const el: Element = render('<b>{{ 2 + 2 }}</b>', {}, []);
  assert.equal(el.textContent, '4');
});

test('event binding wires a handler that mutates a signal', () => {
  const count: Signal<number> = signal(0);
  const inc = (): number => count.set((c) => c + 1);
  const el: Element = render('<button on:click={{inc}}>{{ count() }}</button>', { count, inc }, ['count', 'inc']);
  host().appendChild(el);
  assert.equal(el.textContent, '0');
  (el as HTMLButtonElement).click();
  (el as HTMLButtonElement).click();
  assert.equal(el.textContent, '2');
});

test('inline arrow handler with member access rewrites only bindings', () => {
  const count: Signal<number> = signal(0);
  const el: Element = render('<button on:click={{() => count.set(n => n + 1)}}>x</button>', { count }, ['count']);
  host().appendChild(el);
  (el as HTMLButtonElement).click();
  assert.equal(count(), 1);
});

test('dynamic attribute binds reactively (boolean + value)', () => {
  const disabled: Signal<boolean> = signal(true);
  const cls: Signal<string> = signal('a');
  const el: Element = render('<input disabled={{disabled()}} class={{cls()}}>', { disabled, cls }, ['disabled', 'cls']);
  assert.equal(el.hasAttribute('disabled'), true);
  assert.equal(el.getAttribute('class'), 'a');
  disabled.set(false);
  cls.set('b');
  assert.equal(el.hasAttribute('disabled'), false);
  assert.equal(el.getAttribute('class'), 'b');
});

test('property binding (.value)', () => {
  const text: Signal<string> = signal('one');
  const el: HTMLInputElement = render('<input .value={{text()}}>', { text }, ['text']) as HTMLInputElement;
  assert.equal(el.value, 'one');
  text.set('two');
  assert.equal(el.value, 'two');
});

test('class: binding toggles', () => {
  const done: Signal<boolean> = signal(false);
  const el: Element = render('<li class:done={{done()}}>x</li>', { done }, ['done']);
  assert.equal(el.className, '');
  done.set(true);
  assert.equal(el.className, 'done');
});

test('event modifier preventDefault wraps the handler', () => {
  let ran: boolean = false;
  const onSubmit = (): boolean => (ran = true);
  const el: Element = render('<button on:click|preventDefault={{onSubmit}}>go</button>', { onSubmit }, ['onSubmit']);
  host().appendChild(el);
  const ev: MouseEvent = new MouseEvent('click', { cancelable: true });
  el.dispatchEvent(ev);
  assert.ok(ran, 'handler ran');
  assert.ok(ev.defaultPrevented, 'default prevented by modifier');
});

test('globals are not rewritten to ctx (Math stays Math)', () => {
  const n: Signal<number> = signal(3);
  const el: Element = render('<b>{{ Math.max(n(), 5) }}</b>', { n }, ['n']);
  assert.equal(el.textContent, '5');
  n.set(9);
  assert.equal(el.textContent, '9');
});

test('multi-root template renders a fragment', () => {
  const a: Signal<string> = signal('A');
  const b: Signal<string> = signal('B');
  const frag: Element = render('<h1>{{ a() }}</h1><p>{{ b() }}</p>', { a, b }, ['a', 'b']);
  const h: HTMLElement = host();
  h.appendChild(frag);
  assert.equal(h.querySelector('h1')!.textContent, 'A');
  assert.equal(h.querySelector('p')!.textContent, 'B');
  a.set('A2');
  assert.equal(h.querySelector('h1')!.textContent, 'A2');
});

/* ──────────── M4: control flow ──────────── */

test('@if / @else toggles branches', () => {
  const open: Signal<boolean> = signal(true);
  const el: Element = render('<div>@if (open()) { <p>yes</p> } @else { <p>no</p> }</div>', { open }, ['open']);
  host().appendChild(el);
  assert.equal(el.querySelector('p')!.textContent, 'yes');
  open.set(false);
  assert.equal(el.querySelector('p')!.textContent, 'no');
  open.set(true);
  assert.equal(el.querySelector('p')!.textContent, 'yes');
});

test('@if branch is not remounted while condition stays true', () => {
  const open: Signal<boolean> = signal(true);
  const tick: Signal<number> = signal(0);
  const el: Element = render('<div>@if (open()) { <p>{{ tick() }}</p> }</div>', { open, tick }, ['open', 'tick']);
  host().appendChild(el);
  const p: HTMLParagraphElement = el.querySelector('p')!;
  tick.set(1);
  assert.is(el.querySelector('p'), p, 'same <p> node — branch not remounted');
  assert.equal(p.textContent, '1');
});

test('@if (expr; as alias) exposes the value', () => {
  const user: Signal<{ name: string } | null> = signal<{ name: string } | null>({ name: 'Ada' });
  const el: Element = render(
    '<div>@if (user(); as u) { <p>{{ u.name }}</p> } @else { <p>none</p> }</div>',
    { user },
    ['user']
  );
  host().appendChild(el);
  assert.equal(el.querySelector('p')!.textContent, 'Ada');
  user.set({ name: 'Lin' });
  assert.equal(el.querySelector('p')!.textContent, 'Lin');
  user.set(null);
  assert.equal(el.querySelector('p')!.textContent, 'none');
});

test('@for renders, reacts, and exposes $index/$first/$last', () => {
  const items: Signal<{ id: number; t: string }[]> = signal([{ id: 1, t: 'a' }, { id: 2, t: 'b' }]);
  const el: Element = render(
    '<ul>@for (it of items(); track it.id) { <li>{{ $index }}:{{ it.t }}{{ $last ? "!" : "" }}</li> }</ul>',
    { items },
    ['items']
  );
  host().appendChild(el);
  assert.deepEqual([...el.querySelectorAll('li')].map((l) => l.textContent), ['0:a', '1:b!']);
  items.set((xs) => [...xs, { id: 3, t: 'c' }]);
  assert.deepEqual([...el.querySelectorAll('li')].map((l) => l.textContent), ['0:a', '1:b', '2:c!']);
});

test('@for reflects immutable item updates on reused rows', () => {
  const items: Signal<{ id: number; t: string }[]> = signal([{ id: 1, t: 'a' }]);
  const el: Element = render(
    '<ul>@for (it of items(); track it.id) { <li>{{ it.t }}</li> }</ul>',
    { items },
    ['items']
  );
  host().appendChild(el);
  const li: HTMLLIElement = el.querySelector('li')!;
  items.set([{ id: 1, t: 'A' }]); // same key, new object
  assert.is(el.querySelector('li'), li, 'row node reused');
  assert.equal(li.textContent, 'A', 'reused row reflects new item value');
});

test('@for @empty shows when the list is empty', () => {
  const items: Signal<number[]> = signal<number[]>([]);
  const el: Element = render(
    '<ul>@for (n of items(); track n) { <li>{{ n }}</li> } @empty { <li class="e">none</li> }</ul>',
    { items },
    ['items']
  );
  host().appendChild(el);
  assert.equal(el.querySelector('.e')!.textContent, 'none');
  items.set([10]);
  assert.equal(el.querySelector('.e'), null);
  assert.equal(el.querySelector('li')!.textContent, '10');
  items.set([]);
  assert.equal(el.querySelector('.e')!.textContent, 'none');
});

test('@switch picks a case and @default', () => {
  const status: Signal<string> = signal('a');
  const el: Element = render(
    '<div>@switch (status()) { @case ("a") { <p>A</p> } @case ("b") { <p>B</p> } @default { <p>?</p> } }</div>',
    { status },
    ['status']
  );
  host().appendChild(el);
  assert.equal(el.querySelector('p')!.textContent, 'A');
  status.set('b');
  assert.equal(el.querySelector('p')!.textContent, 'B');
  status.set('z');
  assert.equal(el.querySelector('p')!.textContent, '?');
});

test('@@ escapes a literal @ so prose can mention block keywords', () => {
  const el: Element = render('<p>Use <code>@@for</code> and @@if in docs</p>', {}, []);
  host().appendChild(el);
  assert.equal(el.querySelector('code')!.textContent, '@for', 'escaped @@for renders as literal @for');
  assert.equal(el.textContent, 'Use @for and @if in docs', 'both escapes collapse; no block parsed');
});

test('a single @ in text is left untouched (emails, decorators)', () => {
  const el: Element = render('<p>mail me at ada@weave.dev</p>', {}, []);
  assert.equal(el.textContent, 'mail me at ada@weave.dev');
});

test('@let defines a reactive local', () => {
  const n: Signal<number> = signal(3);
  const el: Element = render('<div>@let dbl = n() * 2;<b>{{ dbl }}</b></div>', { n }, ['n']);
  host().appendChild(el);
  assert.equal(el.querySelector('b')!.textContent, '6');
  n.set(5);
  assert.equal(el.querySelector('b')!.textContent, '10');
});

test('module mode emits a real ES module', () => {
  const { code } = compileTemplate('<button on:click={{inc}}>clicks: {{ count() }}</button>', {
    mode: 'module',
    scope: ['count', 'inc'],
  });
  assert.ok(code.includes("from \"@weave/runtime/dom\""), 'imports from runtime');
  assert.ok(code.includes('export default function render(ctx, slots)'), 'exports render');
  assert.ok(code.includes('bindText('), 'binds text');
  assert.ok(code.includes('listen('), 'wires event');
  assert.ok(code.includes('ctx.count') && code.includes('ctx.inc'), 'scope rewritten to ctx');
});

/* ──────────── M5: components + slots ──────────── */

test('component renders with a prop', () => {
  const Child: (props: unknown, slots?: unknown) => Node = compileComponent('<span>{{ label }}</span>', ['label']);
  const el: Element = render('<div><Child label={{"hi"}} /></div>', {}, [], { Child });
  host().appendChild(el);
  assert.equal(el.querySelector('span')!.textContent, 'hi');
});

test('component prop is reactive (parent signal flows through the getter)', () => {
  const name: Signal<string> = signal('Ada');
  const Child: (props: unknown, slots?: unknown) => Node = compileComponent('<span>{{ label }}</span>', ['label']);
  const el: Element = render('<div><Child label={{name()}} /></div>', { name }, ['name'], { Child });
  host().appendChild(el);
  assert.equal(el.querySelector('span')!.textContent, 'Ada');
  name.set('Lin');
  assert.equal(el.querySelector('span')!.textContent, 'Lin', 'child text tracks parent signal');
});

test('on:event prop fires the parent handler', () => {
  let got: number = 0;
  const handler = (): void => { got++; };
  const Child: (props: unknown, slots?: unknown) => Node = compileComponent('<button on:click={{onSelect}}>x</button>', ['onSelect']);
  const el: Element = render('<div><Child on:select={{handler}} /></div>', { handler }, ['handler'], { Child });
  host().appendChild(el);
  const btn: HTMLButtonElement = el.querySelector('button') as HTMLButtonElement;
  btn.click();
  btn.click();
  assert.equal(got, 2, 'on:select mapped to onSelect prop and fired');
});

test('default slot projects parent content', () => {
  const Child: (props: unknown, slots?: unknown) => Node = compileComponent('<div class="box"><slot/></div>');
  const el: Element = render('<section><Child>hello</Child></section>', {}, [], { Child });
  host().appendChild(el);
  assert.equal(el.querySelector('.box')!.textContent, 'hello');
});

test('slot content uses parent scope', () => {
  const who: Signal<string> = signal('world');
  const Child: (props: unknown, slots?: unknown) => Node = compileComponent('<div class="box"><slot/></div>');
  const el: Element = render('<section><Child>hi {{ who() }}</Child></section>', { who }, ['who'], { Child });
  host().appendChild(el);
  assert.equal(el.querySelector('.box')!.textContent, 'hi world');
  who.set('Weave');
  assert.equal(el.querySelector('.box')!.textContent, 'hi Weave', 'projected content stays reactive');
});

test('named slots route by slot="name"', () => {
  const Card: (props: unknown, slots?: unknown) => Node = compileComponent('<div><header><slot name="title"/></header><main><slot/></main></div>');
  const el: Element = render(
    '<div><Card><h1 slot="title">T</h1><p>body</p></Card></div>',
    {},
    [],
    { Card }
  );
  host().appendChild(el);
  assert.equal(el.querySelector('header')!.textContent, 'T');
  assert.equal(el.querySelector('main')!.textContent, 'body');
});

test('slot renders fallback when not provided', () => {
  const Child: (props: unknown, slots?: unknown) => Node = compileComponent('<div class="box"><slot>fallback</slot></div>');
  const el: Element = render('<div><Child/></div>', {}, [], { Child });
  host().appendChild(el);
  assert.equal(el.querySelector('.box')!.textContent, 'fallback');
});

test('module mode references components by name and emits getter props', () => {
  const { code } = compileTemplate('<div><Child x={{v()}} on:go={{h}} /></div>', {
    mode: 'module',
    scope: ['v', 'h'],
  });
  assert.ok(code.includes('mountChild('), 'mounts the child');
  assert.ok(/Child\(\{/.test(code), 'calls Child({ … })');
  assert.ok(code.includes('get x()'), 'reactive prop is a getter');
  assert.ok(code.includes('onGo:'), 'on:go mapped to onGo prop');
});
