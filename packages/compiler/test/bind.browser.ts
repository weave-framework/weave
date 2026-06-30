import { test, assert } from '../../../tools/harness.js';
import { signal, computed, effect, root, tick, type Signal } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate } from '@weave-framework/compiler';

// The runtime object the compiled (function-mode) code references as `rt`.
const rt: typeof dom & {
  signal: typeof signal;
  computed: typeof computed;
  effect: typeof effect;
  root: typeof root;
} = { ...dom, signal, computed, effect, root };

function render(html: string, ctx: Record<string, unknown>, scope: string[]): Element {
  const { code } = compileTemplate(html, { mode: 'function', scope });
  const fn: (ctx: unknown, rt: unknown, _c: unknown) => Element = new Function('ctx', 'rt', '_c', code) as (ctx: unknown, rt: unknown, _c: unknown) => Element;
  const el: Element = fn(ctx, rt, {});
  document.body.appendChild(el);
  return el;
}

/** Fire a native input/change event the way a real user edit would. */
function fire(el: Element, type: 'input' | 'change'): void {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

test('bind:value text — two-way (signal ⇄ input)', () => {
  const name: Signal<string> = signal('alpha');
  const el: HTMLInputElement = render('<input bind:value={{name}} />', { name }, ['name']) as HTMLInputElement;
  assert.equal(el.value, 'alpha', 'signal seeds the input');

  name.set('beta');
  assert.equal(el.value, 'beta', 'signal → input');

  el.value = 'gamma';
  fire(el, 'input');
  assert.equal(name(), 'gamma', 'input → signal');
});

test('bind:value number — reads valueAsNumber', () => {
  const n: Signal<number> = signal(5);
  const el: HTMLInputElement = render('<input type="number" bind:value={{n}} />', { n }, ['n']) as HTMLInputElement;
  assert.equal(el.value, '5');

  n.set(10);
  assert.equal(el.value, '10', 'signal → input');

  el.value = '42';
  fire(el, 'input');
  assert.equal(n(), 42, 'input → signal as a number, not a string');
});

test('bind:checked — boolean checkbox', () => {
  const on: Signal<boolean> = signal(true);
  const el: HTMLInputElement = render('<input type="checkbox" bind:checked={{on}} />', { on }, ['on']) as HTMLInputElement;
  assert.equal(el.checked, true, 'signal seeds checked');

  on.set(false);
  assert.equal(el.checked, false, 'signal → checkbox');

  el.checked = true;
  fire(el, 'change');
  assert.equal(on(), true, 'checkbox → signal');
});

test('bind:group — radio selects by value', () => {
  const pick: Signal<string> = signal('a');
  const wrap: Element = render(
    '<div><input type="radio" name="g" value="a" bind:group={{pick}} />' +
      '<input type="radio" name="g" value="b" bind:group={{pick}} /></div>',
    { pick },
    ['pick']
  );
  const [ra, rb] = [...wrap.querySelectorAll('input')] as HTMLInputElement[];
  assert.equal(ra.checked, true, 'a is selected initially');
  assert.equal(rb.checked, false);

  pick.set('b');
  assert.equal(rb.checked, true, 'signal → radio group');
  assert.equal(ra.checked, false);

  ra.checked = true;
  fire(ra, 'change');
  assert.equal(pick(), 'a', 'radio → signal (selected value)');
});

test('bind:value select — single', () => {
  const sel: Signal<string> = signal('y');
  const el: HTMLSelectElement = render(
    '<select bind:value={{sel}}><option value="x">X</option><option value="y">Y</option></select>',
    { sel },
    ['sel']
  ) as HTMLSelectElement;
  assert.equal(el.value, 'y', 'signal seeds the selection');

  sel.set('x');
  assert.equal(el.value, 'x', 'signal → select');

  el.value = 'y';
  fire(el, 'change');
  assert.equal(sel(), 'y', 'select → signal');
});

test('bind:value select — @for options: the signal wins over the browser auto-select', async () => {
  // Regression: a `@for`-generated <option> list is inserted AFTER the binding
  // runs, and the browser auto-selects the first physically-inserted option of a
  // freshly-populated select. The bound signal (here the LAST option) must still win.
  const opts: string[] = ['todo', 'doing', 'done'];
  const sel: Signal<string> = signal('done');
  const el: HTMLSelectElement = render(
    '<select bind:value={{sel}}>@for (o of opts; track o) {<option value={{o}}>{{ o }}</option>}</select>',
    { sel, opts },
    ['sel', 'opts']
  ) as HTMLSelectElement;

  await tick(); // let the post-render re-assert run
  assert.equal(el.value, 'done', 'signal value survives @for option insertion');
  assert.equal(el.selectedIndex, 2);

  sel.set('todo');
  assert.equal(el.value, 'todo', 'signal → select once options are present (synchronous)');

  el.value = 'doing';
  fire(el, 'change');
  assert.equal(sel(), 'doing', 'select → signal');
});

test('bind:value text is IME-safe — no overwrite mid-composition', () => {
  const name: Signal<string> = signal('');
  const el: HTMLInputElement = render('<input bind:value={{name}} />', { name }, ['name']) as HTMLInputElement;

  el.dispatchEvent(new Event('compositionstart', { bubbles: true }));
  // a competing signal write must NOT clobber the half-composed text
  el.value = 'にほ';
  name.set('x'); // would normally write 'x' back to the DOM
  assert.equal(el.value, 'にほ', 'DOM left alone during composition');

  el.dispatchEvent(new Event('compositionend', { bubbles: true }));
  assert.equal(name(), 'にほ', 'composition commit writes through to the signal');
});
