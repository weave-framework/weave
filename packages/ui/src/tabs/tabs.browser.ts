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
import { setup, template, type TabsProps, type TabsContext, type TabItem } from '@weave-framework/ui/tabs';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };

/** Flush microtasks (fires the deferred onMount content-append). */
const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));

const SCOPE: string[] = [
  'host', 'tabs', 'rootClass', 'label', 'tabId', 'panelId', 'selectedAttr',
  'disabledAttr', 'tabTabindex', 'isHidden', 'select', 'onKeydown',
];

interface Mounted {
  root: HTMLElement;
  tabsEls: HTMLButtonElement[];
  panels: HTMLElement[];
  dispose: () => void;
}

function mount(props: TabsProps): Mounted {
  const owner: Owner = createOwner();
  const root: HTMLElement = runInOwner(owner, () => {
    const ctx: TabsContext = setup(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: SCOPE });
    const fn: (c: unknown, r: unknown, k: unknown) => HTMLElement = new Function('ctx', 'rt', '_c', code) as (
      c: unknown,
      r: unknown,
      k: unknown
    ) => HTMLElement;
    return fn(ctx, rt, {});
  });
  document.body.appendChild(root);
  return {
    root,
    tabsEls: Array.from(root.querySelectorAll<HTMLButtonElement>('.weave-tabs__tab')),
    panels: Array.from(root.querySelectorAll<HTMLElement>('.weave-tabs__panel')),
    dispose: (): void => { disposeOwner(owner); root.remove(); },
  };
}

const TABS: TabItem[] = [
  { label: 'Overview', content: 'Overview body' },
  { label: 'Specs', content: 'Specs body' },
  { label: 'Reviews', content: 'Reviews body' },
];
const key = (target: EventTarget, k: string): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
};

/* ─────────────────────────── structure + a11y ─────────────────────────── */

test('renders a tablist of tabs + one panel each; first selected by default', () => {
  const { root, tabsEls, panels, dispose } = mount({ tabs: TABS });
  assert.equal(root.querySelector('.weave-tabs__list')?.getAttribute('role'), 'tablist');
  assert.equal(tabsEls.length, 3);
  assert.equal(panels.length, 3);
  assert.ok(tabsEls.every((t) => t.getAttribute('role') === 'tab' && t.getAttribute('type') === 'button'));
  assert.ok(panels.every((p) => p.getAttribute('role') === 'tabpanel'));
  assert.equal(tabsEls[0].getAttribute('aria-selected'), 'true');
  assert.equal(tabsEls[1].getAttribute('aria-selected'), 'false');
  dispose();
});

test('a11y: tab aria-controls its panel, panel aria-labelledby its tab; roving tabindex', () => {
  const { tabsEls, panels, dispose } = mount({ tabs: TABS });
  tabsEls.forEach((t, i) => {
    assert.equal(t.getAttribute('aria-controls'), panels[i].id);
    assert.equal(panels[i].getAttribute('aria-labelledby'), t.id);
  });
  // only the selected tab is in the tab sequence
  assert.equal(tabsEls[0].getAttribute('tabindex'), '0');
  assert.equal(tabsEls[1].getAttribute('tabindex'), '-1');
  assert.equal(tabsEls[2].getAttribute('tabindex'), '-1');
  dispose();
});

/* ─────────────────────────── content + visibility ─────────────────────────── */

test('appends panel content on mount; only the active panel is visible', async () => {
  const node: HTMLElement = document.createElement('b');
  node.textContent = 'node-panel';
  const { panels, dispose } = mount({
    tabs: [
      { label: 'A', content: 'string-panel' },
      { label: 'B', content: (): Node => { const e: HTMLElement = document.createElement('i'); e.textContent = 'factory-panel'; return e; } },
      { label: 'C', content: node },
    ],
  });
  await tick();
  assert.ok(panels[0].textContent?.includes('string-panel'));
  assert.equal(panels[1].querySelector('i')?.textContent, 'factory-panel');
  assert.equal(panels[2].querySelector('b')?.textContent, 'node-panel');
  assert.equal(panels[0].hidden, false, 'active panel shown');
  assert.equal(panels[1].hidden, true, 'inactive panel hidden');
  assert.equal(panels[2].hidden, true);
  dispose();
});

/* ─────────────────────────── selection ─────────────────────────── */

test('clicking a tab selects it and switches the visible panel', async () => {
  const { tabsEls, panels, dispose } = mount({ tabs: TABS });
  tabsEls[2].click();
  await tick();
  assert.equal(tabsEls[2].getAttribute('aria-selected'), 'true');
  assert.equal(tabsEls[0].getAttribute('aria-selected'), 'false');
  assert.equal(panels[2].hidden, false);
  assert.equal(panels[0].hidden, true);
  assert.equal(tabsEls[2].getAttribute('tabindex'), '0', 'roving tab stop follows selection');
  dispose();
});

test('uncontrolled defaultIndex seeds the initial selection', () => {
  const { tabsEls, dispose } = mount({ tabs: TABS, defaultIndex: 1 });
  assert.equal(tabsEls[1].getAttribute('aria-selected'), 'true');
  assert.equal(tabsEls[0].getAttribute('aria-selected'), 'false');
  dispose();
});

test('controlled value drives selection; onChange reports the next index', async () => {
  const idx: Signal<number> = signal<number>(0);
  const seen: number[] = [];
  const { tabsEls, dispose } = mount({
    tabs: TABS,
    get value(): number { return idx(); },
    onChange: (i): void => { seen.push(i); idx.set(i); },
  } as TabsProps);
  tabsEls[1].click();
  await tick();
  assert.deepEqual(seen, [1]);
  assert.equal(tabsEls[1].getAttribute('aria-selected'), 'true', 'value re-drove the DOM');
  dispose();
});

/* ─────────────────────────── disabled ─────────────────────────── */

test('a disabled tab is marked and not selectable', async () => {
  const { tabsEls, dispose } = mount({
    tabs: [{ label: 'A', content: 'a' }, { label: 'B', content: 'b', disabled: true }],
  });
  assert.equal(tabsEls[1].getAttribute('aria-disabled'), 'true');
  assert.equal(tabsEls[1].getAttribute('tabindex'), '-1');
  tabsEls[1].click();
  await tick();
  assert.equal(tabsEls[1].getAttribute('aria-selected'), 'false');
  assert.equal(tabsEls[0].getAttribute('aria-selected'), 'true');
  dispose();
});

/* ─────────────────────────── keyboard ─────────────────────────── */

test('manual activation: Arrow moves focus only; Enter/Space selects', async () => {
  const { tabsEls, dispose } = mount({ tabs: TABS });
  tabsEls[0].focus();
  key(tabsEls[0], 'ArrowRight');
  assert.equal(document.activeElement, tabsEls[1], 'focus moved to next tab');
  assert.equal(tabsEls[1].getAttribute('aria-selected'), 'false', 'but selection did not follow focus');
  key(tabsEls[1], 'Enter');
  await tick();
  assert.equal(tabsEls[1].getAttribute('aria-selected'), 'true', 'Enter activates the focused tab');
  dispose();
});

test('ArrowLeft wraps; Home/End jump to first/last', () => {
  const { tabsEls, dispose } = mount({ tabs: TABS });
  tabsEls[0].focus();
  key(tabsEls[0], 'ArrowLeft');
  assert.equal(document.activeElement, tabsEls[2], 'wraps to last');
  key(tabsEls[2], 'Home');
  assert.equal(document.activeElement, tabsEls[0], 'Home → first');
  key(tabsEls[0], 'End');
  assert.equal(document.activeElement, tabsEls[2], 'End → last');
  dispose();
});

test('activateOnFocus: Arrow moves focus AND selection', async () => {
  const { tabsEls, dispose } = mount({ tabs: TABS, activateOnFocus: true });
  tabsEls[0].focus();
  key(tabsEls[0], 'ArrowRight');
  await tick();
  assert.equal(document.activeElement, tabsEls[1]);
  assert.equal(tabsEls[1].getAttribute('aria-selected'), 'true', 'selection follows focus');
  dispose();
});

test('keyboard nav skips a disabled tab', () => {
  const { tabsEls, dispose } = mount({
    tabs: [
      { label: 'A', content: 'a' },
      { label: 'B', content: 'b', disabled: true },
      { label: 'C', content: 'c' },
    ],
  });
  tabsEls[0].focus();
  key(tabsEls[0], 'ArrowRight');
  assert.equal(document.activeElement, tabsEls[2], 'skips the disabled middle tab');
  dispose();
});

/* ─────────────────────────── class forwarding ─────────────────────────── */

test('forwards a custom class onto the container', () => {
  const { root, dispose } = mount({ tabs: TABS, class: 'my-tabs' });
  assert.ok(root.classList.contains('weave-tabs') && root.classList.contains('my-tabs'));
  dispose();
});
