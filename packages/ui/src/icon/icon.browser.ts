import { test, assert } from '../../../../tools/harness.js';
import {
  signal,
  effect,
  createOwner,
  runInOwner,
  disposeOwner,
  provide,
  type Signal,
  type Owner,
} from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate } from '@weave-framework/compiler';
import {
  setup,
  template,
  createIconRegistry,
  configureIcons,
  activeIcons,
  inlineIcons,
  spriteIcons,
  IconContext,
  type IconProps,
  type IconRegistry,
} from '@weave-framework/ui/icon';

// The runtime object the compiled (function-mode) template references as `rt`.
const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };

/** Let queued effects / microtasks flush. */
const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));

/* ─────────────────────────── registry ─────────────────────────── */

test('registry: built-in Lucide name resolves to a wrapped <svg>', () => {
  const reg: IconRegistry = createIconRegistry();
  const svg: string | undefined = reg.resolve('search');
  assert.ok(svg, 'search resolves');
  assert.ok(svg!.startsWith('<svg'), 'wrapped in <svg>');
  assert.ok(svg!.includes('stroke="currentColor"'), 'Weave currentColor stroke');
  assert.ok(svg!.includes('circle'), 'contains the search glyph geometry');
});

test('registry: an unknown name resolves to undefined', () => {
  const reg: IconRegistry = createIconRegistry();
  assert.equal(reg.resolve('definitely-not-an-icon'), undefined);
  assert.equal(reg.has('definitely-not-an-icon'), false);
  assert.equal(reg.has('menu'), true);
});

test('registry: register() overrides a name (and wraps inner geometry)', () => {
  const reg: IconRegistry = createIconRegistry();
  reg.register('search', '<path d="M0 0" />');
  const svg: string = reg.resolve('search')!;
  assert.ok(svg.startsWith('<svg') && svg.includes('M0 0'), 'custom geometry used');
});

test('registry: a full <svg> from a source is passed through unwrapped', () => {
  const reg: IconRegistry = createIconRegistry({
    builtin: false,
    sources: [inlineIcons({ logo: '<svg viewBox="0 0 10 10"><rect/></svg>' })],
  });
  const svg: string = reg.resolve('logo')!;
  assert.ok(svg.includes('viewBox="0 0 10 10"'), 'kept the source viewBox');
  assert.equal(svg.match(/<svg/g)!.length, 1, 'not double-wrapped');
});

test('registry: sources are consulted before the built-in set (first hit wins)', () => {
  const reg: IconRegistry = createIconRegistry({ sources: [inlineIcons({ search: '<svg id="mine"></svg>' })] });
  assert.ok(reg.resolve('search')!.includes('id="mine"'), 'source overrides built-in');
  assert.ok(reg.resolve('menu'), 'built-in still available as fallback');
});

test('configureIcons() sets the global backing activeIcons()', () => {
  const reg: IconRegistry = configureIcons({ builtin: false, sources: [inlineIcons({ a: '<svg id="a"></svg>' })] });
  assert.equal(activeIcons(), reg, 'global instance is active with no context');
});

test('IconContext overrides the global within a subtree', () => {
  configureIcons({ builtin: true }); // global
  const scoped: IconRegistry = createIconRegistry({ builtin: false, global: false });
  const owner: Owner = createOwner();
  runInOwner(owner, () => {
    provide(IconContext, scoped);
    assert.equal(activeIcons(), scoped, 'context-provided registry wins');
  });
  disposeOwner(owner);
});

test('registry: an async sprite source fills a reactive cache', async () => {
  const original: typeof fetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve({
      text: () => Promise.resolve('<svg><symbol id="foo"><rect x="1" /></symbol></svg>'),
    })) as unknown as typeof fetch;
  try {
    const reg: IconRegistry = createIconRegistry({ builtin: false, sources: [spriteIcons('/sprite.svg')] });
    let seen: string | undefined;
    const stop: () => void = effect(() => {
      seen = reg.resolve('foo'); // tracked — re-runs when the fetch lands
    });
    assert.equal(seen, undefined, 'pending on first read');
    for (let i: number = 0; i < 10 && seen === undefined; i++) await tick();
    assert.ok(seen && seen.includes('rect'), 'reactively filled from the sprite');
    stop();
  } finally {
    globalThis.fetch = original;
  }
});

/* ─────────────────────────── component ─────────────────────────── */

/** Instantiate `<Icon>` (setup + template) in a fresh owner and attach it. */
function mountIcon(props: IconProps): { el: HTMLElement; dispose: () => void } {
  const owner: Owner = createOwner();
  const el: HTMLElement = runInOwner(owner, () => {
    const ctx: ReturnType<typeof setup> = setup(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: ['host'] });
    const fn: (c: unknown, r: unknown, k: unknown) => HTMLElement = new Function('ctx', 'rt', '_c', code) as (c: unknown, r: unknown, k: unknown) => HTMLElement;
    return fn(ctx, rt, {});
  });
  document.body.appendChild(el);
  return { el, dispose: () => { disposeOwner(owner); el.remove(); } };
}

test('component: renders the named icon inline as an <svg>, decorative by default', async () => {
  configureIcons({ builtin: true });
  const { el, dispose } = mountIcon({ name: 'search' });
  await tick();
  const host: HTMLElement = el.classList.contains('weave-icon') ? el : (el.querySelector('.weave-icon') as HTMLElement);
  assert.ok(host, 'has the .weave-icon host');
  assert.ok(host.querySelector('svg'), 'inline <svg> rendered');
  assert.equal(host.getAttribute('aria-hidden'), 'true', 'decorative by default');
  assert.equal(host.getAttribute('role'), null);
  dispose();
});

test('component: label makes it a labelled image (role=img + aria-label)', async () => {
  const { el, dispose } = mountIcon({ name: 'trash-2', label: 'Delete' });
  await tick();
  const host: HTMLElement = el as HTMLElement;
  assert.equal(host.getAttribute('role'), 'img');
  assert.equal(host.getAttribute('aria-label'), 'Delete');
  assert.equal(host.getAttribute('aria-hidden'), null, 'not hidden when labelled');
  dispose();
});

test('component: a direct svg prop bypasses the registry', async () => {
  const { el, dispose } = mountIcon({ svg: '<svg id="direct"><circle/></svg>' });
  await tick();
  assert.ok((el as HTMLElement).querySelector('svg#direct'), 'rendered the given svg');
  dispose();
});

test('component: changing name re-renders in place', async () => {
  const name: Signal<string> = signal<string>('search');
  const props: IconProps = { get name() { return name(); } };
  const { el, dispose } = mountIcon(props);
  await tick();
  const first: string = (el as HTMLElement).innerHTML;
  name.set('menu');
  await tick();
  const second: string = (el as HTMLElement).innerHTML;
  assert.ok(second.includes('<svg'), 'still an svg after change');
  assert.notEqual(first, second, 'markup updated for the new name');
  dispose();
});

test('component: an untrusted svg is sanitized — on* / <script> / <foreignObject> stripped (M5)', async () => {
  const { el, dispose } = mountIcon({
    svg: '<svg id="x" onload="_x=1"><script>_x=2</script><foreignObject><b>hi</b></foreignObject><circle r="1"/></svg>',
  });
  await tick();
  const svg: SVGElement | null = (el as HTMLElement).querySelector('svg#x');
  assert.ok(svg, 'the svg still renders');
  assert.equal(svg!.getAttribute('onload'), null, 'on* handler attribute stripped');
  assert.equal(svg!.querySelector('script'), null, '<script> removed');
  assert.equal(svg!.querySelector('foreignObject'), null, '<foreignObject> removed');
  assert.ok(svg!.querySelector('circle'), 'safe geometry kept');
  dispose();
});
