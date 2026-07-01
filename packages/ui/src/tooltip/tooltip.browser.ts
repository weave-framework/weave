import { test, assert } from '../../../../tools/harness.js';
import { overlayContainer } from '@weave-framework/ui/cdk';
import { tooltip, type TooltipOptions } from '@weave-framework/ui/tooltip';

// A hover uses setTimeout; wait a macrotask so the deferred show fires.
const wait = (ms: number = 0): Promise<void> => new Promise<void>((r) => setTimeout(r, ms));

// Mount a host with the `use:tooltip` action attached; `cleanup` is what Weave calls on
// unmount (the action's contract).
function mount(options: string | TooltipOptions): { host: HTMLButtonElement; cleanup: () => void } {
  const host: HTMLButtonElement = document.createElement('button');
  host.textContent = 'trigger';
  document.body.appendChild(host);
  const cleanup: () => void = tooltip(host, options);
  return { host, cleanup };
}

// The tooltip panel(s) currently in the shared overlay container.
const panels = (): HTMLElement[] =>
  Array.from(overlayContainer().querySelectorAll('.weave-tooltip')) as HTMLElement[];

function teardown(host: HTMLElement, cleanup: () => void): void {
  cleanup();
  host.remove();
}

test('tooltip: focus shows the panel immediately with role=tooltip + the text', () => {
  const { host, cleanup } = mount('Save changes');
  host.dispatchEvent(new FocusEvent('focusin'));
  const p: HTMLElement[] = panels();
  assert.equal(p.length, 1, 'exactly one tooltip panel');
  assert.equal(p[0].getAttribute('role'), 'tooltip');
  assert.equal(p[0].textContent, 'Save changes');
  assert.equal(p[0].parentElement?.parentElement, overlayContainer(), 'panel is in the overlay container');
  teardown(host, cleanup);
});

test('tooltip: sets aria-describedby on the host to the panel id while shown, clears on hide', () => {
  const { host, cleanup } = mount('Hint');
  host.dispatchEvent(new FocusEvent('focusin'));
  const id: string | null = host.getAttribute('aria-describedby');
  assert.ok(id, 'aria-describedby is set');
  assert.equal(panels()[0].id, id, 'it points at the panel id');
  host.dispatchEvent(new FocusEvent('focusout'));
  assert.equal(host.getAttribute('aria-describedby'), null, 'cleared on hide');
  assert.equal(panels().length, 0, 'panel detached');
  teardown(host, cleanup);
});

test('tooltip: hover shows after the delay, leave hides', async () => {
  const { host, cleanup } = mount({ text: 'Hover me', delay: 0 });
  host.dispatchEvent(new MouseEvent('mouseenter'));
  assert.equal(panels().length, 0, 'not shown synchronously — the hover is deferred');
  await wait(5);
  assert.equal(panels().length, 1, 'shown after the delay');
  host.dispatchEvent(new MouseEvent('mouseleave'));
  assert.equal(panels().length, 0, 'hidden on leave');
  teardown(host, cleanup);
});

test('tooltip: a pending hover-show is cancelled if the pointer leaves before the delay', async () => {
  const { host, cleanup } = mount({ text: 'Quick', delay: 20 });
  host.dispatchEvent(new MouseEvent('mouseenter'));
  host.dispatchEvent(new MouseEvent('mouseleave')); // leave before the 20ms fires
  await wait(30);
  assert.equal(panels().length, 0, 'the queued show was cancelled');
  teardown(host, cleanup);
});

test('tooltip: Escape hides an open tooltip', () => {
  const { host, cleanup } = mount('Esc me');
  host.dispatchEvent(new FocusEvent('focusin'));
  assert.equal(panels().length, 1);
  host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(panels().length, 0, 'Escape closed it');
  assert.equal(host.getAttribute('aria-describedby'), null);
  teardown(host, cleanup);
});

test('tooltip: disabled suppresses the tooltip entirely', () => {
  const { host, cleanup } = mount({ text: 'nope', disabled: true });
  host.dispatchEvent(new FocusEvent('focusin'));
  host.dispatchEvent(new MouseEvent('mouseenter'));
  assert.equal(panels().length, 0, 'never shows while disabled');
  assert.equal(host.getAttribute('aria-describedby'), null);
  teardown(host, cleanup);
});

test('tooltip: empty text never opens a panel', () => {
  const { host, cleanup } = mount({ text: '' });
  host.dispatchEvent(new FocusEvent('focusin'));
  assert.equal(panels().length, 0, 'no panel for empty text');
  teardown(host, cleanup);
});

test('tooltip: positioning is applied to the panel host (left/top set)', () => {
  const { host, cleanup } = mount('Placed');
  host.dispatchEvent(new FocusEvent('focusin'));
  const wrapper: HTMLElement = panels()[0].parentElement as HTMLElement; // the .weave-overlay host
  assert.ok(wrapper.style.left !== '', 'left is set by connectedPosition');
  assert.ok(wrapper.style.top !== '', 'top is set by connectedPosition');
  teardown(host, cleanup);
});

test('tooltip: cleanup detaches the panel and clears aria-describedby (no leak)', () => {
  const { host, cleanup } = mount('Bye');
  host.dispatchEvent(new FocusEvent('focusin'));
  assert.equal(panels().length, 1);
  cleanup();
  assert.equal(panels().length, 0, 'panel disposed on cleanup');
  assert.equal(host.getAttribute('aria-describedby'), null);
  host.remove();
});
