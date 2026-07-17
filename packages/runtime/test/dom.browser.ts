import { test, assert } from '../../../tools/harness.js';
import { signal } from '@weave-framework/runtime';
import type { Signal } from '@weave-framework/runtime';
import {
  template, clone, child, anchor, insert,
  setText, bindText, setAttr, bindAttr, bindProp, bindClass,
  listen, setRef, mount,
} from '@weave-framework/runtime/dom';

function host(): HTMLElement {
  const el: HTMLDivElement = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

test('template + clone + child resolve real DOM', () => {
  const tpl: HTMLTemplateElement = template('<button>clicks: <!----></button>');
  const root: HTMLButtonElement = clone(tpl) as HTMLButtonElement;
  assert.equal(root.tagName, 'BUTTON');
  const a: Node = child(root, 1); // the comment anchor
  assert.equal(a.nodeType, 8);
});

test('bindText updates the SAME text node in place (surgical)', () => {
  // Simulates compiled: <span>n: {count}</span>
  const tpl: HTMLTemplateElement = template('<span>n: <!----></span>');
  const root: Element = clone(tpl);
  const count: Signal<number> = signal(0);
  bindText(child(root, 1) as Comment, () => count());
  mount(root, host());

  assert.equal(root.textContent, 'n: 0');
  // capture the dynamic text node; it must be reused, not recreated, on update
  const dynText: Text = root.childNodes[1] as Text;
  assert.equal(dynText.data, '0');
  count.set(42);
  assert.equal(root.textContent, 'n: 42');
  assert.is(root.childNodes[1], dynText, 'same Text node reused');
  assert.equal(dynText.data, '42');
});

test('setText is static (one-shot, no reactivity)', () => {
  const tpl: HTMLTemplateElement = template('<p><!----></p>');
  const root: Element = clone(tpl);
  const x: Signal<string> = signal('hello');
  setText(child(root, 0) as Comment, x()); // read once, not bound
  assert.equal(root.textContent, 'hello');
  x.set('world');
  assert.equal(root.textContent, 'hello', 'static text does not react');
});

// `setAttr` takes an already-evaluated value, so a "does not react" assertion here would be theatre: the
// caller reads the signal before setAttr is entered, and no implementation could subscribe. What IS worth
// pinning is that the static door applies the same boolean/null contract as the reactive one (`applyAttr`).
test('setAttr applies the boolean/null attribute contract', () => {
  const tpl: HTMLTemplateElement = template('<input>');
  const root: HTMLInputElement = clone(tpl) as HTMLInputElement;
  setAttr(root, 'class', 'a');
  setAttr(root, 'disabled', true);
  setAttr(root, 'placeholder', null);
  setAttr(root, 'readonly', false);
  setAttr(root, 'size', 4);
  assert.equal(root.getAttribute('class'), 'a');
  assert.equal(root.getAttribute('disabled'), '', 'true → present and empty');
  assert.equal(root.hasAttribute('placeholder'), false, 'null → absent');
  assert.equal(root.hasAttribute('readonly'), false, 'false → absent');
  assert.equal(root.getAttribute('size'), '4', 'non-string → stringified');
});

test('bindAttr toggles boolean and sets value attributes', () => {
  const tpl: HTMLTemplateElement = template('<input>');
  const root: HTMLInputElement = clone(tpl) as HTMLInputElement;
  const disabled: Signal<boolean> = signal(true);
  const cls: Signal<string> = signal('a');
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
  const tpl: HTMLTemplateElement = template('<input>');
  const root: HTMLInputElement = clone(tpl) as HTMLInputElement;
  const text: Signal<string> = signal('one');
  bindProp(root, 'value', () => text());
  assert.equal(root.value, 'one');
  text.set('two');
  assert.equal(root.value, 'two');
});

test('bindClass toggles a single class', () => {
  const tpl: HTMLTemplateElement = template('<li>x</li>');
  const root: Element = clone(tpl);
  const done: Signal<boolean> = signal(false);
  bindClass(root, 'done', () => done());
  assert.equal(root.className, '');
  done.set(true);
  assert.equal(root.className, 'done');
  done.set(false);
  assert.equal(root.className, '');
});

test('listen wires events that mutate signals', () => {
  const tpl: HTMLTemplateElement = template('<button>x</button>');
  const root: HTMLButtonElement = clone(tpl) as HTMLButtonElement;
  const count: Signal<number> = signal(0);
  listen(root, 'click', () => count.set((c) => c + 1));
  mount(root, host());
  root.click();
  root.click();
  assert.equal(count(), 2);
});

test('setRef assigns to a signal and to a callback', () => {
  const tpl: HTMLTemplateElement = template('<div>x</div>');
  const root: Element = clone(tpl);
  const elSig: Signal<Element | null> = signal<Element | null>(null);
  setRef(elSig, root);
  assert.is(elSig(), root);

  let captured: Element | null = null;
  setRef((el) => (captured = el), root);
  assert.is(captured, root);
});

test('two independent bindings update independently (fine-grained)', () => {
  // <p data-x={{a}}>{{a}}-{{b}}</p> compiled shape
  const tpl: HTMLTemplateElement = template('<p>x</p>');
  const root: Element = clone(tpl);
  // rebuild children: anchorA, "-", anchorB
  root.textContent = '';
  const aAnchor: Comment = anchor(root);
  insert(root, document.createTextNode('-'));
  const bAnchor: Comment = anchor(root);
  const a: Signal<string> = signal('A');
  const b: Signal<string> = signal('B');
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
