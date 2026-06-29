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

/** Compile a template (function mode) and instantiate it — runs the real runtime path. */
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
const wait = (ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms));

test('@defer compiles to a deferBlock call with a trigger spec', () => {
  const { code } = compileTemplate(`<div>@defer (on idle) { <p>x</p> }</div>`, { mode: 'module' });
  assert.ok(code.includes('deferBlock('), 'emits deferBlock');
  assert.ok(code.includes('{ on: "idle" }'), 'emits the idle trigger spec');
});

test('@defer (when) shows the placeholder until the condition flips', () => {
  const ready: Signal<boolean> = signal(false);
  const el: Element = render(
    `<div>@defer (when ready()) { <span>content</span> } @placeholder { <span>ph</span> }</div>`,
    { ready },
    ['ready']
  );
  host().appendChild(el);
  assert.ok(el.textContent?.includes('ph'), 'placeholder shown initially');
  assert.ok(!el.textContent?.includes('content'));
  ready.set(true);
  assert.ok(el.textContent?.includes('content'), 'content shown after the trigger fires');
  assert.ok(!el.textContent?.includes('ph'), 'placeholder removed');
});

test('@defer (immediate) renders the content right away', () => {
  const el: Element = render(
    `<div>@defer (immediate) { <span>now</span> } @placeholder { <span>ph</span> }</div>`
  );
  host().appendChild(el);
  assert.ok(el.textContent?.includes('now'));
  assert.ok(!el.textContent?.includes('ph'));
});

test('@defer (on timer) swaps after the delay', async () => {
  const el: Element = render(
    `<div>@defer (on timer(10)) { <span>late</span> } @placeholder { <span>wait</span> }</div>`
  );
  host().appendChild(el);
  assert.ok(el.textContent?.includes('wait'), 'placeholder before the timer');
  await wait(40);
  assert.ok(el.textContent?.includes('late'), 'content after the timer');
  assert.ok(!el.textContent?.includes('wait'));
});

test('@defer (on idle) renders after an idle tick', async () => {
  const el: Element = render(
    `<div>@defer (on idle) { <span>idle-content</span> } @placeholder { <span>p</span> }</div>`
  );
  host().appendChild(el);
  assert.ok(el.textContent?.includes('p'));
  await wait(60);
  assert.ok(el.textContent?.includes('idle-content'), 'content after idle');
});

test('@defer (on interaction) renders on a click of the placeholder', () => {
  const el: Element = render(
    `<div>@defer (on interaction) { <span>loaded</span> } @placeholder { <button>tap</button> }</div>`
  );
  host().appendChild(el);
  const btn: HTMLButtonElement = el.querySelector('button')!;
  assert.ok(!el.textContent?.includes('loaded'), 'not loaded before interaction');
  btn.click();
  assert.ok(el.textContent?.includes('loaded'), 'content rendered after interaction');
});

test('@defer (on viewport) with no placeholder renders immediately (nothing to observe)', () => {
  const el: Element = render(`<div>@defer (on viewport) { <span>vp</span> }</div>`);
  host().appendChild(el);
  assert.ok(el.textContent?.includes('vp'));
});

test('deferred content keeps fine-grained reactivity after it renders', () => {
  const ready: Signal<boolean> = signal(true);
  const count: Signal<number> = signal(1);
  const el: Element = render(
    `<div>@defer (when ready()) { <span>{{ count() }}</span> }</div>`,
    { ready, count },
    ['ready', 'count']
  );
  host().appendChild(el);
  assert.ok(el.textContent?.includes('1'));
  count.set(5);
  assert.ok(el.textContent?.includes('5'), 'content stays reactive after the deferred render');
});

test('a timer delay can be a ctx expression', () => {
  const { code } = compileTemplate(`<div>@defer (on timer(delay())) { <p>x</p> }</div>`, {
    mode: 'module',
    scope: ['delay'],
  });
  assert.ok(code.includes('ms: ctx.delay()'), 'timer ms is rewritten against ctx');
});
