import { test, assert } from '../../../../tools/harness.js';
import { signal, effect, createOwner, runInOwner, disposeOwner, type Owner } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate, inferCtxNames, parseTemplate } from '@weave-framework/compiler';
import { setup, template, type MenubarProps, type MenubarContext, type MenubarMenu } from '@weave-framework/ui/menubar';
import type { MenuItem } from '@weave-framework/ui/menu';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };
const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));

type MakeRender = (ctx: MenubarContext, rt: unknown, c: unknown) => (ctx: MenubarContext, slots: Record<string, () => Node>) => HTMLElement;

interface Mounted {
  host: HTMLElement;
  owner: Owner;
  dispose: () => void;
}

const SCOPE: string[] = inferCtxNames(parseTemplate(template));

async function mount(props: MenubarProps): Promise<Mounted> {
  const owner: Owner = createOwner();
  const host: HTMLElement = runInOwner(owner, () => {
    const ctx: MenubarContext = setup(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: SCOPE });
    const make: MakeRender = new Function('ctx', 'rt', '_c', code.replace('return render(ctx, {});', 'return render;')) as MakeRender;
    return make(ctx, rt, {})(ctx, {});
  });
  document.body.appendChild(host);
  await tick();
  return {
    host,
    owner,
    dispose: (): void => {
      disposeOwner(owner);
      host.remove();
    },
  };
}

const FILE_ITEMS: MenuItem[] = [
  { value: 'new', label: 'New' },
  { value: 'open', label: 'Open' },
];
const EDIT_ITEMS: MenuItem[] = [
  { value: 'undo', label: 'Undo' },
  { value: 'redo', label: 'Redo' },
];
const MENUS: MenubarMenu[] = [
  { label: 'File', items: FILE_ITEMS },
  { label: 'Edit', items: EDIT_ITEMS },
  { label: 'View', items: [{ value: 'zoom', label: 'Zoom' }], disabled: true },
];

const topItems = (m: Mounted): HTMLButtonElement[] =>
  Array.from(m.host.querySelectorAll<HTMLButtonElement>('.weave-menubar__item'));
const menuPanel = (): HTMLElement | null => document.body.querySelector('.weave-menu');
const menuItems = (): HTMLButtonElement[] =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('.weave-menu__item'));
const barKey = (m: Mounted, k: string): void => {
  m.host.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: k }));
};

/* ── structure ── */
test('menubar: role=menubar of top menuitems with aria-haspopup', async () => {
  const m: Mounted = await mount({ menus: MENUS, label: 'Main' });
  assert.equal(m.host.getAttribute('role'), 'menubar');
  assert.equal(m.host.getAttribute('aria-label'), 'Main');
  const items: HTMLButtonElement[] = topItems(m);
  assert.equal(items.length, 3);
  assert.equal(items[0].getAttribute('aria-haspopup'), 'menu');
  assert.equal(items[0].textContent, 'File');
  assert.equal(items[2].getAttribute('aria-disabled'), 'true', 'View is disabled');
  m.dispose();
});

test('menubar: a single roving tab stop (first enabled item tabbable)', async () => {
  const m: Mounted = await mount({ menus: MENUS });
  assert.equal(topItems(m).filter((b) => b.getAttribute('tabindex') === '0').length, 1);
  assert.equal(topItems(m)[0].getAttribute('tabindex'), '0');
  m.dispose();
});

/* ── open / select ── */
test('menubar: clicking a top item opens its dropdown (aria-expanded true)', async () => {
  const m: Mounted = await mount({ menus: MENUS });
  assert.equal(menuPanel(), null);
  topItems(m)[0].click();
  assert.ok(menuPanel(), 'dropdown opened');
  assert.equal(topItems(m)[0].getAttribute('aria-expanded'), 'true');
  assert.deepEqual(menuItems().map((b) => b.textContent), ['New', 'Open']);
  m.dispose();
});

test('menubar: selecting an item fires onSelect + closes the dropdown', async () => {
  const picked: string[] = [];
  const m: Mounted = await mount({ menus: MENUS, onSelect: (v) => picked.push(v as string) });
  topItems(m)[0].click();
  menuItems()[1].click(); // Open
  assert.deepEqual(picked, ['open']);
  assert.equal(menuPanel(), null, 'closed after select');
  m.dispose();
});

test('menubar: clicking the open item again toggles it closed', async () => {
  const m: Mounted = await mount({ menus: MENUS });
  topItems(m)[0].click();
  assert.ok(menuPanel());
  topItems(m)[0].click();
  assert.equal(menuPanel(), null, 'toggled closed');
  m.dispose();
});

/* ── keyboard ── */
test('menubar: Left/Right rove the top items (skipping disabled, wrapping)', async () => {
  const m: Mounted = await mount({ menus: MENUS });
  barKey(m, 'ArrowRight'); // File → Edit
  assert.equal(document.activeElement, topItems(m)[1]);
  barKey(m, 'ArrowRight'); // Edit → (View disabled) → wrap to File
  assert.equal(document.activeElement, topItems(m)[0]);
  m.dispose();
});

test('menubar: ArrowDown opens the active menu focused on its first item', async () => {
  const m: Mounted = await mount({ menus: MENUS });
  barKey(m, 'ArrowDown'); // opens File
  assert.ok(menuPanel());
  assert.equal(document.activeElement, menuItems()[0], 'first item focused');
  m.dispose();
});

test('menubar: with a menu open, Right switches to the neighbour menu', async () => {
  const m: Mounted = await mount({ menus: MENUS });
  topItems(m)[0].click(); // open File
  assert.deepEqual(menuItems().map((b) => b.textContent), ['New', 'Open']);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); // → Edit
  assert.equal(topItems(m)[1].getAttribute('aria-expanded'), 'true');
  assert.deepEqual(menuItems().map((b) => b.textContent), ['Undo', 'Redo'], 'Edit menu now open');
  m.dispose();
});

test('menubar: Escape closes the open menu + returns focus to its top item', async () => {
  const m: Mounted = await mount({ menus: MENUS });
  topItems(m)[0].click();
  menuPanel()!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
  assert.equal(menuPanel(), null);
  assert.equal(document.activeElement, topItems(m)[0], 'focus returned to File');
  m.dispose();
});
