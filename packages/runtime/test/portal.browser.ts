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
import * as dom from '@weave/runtime/dom';
import { compileTemplate } from '@weave/compiler';

const rt = { ...dom, signal, computed, effect, root };

function target(id: string): HTMLElement {
  const el = document.createElement('div');
  el.id = id;
  document.body.appendChild(el);
  return el;
}

test('Portal renders the default slot into document.body by default; placeholder stays put', () => {
  const owner = createOwner();
  const ph = runInOwner(owner, () =>
    dom.Portal({}, {
      default: () => {
        const d = document.createElement('div');
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
  const t1 = target('tgt-sel');
  const t2 = target('tgt-el');
  const o1 = createOwner();
  const o2 = createOwner();
  runInOwner(o1, () =>
    dom.Portal({ to: '#tgt-sel' }, { default: () => { const d = document.createElement('span'); d.id = 'in-sel'; return d; } })
  );
  runInOwner(o2, () =>
    dom.Portal({ to: t2 }, { default: () => { const d = document.createElement('span'); d.id = 'in-el'; return d; } })
  );
  assert.equal(document.getElementById('in-sel')!.parentElement, t1, 'selector target honored');
  assert.equal(document.getElementById('in-el')!.parentElement, t2, 'element target honored');
  disposeOwner(o1);
  disposeOwner(o2);
  t1.remove();
  t2.remove();
});

test('a missing selector falls back to document.body', () => {
  const owner = createOwner();
  runInOwner(owner, () =>
    dom.Portal({ to: '#does-not-exist' }, { default: () => { const d = document.createElement('i'); d.id = 'fb'; return d; } })
  );
  assert.equal(document.getElementById('fb')!.parentElement, document.body);
  disposeOwner(owner);
});

test('Portal content is removed from the target on unmount', () => {
  const t = target('tgt-rm');
  const owner = createOwner();
  runInOwner(owner, () =>
    dom.Portal({ to: t }, { default: () => { const d = document.createElement('p'); d.id = 'rm'; return d; } })
  );
  assert.ok(document.getElementById('rm'), 'present while mounted');
  disposeOwner(owner);
  assert.equal(document.getElementById('rm'), null, 'gone after unmount');
  t.remove();
});

test('Portal content stays reactive (effects tie to the surrounding owner)', () => {
  const t = target('tgt-reactive');
  const label = signal('a');
  const owner = createOwner();
  runInOwner(owner, () =>
    dom.Portal({ to: t }, {
      default: () => {
        const span = document.createElement('span');
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
  const Theme = createContext<string>('light');
  const t = target('tgt-ctx');
  let seen = '';
  const owner = createOwner();
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
  const t = target('tgt-if');
  const show = signal(true);
  const { code } = compileTemplate('<div>@if (show()) { <Portal to="#tgt-if"><b class="m">hi</b></Portal> }</div>', {
    mode: 'function',
    scope: ['show'],
  });
  const fn = new Function('ctx', 'rt', '_c', code) as (c: unknown, r: unknown, k: unknown) => Element;
  const owner = createOwner();
  const elRoot = runInOwner(owner, () => fn({ show }, rt, { Portal: dom.Portal }));
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
