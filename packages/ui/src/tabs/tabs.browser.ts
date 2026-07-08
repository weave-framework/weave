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
import { setup, template, type TabsProps, type TabsContext, type TabItem, type TabRowContext } from '@weave-framework/ui/tabs';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };

/** Flush microtasks (fires the deferred onMount content-append). */
const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));

const SCOPE: string[] = [
  'host', 'indicator', 'tabs', 'rootClass', 'label', 'hasTemplate', 'hasIndicator', 'tabId', 'panelId',
  'selectedAttr', 'disabledAttr', 'ariaLabel', 'tabTabindex', 'isHidden', 'select', 'onKeydown',
];

interface Mounted {
  root: HTMLElement;
  tabsEls: HTMLButtonElement[];
  panels: HTMLElement[];
  indicator: HTMLElement | null;
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
    indicator: root.querySelector<HTMLElement>('.weave-tabs__indicator'),
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

/* ─────────────────────────── FW-12 · tabTemplate ─────────────────────────── */

interface Ico { icon: string }
const ICON_TABS: TabItem<Ico>[] = [
  { label: 'Profile', content: 'p', data: { icon: 'user' } },
  { label: 'Password', content: 'pw', data: { icon: 'lock' } },
  { label: 'Security', content: 's', data: { icon: 'shield' } },
];
/** A plain-JS row factory (stands in for a compiled `@snippet`): icon glyph + label, active-marked. */
const iconRow = (row: TabRowContext<Ico>): Node => {
  const wrap: HTMLElement = document.createElement('span');
  wrap.className = 'tpl-btn';
  wrap.dataset.idx = String(row.index);
  if (row.selected) wrap.classList.add('is-sel');
  if (row.disabled) wrap.classList.add('is-disabled');
  const ico: HTMLElement = document.createElement('i');
  ico.className = 'tpl-ico';
  ico.dataset.icon = row.item.data?.icon ?? '';
  const lbl: HTMLElement = document.createElement('span');
  lbl.className = 'tpl-label';
  lbl.textContent = row.label;
  wrap.append(ico, lbl);
  return wrap;
};

test('tabTemplate renders the whole button content — icon + label — replacing the default label span (FW-12)', async () => {
  const { tabsEls, dispose } = mount({ tabs: ICON_TABS, tabTemplate: iconRow } as TabsProps);
  await tick();
  tabsEls.forEach((btn, i) => {
    assert.ok(btn.querySelector('.tpl-btn'), `tab ${i} has the custom template body`);
    assert.equal(btn.querySelector('.tpl-ico')?.getAttribute('data-icon'), ICON_TABS[i].data!.icon, 'icon from row.item.data');
    assert.equal(btn.querySelector('.tpl-label')?.textContent, ICON_TABS[i].label, 'label from row.label');
    assert.equal(btn.querySelector('.weave-tabs__label'), null, 'default label span is NOT rendered when templated');
  });
  dispose();
});

test('tabTemplate: label still drives the accessible name (aria-label); framework keeps role/tabindex (FW-12)', async () => {
  const { tabsEls, dispose } = mount({ tabs: ICON_TABS, tabTemplate: iconRow } as TabsProps);
  await tick();
  assert.equal(tabsEls[0].getAttribute('aria-label'), 'Profile', 'aria-label = label when templated');
  assert.equal(tabsEls[0].getAttribute('role'), 'tab', 'framework still owns the button role');
  assert.equal(tabsEls[0].getAttribute('tabindex'), '0', 'framework still owns roving tabindex');
  assert.equal(tabsEls[1].getAttribute('tabindex'), '-1');
  dispose();
});

test('no tabTemplate → default label span, no aria-label (back-compatible) (FW-12)', () => {
  const { tabsEls, dispose } = mount({ tabs: TABS });
  assert.equal(tabsEls[0].querySelector('.weave-tabs__label')?.textContent, 'Overview', 'default label span rendered');
  assert.equal(tabsEls[0].getAttribute('aria-label'), null, 'no aria-label on the default (text is the name)');
  dispose();
});

test('tabTemplate row context: item / label / index / selected / disabled are correct (FW-12)', async () => {
  const seen: TabRowContext<Ico>[] = [];
  const capture = (row: TabRowContext<Ico>): Node => { seen.push({ ...row }); return iconRow(row); };
  const tabs: TabItem<Ico>[] = [
    { label: 'Profile', content: 'p', data: { icon: 'user' } },
    { label: 'Password', content: 'pw', data: { icon: 'lock' }, disabled: true },
  ];
  const { dispose } = mount({ tabs, tabTemplate: capture, defaultIndex: 0 } as TabsProps);
  await tick();
  const p0: TabRowContext<Ico> = seen.find((r) => r.index === 0)!;
  const p1: TabRowContext<Ico> = seen.find((r) => r.index === 1)!;
  assert.equal(p0.label, 'Profile');
  assert.equal(p0.item.data?.icon, 'user', 'item carries the data payload');
  assert.equal(p0.selected, true, 'index 0 is the selected tab');
  assert.equal(p0.disabled, false);
  assert.equal(p1.selected, false);
  assert.equal(p1.disabled, true, 'disabled tab reported to the template');
  dispose();
});

test('tabTemplate is reactive: selecting a tab re-renders it with the new selected state (FW-12)', async () => {
  const { tabsEls, dispose } = mount({ tabs: ICON_TABS, tabTemplate: iconRow } as TabsProps);
  await tick();
  assert.ok(tabsEls[0].querySelector('.tpl-btn')?.classList.contains('is-sel'), 'first tab template is-sel on mount');
  assert.ok(!tabsEls[2].querySelector('.tpl-btn')?.classList.contains('is-sel'), 'third tab not selected');
  tabsEls[2].click();
  await tick();
  assert.ok(!tabsEls[0].querySelector('.tpl-btn')?.classList.contains('is-sel'), 'first tab no longer selected in template');
  assert.ok(tabsEls[2].querySelector('.tpl-btn')?.classList.contains('is-sel'), 'selected state moved to the clicked tab');
  dispose();
});

test('tabTemplate rows are torn down on unmount — no effect fires after dispose (FW-12)', async () => {
  const idx: Signal<number> = signal<number>(0);
  let renders: number = 0;
  const counting = (row: TabRowContext<Ico>): Node => { renders += 1; return iconRow(row); };
  const { dispose } = mount({
    tabs: ICON_TABS,
    tabTemplate: counting,
    get value(): number { return idx(); },
    onChange: (i): void => { idx.set(i); },
  } as TabsProps);
  await tick();
  const afterMount: number = renders;
  assert.ok(afterMount >= 3, 'each tab rendered once on mount');
  dispose();
  idx.set(2); // would re-run a live row effect; must be a no-op after dispose
  await tick();
  assert.equal(renders, afterMount, 'no row re-render after dispose (owner torn down)');
});

/* ─────────────────────────── FW-13 · slidingIndicator ─────────────────────────── */

test('no slidingIndicator → no indicator element (back-compatible) (FW-13)', () => {
  const { root, indicator, dispose } = mount({ tabs: TABS });
  assert.equal(indicator, null, 'no indicator without the opt-in');
  assert.equal(root.querySelector('.weave-tabs__indicator'), null);
  dispose();
});

test('slidingIndicator renders exactly one decorative indicator inside the tab list (FW-13)', () => {
  const { root, indicator, dispose } = mount({ tabs: TABS, slidingIndicator: true });
  assert.ok(indicator, 'indicator element rendered');
  assert.equal(root.querySelectorAll('.weave-tabs__indicator').length, 1, 'exactly one');
  assert.equal(indicator!.getAttribute('aria-hidden'), 'true', 'decorative (aria-hidden)');
  assert.ok(indicator!.closest('.weave-tabs__list'), 'sits inside the tab list');
  dispose();
});

test('slidingIndicator positions the indicator to the active tab box on mount (FW-13)', async () => {
  const { tabsEls, indicator, dispose } = mount({ tabs: TABS, slidingIndicator: true, defaultIndex: 0 });
  await tick();
  assert.equal(indicator!.style.transform, `translateX(${tabsEls[0].offsetLeft}px)`, 'translateX = active tab offsetLeft');
  assert.equal(indicator!.style.width, `${tabsEls[0].offsetWidth}px`, 'width = active tab offsetWidth');
  assert.notEqual(indicator!.style.width, '', 'geometry actually measured');
  dispose();
});

test('slidingIndicator slides + resizes to the clicked tab (FW-13)', async () => {
  const { tabsEls, indicator, dispose } = mount({ tabs: TABS, slidingIndicator: true });
  await tick();
  const before: string = indicator!.style.transform;
  tabsEls[2].click();
  await tick();
  assert.equal(indicator!.style.transform, `translateX(${tabsEls[2].offsetLeft}px)`, 'slid to tab 2 offsetLeft');
  assert.equal(indicator!.style.width, `${tabsEls[2].offsetWidth}px`, 'resized to tab 2 width');
  assert.notEqual(indicator!.style.transform, before, 'geometry moved from the initial tab');
  dispose();
});

test('slidingIndicator + tabTemplate compose (FW-13)', async () => {
  const { root, indicator, dispose } = mount({ tabs: ICON_TABS, tabTemplate: iconRow, slidingIndicator: true } as TabsProps);
  await tick();
  assert.ok(indicator, 'indicator rendered alongside a custom tab template');
  assert.ok(root.querySelector('.weave-tabs__tab .tpl-btn'), 'tab template still renders');
  assert.notEqual(indicator!.style.width, '', 'indicator still measured with a custom template');
  dispose();
});
