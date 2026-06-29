import { test, assert } from '../../../tools/harness.js';
import { signal, computed, effect, root, tick, type Signal } from '@weave/runtime';
import * as dom from '@weave/runtime/dom';
import { compileTemplate, parseTemplate } from '@weave/compiler';
import type { TransitionConfig } from '@weave/runtime/dom';

const rt: typeof dom & {
  signal: typeof signal;
  computed: typeof computed;
  effect: typeof effect;
  root: typeof root;
} = { ...dom, signal, computed, effect, root };

function render(html: string, ctx: Record<string, unknown> = {}, scope: string[] = []): Element {
  const { code } = compileTemplate(html, { mode: 'function', scope });
  const fn: (c: unknown, r: unknown, k: unknown) => Element = new Function('ctx', 'rt', '_c', code) as (c: unknown, r: unknown, k: unknown) => Element;
  return fn(ctx, rt, {});
}
function host(): HTMLElement {
  const el: HTMLDivElement = document.createElement('div');
  document.body.appendChild(el);
  return el;
}
const wait = (ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms));

/** A short, observable transition: animates opacity over 20ms. */
const tFade = (): TransitionConfig => ({ duration: 20, css: (t) => `opacity: ${t}` });

/* ──────────── parse + codegen ──────────── */

test('transition: / in: / out: parse into transition attrs with a mode', () => {
  const a: { attrs: { type: string; name: string; mode: string }[] } = parseTemplate(`<div transition:fade></div>`)[0] as { attrs: { type: string; name: string; mode: string }[] };
  const b: { attrs: { type: string; mode: string }[] } = parseTemplate(`<div in:fly></div>`)[0] as { attrs: { type: string; mode: string }[] };
  const c: { attrs: { type: string; mode: string }[] } = parseTemplate(`<div out:slide></div>`)[0] as { attrs: { type: string; mode: string }[] };
  assert.equal(a.attrs[0].type, 'transition');
  assert.equal(a.attrs[0].name, 'fade');
  assert.equal(a.attrs[0].mode, 'both');
  assert.equal(b.attrs[0].mode, 'in');
  assert.equal(c.attrs[0].mode, 'out');
});

test('codegen emits a transition() call with the mode', () => {
  const { code } = compileTemplate(`<div in:fade={{ duration: 100 }}>x</div>`, { mode: 'module', scope: ['fade'] });
  assert.ok(code.includes('transition('), code);
  assert.ok(code.includes('"in"'), code);
});

/* ──────────── runtime: intro ──────────── */

test('in: plays an intro that cleans up its inline style when finished', async () => {
  const el: HTMLElement = render(`<div in:run>hi</div>`, { run: tFade }, ['run']) as HTMLElement;
  host().appendChild(el);
  await tick(); // onMount fires the intro (sets opacity: 0 to start)
  await wait(60); // let it finish
  assert.equal(el.style.opacity, '', 'inline opacity override removed after the intro completes');
});

/* ──────────── runtime: outro coordination (the headline) ──────────── */

test('out: defers DOM removal until the leave animation finishes', async () => {
  const show: Signal<boolean> = signal(true);
  const el: Element = render(`<div>@if (show()) { <p out:run>bye</p> }</div>`, { show, run: tFade }, ['show', 'run']);
  host().appendChild(el);
  assert.ok(el.querySelector('p'), 'present initially');

  show.set(false); // @if clears → removeWithOutro plays the leave animation first
  assert.ok(el.querySelector('p'), 'still in the DOM during the leave animation');

  await wait(80);
  assert.equal(el.querySelector('p'), null, 'removed only after the animation finished');
});

test('out: leave animation also runs for a removed @for row', async () => {
  const items: Signal<number[]> = signal([1, 2, 3]);
  const el: Element = render(
    `<ul>@for (n of items(); track n) { <li out:run>{{ n }}</li> }</ul>`,
    { items, run: tFade },
    ['items', 'run']
  );
  host().appendChild(el);
  assert.equal(el.querySelectorAll('li').length, 3);

  items.set([1, 3]); // drop item 2
  assert.equal(el.querySelectorAll('li').length, 3, 'leaving row lingers during its animation');

  await wait(80);
  assert.equal(el.querySelectorAll('li').length, 2, 'leaving row removed after the animation');
});

test('out: leave animation runs when a @for is emptied to zero', async () => {
  // The whole-list removal path (data → empty) is separate from reconcileKeyed's
  // partial removal; it must play outros too, or emptying a list snaps instead of
  // animating. Regression for the demo D.5b board (filtering a column to empty).
  const items: Signal<number[]> = signal([1, 2]);
  const el: Element = render(
    `<ul>@for (n of items(); track n) { <li out:run>{{ n }}</li> } @empty { <li class="none">—</li> }</ul>`,
    { items, run: tFade },
    ['items', 'run']
  );
  host().appendChild(el);
  assert.equal(el.querySelectorAll('li:not(.none)').length, 2);

  items.set([]); // empties the list → removeRows must outro, not snap
  assert.equal(el.querySelectorAll('li:not(.none)').length, 2, 'leaving rows linger during their animation');
  assert.ok(el.querySelector('li.none'), '@empty placeholder appears immediately alongside the fading rows');

  await wait(80);
  assert.equal(el.querySelectorAll('li:not(.none)').length, 0, 'rows removed after the animation finishes');
});

test('no outro registered (in: only) removes immediately', async () => {
  const show: Signal<boolean> = signal(true);
  const el: Element = render(`<div>@if (show()) { <p in:run>hi</p> }</div>`, { show, run: tFade }, ['show', 'run']);
  host().appendChild(el);
  await tick();
  show.set(false);
  assert.equal(el.querySelector('p'), null, 'in:-only element is removed synchronously (no leave anim)');
});
