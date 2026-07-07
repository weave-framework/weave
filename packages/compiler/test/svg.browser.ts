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

// FW-8: self-closing SVG child tags (<circle/>, <rect/>, <path/>, …) must parse as COMPLETE
// elements. codegen serializes a self-closing non-void element with an explicit close tag; without
// it the HTML parser leaves each <path> open in foreign content and nests every following sibling
// inside it (a flat list of shapes becomes a deep tree — only the first renders right).
test('self-closing SVG children stay siblings, not nested (FW-8)', () => {
  const el: Element = render(
    '<svg viewBox="0 0 100 100"><circle cx="30" cy="30" r="20" fill="#16347b" /><rect x="50" y="50" width="40" height="40" fill="#b62724" /></svg>',
    {},
    []
  );
  host().appendChild(el);
  const circle: Element = el.querySelector('circle') as Element;
  const rect: Element = el.querySelector('rect') as Element;
  assert.ok(circle && rect, 'both shapes exist');
  assert.equal(el.children.length, 2, '<svg> has two sibling children');
  assert.equal(rect.parentElement, el, 'the rect is a direct child of <svg>, NOT nested in the circle');
  assert.equal(circle.querySelector('rect'), null, 'the rect is not buried inside the circle');
  assert.equal(circle.namespaceURI, SVG_NS);
  assert.equal(rect.namespaceURI, SVG_NS);
});

test('many self-closing shapes in a <g> stay flat siblings (FW-8)', () => {
  const el: Element = render(
    '<svg viewBox="0 0 501 500"><g id="logo">' +
      '<circle cx="228" cy="250" r="191" fill="#fff" />' +
      '<path id="sky" fill="#16347b" d="M1 1" />' +
      '<path id="banner" fill="#f5d317" d="M2 2" />' +
      '<path id="dancer" fill="#b62724" d="M3 3" />' +
      '</g></svg>',
    {},
    []
  );
  host().appendChild(el);
  const g: Element = el.querySelector('#logo') as Element;
  assert.equal(g.children.length, 4, 'the <g> has four flat sibling shapes');
  assert.equal((el.querySelector('#sky') as Element).parentElement, g, '#sky is a direct child of <g>');
  assert.equal((el.querySelector('#dancer') as Element).parentElement, g, '#dancer is a sibling, not nested');
  assert.equal(el.querySelectorAll('path').length, 3, 'all three paths present as siblings');
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
