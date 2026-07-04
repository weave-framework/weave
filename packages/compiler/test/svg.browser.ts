import { test, assert } from '../../../tools/harness.js';
import { signal, computed, effect, root, type Signal } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate } from '@weave-framework/compiler';

// The runtime object the compiled (function-mode) code references as `rt`.
const rt: typeof dom & {
  signal: typeof signal;
  computed: typeof computed;
  effect: typeof effect;
  root: typeof root;
} = { ...dom, signal, computed, effect, root };

function render(html: string, ctx: Record<string, unknown>, scope: string[]): Element {
  const { code } = compileTemplate(html, { mode: 'function', scope });
  const fn: (ctx: unknown, rt: unknown, _c: unknown) => Element = new Function('ctx', 'rt', '_c', code) as (
    ctx: unknown,
    rt: unknown,
    _c: unknown
  ) => Element;
  return fn(ctx, rt, {});
}

function host(): HTMLElement {
  const el: HTMLDivElement = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

const SVG_NS: string = 'http://www.w3.org/2000/svg';

// Baseline: an SVG child in the SAME template already parses correctly (the HTML
// parser enters foreign content at the enclosing <svg>). Included so a regression
// in the common case is caught too.
test('svg child in one fragment is in the SVG namespace + reactive attr', () => {
  const d: Signal<string> = signal('M0 0 L10 10');
  const el: Element = render('<svg viewBox="0 0 10 10"><path d={{ d() }}></path></svg>', { d }, ['d']);
  host().appendChild(el);
  const path: SVGPathElement = el.querySelector('path') as SVGPathElement;
  assert.equal(path.namespaceURI, SVG_NS, 'path is a real SVG element');
  assert.equal(path.getAttribute('d'), 'M0 0 L10 10');
  d.set('M1 1 L2 2');
  assert.equal(path.getAttribute('d'), 'M1 1 L2 2', 'bound attr updates');
});

// The regression: a `@for` body rooted at an SVG element is compiled as its OWN
// fragment (its own template string, `<path>` with no <svg> ancestor). Without the
// SVG-namespace fix that template parses `<path>` as an inert HTMLUnknownElement in
// the xhtml namespace — it renders in outerHTML but the browser never paints it.
test('@for rows rooted at <path> are created in the SVG namespace', () => {
  const bars: Signal<{ id: number; d: string }[]> = signal([
    { id: 1, d: 'M0 0' },
    { id: 2, d: 'M1 1' },
  ]);
  const el: Element = render(
    '<svg viewBox="0 0 10 10">@for (b of bars(); track b.id) { <path d={{ b.d }}></path> }</svg>',
    { bars },
    ['bars']
  );
  host().appendChild(el);
  const paths: NodeListOf<Element> = el.querySelectorAll('path');
  assert.equal(paths.length, 2);
  for (const p of paths) assert.equal(p.namespaceURI, SVG_NS, 'each @for path is a real SVG element');
});

// An `@if` branch rooted at an SVG element — same separate-fragment path as `@for`.
test('@if branch rooted at <path> is in the SVG namespace', () => {
  const show: Signal<boolean> = signal(true);
  const el: Element = render(
    '<svg viewBox="0 0 10 10">@if (show()) { <path d="M0 0"></path> }</svg>',
    { show },
    ['show']
  );
  host().appendChild(el);
  const path: Element = el.querySelector('path') as Element;
  assert.equal(path.namespaceURI, SVG_NS);
});

// A whole fragment (e.g. a component's render root, or a slot) rooted at an SVG
// child element — the compiler must parse it in the SVG namespace by the root tag.
test('a fragment rooted at an SVG element (<g>) is in the SVG namespace', () => {
  const r: Signal<string> = signal('4');
  const el: Element = render('<g><circle r={{ r() }}></circle></g>', { r }, ['r']);
  host().appendChild(el);
  assert.equal(el.namespaceURI, SVG_NS, 'the <g> root is a real SVG element');
  assert.equal((el.querySelector('circle') as Element).namespaceURI, SVG_NS);
});

// `<svg>` itself must NOT be wrapped — it parses correctly and is a valid HTML-context
// root; double-wrapping would nest it wrongly.
test('an <svg> root still parses correctly (not double-wrapped)', () => {
  const el: Element = render('<svg width="10" height="10"><rect></rect></svg>', {}, []);
  host().appendChild(el);
  assert.equal(el.tagName.toLowerCase(), 'svg');
  assert.equal(el.namespaceURI, SVG_NS);
  assert.equal((el.querySelector('rect') as Element).namespaceURI, SVG_NS);
});
