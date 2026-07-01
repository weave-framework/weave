import { test, assert } from '../../../../tools/harness.js';
import { overlayContainer } from '@weave-framework/ui/cdk';
import { contextMenu, type MenuItem } from '@weave-framework/ui/context-menu';

const ITEMS: MenuItem[] = [
  { value: 'copy', label: 'Copy' },
  { value: 'paste', label: 'Paste' },
  { value: 'del', label: 'Delete' },
];

function mount(): { host: HTMLDivElement; selected: string[]; cleanup: () => void } {
  const host: HTMLDivElement = document.createElement('div');
  host.tabIndex = 0; // focusable so focus-return is observable
  host.textContent = 'right-click me';
  document.body.appendChild(host);
  const selected: string[] = [];
  const cleanup: () => void = contextMenu(host, { items: ITEMS, onSelect: (v: string) => selected.push(v) });
  return { host, selected, cleanup };
}

const panel = (): HTMLElement | null => overlayContainer().querySelector('.weave-menu');
const items = (): HTMLButtonElement[] =>
  Array.from(overlayContainer().querySelectorAll('.weave-menu__item')) as HTMLButtonElement[];

function rightClick(host: HTMLElement, x: number = 120, y: number = 80): MouseEvent {
  const ev: MouseEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y });
  host.dispatchEvent(ev);
  return ev;
}

function teardown(host: HTMLElement, cleanup: () => void): void {
  cleanup();
  host.remove();
}

test('context-menu: right-click opens the .weave-menu panel and suppresses the native menu', () => {
  const { host, cleanup } = mount();
  const ev: MouseEvent = rightClick(host);
  assert.ok(panel(), 'menu panel is shown');
  assert.equal(panel()?.getAttribute('role'), 'menu');
  assert.equal(ev.defaultPrevented, true, 'native context menu prevented');
  assert.equal(items().length, 3);
  // Pointer open highlights nothing — focus rests on the panel (first arrow steps in).
  assert.equal(document.activeElement, panel(), 'no item pre-highlighted on right-click');
  teardown(host, cleanup);
});

test('context-menu: Shift+F10 (keyboard) opens with the first item highlighted', () => {
  const { host, cleanup } = mount();
  host.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }));
  assert.equal(document.activeElement, items()[0], 'keyboard open highlights the first item');
  teardown(host, cleanup);
});

test('context-menu: the panel is anchored at the pointer coordinates', () => {
  const { host, cleanup } = mount();
  rightClick(host, 150, 90);
  const wrapper: HTMLElement = panel()?.parentElement as HTMLElement; // the .weave-overlay host
  // connectedPosition bottom-start of a zero-size origin at (150,90): left≈150, top≈90+offset.
  const left: number = parseFloat(wrapper.style.left);
  const top: number = parseFloat(wrapper.style.top);
  assert.ok(Math.abs(left - 150) < 2, `left near pointer x (got ${left})`);
  assert.ok(top >= 90 && top < 110, `top just below pointer y (got ${top})`);
  teardown(host, cleanup);
});

test('context-menu: selecting an item reports its value and closes, returning focus to the host', () => {
  const { host, selected, cleanup } = mount();
  rightClick(host);
  (items().find((b) => b.textContent === 'Paste') as HTMLButtonElement).click();
  assert.deepEqual(selected, ['paste']);
  assert.equal(panel(), null, 'closed after select');
  assert.equal(document.activeElement, host, 'focus returned to host');
  teardown(host, cleanup);
});

test('context-menu: a second right-click replaces the open menu (only one panel)', () => {
  const { host, cleanup } = mount();
  rightClick(host, 100, 100);
  rightClick(host, 200, 200);
  assert.equal(overlayContainer().querySelectorAll('.weave-menu').length, 1, 'only one panel at a time');
  teardown(host, cleanup);
});

test('context-menu: Escape closes the menu', () => {
  const { host, cleanup } = mount();
  rightClick(host);
  panel()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(panel(), null, 'closed on Escape');
  teardown(host, cleanup);
});

test('context-menu: Shift+F10 opens the menu anchored to the host (keyboard parity)', () => {
  const { host, cleanup } = mount();
  host.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }));
  assert.ok(panel(), 'opened via Shift+F10');
  teardown(host, cleanup);
});

test('context-menu: cleanup removes the listeners and closes any open panel', () => {
  const { host, cleanup } = mount();
  rightClick(host);
  assert.ok(panel());
  cleanup();
  assert.equal(panel(), null, 'panel closed on cleanup');
  // After cleanup a right-click no longer opens anything.
  rightClick(host);
  assert.equal(panel(), null, 'listener removed');
  host.remove();
});
