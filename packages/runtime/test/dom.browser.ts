import { test, assert } from '../../../tools/harness.js';
import { signal } from '@weave/runtime';
import {
  template, clone, child, anchor, insert,
  setText, bindText, setAttr, bindAttr, bindProp, bindClass,
  listen, setRef, mount,
} from '@weave/runtime/dom';

function host(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

test('template + clone + child resolve real DOM', () => {
  const tpl = template('<button>clicks: <!----></button>');
  const root = clone(tpl) as HTMLButtonElement;
  assert.equal(root.tagName, 'BUTTON');
  const a = child(root, 1); // the comment anchor
  assert.equal(a.nodeType, 8);
});

test('bindText updates the SAME text node in place (surgical)', () => {
  // Simulates compiled: <span>n: {count}</span>
  const tpl = template('<span>n: <!----></span>');
  const root = clone(tpl);
  const count = signal(0);
  bindText(child(root, 1) as Comment, () => count());
  mount(root, host());

  assert.equal(root.textContent, 'n: 0');
  // capture the dynamic text node; it must be reused, not recreated, on update
  const dynText = root.childNodes[1] as Text;
  assert.equal(dynText.data, '0');
  count.set(42);
  assert.equal(root.textContent, 'n: 42');
  assert.is(root.childNodes[1], dynText, 'same Text node reused');
  assert.equal(dynText.data, '42');
});

test('setText is static (one-shot, no reactivity)', () => {
  const tpl = template('<p><!----></p>');
  const root = clone(tpl);
  const x = signal('hello');
  setText(child(root, 0) as Comment, x()); // read once, not bound
  assert.equal(root.textContent, 'hello');
  x.set('world');
  assert.equal(root.textContent, 'hello', 'static text does not react');
});

test('bindAttr toggles boolean and sets value attributes', () => {
  const tpl = template('<input>');
  const root = clone(tpl) as HTMLInputElement;
  const disabled = signal(true);
  const cls = signal('a');
  bindAttr(root, 'disabled', () => disabled());
  bindAttr(root, 'class', () => cls());
  assert.equal(root.hasAttribute('disabled'), true);
  assert.equal(root.getAttribute('class'), 'a');
  disabled.set(false);
  cls.set('b');
  assert.equal(root.hasAttribute('disabled'), false);
  assert.equal(root.getAttribute('class'), 'b');
});

test('bindProp drives DOM properties (.value)', () => {
  const tpl = template('<input>');
  const root = clone(tpl) as HTMLInputElement;
  const text = signal('one');
  bindProp(root, 'value', () => text());
  assert.equal(root.value, 'one');
  text.set('two');
  assert.equal(root.value, 'two');
});

test('bindClass toggles a single class', () => {
  const tpl = template('<li>x</li>');
  const root = clone(tpl);
  const done = signal(false);
  bindClass(root, 'done', () => done());
  assert.equal(root.className, '');
  done.set(true);
  assert.equal(root.className, 'done');
  done.set(false);
  assert.equal(root.className, '');
});

test('listen wires events that mutate signals', () => {
  const tpl = template('<button>x</button>');
  const root = clone(tpl) as HTMLButtonElement;
  const count = signal(0);
  listen(root, 'click', () => count.set((c) => c + 1));
  mount(root, host());
  root.click();
  root.click();
  assert.equal(count(), 2);
});

test('setRef assigns to a signal and to a callback', () => {
  const tpl = template('<div>x</div>');
  const root = clone(tpl);
  const elSig = signal<Element | null>(null);
  setRef(elSig, root);
  assert.is(elSig(), root);

  let captured: Element | null = null;
  setRef((el) => (captured = el), root);
  assert.is(captured, root);
});

test('two independent bindings update independently (fine-grained)', () => {
  // <p data-x={a}>{a}-{b}</p> compiled shape
  const tpl = template('<p>x</p>');
  const root = clone(tpl);
  // rebuild children: anchorA, "-", anchorB
  root.textContent = '';
  const aAnchor = anchor(root);
  insert(root, document.createTextNode('-'));
  const bAnchor = anchor(root);
  const a = signal('A');
  const b = signal('B');
  bindText(aAnchor, () => a());
  bindText(bAnchor, () => b());
  bindAttr(root, 'data-x', () => a());
  mount(root, host());

  assert.equal(root.textContent, 'A-B');
  assert.equal(root.getAttribute('data-x'), 'A');
  b.set('B2');
  assert.equal(root.textContent, 'A-B2'); // only b's text node changed
  assert.equal(root.getAttribute('data-x'), 'A'); // a's attr untouched
  a.set('A2');
  assert.equal(root.textContent, 'A2-B2');
  assert.equal(root.getAttribute('data-x'), 'A2');
});
