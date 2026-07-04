import { test, assert } from '../../../../tools/harness.js';
import { overlayContainer, setDirection } from '@weave-framework/ui/cdk';
import { snackbar, type SnackbarRef } from '@weave-framework/ui/snackbar';

const bars = (): HTMLElement[] =>
  Array.from(overlayContainer().querySelectorAll('.weave-snackbar')) as HTMLElement[];
const bar = (): HTMLElement | null => overlayContainer().querySelector('.weave-snackbar');
const action = (): HTMLButtonElement | null =>
  overlayContainer().querySelector('.weave-snackbar__action');
const wait = (ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms));

test('snackbar: shows a bar with the message; auto-dismisses after the duration', async () => {
  const ref: SnackbarRef = snackbar('Saved.', { duration: 20 });
  assert.ok(bar(), 'bar shown');
  assert.equal(bar()?.querySelector('.weave-snackbar__message')?.textContent, 'Saved.');
  await wait(35);
  assert.equal(bar(), null, 'auto-dismissed after the duration');
  void ref;
});

test('snackbar: duration 0 stays until dismissed', async () => {
  const ref: SnackbarRef = snackbar('Sticky', { duration: 0 });
  await wait(20);
  assert.ok(bar(), 'still visible with duration 0');
  ref.dismiss();
  assert.equal(bar(), null, 'gone after manual dismiss');
});

test('snackbar: an action button fires onAction and dismisses', () => {
  let acted: number = 0;
  const ref: SnackbarRef = snackbar('Item deleted', {
    duration: 0,
    action: { label: 'Undo', onAction: (): void => { acted++; } },
  });
  assert.equal(action()?.textContent, 'Undo');
  action()!.click();
  assert.equal(acted, 1, 'onAction fired');
  assert.equal(bar(), null, 'dismissed after the action');
  void ref;
});

test('snackbar: a string action is a label-only button', () => {
  const ref: SnackbarRef = snackbar('Note', { duration: 0, action: 'OK' });
  assert.equal(action()?.textContent, 'OK');
  ref.dismiss();
});

test('snackbar: only one is visible at a time; the next shows after the first is dismissed', () => {
  const first: SnackbarRef = snackbar('First', { duration: 0 });
  const second: SnackbarRef = snackbar('Second', { duration: 0 });
  assert.equal(bars().length, 1, 'one bar at a time');
  assert.equal(bar()?.querySelector('.weave-snackbar__message')?.textContent, 'First');
  first.dismiss();
  assert.equal(bar()?.querySelector('.weave-snackbar__message')?.textContent, 'Second', 'the queued one shows');
  second.dismiss();
  assert.equal(bar(), null);
});

test('snackbar: dismissing a still-queued snackbar removes it without ever showing', () => {
  const first: SnackbarRef = snackbar('A', { duration: 0 });
  const queued: SnackbarRef = snackbar('B', { duration: 0 });
  queued.dismiss(); // never shown
  first.dismiss();
  assert.equal(bar(), null, 'the queued-then-dismissed one never appears');
});

test('snackbar: hovering pauses the auto-dismiss; leaving resumes it', async () => {
  const ref: SnackbarRef = snackbar('Hover me', { duration: 20 });
  const el: HTMLElement = bar() as HTMLElement;
  el.dispatchEvent(new MouseEvent('mouseenter'));
  await wait(35);
  assert.ok(bar(), 'still visible while hovered (timer paused)');
  el.dispatchEvent(new MouseEvent('mouseleave'));
  await wait(35);
  assert.equal(bar(), null, 'dismissed after leaving (timer resumed)');
  void ref;
});

test('snackbar: announces via the live region (polite by default, assertive opt-in)', () => {
  const polite: SnackbarRef = snackbar('Polite msg', { duration: 0 });
  const politeRegion: HTMLElement | null = document.querySelector('.weave-live-announcer[aria-live="polite"]');
  assert.ok(politeRegion, 'a polite live region exists');
  assert.equal(politeRegion?.textContent, 'Polite msg', 'the message was announced politely');
  polite.dismiss();
  const loud: SnackbarRef = snackbar('Loud msg', { duration: 0, politeness: 'assertive' });
  const assertiveRegion: HTMLElement | null = document.querySelector('.weave-live-announcer[aria-live="assertive"]');
  assert.equal(assertiveRegion?.textContent, 'Loud msg', 'assertive message announced assertively');
  loud.dismiss();
});

test('snackbar: position start anchors to the bottom-left (not centered)', () => {
  const ref: SnackbarRef = snackbar('Left', { duration: 0, position: 'start' });
  const wrapper: HTMLElement = bar()?.parentElement as HTMLElement;
  assert.equal(wrapper.style.bottom, '0px');
  assert.equal(wrapper.style.left, '0px', 'anchored left');
  ref.dismiss();
});

test('snackbar: RTL maps position start to the bottom-right edge', () => {
  setDirection('rtl');
  try {
    const ref: SnackbarRef = snackbar('Start', { duration: 0, position: 'start' });
    const wrapper: HTMLElement = bar()?.parentElement as HTMLElement;
    assert.equal(wrapper.style.right, '0px', 'start anchors to the right edge in RTL');
    assert.equal(wrapper.style.left, '', 'not anchored left in RTL');
    ref.dismiss();
  } finally {
    setDirection('ltr');
  }
});

test('snackbar: afterDismissed resolves when dismissed', async () => {
  const ref: SnackbarRef = snackbar('bye', { duration: 0 });
  const p: Promise<void> = ref.afterDismissed();
  ref.dismiss();
  await p; // resolves
  assert.ok(true, 'afterDismissed resolved');
  assert.equal(bar(), null);
});
