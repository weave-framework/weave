import { test, assert } from '../../../tools/harness.js';
import { effect } from '@weave/runtime';
import { defineComponent, defineCustomElement } from '@weave/runtime/dom';

/** A tiny component that greets `ctx.label` (reactive prop). */
const Widget = defineComponent((ctx) => {
  const el = document.createElement('p');
  effect(() => {
    el.textContent = `Hello ${String((ctx as { label?: unknown }).label ?? '')}`;
  });
  return el;
});

function host(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

test('defineCustomElement mounts the component, seeding a prop from an attribute', () => {
  defineCustomElement('w-greet-a', Widget, { props: ['label'] });
  const h = host();
  h.innerHTML = '<w-greet-a label="Ada"></w-greet-a>';
  assert.ok(h.querySelector('p')?.textContent === 'Hello Ada', h.innerHTML);
});

test('an attribute change updates the reactive prop', () => {
  defineCustomElement('w-greet-b', Widget, { props: ['label'] });
  const h = host();
  const el = document.createElement('w-greet-b');
  el.setAttribute('label', 'Bob');
  h.appendChild(el);
  assert.equal(el.querySelector('p')?.textContent, 'Hello Bob');

  el.setAttribute('label', 'Cy');
  assert.equal(el.querySelector('p')?.textContent, 'Hello Cy', 'reflected the attribute change');
});

test('a JS property set updates the reactive prop', () => {
  defineCustomElement('w-greet-c', Widget, { props: ['label'] });
  const h = host();
  const el = document.createElement('w-greet-c') as HTMLElement & { label: string };
  h.appendChild(el);
  el.label = 'Dot';
  assert.equal(el.querySelector('p')?.textContent, 'Hello Dot');
});

test('a kebab-case attribute maps to a camelCase prop', () => {
  const NameWidget = defineComponent((ctx) => {
    const el = document.createElement('span');
    effect(() => {
      el.textContent = String((ctx as { userName?: unknown }).userName ?? '');
    });
    return el;
  });
  defineCustomElement('w-user', NameWidget, { props: ['userName'] });
  const h = host();
  h.innerHTML = '<w-user user-name="ada"></w-user>';
  assert.equal(h.querySelector('span')?.textContent, 'ada');
});

test('disconnecting unmounts (disposes) the component', () => {
  defineCustomElement('w-greet-d', Widget, { props: ['label'] });
  const h = host();
  const el = document.createElement('w-greet-d');
  el.setAttribute('label', 'X');
  h.appendChild(el);
  assert.ok(el.querySelector('p'), 'mounted');

  el.remove(); // fires disconnectedCallback synchronously
  assert.equal(el.querySelector('p'), null, 'component DOM removed on disconnect');
});

test('re-defining the same tag is a no-op (no throw)', () => {
  defineCustomElement('w-greet-e', Widget, { props: ['label'] });
  defineCustomElement('w-greet-e', Widget, { props: ['label'] }); // must not throw
  const h = host();
  h.innerHTML = '<w-greet-e label="ok"></w-greet-e>';
  assert.equal(h.querySelector('p')?.textContent, 'Hello ok');
});
