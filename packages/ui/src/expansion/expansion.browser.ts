import { test, assert } from '../../../../tools/harness.js';
import {
  signal,
  effect,
  createOwner,
  runInOwner,
  disposeOwner,
  type Signal,
  type Owner,
} from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate } from '@weave-framework/compiler';
import * as IconMod from '@weave-framework/ui/icon';
import { toComponent } from '../internal/compose.js';
import {
  setup,
  template,
  type ExpansionProps,
  type ExpansionContext,
  type ExpansionPanel,
} from '@weave-framework/ui/expansion';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };

/** Flush microtasks (fires the deferred onMount body-append). */
const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));

const SCOPE: string[] = [
  'host', 'panels', 'rootClass', 'headingLevel', 'headerId', 'regionId',
  'expandedAttr', 'markerIcon', 'openAttr', 'hiddenAttr', 'disabledAttr', 'isClosed', 'toggle', 'onHeaderKeydown',
];

interface Mounted {
  root: HTMLElement;
  headers: HTMLButtonElement[];
  regions: HTMLElement[];
  dispose: () => void;
}

function mount(props: ExpansionProps): Mounted {
  const owner: Owner = createOwner();
  const root: HTMLElement = runInOwner(owner, () => {
    const ctx: ExpansionContext = setup(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: SCOPE });
    const fn: (c: unknown, r: unknown, k: unknown) => HTMLElement = new Function('ctx', 'rt', '_c', code) as (
      c: unknown,
      r: unknown,
      k: unknown
    ) => HTMLElement;
    return fn(ctx, rt, { Icon: toComponent(IconMod as never) });
  });
  document.body.appendChild(root);
  return {
    root,
    headers: Array.from(root.querySelectorAll<HTMLButtonElement>('.weave-expansion__header')),
    regions: Array.from(root.querySelectorAll<HTMLElement>('.weave-expansion__region')),
    dispose: (): void => { disposeOwner(owner); root.remove(); },
  };
}

const PANELS: ExpansionPanel[] = [
  { id: 'a', header: 'First', body: 'Body A' },
  { id: 'b', header: 'Second', body: 'Body B' },
  { id: 'c', header: 'Third', body: 'Body C' },
];
const key = (target: EventTarget, k: string): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
};

/* ─────────────────────────── structure + a11y ─────────────────────────── */

test('renders a header + region per panel, all collapsed by default', () => {
  const { root, headers, regions, dispose } = mount({ panels: PANELS });
  assert.equal(headers.length, 3);
  assert.equal(regions.length, 3);
  headers.forEach((h, i) => {
    assert.equal(h.getAttribute('type'), 'button');
    assert.equal(h.getAttribute('aria-expanded'), 'false');
    assert.equal(h.querySelector('.weave-expansion__title')?.textContent, PANELS[i].header);
    assert.ok(h.querySelector('.weave-expansion__marker'), 'marker present');
  });
  regions.forEach((r) => {
    assert.equal(r.getAttribute('role'), 'region');
    assert.equal(r.getAttribute('aria-hidden'), 'true');
    assert.ok(!r.hasAttribute('data-open'), 'closed region has no data-open');
    assert.equal(r.inert, true, 'closed region is inert');
  });
  assert.ok(root.classList.contains('weave-expansion'));
  dispose();
});

test('a11y: heading wrapper carries role=heading + aria-level, header controls its region', () => {
  const { root, headers, regions, dispose } = mount({ panels: PANELS, headingLevel: 2 });
  const headings: HTMLElement[] = Array.from(root.querySelectorAll<HTMLElement>('.weave-expansion__heading'));
  assert.ok(headings.every((h) => h.getAttribute('role') === 'heading'), 'each heading has role=heading');
  assert.ok(headings.every((h) => h.getAttribute('aria-level') === '2'), 'aria-level forwarded');
  headers.forEach((h, i) => {
    assert.equal(h.getAttribute('aria-controls'), regions[i].id, 'aria-controls → region id');
    assert.equal(regions[i].getAttribute('aria-labelledby'), h.id, 'region labelled by its header');
  });
  dispose();
});

test('defaults aria-level to 3', () => {
  const { root, dispose } = mount({ panels: PANELS });
  assert.equal(root.querySelector('.weave-expansion__heading')?.getAttribute('aria-level'), '3');
  dispose();
});

/* ─────────────────────────── body content ─────────────────────────── */

test('appends string / factory / node body content on mount', async () => {
  const node: HTMLElement = document.createElement('span');
  node.textContent = 'node-body';
  const { regions, dispose } = mount({
    panels: [
      { id: 'a', header: 'A', body: 'string-body' },
      { id: 'b', header: 'B', body: (): Node => { const d: HTMLElement = document.createElement('em'); d.textContent = 'factory-body'; return d; } },
      { id: 'c', header: 'C', body: node },
    ],
  });
  await tick();
  assert.ok(regions[0].textContent?.includes('string-body'), 'string appended');
  assert.ok(regions[1].querySelector('em')?.textContent === 'factory-body', 'factory node appended');
  assert.ok(regions[2].querySelector('span')?.textContent === 'node-body', 'node appended');
  dispose();
});

/* ─────────────────────────── toggle + multi/single ─────────────────────────── */

test('click opens a panel (aria-expanded/data-open/aria-hidden/inert flip)', async () => {
  const { headers, regions, dispose } = mount({ panels: PANELS });
  headers[0].click();
  await tick();
  assert.equal(headers[0].getAttribute('aria-expanded'), 'true');
  assert.equal(regions[0].getAttribute('data-open'), 'true');
  assert.ok(!regions[0].hasAttribute('aria-hidden'), 'open region drops aria-hidden');
  assert.equal(regions[0].inert, false, 'open region is not inert');
  dispose();
});

// The +/− marker used to be a CSS `content:` character flipped by an [aria-expanded] selector.
// It is a lucide `plus`/`minus` <Icon> chosen in the template now, so the flip is behaviour and
// belongs here rather than in the stylesheet gate. lucide draws `plus` as two <path>s (a cross)
// and `minus` as one — a structural difference that does not depend on reading the icon's name.
test('the marker icon flips plus → minus when a panel opens', async () => {
  const { headers, dispose } = mount({ panels: PANELS });
  const marker = (): SVGSVGElement =>
    headers[0].querySelector('.weave-expansion__marker svg') as SVGSVGElement;
  assert.ok(marker(), 'marker renders an icon');
  assert.equal(marker().querySelectorAll('path').length, 2, 'closed = plus (two strokes)');
  headers[0].click();
  await tick();
  assert.equal(marker().querySelectorAll('path').length, 1, 'open = minus (one stroke)');
  headers[0].click();
  await tick();
  assert.equal(marker().querySelectorAll('path').length, 2, 'closed again = plus');
  dispose();
});

test('click again closes it', async () => {
  const { headers, regions, dispose } = mount({ panels: PANELS });
  headers[0].click();
  await tick();
  headers[0].click();
  await tick();
  assert.equal(headers[0].getAttribute('aria-expanded'), 'false');
  assert.ok(!regions[0].hasAttribute('data-open'));
  assert.equal(regions[0].inert, true);
  dispose();
});

test('multi (default): panels open independently', async () => {
  const { headers, dispose } = mount({ panels: PANELS });
  headers[0].click();
  headers[2].click();
  await tick();
  assert.equal(headers[0].getAttribute('aria-expanded'), 'true');
  assert.equal(headers[1].getAttribute('aria-expanded'), 'false');
  assert.equal(headers[2].getAttribute('aria-expanded'), 'true');
  dispose();
});

test('single (multi=false): opening one closes the rest', async () => {
  const { headers, dispose } = mount({ panels: PANELS, multi: false });
  headers[0].click();
  await tick();
  assert.equal(headers[0].getAttribute('aria-expanded'), 'true');
  headers[1].click();
  await tick();
  assert.equal(headers[0].getAttribute('aria-expanded'), 'false', 'first closed');
  assert.equal(headers[1].getAttribute('aria-expanded'), 'true', 'second open');
  dispose();
});

/* ─────────────────────────── controlled + uncontrolled ─────────────────────────── */

test('uncontrolled defaultOpen seeds the initial open set', () => {
  const { headers, dispose } = mount({ panels: PANELS, defaultOpen: ['b'] });
  assert.equal(headers[0].getAttribute('aria-expanded'), 'false');
  assert.equal(headers[1].getAttribute('aria-expanded'), 'true');
  dispose();
});

test('controlled value drives open state; onChange reports the next set', async () => {
  const open: Signal<string[]> = signal<string[]>([]);
  const seen: string[][] = [];
  const { headers, dispose } = mount({
    panels: PANELS,
    get value(): string[] { return open(); },
    onChange: (ids): void => { seen.push(ids); open.set(ids); },
  } as ExpansionProps);
  headers[0].click();
  await tick();
  assert.deepEqual(seen[0], ['a'], 'onChange got the next open ids');
  assert.equal(headers[0].getAttribute('aria-expanded'), 'true', 'value re-drove the DOM');
  dispose();
});

/* ─────────────────────────── disabled ─────────────────────────── */

test('a disabled panel is marked and does not toggle', async () => {
  const { headers, dispose } = mount({
    panels: [{ id: 'a', header: 'A', body: 'x' }, { id: 'b', header: 'B', body: 'y', disabled: true }],
  });
  assert.equal(headers[1].getAttribute('aria-disabled'), 'true');
  headers[1].click();
  await tick();
  assert.equal(headers[1].getAttribute('aria-expanded'), 'false', 'disabled panel stayed closed');
  dispose();
});

test('disabled on the whole accordion blocks every toggle', async () => {
  const { headers, dispose } = mount({ panels: PANELS, disabled: true });
  assert.ok(headers.every((h) => h.getAttribute('aria-disabled') === 'true'));
  headers[0].click();
  await tick();
  assert.equal(headers[0].getAttribute('aria-expanded'), 'false');
  dispose();
});

/* ─────────────────────────── keyboard ─────────────────────────── */

test('Down/Up/Home/End move focus between headers', () => {
  const { headers, dispose } = mount({ panels: PANELS });
  headers[0].focus();
  key(headers[0], 'ArrowDown');
  assert.equal(document.activeElement, headers[1], 'Down → next header');
  key(headers[1], 'ArrowUp');
  assert.equal(document.activeElement, headers[0], 'Up → previous header');
  key(headers[0], 'End');
  assert.equal(document.activeElement, headers[2], 'End → last header');
  key(headers[2], 'Home');
  assert.equal(document.activeElement, headers[0], 'Home → first header');
  dispose();
});

test('ArrowDown wraps and skips a disabled header', () => {
  const { headers, dispose } = mount({
    panels: [
      { id: 'a', header: 'A', body: 'x' },
      { id: 'b', header: 'B', body: 'y', disabled: true },
      { id: 'c', header: 'C', body: 'z' },
    ],
  });
  headers[0].focus();
  key(headers[0], 'ArrowDown');
  assert.equal(document.activeElement, headers[2], 'skips the disabled middle header');
  key(headers[2], 'ArrowDown');
  assert.equal(document.activeElement, headers[0], 'wraps to the first');
  dispose();
});

/* ─────────────────────────── class forwarding ─────────────────────────── */

test('forwards a custom class onto the container', () => {
  const { root, dispose } = mount({ panels: PANELS, class: 'my-accordion' });
  assert.ok(root.classList.contains('weave-expansion') && root.classList.contains('my-accordion'));
  dispose();
});
