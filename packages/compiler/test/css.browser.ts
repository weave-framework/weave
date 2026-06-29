import { test, assert } from '../../../tools/harness.js';
import { signal, computed, effect, root } from '@weave/runtime';
import * as dom from '@weave/runtime/dom';
import { compileTemplate, compileComponent, scopeCss, scopeAttr, hostAttr, hashCss } from '@weave/compiler';
import type { CompiledComponent } from '@weave/compiler';

const rt: typeof dom & {
  signal: typeof signal;
  computed: typeof computed;
  effect: typeof effect;
  root: typeof root;
} = { ...dom, signal, computed, effect, root };

/** Compile a template with a scope attribute and instantiate it. */
function render(html: string, hash: string): Element {
  const { code } = compileTemplate(html, { mode: 'function', scope: [], scopeAttr: scopeAttr(hash) });
  const fn: (ctx: unknown, rt: unknown, _c: unknown) => Element = new Function('ctx', 'rt', '_c', code) as (
    ctx: unknown,
    rt: unknown,
    _c: unknown
  ) => Element;
  return fn({}, rt, {});
}

/** Compile + instantiate with both the scope and `:host` root attributes. */
function renderHost(html: string, hash: string): Element {
  const { code } = compileTemplate(html, {
    mode: 'function',
    scope: [],
    scopeAttr: scopeAttr(hash),
    hostAttr: hostAttr(hash),
  });
  const fn: (ctx: unknown, rt: unknown, _c: unknown) => Element = new Function('ctx', 'rt', '_c', code) as (
    ctx: unknown,
    rt: unknown,
    _c: unknown
  ) => Element;
  return fn({}, rt, {});
}

function host(): HTMLElement {
  const el: HTMLDivElement = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

/* ──────────── scopeCss: selectors ──────────── */

test('scopes a simple selector with the attribute', () => {
  const out: string = scopeCss('.btn { color: red }', 'h');
  assert.ok(out.includes('.btn[data-w-h]'), out);
});

test('scopes only the rightmost compound (descendant + child)', () => {
  const a: string = scopeCss('.a .b { x: 1 }', 'h');
  assert.ok(a.includes('.a .b[data-w-h]'), a);
  assert.ok(!a.includes('.a[data-w-h]'), 'left compound is not scoped');
  const b: string = scopeCss('.a > .b { x: 1 }', 'h');
  assert.ok(b.includes('.a > .b[data-w-h]'), b);
});

test('inserts the attribute before a pseudo-class / pseudo-element', () => {
  assert.ok(scopeCss('.a:hover { x: 1 }', 'h').includes('.a[data-w-h]:hover'));
  assert.ok(scopeCss('.a::before { x: 1 }', 'h').includes('.a[data-w-h]::before'));
});

test('scopes every selector in a comma list', () => {
  const out: string = scopeCss('.a, .b { x: 1 }', 'h');
  assert.ok(out.includes('.a[data-w-h]'), out);
  assert.ok(out.includes('.b[data-w-h]'), out);
});

test(':global(...) is unwrapped and left unscoped', () => {
  const a: string = scopeCss(':global(body) { margin: 0 }', 'h');
  assert.ok(a.includes('body'), a);
  assert.ok(!a.includes('data-w-h'), 'no scope attribute on a global selector');
  const b: string = scopeCss(':global(.x) .y { z: 1 }', 'h');
  assert.ok(b.includes('.x .y[data-w-h]'), b); // global prefix kept, local tail scoped
});

/* ──────────── scopeCss: at-rules + nesting ──────────── */

test('recurses into @media, scoping inner rules', () => {
  const out: string = scopeCss('@media (min-width: 0px) { .a { x: 1 } }', 'h');
  assert.ok(out.includes('@media (min-width: 0px)'), out);
  assert.ok(out.includes('.a[data-w-h]'), out);
});

test('@keyframes keeps its name and does not scope frame selectors', () => {
  const out: string = scopeCss('@keyframes spin { from { o: 0 } to { o: 1 } }', 'h');
  assert.ok(out.includes('@keyframes spin'), out);
  assert.ok(!out.includes('data-w-h'), 'frame selectors are not scoped');
});

test('native nesting: nested rules scoped, & inherits scope', () => {
  const out: string = scopeCss('.card { color: red; .title { x: 1 } &:hover { y: 2 } }', 'h');
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

/* ──────────── scopeCss: :host ──────────── */

test(':host targets the host attribute (root element)', () => {
  const out: string = scopeCss(':host { display: block }', 'h');
  assert.ok(out.includes('[data-w-h-h]'), out);
  assert.ok(!out.includes(':host'), 'the :host pseudo is rewritten away');
});

test(':host(.modifier) becomes modifier + host attribute', () => {
  const out: string = scopeCss(':host(.active) { x: 1 }', 'h');
  assert.ok(out.includes('.active[data-w-h-h]'), out);
});

test(':host in an ancestor position scopes the descendant normally', () => {
  const out: string = scopeCss(':host .child { x: 1 }', 'h');
  assert.ok(out.includes('[data-w-h-h] .child[data-w-h]'), out);
});

test(':host-context is left untouched (unsupported, not mangled)', () => {
  const out: string = scopeCss(':host-context(.dark) .x { y: 1 }', 'h');
  assert.ok(out.includes(':host-context(.dark)'), out);
  assert.ok(out.includes('.x[data-w-h]'), out);
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

test('codegen stamps the host attribute on the root element only', () => {
  const { code } = compileTemplate('<div><span>x</span></div>', {
    mode: 'module',
    scopeAttr: 'data-w-h1',
    hostAttr: 'data-w-h1-h',
  });
  assert.ok(code.includes('<div data-w-h1 data-w-h1-h>'), code);
  assert.ok(code.includes('<span data-w-h1>'), code);
  assert.ok(!code.includes('<span data-w-h1 data-w-h1-h>'), 'nested element is not a host');
});

test('compileComponent stamps the host attr only when the styles use :host', () => {
  const withHost: CompiledComponent = compileComponent({ template: '<div>x</div>', styles: ':host { color: red }' });
  assert.ok(withHost.code.includes(`${scopeAttr(withHost.hash)} ${hostAttr(withHost.hash)}`), withHost.code);
  assert.ok(withHost.css.includes(`[${hostAttr(withHost.hash)}]`), withHost.css);

  const without: CompiledComponent = compileComponent({ template: '<div>x</div>', styles: '.a { color: red }' });
  assert.ok(!without.code.includes(hostAttr(without.hash)), 'no host attr when :host is unused');
});

/* ──────────── end-to-end: real computed style ──────────── */

test('scoped CSS applies to scoped elements only', () => {
  const hash: string = 'sc' + hashCss('p{color}');
  const style: HTMLStyleElement = document.createElement('style');
  style.textContent = scopeCss('p { color: rgb(255, 0, 0) }', hash);
  document.head.appendChild(style);

  const scoped: Element = render('<p>scoped</p>', hash);
  const plain: HTMLParagraphElement = document.createElement('p');
  plain.textContent = 'plain';

  const h: HTMLElement = host();
  h.appendChild(scoped);
  h.appendChild(plain);

  assert.equal(getComputedStyle(scoped).color, 'rgb(255, 0, 0)', 'scoped element is styled');
  assert.ok(getComputedStyle(plain).color !== 'rgb(255, 0, 0)', 'unscoped element is untouched');
});

test(':host styles the root element but not a nested child', () => {
  const hash: string = 'ho' + hashCss(':host{}');
  const style: HTMLStyleElement = document.createElement('style');
  style.textContent = scopeCss(':host { color: rgb(0, 128, 0) } span { color: rgb(0, 0, 255) }', hash);
  document.head.appendChild(style);

  const rootEl: HTMLElement = renderHost('<div><span>x</span></div>', hash) as HTMLElement;
  const span: HTMLSpanElement = rootEl.querySelector('span')!;
  host().appendChild(rootEl);

  assert.equal(getComputedStyle(rootEl).color, 'rgb(0, 128, 0)', ':host matched the root');
  assert.equal(getComputedStyle(span).color, 'rgb(0, 0, 255)', ':host did not leak to the child');
});
