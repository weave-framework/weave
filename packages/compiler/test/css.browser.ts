import { test, assert } from '../../../tools/harness.js';
import { signal, computed, effect, root } from '@weave/runtime';
import * as dom from '@weave/runtime/dom';
import { compileTemplate, scopeCss, scopeAttr, hashCss } from '@weave/compiler';

const rt = { ...dom, signal, computed, effect, root };

/** Compile a template with a scope attribute and instantiate it. */
function render(html: string, hash: string): Element {
  const { code } = compileTemplate(html, { mode: 'function', scope: [], scopeAttr: scopeAttr(hash) });
  const fn = new Function('ctx', 'rt', '_c', code) as (ctx: unknown, rt: unknown, _c: unknown) => Element;
  return fn({}, rt, {});
}

function host(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

/* ──────────── scopeCss: selectors ──────────── */

test('scopes a simple selector with the attribute', () => {
  const out = scopeCss('.btn { color: red }', 'h');
  assert.ok(out.includes('.btn[data-w-h]'), out);
});

test('scopes only the rightmost compound (descendant + child)', () => {
  const a = scopeCss('.a .b { x: 1 }', 'h');
  assert.ok(a.includes('.a .b[data-w-h]'), a);
  assert.ok(!a.includes('.a[data-w-h]'), 'left compound is not scoped');
  const b = scopeCss('.a > .b { x: 1 }', 'h');
  assert.ok(b.includes('.a > .b[data-w-h]'), b);
});

test('inserts the attribute before a pseudo-class / pseudo-element', () => {
  assert.ok(scopeCss('.a:hover { x: 1 }', 'h').includes('.a[data-w-h]:hover'));
  assert.ok(scopeCss('.a::before { x: 1 }', 'h').includes('.a[data-w-h]::before'));
});

test('scopes every selector in a comma list', () => {
  const out = scopeCss('.a, .b { x: 1 }', 'h');
  assert.ok(out.includes('.a[data-w-h]'), out);
  assert.ok(out.includes('.b[data-w-h]'), out);
});

test(':global(...) is unwrapped and left unscoped', () => {
  const a = scopeCss(':global(body) { margin: 0 }', 'h');
  assert.ok(a.includes('body'), a);
  assert.ok(!a.includes('data-w-h'), 'no scope attribute on a global selector');
  const b = scopeCss(':global(.x) .y { z: 1 }', 'h');
  assert.ok(b.includes('.x .y[data-w-h]'), b); // global prefix kept, local tail scoped
});

/* ──────────── scopeCss: at-rules + nesting ──────────── */

test('recurses into @media, scoping inner rules', () => {
  const out = scopeCss('@media (min-width: 0px) { .a { x: 1 } }', 'h');
  assert.ok(out.includes('@media (min-width: 0px)'), out);
  assert.ok(out.includes('.a[data-w-h]'), out);
});

test('@keyframes keeps its name and does not scope frame selectors', () => {
  const out = scopeCss('@keyframes spin { from { o: 0 } to { o: 1 } }', 'h');
  assert.ok(out.includes('@keyframes spin'), out);
  assert.ok(!out.includes('data-w-h'), 'frame selectors are not scoped');
});

test('native nesting: nested rules scoped, & inherits scope', () => {
  const out = scopeCss('.card { color: red; .title { x: 1 } &:hover { y: 2 } }', 'h');
  assert.ok(out.includes('.card[data-w-h]'), out);
  assert.ok(out.includes('.title[data-w-h]'), out);
  assert.ok(out.includes('&:hover{') || out.includes('&:hover {'), out);
  assert.ok(!out.includes('&:hover[data-w-h]'), '& already carries the parent scope');
});

test('hashCss is deterministic and scopeAttr is data-w-<hash>', () => {
  assert.equal(hashCss('abc'), hashCss('abc'));
  assert.equal(hashCss('abc').length, 6);
  assert.ok(hashCss('abc') !== hashCss('abd'), 'different input → different hash');
  assert.equal(scopeAttr('zz9p1u'), 'data-w-zz9p1u');
});

/* ──────────── codegen: stamping ──────────── */

test('codegen stamps the scope attribute on every element', () => {
  const { code } = compileTemplate('<div><span>x</span></div>', { mode: 'module', scopeAttr: 'data-w-h1' });
  assert.ok(code.includes('<div data-w-h1>'), code);
  assert.ok(code.includes('<span data-w-h1>'), code);
});

test('components and slots are not stamped (no own DOM)', () => {
  const { code } = compileTemplate('<div><Child/><slot/></div>', { mode: 'module', scopeAttr: 'data-w-h1' });
  assert.ok(code.includes('<div data-w-h1>'), code);
  assert.ok(!code.includes('Child data-w'), 'component tag never reaches HTML');
});

/* ──────────── end-to-end: real computed style ──────────── */

test('scoped CSS applies to scoped elements only', () => {
  const hash = 'sc' + hashCss('p{color}');
  const style = document.createElement('style');
  style.textContent = scopeCss('p { color: rgb(255, 0, 0) }', hash);
  document.head.appendChild(style);

  const scoped = render('<p>scoped</p>', hash);
  const plain = document.createElement('p');
  plain.textContent = 'plain';

  const h = host();
  h.appendChild(scoped);
  h.appendChild(plain);

  assert.equal(getComputedStyle(scoped).color, 'rgb(255, 0, 0)', 'scoped element is styled');
  assert.ok(getComputedStyle(plain).color !== 'rgb(255, 0, 0)', 'unscoped element is untouched');
});
