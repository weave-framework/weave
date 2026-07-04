import { test, assert } from '../../../tools/harness.js';
import { signal, effect, createOwner, runInOwner, disposeOwner } from '@weave-framework/runtime';
import type { Signal, Owner } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import type { Component } from '@weave-framework/runtime/dom';

function host(): HTMLElement {
  const el: HTMLDivElement = document.createElement('div');
  document.body.appendChild(el);
  return el;
}
const span = (t: string): Component => (): HTMLSpanElement => {
  const s: HTMLSpanElement = document.createElement('span');
  s.textContent = t;
  return s;
};

test('Dynamic renders the current component and swaps reactively when `is` changes', () => {
  const A: Component = span('A');
  const B: Component = span('B');
  const which: Signal<Component> = signal<Component>(A);
  const el: HTMLElement = host();
  const o: Owner = createOwner();
  runInOwner(o, () =>
    el.appendChild(
      dom.Dynamic(
        {
          get is(): Component {
            return which();
          },
        },
        {}
      )
    )
  );
  assert.equal(el.textContent, 'A', 'initial component rendered');
  which.set(() => B);
  assert.equal(el.textContent, 'B', 'swapped to B reactively');
  disposeOwner(o);
});

test('Dynamic renders nothing for a non-function `is`, and forwards other props', () => {
  let seen: string | undefined;
  const P: Component = (props = {}): HTMLSpanElement => {
    seen = (props as { label?: string }).label;
    const s: HTMLSpanElement = document.createElement('span');
    s.textContent = seen ?? '';
    return s;
  };
  const which: Signal<Component | null> = signal<Component | null>(null);
  const el: HTMLElement = host();
  const o: Owner = createOwner();
  runInOwner(o, () =>
    el.appendChild(
      dom.Dynamic(
        {
          get is(): Component | null {
            return which();
          },
          label: 'hi',
        },
        {}
      )
    )
  );
  assert.equal(el.textContent, '', 'a null `is` renders nothing');
  which.set(() => P);
  assert.equal(el.textContent, 'hi', 'renders once `is` is a component');
  assert.equal(seen, 'hi', 'the forwarded prop reached the child');
  disposeOwner(o);
});

test('KeepAlive preserves a component instance (state) across swaps', () => {
  const Counter: Component = (): HTMLButtonElement => {
    const n: Signal<number> = signal(0);
    const btn: HTMLButtonElement = document.createElement('button');
    effect(() => {
      btn.textContent = 'n=' + n();
    });
    btn.addEventListener('click', () => n.set(n() + 1));
    return btn;
  };
  const B: Component = span('B');
  const which: Signal<Component> = signal<Component>(Counter);
  const el: HTMLElement = host();
  const o: Owner = createOwner();
  runInOwner(o, () =>
    el.appendChild(
      dom.KeepAlive(
        {
          get is(): Component {
            return which();
          },
        },
        {}
      )
    )
  );
  const btn: HTMLButtonElement = el.querySelector('button')!;
  btn.click();
  btn.click();
  assert.equal(el.textContent, 'n=2', 'counter state built up');
  which.set(() => B);
  assert.equal(el.textContent, 'B', 'swapped away to B');
  which.set(() => Counter);
  assert.equal(el.textContent, 'n=2', 'the SAME Counter instance returned with its state intact');
  disposeOwner(o);
});
