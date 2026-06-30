import { test, assert } from '../../../tools/harness.js';
import { signal, computed, effect, root } from '@weave-framework/runtime';
import type { Signal } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate } from '@weave-framework/compiler';

const rt: typeof dom & {
  signal: typeof signal;
  computed: typeof computed;
  effect: typeof effect;
  root: typeof root;
} = { ...dom, signal, computed, effect, root };

function render(html: string, ctx: Record<string, unknown> = {}, scope: string[] = []): Element {
  const { code } = compileTemplate(html, { mode: 'function', scope });
  const fn: (c: unknown, r: unknown, k: unknown) => Element = new Function('ctx', 'rt', '_c', code) as (
    c: unknown,
    r: unknown,
    k: unknown
  ) => Element;
  return fn(ctx, rt, {});
}
function host(): HTMLElement {
  const el: HTMLDivElement = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

test('@key compiles to a keyBlock call', () => {
  const { code } = compileTemplate(`<div>@key (id()) { <span>x</span> }</div>`, { mode: 'module', scope: ['id'] });
  assert.ok(code.includes('keyBlock('), code);
});

test('@key re-creates the content when the key changes', () => {
  const id: Signal<number> = signal(1);
  const el: Element = render(`<div>@key (id()) { <span>x</span> }</div>`, { id }, ['id']);
  host().appendChild(el);
  const first: HTMLSpanElement | null = el.querySelector('span');
  assert.ok(first, 'rendered');

  id.set(2);
  const second: HTMLSpanElement | null = el.querySelector('span');
  assert.ok(second && first !== second, 'span node recreated on key change');
});

test('@key keeps the content (same node) when the key is unchanged', () => {
  const id: Signal<number> = signal(1);
  const other: Signal<number> = signal(0);
  const el: Element = render(`<div>@key (id()) { <span>{{ other() }}</span> }</div>`, { id, other }, ['id', 'other']);
  host().appendChild(el);
  const first: HTMLSpanElement | null = el.querySelector('span');

  other.set(5); // unrelated change — must NOT recreate
  assert.equal(el.querySelector('span'), first, 'same node — not recreated');
  assert.ok(el.textContent?.includes('5'), 'inner binding stays reactive');
});

test('@key resets stateful DOM on key change', () => {
  const id: Signal<string> = signal('a');
  const el: Element = render(`<div>@key (id()) { <input/> }</div>`, { id }, ['id']);
  host().appendChild(el);
  const input1: HTMLInputElement = el.querySelector('input') as HTMLInputElement;
  input1.value = 'typed';

  id.set('b');
  const input2: HTMLInputElement = el.querySelector('input') as HTMLInputElement;
  assert.ok(input2 !== input1, 'new input element');
  assert.equal(input2.value, '', 'fresh element has no carried-over state');
});
