import { test, assert } from '../../../tools/harness.js';
import { signal, computed, effect, root } from '@weave/runtime';
import * as dom from '@weave/runtime/dom';
import { compileTemplate } from '@weave/compiler';

// The runtime object the compiled (function-mode) code references as `rt`.
const rt = { ...dom, signal, computed, effect, root };

/** Compile a template to a render function and instantiate it (simulates the compiler's output running). */
function render(html: string, ctx: Record<string, unknown>, scope: string[]): Element {
  const { code } = compileTemplate(html, { mode: 'function', scope });
  const fn = new Function('ctx', 'rt', code) as (ctx: unknown, rt: unknown) => Element;
  return fn(ctx, rt);
}

function host(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

test('static element compiles and renders', () => {
  const el = render('<p class="x">hi</p>', {}, []);
  host().appendChild(el);
  assert.equal((el as HTMLElement).outerHTML, '<p class="x">hi</p>');
});

test('reactive interpolation updates the same text node', () => {
  const count = signal(7);
  const el = render('<span>n: {{ count() }}</span>', { count }, ['count']);
  host().appendChild(el);
  assert.equal(el.textContent, 'n: 7');
  const dyn = el.childNodes[1] as Text;
  count.set(8);
  assert.equal(el.textContent, 'n: 8');
  assert.is(el.childNodes[1], dyn, 'same text node reused');
});

test('static interpolation uses setText (no reactivity)', () => {
  const el = render('<b>{{ 2 + 2 }}</b>', {}, []);
  assert.equal(el.textContent, '4');
});

test('event binding wires a handler that mutates a signal', () => {
  const count = signal(0);
  const inc = () => count.set((c) => c + 1);
  const el = render('<button on:click={inc}>{{ count() }}</button>', { count, inc }, ['count', 'inc']);
  host().appendChild(el);
  assert.equal(el.textContent, '0');
  (el as HTMLButtonElement).click();
  (el as HTMLButtonElement).click();
  assert.equal(el.textContent, '2');
});

test('inline arrow handler with member access rewrites only bindings', () => {
  const count = signal(0);
  const el = render('<button on:click={() => count.set(n => n + 1)}>x</button>', { count }, ['count']);
  host().appendChild(el);
  (el as HTMLButtonElement).click();
  assert.equal(count(), 1);
});

test('dynamic attribute binds reactively (boolean + value)', () => {
  const disabled = signal(true);
  const cls = signal('a');
  const el = render('<input disabled={disabled()} class={cls()}>', { disabled, cls }, ['disabled', 'cls']);
  assert.equal(el.hasAttribute('disabled'), true);
  assert.equal(el.getAttribute('class'), 'a');
  disabled.set(false);
  cls.set('b');
  assert.equal(el.hasAttribute('disabled'), false);
  assert.equal(el.getAttribute('class'), 'b');
});

test('property binding (.value)', () => {
  const text = signal('one');
  const el = render('<input .value={text()}>', { text }, ['text']) as HTMLInputElement;
  assert.equal(el.value, 'one');
  text.set('two');
  assert.equal(el.value, 'two');
});

test('class: binding toggles', () => {
  const done = signal(false);
  const el = render('<li class:done={done()}>x</li>', { done }, ['done']);
  assert.equal(el.className, '');
  done.set(true);
  assert.equal(el.className, 'done');
});

test('event modifier preventDefault wraps the handler', () => {
  let ran = false;
  const onSubmit = () => (ran = true);
  const el = render('<button on:click|preventDefault={onSubmit}>go</button>', { onSubmit }, ['onSubmit']);
  host().appendChild(el);
  const ev = new MouseEvent('click', { cancelable: true });
  el.dispatchEvent(ev);
  assert.ok(ran, 'handler ran');
  assert.ok(ev.defaultPrevented, 'default prevented by modifier');
});

test('globals are not rewritten to ctx (Math stays Math)', () => {
  const n = signal(3);
  const el = render('<b>{{ Math.max(n(), 5) }}</b>', { n }, ['n']);
  assert.equal(el.textContent, '5');
  n.set(9);
  assert.equal(el.textContent, '9');
});

test('multi-root template renders a fragment', () => {
  const a = signal('A');
  const b = signal('B');
  const frag = render('<h1>{{ a() }}</h1><p>{{ b() }}</p>', { a, b }, ['a', 'b']);
  const h = host();
  h.appendChild(frag);
  assert.equal(h.querySelector('h1')!.textContent, 'A');
  assert.equal(h.querySelector('p')!.textContent, 'B');
  a.set('A2');
  assert.equal(h.querySelector('h1')!.textContent, 'A2');
});

/* ──────────── M4: control flow ──────────── */

test('@if / @else toggles branches', () => {
  const open = signal(true);
  const el = render('<div>@if (open()) { <p>yes</p> } @else { <p>no</p> }</div>', { open }, ['open']);
  host().appendChild(el);
  assert.equal(el.querySelector('p')!.textContent, 'yes');
  open.set(false);
  assert.equal(el.querySelector('p')!.textContent, 'no');
  open.set(true);
  assert.equal(el.querySelector('p')!.textContent, 'yes');
});

test('@if branch is not remounted while condition stays true', () => {
  const open = signal(true);
  const tick = signal(0);
  const el = render('<div>@if (open()) { <p>{{ tick() }}</p> }</div>', { open, tick }, ['open', 'tick']);
  host().appendChild(el);
  const p = el.querySelector('p')!;
  tick.set(1);
  assert.is(el.querySelector('p'), p, 'same <p> node — branch not remounted');
  assert.equal(p.textContent, '1');
});

test('@if (expr; as alias) exposes the value', () => {
  const user = signal<{ name: string } | null>({ name: 'Ada' });
  const el = render(
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
  const items = signal([{ id: 1, t: 'a' }, { id: 2, t: 'b' }]);
  const el = render(
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
  const items = signal([{ id: 1, t: 'a' }]);
  const el = render(
    '<ul>@for (it of items(); track it.id) { <li>{{ it.t }}</li> }</ul>',
    { items },
    ['items']
  );
  host().appendChild(el);
  const li = el.querySelector('li')!;
  items.set([{ id: 1, t: 'A' }]); // same key, new object
  assert.is(el.querySelector('li'), li, 'row node reused');
  assert.equal(li.textContent, 'A', 'reused row reflects new item value');
});

test('@for @empty shows when the list is empty', () => {
  const items = signal<number[]>([]);
  const el = render(
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
  const status = signal('a');
  const el = render(
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

test('@let defines a reactive local', () => {
  const n = signal(3);
  const el = render('<div>@let dbl = n() * 2;<b>{{ dbl }}</b></div>', { n }, ['n']);
  host().appendChild(el);
  assert.equal(el.querySelector('b')!.textContent, '6');
  n.set(5);
  assert.equal(el.querySelector('b')!.textContent, '10');
});

test('module mode emits a real ES module', () => {
  const { code } = compileTemplate('<button on:click={inc}>clicks: {{ count() }}</button>', {
    mode: 'module',
    scope: ['count', 'inc'],
  });
  assert.ok(code.includes("from \"@weave/runtime/dom\""), 'imports from runtime');
  assert.ok(code.includes('export default function render(ctx)'), 'exports render');
  assert.ok(code.includes('bindText('), 'binds text');
  assert.ok(code.includes('listen('), 'wires event');
  assert.ok(code.includes('ctx.count') && code.includes('ctx.inc'), 'scope rewritten to ctx');
});
