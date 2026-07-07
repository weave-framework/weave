/**
 * FW-10 integration: the AUTHORING experience end-to-end. An author writes a per-row
 * `@snippet` (real weave template markup with `{{ }}` bindings over the row context) and hands
 * it to `use:menu` as `itemTemplate`. This compiles the template for real (function mode),
 * mounts the `use:menu` button, opens the panel, and asserts each row is stamped from the
 * snippet — bound to its item + reactive state — with the marker, layout and selected/active
 * styling all owned by the template. Proves the compiled-snippet path, not just the menu-core
 * function contract (that lives in menu.browser.ts).
 */
import { test, assert } from '../../../../tools/harness.js';
import {
  signal,
  computed,
  effect,
  root,
  createOwner,
  runInOwner,
  disposeOwner,
  type Owner,
  type Signal,
} from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate } from '@weave-framework/compiler';
import { menu, type MenuItem } from '@weave-framework/ui/menu';
import { overlayContainer } from '@weave-framework/ui/cdk';

// Everything the compiled (function-mode) template references as `rt`.
const rt: typeof dom & {
  signal: typeof signal;
  computed: typeof computed;
  effect: typeof effect;
  root: typeof root;
} = { ...dom, signal, computed, effect, root };

const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));

// The author's row template: flag + native name, a trailing `✓` only on the checked row, a
// live `is-active` class as the user arrows through, and an `is-checked` selected style — all
// authored, none of it weave's default markup.
const APP: string = `
@snippet langRow(row) {
  <span class="lang-row" class:is-checked={{ row.checked }} class:is-active={{ row.active() }}>
    <i class="flag" data-code={{ row.item.value }}></i>
    <span class="lang-row__name">{{ row.item.label }}</span>
    @if (row.checked) { <b class="lang-row__mark">check</b> }
  </span>
}
<button use:menu={{ { items: langs, selected: sel, onSelect: onSel, itemTemplate: langRow } }}>Language</button>
`;

interface Lang extends MenuItem {
  value: string;
  label: string;
}
const LANGS: Lang[] = [
  { value: 'en', label: 'English' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'lt', label: 'Lietuvių' },
];

interface AppCtx {
  menu: typeof menu;
  langs: Lang[];
  sel: () => string;
  onSel: (v: string | Lang) => void;
}

function mountApp(sel: Signal<string>, picked: Array<string | Lang>): {
  button: HTMLButtonElement;
  owner: Owner;
  host: HTMLElement;
} {
  const ctx: AppCtx = { menu, langs: LANGS, sel: () => sel(), onSel: (v) => picked.push(v) };
  const { code } = compileTemplate(APP, { mode: 'function', scope: ['menu', 'langs', 'sel', 'onSel'] });
  const fn: (ctx: AppCtx, rt: unknown, _c: unknown) => Node = new Function('ctx', 'rt', '_c', code) as (
    ctx: AppCtx,
    rt: unknown,
    _c: unknown,
  ) => Node;
  const owner: Owner = createOwner();
  // The template has a top-level `@snippet` declaration + the `<button>`, so the render root is
  // a fragment — mount it into a host and pull the button (identity preserved, so use:menu's
  // bound element stays live).
  const rootNode: Node = runInOwner(owner, () => fn(ctx, rt, {}));
  const host: HTMLElement = document.createElement('div');
  host.appendChild(rootNode);
  document.body.appendChild(host);
  const button: HTMLButtonElement = host.querySelector('button') as HTMLButtonElement;
  return { button, owner, host };
}

const panel = (): HTMLElement | null => overlayContainer().querySelector('.weave-menu');
const rows = (): HTMLButtonElement[] =>
  Array.from(overlayContainer().querySelectorAll('.weave-menu__item')) as HTMLButtonElement[];
const langRow = (btn: HTMLButtonElement): HTMLElement => btn.querySelector('.lang-row') as HTMLElement;
const key = (el: EventTarget, k: string): void =>
  void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

test('FW-10 integration: an authored @snippet row template stamps each row from the JSON item', async () => {
  const sel: Signal<string> = signal('nl');
  const picked: Array<string | Lang> = [];
  const { button, owner, host } = mountApp(sel, picked);
  await tick(); // let use:menu bind (applyAction runs on mount)

  button.click(); // pointer open
  assert.ok(panel(), 'panel opened');
  const rs: HTMLButtonElement[] = rows();
  assert.equal(rs.length, 3, 'one row per JSON item');

  // Each row is the author's markup, bound to that item — no weave default label/check.
  assert.equal(rs[0].querySelector('.weave-menu__label'), null, 'no default label span');
  assert.equal(rs[0].querySelector('.weave-menu__check'), null, 'no forced check gutter');
  assert.ok(rs[0].classList.contains('weave-menu__item--templated'), 'templated row');
  assert.equal(langRow(rs[0]).querySelector('.flag')?.getAttribute('data-code'), 'en', 'flag bound to item.value');
  assert.equal(langRow(rs[0]).querySelector('.lang-row__name')?.textContent, 'English', 'name bound to item.label');

  // The template owns the marker: a trailing ✓ + is-checked class only on the selected row.
  assert.ok(langRow(rs[1]).classList.contains('is-checked'), 'selected row has the authored selected style');
  assert.ok(langRow(rs[1]).querySelector('.lang-row__mark'), 'checked row shows the trailing template marker');
  assert.ok(!langRow(rs[0]).classList.contains('is-checked'), 'unchecked row is not styled selected');
  assert.equal(langRow(rs[0]).querySelector('.lang-row__mark'), null, 'unchecked row has no marker');

  // ARIA semantics still come from weave.
  assert.equal(rs[1].getAttribute('role'), 'menuitemradio');
  assert.equal(rs[1].getAttribute('aria-checked'), 'true');
  assert.equal(rs[1].getAttribute('aria-label'), 'Nederlands', 'optionLabel is the accessible name');

  disposeOwner(owner);
  host.remove();
});

test('FW-10 integration: row.active() in the template restyles the highlighted row as you arrow', async () => {
  const sel: Signal<string> = signal('en');
  const picked: Array<string | Lang> = [];
  const { button, owner, host } = mountApp(sel, picked);
  await tick();

  button.focus();
  key(button, 'ArrowDown'); // keyboard open → first row highlighted
  const rs: HTMLButtonElement[] = rows();
  assert.ok(langRow(rs[0]).classList.contains('is-active'), 'first row active on open');
  assert.ok(!langRow(rs[1]).classList.contains('is-active'), 'second row not active');

  key(panel() as HTMLElement, 'ArrowDown');
  assert.ok(!langRow(rs[0]).classList.contains('is-active'), 'first row no longer active');
  assert.ok(langRow(rs[1]).classList.contains('is-active'), 'active followed the keyboard to row 2');

  disposeOwner(owner);
  host.remove();
});

test('FW-10 integration: selecting a templated row emits its value + typeahead uses optionLabel', async () => {
  const sel: Signal<string> = signal('en');
  const picked: Array<string | Lang> = [];
  const { button, owner, host } = mountApp(sel, picked);
  await tick();

  button.focus();
  key(button, 'ArrowDown');
  key(panel() as HTMLElement, 'l'); // typeahead → "Lietuvių"
  assert.equal(document.activeElement, rows()[2], 'typeahead matched the label of a templated row');
  rows()[2].click();
  assert.deepEqual(picked, ['lt'], 'selecting the templated row emitted its value');
  assert.equal(panel(), null, 'menu closed on select');

  disposeOwner(owner);
  host.remove();
});
