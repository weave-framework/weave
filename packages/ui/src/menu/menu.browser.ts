import { test, assert } from '../../../../tools/harness.js';
import { overlayContainer, type ConnectedPosition } from '@weave-framework/ui/cdk';
import { menu, type MenuItem, type MenuOptions } from '@weave-framework/ui/menu';
import { buildPositions } from './menu-core.js';

const ITEMS: MenuItem[] = [
  { value: 'edit', label: 'Edit' },
  { value: 'dup', label: 'Duplicate' },
  { value: 'sep', label: '', divider: true },
  { value: 'archive', label: 'Archive', disabled: true },
  { value: 'del', label: 'Delete' },
];

function mount(over: Partial<MenuOptions> = {}): {
  trigger: HTMLButtonElement;
  selected: Array<string | MenuItem>;
  cleanup: () => void;
} {
  const trigger: HTMLButtonElement = document.createElement('button');
  trigger.textContent = 'Actions';
  document.body.appendChild(trigger);
  const selected: Array<string | MenuItem> = [];
  const cleanup: () => void = menu(trigger, {
    items: over.items ?? ITEMS,
    onSelect: (v) => selected.push(v),
    position: over.position,
    selected: over.selected,
  });
  return { trigger, selected, cleanup };
}

const panel = (): HTMLElement | null => overlayContainer().querySelector('.weave-menu');
const items = (): HTMLButtonElement[] =>
  Array.from(overlayContainer().querySelectorAll('.weave-menu__item')) as HTMLButtonElement[];
const key = (el: EventTarget, k: string): void => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
};
// Open by keyboard (↓ on the trigger) — highlights the first item.
const openByKeyboard = (trigger: HTMLElement): void => {
  trigger.focus();
  key(trigger, 'ArrowDown');
};

function teardown(trigger: HTMLElement, cleanup: () => void): void {
  cleanup();
  trigger.remove();
}

test('menu: trigger carries aria-haspopup=menu and aria-expanded, toggled on open/close', () => {
  const { trigger, cleanup } = mount();
  assert.equal(trigger.getAttribute('aria-haspopup'), 'menu');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  trigger.click();
  assert.equal(trigger.getAttribute('aria-expanded'), 'true', 'expanded after open');
  assert.ok(panel(), 'panel is shown');
  trigger.click();
  assert.equal(trigger.getAttribute('aria-expanded'), 'false', 'collapsed after re-click');
  assert.equal(panel(), null, 'panel removed');
  teardown(trigger, cleanup);
});

test('menu: role=menu panel renders one menuitem per non-divider item + a separator', () => {
  const { trigger, cleanup } = mount();
  trigger.click();
  assert.equal(panel()?.getAttribute('role'), 'menu');
  // 4 real items (edit/dup/archive/del) + 1 separator; archive is disabled.
  assert.equal(items().length, 4, 'four menuitem buttons');
  assert.equal(overlayContainer().querySelectorAll('.weave-menu__divider').length, 1, 'one divider');
  const archive: HTMLButtonElement = items().find((b) => b.textContent === 'Archive') as HTMLButtonElement;
  assert.equal(archive.disabled, true, 'disabled item is a disabled button');
  assert.equal(archive.getAttribute('aria-disabled'), 'true');
  teardown(trigger, cleanup);
});

test('menu: a pointer open highlights nothing (focus rests on the panel)', () => {
  const { trigger, cleanup } = mount();
  trigger.click();
  assert.equal(document.activeElement, panel(), 'focus is on the panel, not an item');
  assert.ok(
    items().every((b) => b.tabIndex === -1),
    'all menuitems tabindex -1 (roving via focus)',
  );
  teardown(trigger, cleanup);
});

test('menu: a keyboard open highlights the first item', () => {
  const { trigger, cleanup } = mount();
  openByKeyboard(trigger);
  assert.equal(document.activeElement, items()[0], 'first item focused on keyboard open');
  teardown(trigger, cleanup);
});

test('menu: after a pointer open, the first ArrowDown steps in to the first item', () => {
  const { trigger, cleanup } = mount();
  trigger.click();
  key(panel() as HTMLElement, 'ArrowDown');
  assert.equal(document.activeElement, items()[0], 'first arrow highlights the first item');
  teardown(trigger, cleanup);
});

test('menu: ArrowDown/Up move roving focus and skip the disabled item', () => {
  const { trigger, cleanup } = mount();
  openByKeyboard(trigger); // first item (Edit) highlighted
  const [edit, dup, del] = items().filter((b) => !b.disabled); // enabled order: Edit, Duplicate, Delete
  const p: HTMLElement = panel() as HTMLElement;
  assert.equal(document.activeElement, edit);
  key(p, 'ArrowDown');
  assert.equal(document.activeElement, dup, 'down → Duplicate');
  key(p, 'ArrowDown');
  assert.equal(document.activeElement, del, 'down skips disabled Archive → Delete');
  key(p, 'ArrowUp');
  assert.equal(document.activeElement, dup, 'up → Duplicate');
  teardown(trigger, cleanup);
});

test('menu: Home/End jump to the first/last enabled item', () => {
  const { trigger, cleanup } = mount();
  openByKeyboard(trigger);
  const enabled: HTMLButtonElement[] = items().filter((b) => !b.disabled);
  const p: HTMLElement = panel() as HTMLElement;
  key(p, 'End');
  assert.equal(document.activeElement, enabled[enabled.length - 1], 'End → last');
  key(p, 'Home');
  assert.equal(document.activeElement, enabled[0], 'Home → first');
  teardown(trigger, cleanup);
});

test('menu: Enter on the active item selects it and closes, returning focus to the trigger', () => {
  const { trigger, selected, cleanup } = mount();
  openByKeyboard(trigger); // Edit highlighted
  key(panel() as HTMLElement, 'ArrowDown'); // -> Duplicate
  key(panel() as HTMLElement, 'Enter');
  assert.deepEqual(selected, ['dup'], 'selected the active item');
  assert.equal(panel(), null, 'closed');
  assert.equal(document.activeElement, trigger, 'focus returned to trigger');
  teardown(trigger, cleanup);
});

test('menu: clicking a menuitem selects its value and closes', () => {
  const { trigger, selected, cleanup } = mount();
  trigger.click();
  (items().find((b) => b.textContent === 'Delete') as HTMLButtonElement).click();
  assert.deepEqual(selected, ['del']);
  assert.equal(panel(), null, 'closed after click');
  teardown(trigger, cleanup);
});

test('menu: typeahead jumps to the item starting with the typed letter', () => {
  const { trigger, cleanup } = mount();
  openByKeyboard(trigger);
  key(panel() as HTMLElement, 'd'); // Duplicate is first enabled starting with 'd'
  assert.equal(document.activeElement, items().find((b) => b.textContent === 'Duplicate'));
  teardown(trigger, cleanup);
});

test('menu: Escape closes and returns focus to the trigger', () => {
  const { trigger, cleanup } = mount();
  trigger.click();
  key(panel() as HTMLElement, 'Escape');
  assert.equal(panel(), null, 'closed on Escape');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, trigger, 'focus returned');
  teardown(trigger, cleanup);
});

test('menu: ArrowDown on the closed trigger opens the menu (keyboard)', () => {
  const { trigger, cleanup } = mount();
  trigger.focus();
  key(trigger, 'ArrowDown');
  assert.ok(panel(), 'opened via ArrowDown');
  assert.equal(document.activeElement, items()[0]);
  teardown(trigger, cleanup);
});

test('menu: the backdrop is a transparent click-catcher (not a dimming scrim)', () => {
  const { trigger, cleanup } = mount();
  trigger.click();
  const backdrop: HTMLElement = overlayContainer().querySelector('.weave-overlay-backdrop') as HTMLElement;
  assert.ok(backdrop, 'a backdrop exists');
  assert.ok(backdrop.classList.contains('weave-overlay-backdrop--transparent'), 'transparent variant');
  teardown(trigger, cleanup);
});

test('menu: a backdrop click closes the menu (does NOT return focus to the trigger)', () => {
  const { trigger, cleanup } = mount();
  trigger.click();
  const backdrop: HTMLElement = overlayContainer().querySelector('.weave-overlay-backdrop') as HTMLElement;
  backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(panel(), null, 'closed on click-away');
  teardown(trigger, cleanup);
});

test('menu: an item description renders as a __label + __description subtext row', () => {
  const trigger: HTMLButtonElement = document.createElement('button');
  document.body.appendChild(trigger);
  const cleanup: () => void = menu(trigger, {
    items: [{ value: 'export', label: 'Export', description: 'Download as CSV' }],
    onSelect: (): void => {},
  });
  trigger.click();
  const item: HTMLElement = overlayContainer().querySelector('.weave-menu__item') as HTMLElement;
  assert.equal(item.querySelector('.weave-menu__label')?.textContent, 'Export');
  assert.equal(item.querySelector('.weave-menu__description')?.textContent, 'Download as CSV');
  cleanup();
  trigger.remove();
});

test('menu: custom option objects via accessors + emit:object returns the whole item', () => {
  interface Row {
    id: string;
    name: string;
    note: string;
  }
  const rows: Row[] = [
    { id: 'u1', name: 'Ada', note: 'Owner' },
    { id: 'u2', name: 'Grace', note: 'Admin' },
  ];
  const picked: Array<string | Row> = [];
  const trigger: HTMLButtonElement = document.createElement('button');
  document.body.appendChild(trigger);
  const cleanup: () => void = menu<Row>(trigger, {
    items: rows,
    optionValue: (r) => r.id,
    optionLabel: (r) => r.name,
    optionDescription: (r) => r.note,
    emit: 'object',
    onSelect: (r) => picked.push(r),
  });
  trigger.click();
  const items: HTMLButtonElement[] = Array.from(
    overlayContainer().querySelectorAll('.weave-menu__item'),
  ) as HTMLButtonElement[];
  assert.equal(items[0].querySelector('.weave-menu__label')?.textContent, 'Ada');
  assert.equal(items[0].querySelector('.weave-menu__description')?.textContent, 'Owner');
  items[1].click();
  assert.deepEqual(picked, [rows[1]], 'emit:object returns the whole row object');
  cleanup();
  trigger.remove();
});

test('menu: plain string options work with zero config (value = label = the string)', () => {
  const picked: Array<string | string> = [];
  const trigger: HTMLButtonElement = document.createElement('button');
  document.body.appendChild(trigger);
  const cleanup: () => void = menu<string>(trigger, {
    items: ['Red', 'Green', 'Blue'],
    onSelect: (v) => picked.push(v),
  });
  trigger.click();
  const items: HTMLButtonElement[] = Array.from(
    overlayContainer().querySelectorAll('.weave-menu__item'),
  ) as HTMLButtonElement[];
  assert.equal(items[0].querySelector('.weave-menu__label')?.textContent, 'Red');
  items[2].click();
  assert.deepEqual(picked, ['Blue'], 'string option emits itself as the value');
  cleanup();
  trigger.remove();
});

test('menu: buildPositions appends the opposite preset (flip) and passes explicit pairs through', () => {
  assert.deepEqual(buildPositions(undefined, 'bottom-start'), ['bottom-start', 'top-start']);
  assert.deepEqual(buildPositions('top-end', 'bottom-start'), ['top-end', 'bottom-end']);
  assert.deepEqual(buildPositions('right', 'bottom-start'), ['right', 'left']);
  const pair: ConnectedPosition = { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top' };
  assert.deepEqual(buildPositions(pair, 'bottom-start'), [pair]);
});

test('menu: position places the panel above a bottom-anchored trigger (top preset)', () => {
  const trigger: HTMLButtonElement = document.createElement('button');
  trigger.style.cssText = 'position:fixed; left:120px; top:300px; width:90px; height:34px';
  document.body.appendChild(trigger);
  const cleanup: () => void = menu(trigger, { items: ITEMS, onSelect: (): void => {}, position: 'top-start' });
  trigger.click();
  const wrapper: HTMLElement = panel()?.parentElement as HTMLElement;
  const top: number = parseFloat(wrapper.style.top);
  // top-start: panel's bottom edge sits on the trigger's top (300) → panel is above it.
  assert.ok(top < 300, `panel is above the trigger (top ${top} < 300)`);
  assert.ok(Math.abs(parseFloat(wrapper.style.left) - 120) < 2, 'left-aligned to the trigger');
  cleanup();
  trigger.remove();
});

test('menu: cleanup closes the panel and strips the trigger ARIA (no leak)', () => {
  const { trigger, cleanup } = mount();
  trigger.click();
  assert.ok(panel());
  cleanup();
  assert.equal(panel(), null, 'panel gone after cleanup');
  assert.equal(trigger.getAttribute('aria-haspopup'), null, 'aria-haspopup removed');
  assert.equal(trigger.getAttribute('aria-expanded'), null, 'aria-expanded removed');
  trigger.remove();
});

/* ─────────────────────────── value picker (`selected`) ─────────────────────────── */

test('menu: `selected` marks the matching row role=menuitemradio + aria-checked (value picker)', () => {
  const { trigger, cleanup } = mount({ selected: 'dup' });
  trigger.click();
  assert.ok(panel()!.classList.contains('weave-menu--selectable'), 'panel is a selectable menu');
  const rows: HTMLButtonElement[] = items();
  // enabled non-divider rows: Edit, Duplicate, Delete (archive is disabled → excluded from items())
  const byLabel = (l: string): HTMLButtonElement =>
    rows.find((r) => r.querySelector('.weave-menu__label')?.textContent === l)!;
  assert.equal(byLabel('Duplicate').getAttribute('role'), 'menuitemradio');
  assert.equal(byLabel('Duplicate').getAttribute('aria-checked'), 'true', 'the selected value is checked');
  assert.equal(byLabel('Edit').getAttribute('aria-checked'), 'false', 'others are unchecked');
  assert.ok(byLabel('Duplicate').querySelector('.weave-menu__check'), 'a check gutter is rendered');
  teardown(trigger, cleanup);
});

test('menu: a `selected` getter is re-read on every open, so the check follows the value', () => {
  let current = 'edit';
  const { trigger, cleanup } = mount({ selected: () => current });
  const checkedLabel = (): string | undefined =>
    items().find((r) => r.getAttribute('aria-checked') === 'true')
      ?.querySelector('.weave-menu__label')?.textContent ?? undefined;

  trigger.click();
  assert.equal(checkedLabel(), 'Edit', 'first open checks the current value');
  trigger.click(); // close

  current = 'del';
  trigger.click();
  assert.equal(checkedLabel(), 'Delete', 're-open reflects the new value (getter re-read)');
  teardown(trigger, cleanup);
});

test('menu: without `selected`, rows stay plain role=menuitem (no radio) — back-compat', () => {
  const { trigger, cleanup } = mount();
  trigger.click();
  assert.ok(!panel()!.classList.contains('weave-menu--selectable'));
  assert.equal(items()[0].getAttribute('role'), 'menuitem');
  assert.equal(items()[0].getAttribute('aria-checked'), null, 'no aria-checked on a plain action menu');
  teardown(trigger, cleanup);
});

/* ─────────────────────── custom row content (`optionContent`) — FW-9 ─────────────────────── */

interface Lang {
  value: string;
  label: string;
}
const LANGS: Lang[] = [
  { value: 'en', label: 'English' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'lt', label: 'Lietuvių' },
];
// A flag-swatch + native-name row — the language-picker case FW-9 exists to support.
function flagRow(l: Lang): Node {
  const row: HTMLElement = document.createElement('span');
  row.className = 'demo-flag-row';
  const flag: HTMLElement = document.createElement('i');
  flag.className = 'demo-flag';
  flag.dataset.flag = l.value;
  const name: HTMLElement = document.createElement('span');
  name.className = 'demo-flag-name';
  name.textContent = l.label;
  row.append(flag, name);
  return row;
}

function mountLang(over: Partial<MenuOptions<Lang>> = {}): {
  trigger: HTMLButtonElement;
  picked: Array<string | Lang>;
  cleanup: () => void;
} {
  const trigger: HTMLButtonElement = document.createElement('button');
  document.body.appendChild(trigger);
  const picked: Array<string | Lang> = [];
  const cleanup: () => void = menu<Lang>(trigger, {
    items: LANGS,
    optionContent: flagRow,
    onSelect: (v) => picked.push(v),
    ...over,
  });
  return { trigger, picked, cleanup };
}

test('menu: optionContent renders custom row markup in place of the default label span (FW-9)', () => {
  const { trigger, cleanup } = mountLang();
  trigger.click();
  const rows: HTMLButtonElement[] = items();
  assert.equal(rows.length, 3, 'one row per option');
  // The default label span is NOT emitted — the author's markup is the row body instead.
  assert.equal(rows[0].querySelector('.weave-menu__label'), null, 'no default label span');
  assert.ok(rows[0].querySelector('.demo-flag-row'), 'custom content is the row body');
  assert.equal(rows[0].querySelector('.demo-flag')?.getAttribute('data-flag'), 'en');
  assert.equal(rows[0].querySelector('.demo-flag-name')?.textContent, 'English');
  teardown(trigger, cleanup);
});

test('menu: with optionContent, optionLabel still drives the accessible name (aria-label) (FW-9)', () => {
  const { trigger, cleanup } = mountLang();
  trigger.click();
  assert.equal(
    items()[1].getAttribute('aria-label'),
    'Nederlands',
    'aria-label = optionLabel even when the visible content is custom',
  );
  teardown(trigger, cleanup);
});

test('menu: with optionContent, typeahead still matches the optionLabel (FW-9)', () => {
  const { trigger, cleanup } = mountLang();
  openByKeyboard(trigger); // first row highlighted
  key(panel() as HTMLElement, 'n'); // "Nederlands"
  assert.equal(document.activeElement, items()[1], 'typeahead jumped to Nederlands via optionLabel');
  teardown(trigger, cleanup);
});

test('menu: optionContent composes with `selected` — the check AND custom content both render (FW-9)', () => {
  const { trigger, cleanup } = mountLang({ selected: 'nl' });
  trigger.click();
  assert.ok(panel()!.classList.contains('weave-menu--selectable'), 'still a value picker');
  const nl: HTMLButtonElement = items()[1];
  assert.equal(nl.getAttribute('role'), 'menuitemradio');
  assert.equal(nl.getAttribute('aria-checked'), 'true', 'the selected row is checked');
  assert.ok(nl.querySelector('.weave-menu__check'), 'the check gutter is present');
  // The custom content lives inside the body column, next to the check — not lost.
  assert.ok(
    nl.querySelector('.weave-menu__body .demo-flag-row'),
    'custom content sits in the body column alongside the check',
  );
  assert.equal(nl.getAttribute('aria-label'), 'Nederlands', 'accessible name preserved on the radio row');
  teardown(trigger, cleanup);
});

test('menu: selecting a custom-content row still emits its value (FW-9)', () => {
  const { trigger, picked, cleanup } = mountLang();
  trigger.click();
  items()[2].click();
  assert.deepEqual(picked, ['lt'], 'value emitted from the custom-content row');
  teardown(trigger, cleanup);
});

test('menu: without optionContent, rows keep the default label span and no aria-label (back-compat, FW-9)', () => {
  const { trigger, cleanup } = mount();
  trigger.click();
  assert.ok(items()[0].querySelector('.weave-menu__label'), 'default label span still rendered');
  assert.equal(items()[0].getAttribute('aria-label'), null, 'no aria-label added to default text rows');
  teardown(trigger, cleanup);
});
