import { test, assert } from '../../../../tools/harness.js';
import { mount } from '../testing/index.js';
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

/**
 * Instantiate `<Icon>` through the shipped harness.
 *
 * This used to spell out `scope: ['host', 'iconClass']`, and that list is why these tests failed the
 * moment the component grew a binding — with `iconClass is not defined`, which says nothing about
 * icons. `mount` derives the scope from the template, the same way the real build does.
 */
function mountIcon(props: IconProps): { el: HTMLElement; dispose: () => void } {
  return mount<HTMLElement>({ template, setup } as never, props as unknown as Record<string, unknown>);
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

test('component: an untrusted svg is sanitized — on* / <script> / <foreignObject> stripped', async () => {
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

// 30 of the library's 45 components take a per-instance `class`; this was the one that did not, and an
// icon is the thing most often sized or coloured differently from its neighbours. A real app hit it.
test('component: a `class` lands on the host alongside weave-icon', async () => {
  const { el, dispose } = mountIcon({ name: 'search', class: 'mine' });
  await tick();
  assert.ok(el.classList.contains('weave-icon'), 'the block class is still there');
  assert.ok(el.classList.contains('mine'), 'and the per-instance one is too');
  dispose();
});

test('component: with no `class` the host is unchanged', async () => {
  const { el, dispose } = mountIcon({ name: 'search' });
  await tick();
  assert.equal(el.getAttribute('class'), 'weave-icon', 'no stray whitespace, no extra class');
  dispose();
});

// Sanitizer vectors that a reader would not think of. Each is a documented SVG XSS shape; the point is
// to learn what the scrubber actually does with them rather than to assume the list it checks is the
// list that matters.
test('component: sanitizer — a scheme split by a tab is still removed', async () => {
  const tab: string = String.fromCharCode(9);
  const { el, dispose } = mountIcon({ svg: `<svg id="v"><a href="java${tab}script:alert(1)"><circle r="1"/></a></svg>` });
  await tick();
  const a: Element | null = el.querySelector('a');
  assert.ok(a, 'the link survives (only the URL is in question)');
  const href: string = a!.getAttribute('href') ?? a!.getAttribute('xlink:href') ?? '';
  assert.ok(!/script:/i.test(href), `no script URL survives (got ${JSON.stringify(href)})`);
  dispose();
});

test('component: sanitizer — an <animate> cannot smuggle a javascript: href', async () => {
  const { el, dispose } = mountIcon({
    svg: '<svg id="v"><a><animate attributeName="href" to="javascript:alert(1)"/><circle r="1"/></a></svg>',
  });
  await tick();
  const anim: Element | null = el.querySelector('animate');
  const to: string = anim?.getAttribute('to') ?? '';
  assert.ok(!/javascript:/i.test(to), `no javascript: survives an animate (got ${JSON.stringify(to)})`);
  dispose();
});
