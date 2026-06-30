import { test, assert } from '../../../tools/harness.js';
import {
  signal,
  computed,
  effect,
  root,
  createOwner,
  runInOwner,
  disposeOwner,
  createContext,
  provide,
  inject,
} from '@weave-framework/runtime';
import type { Signal, Owner, Context } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate } from '@weave-framework/compiler';

const rt: typeof dom & {
  signal: typeof signal;
  computed: typeof computed;
  effect: typeof effect;
  root: typeof root;
} = { ...dom, signal, computed, effect, root };

function target(id: string): HTMLElement {
  const el: HTMLDivElement = document.createElement('div');
  el.id = id;
  document.body.appendChild(el);
  return el;
}

test('Portal renders the default slot into document.body by default; placeholder stays put', () => {
  const owner: Owner = createOwner();
  const ph: Node = runInOwner(owner, () =>
    dom.Portal({}, {
      default: () => {
        const d: HTMLDivElement = document.createElement('div');
        d.id = 'p-default';
        return d;
      },
    })
  );
  assert.equal(ph.nodeType, Node.COMMENT_NODE, 'returns a comment placeholder for the logical slot');
  assert.ok(document.getElementById('p-default'), 'content landed somewhere');
  assert.equal(document.getElementById('p-default')!.parentElement, document.body, 'defaults to <body>');
  disposeOwner(owner);
});

test('Portal targets a CSS selector and an Element', () => {
  const t1: HTMLElement = target('tgt-sel');
  const t2: HTMLElement = target('tgt-el');
  const o1: Owner = createOwner();
  const o2: Owner = createOwner();
  runInOwner(o1, () =>
    dom.Portal({ to: '#tgt-sel' }, { default: () => { const d: HTMLSpanElement = document.createElement('span'); d.id = 'in-sel'; return d; } })
  );
  runInOwner(o2, () =>
    dom.Portal({ to: t2 }, { default: () => { const d: HTMLSpanElement = document.createElement('span'); d.id = 'in-el'; return d; } })
  );
  assert.equal(document.getElementById('in-sel')!.parentElement, t1, 'selector target honored');
  assert.equal(document.getElementById('in-el')!.parentElement, t2, 'element target honored');
  disposeOwner(o1);
  disposeOwner(o2);
  t1.remove();
  t2.remove();
});

test('a missing selector falls back to document.body', () => {
  const owner: Owner = createOwner();
  runInOwner(owner, () =>
    dom.Portal({ to: '#does-not-exist' }, { default: () => { const d: HTMLElement = document.createElement('i'); d.id = 'fb'; return d; } })
  );
  assert.equal(document.getElementById('fb')!.parentElement, document.body);
  disposeOwner(owner);
});

test('Portal content is removed from the target on unmount', () => {
  const t: HTMLElement = target('tgt-rm');
  const owner: Owner = createOwner();
  runInOwner(owner, () =>
    dom.Portal({ to: t }, { default: () => { const d: HTMLParagraphElement = document.createElement('p'); d.id = 'rm'; return d; } })
  );
  assert.ok(document.getElementById('rm'), 'present while mounted');
  disposeOwner(owner);
  assert.equal(document.getElementById('rm'), null, 'gone after unmount');
  t.remove();
});

test('Portal content stays reactive (effects tie to the surrounding owner)', () => {
  const t: HTMLElement = target('tgt-reactive');
  const label: Signal<string> = signal('a');
  const owner: Owner = createOwner();
  runInOwner(owner, () =>
    dom.Portal({ to: t }, {
      default: () => {
        const span: HTMLSpanElement = document.createElement('span');
        span.id = 'rx';
        effect(() => {
          span.textContent = label();
        });
        return span;
      },
    })
  );
  assert.equal(document.getElementById('rx')!.textContent, 'a');
  label.set('b');
  assert.equal(document.getElementById('rx')!.textContent, 'b', 'reactive update reaches the teleported content');
  disposeOwner(owner);
  t.remove();
});

test('context flows into portal content (logical tree, not DOM tree)', () => {
  const Theme: Context<string> = createContext<string>('light');
  const t: HTMLElement = target('tgt-ctx');
  let seen: string = '';
  const owner: Owner = createOwner();
  runInOwner(owner, () => {
    provide(Theme, 'dark');
    dom.Portal({ to: t }, {
      default: () => {
        seen = inject(Theme);
        return document.createElement('div');
      },
    });
  });
  assert.equal(seen, 'dark', 'inject resolves against the logical owner tree, despite the DOM move');
  disposeOwner(owner);
  t.remove();
});

test('an @if INSIDE a Portal renders into the target (regression: relocated anchor)', () => {
  // Bug #9: ifBlock/eachBlock used to cache `anchor.parentNode` at construction, but a
  // Portal moves the anchor to its target afterwards — so inserts went to the (detached)
  // original parent and nothing showed. The blocks now read the parent at insert time.
  const t: HTMLElement = target('tgt-cf-if');
  const show: Signal<boolean> = signal(false);
  const { code } = compileTemplate('<div><Portal to="#tgt-cf-if">@if (show()) { <b class="cf">hi</b> }</Portal></div>', {
    mode: 'function',
    scope: ['show'],
  });
  const fn: (c: unknown, r: unknown, k: unknown) => Element = new Function('ctx', 'rt', '_c', code) as (c: unknown, r: unknown, k: unknown) => Element;
  const owner: Owner = createOwner();
  const elRoot: Element = runInOwner(owner, () => fn({ show }, rt, { Portal: dom.Portal }));
  document.body.appendChild(elRoot);

  assert.equal(t.querySelector('.cf'), null, 'nothing while the @if is false');
  show.set(true);
  assert.equal(t.querySelector('.cf')?.textContent, 'hi', 'inserts into the portal target, not the relocated original parent');
  show.set(false);
  assert.equal(t.querySelector('.cf'), null, 'removed again');

  disposeOwner(owner);
  elRoot.remove();
  t.remove();
});

test('a @for INSIDE a Portal renders + reconciles rows in the target', () => {
  const t: HTMLElement = target('tgt-cf-for');
  const items: Signal<number[]> = signal<number[]>([]);
  const { code } = compileTemplate(
    '<div><Portal to="#tgt-cf-for">@for (n of items(); track n) { <i class="row">{{ n }}</i> }</Portal></div>',
    { mode: 'function', scope: ['items'] }
  );
  const fn: (c: unknown, r: unknown, k: unknown) => Element = new Function('ctx', 'rt', '_c', code) as (c: unknown, r: unknown, k: unknown) => Element;
  const owner: Owner = createOwner();
  const elRoot: Element = runInOwner(owner, () => fn({ items }, rt, { Portal: dom.Portal }));
  document.body.appendChild(elRoot);

  assert.equal(t.querySelectorAll('.row').length, 0, 'starts empty');
  items.set([1, 2, 3]);
  assert.equal([...t.querySelectorAll('.row')].map((e) => e.textContent).join(''), '123', 'rows land in the target');
  items.set([1, 3]);
  assert.equal(t.querySelectorAll('.row').length, 2, 'reconcile works in the relocated parent');

  disposeOwner(owner);
  elRoot.remove();
  t.remove();
});

test('Portal inside a compiled @if: toggling adds/removes the teleported content', () => {
  const t: HTMLElement = target('tgt-if');
  const show: Signal<boolean> = signal(true);
  const { code } = compileTemplate('<div>@if (show()) { <Portal to="#tgt-if"><b class="m">hi</b></Portal> }</div>', {
    mode: 'function',
    scope: ['show'],
  });
  const fn: (c: unknown, r: unknown, k: unknown) => Element = new Function('ctx', 'rt', '_c', code) as (c: unknown, r: unknown, k: unknown) => Element;
  const owner: Owner = createOwner();
  const elRoot: Element = runInOwner(owner, () => fn({ show }, rt, { Portal: dom.Portal }));
  document.body.appendChild(elRoot);

  assert.equal(t.querySelector('.m')?.textContent, 'hi', 'teleported into the target while shown');
  show.set(false);
  assert.equal(t.querySelector('.m'), null, 'removed from the target when the @if branch unmounts');
  show.set(true);
  assert.equal(t.querySelector('.m')?.textContent, 'hi', 're-teleported when shown again');

  disposeOwner(owner);
  elRoot.remove();
  t.remove();
});
