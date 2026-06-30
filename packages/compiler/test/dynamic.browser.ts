import { test, assert } from '../../../tools/harness.js';
import { signal, computed, effect, root } from '@weave/runtime';
import type { Signal } from '@weave/runtime';
import * as dom from '@weave/runtime/dom';
import { compileTemplate } from '@weave/compiler';

const rt: typeof dom & {
  signal: typeof signal;
  computed: typeof computed;
  effect: typeof effect;
  root: typeof root;
} = { ...dom, signal, computed, effect, root };

function render(html: string, ctx: Record<string, unknown> = {}, scope: string[] = []): Element {
  const { code } = compileTemplate(html, { mode: 'function', scope });
  const fn: (c: unknown, r: unknown, k: unknown) => Element = new Function('ctx', 'rt', '_c', code) as (
    c: unknown,
    r: unknown,
    k: unknown
  ) => Element;
  return fn(ctx, rt, {});
}
function host(): HTMLElement {
  const el: HTMLDivElement = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

/* ──────────── show={expr} (v-show) ──────────── */

test('show emits bindShow; w:element emits dynElement', () => {
  const a: { code: string } = compileTemplate(`<div show={{ok()}}>x</div>`, { mode: 'module', scope: ['ok'] });
  assert.ok(a.code.includes('bindShow('), a.code);
  const b: { code: string } = compileTemplate(`<div><w:element this={{tag()}}>x</w:element></div>`, { mode: 'module', scope: ['tag'] });
  assert.ok(b.code.includes('dynElement('), b.code);
});

test('show toggles display but keeps the element in the DOM', () => {
  const visible: Signal<boolean> = signal(true);
  const el: HTMLElement = render(`<div show={{visible()}}>hi</div>`, { visible }, ['visible']) as HTMLElement;
  host().appendChild(el);
  assert.equal(el.style.display, '', 'shown initially (no display override)');

  visible.set(false);
  assert.equal(el.style.display, 'none', 'hidden via display:none');
  assert.ok(el.isConnected, 'element is still in the DOM (not removed)');

  visible.set(true);
  assert.equal(el.style.display, '', 'shown again');
});

test('show on a nested element', () => {
  const open: Signal<boolean> = signal(false);
  const el: Element = render(`<div><span show={{open()}}>panel</span></div>`, { open }, ['open']);
  host().appendChild(el);
  const span: HTMLElement = el.querySelector('span') as HTMLElement;
  assert.equal(span.style.display, 'none');
  open.set(true);
  assert.equal(span.style.display, '');
});

/* ──────────── <w:element this={tag}> (dynamic element) ──────────── */

test('renders an element of the given tag with children', () => {
  const el: Element = render(`<div><w:element this={{tag()}}>content</w:element></div>`, { tag: signal('h1') }, ['tag']);
  host().appendChild(el);
  const h1: HTMLHeadingElement | null = el.querySelector('h1');
  assert.ok(h1, 'created an <h1>');
  assert.equal(h1!.textContent, 'content');
});

test('re-creates the element when the tag changes', () => {
  const tag: Signal<string> = signal('h1');
  const el: Element = render(`<div><w:element this={{tag()}}>x</w:element></div>`, { tag }, ['tag']);
  host().appendChild(el);
  assert.ok(el.querySelector('h1') && !el.querySelector('h2'));

  tag.set('h2');
  assert.ok(el.querySelector('h2'), 'now an <h2>');
  assert.ok(!el.querySelector('h1'), 'old <h1> removed');
});

test('wires attributes, classes and events on the dynamic element', () => {
  const active: Signal<boolean> = signal(true);
  let clicks: number = 0;
  const el: Element = render(
    `<div><w:element this={{'button'}} class:on={{active()}} on:click={{() => bump()}}>tap</w:element></div>`,
    { active, bump: () => clicks++ },
    ['active', 'bump']
  );
  host().appendChild(el);
  const btn: HTMLButtonElement = el.querySelector('button') as HTMLButtonElement;
  assert.ok(btn, 'created a <button>');
  assert.ok(btn.classList.contains('on'), 'class:on applied');

  btn.click();
  assert.equal(clicks, 1, 'on:click fired');

  active.set(false);
  assert.ok(!btn.classList.contains('on'), 'class toggles reactively');
});

test('reactive content inside the dynamic element stays fine-grained', () => {
  const n: Signal<number> = signal(1);
  const el: Element = render(`<div><w:element this={{'p'}}>n={{ n() }}</w:element></div>`, { n }, ['n']);
  host().appendChild(el);
  assert.ok(el.textContent?.includes('n=1'));
  n.set(2);
  assert.ok(el.textContent?.includes('n=2'), 'binding updates without recreating the element');
});
