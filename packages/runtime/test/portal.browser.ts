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
} from '@weave/runtime';
import type { Signal, Owner, Context } from '@weave/runtime';
import * as dom from '@weave/runtime/dom';
import { compileTemplate } from '@weave/compiler';

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
