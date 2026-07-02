import { test, assert } from '../../../../tools/harness.js';
import { overlayContainer } from '@weave-framework/ui/cdk';
import { openBottomSheet, type BottomSheetRef } from '@weave-framework/ui/bottom-sheet';

const sheet = (): HTMLElement | null => overlayContainer().querySelector('.weave-bottom-sheet');
const backdrop = (): HTMLElement | null => overlayContainer().querySelector('.weave-overlay-backdrop');
const region = (part: string): HTMLElement | null =>
  overlayContainer().querySelector(`.weave-bottom-sheet__${part}`);

interface Opened {
  ref: BottomSheetRef;
  opener: HTMLButtonElement;
}

function openWith(opts: Partial<Parameters<typeof openBottomSheet>[0]> & { content: Node | string }): Opened {
  const opener: HTMLButtonElement = document.createElement('button');
  document.body.appendChild(opener);
  opener.focus();
  const ref: BottomSheetRef = openBottomSheet({ ...opts });
  return { ref, opener };
}

test('bottom-sheet: content mandatory + always rendered; header/actions optional', () => {
  const { ref, opener } = openWith({ content: 'Sheet body' });
  assert.ok(sheet(), 'sheet shown');
  assert.equal(region('content')?.textContent, 'Sheet body');
  assert.equal(region('header'), null, 'no header by default');
  assert.equal(region('actions'), null, 'no actions by default');
  ref.close();
  opener.remove();
});

test('bottom-sheet: title renders the header + wires aria-labelledby; role=dialog + aria-modal', () => {
  const { ref, opener } = openWith({ title: 'Share', content: 'x' });
  assert.equal(region('header')?.textContent, 'Share');
  assert.equal(sheet()?.getAttribute('aria-labelledby'), region('header')?.id);
  assert.equal(sheet()?.getAttribute('role'), 'dialog');
  assert.equal(sheet()?.getAttribute('aria-modal'), 'true');
  ref.close();
  opener.remove();
});

test('bottom-sheet: docked to the bottom edge (globalPosition bottom:0, not centered)', () => {
  const { ref, opener } = openWith({ content: 'x' });
  const wrapper: HTMLElement = sheet()?.parentElement as HTMLElement; // .weave-overlay host
  assert.equal(wrapper.style.bottom, '0px', 'anchored to the bottom');
  assert.equal(wrapper.style.left, '0px', 'stretched left');
  assert.equal(wrapper.style.right, '0px', 'stretched right');
  assert.equal(wrapper.style.top, '', 'not vertically centered');
  ref.close();
  opener.remove();
});

test('bottom-sheet: dimming backdrop + focus moves in, restores to opener on close', () => {
  const btnNode: HTMLElement = document.createElement('div');
  const b: HTMLButtonElement = document.createElement('button');
  b.textContent = 'Go';
  btnNode.appendChild(b);
  const { ref, opener } = openWith({ content: 'x', actions: btnNode });
  assert.ok(!backdrop()!.classList.contains('weave-overlay-backdrop--transparent'), 'dimming backdrop');
  assert.equal(document.activeElement, b, 'focus moved to the first tabbable');
  ref.close();
  assert.equal(document.activeElement, opener, 'focus restored to opener');
  opener.remove();
});

test('bottom-sheet: Escape closes; dismissable:false ignores Escape + backdrop', () => {
  const dismissible: Opened = openWith({ content: 'x' });
  sheet()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(sheet(), null, 'closed on Escape');
  dismissible.opener.remove();

  const locked: Opened = openWith({ content: 'y', dismissable: false });
  sheet()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(sheet(), 'Escape ignored when not dismissable');
  backdrop()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.ok(sheet(), 'backdrop ignored when not dismissable');
  locked.ref.close();
  locked.opener.remove();
});

const dragPointer = (target: EventTarget, type: string, clientY: number): void => {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: 50, clientY }));
};

test('bottom-sheet: dragging the grab handle down past the threshold dismisses it', async () => {
  const { ref, opener } = openWith({ content: 'x' });
  const handle: HTMLElement | null = region('handle');
  assert.ok(handle, 'grab handle shown by default');
  const p: Promise<unknown> = ref.afterClosed();
  dragPointer(handle as HTMLElement, 'pointerdown', 0);
  dragPointer(handle as HTMLElement, 'pointermove', 300);
  dragPointer(handle as HTMLElement, 'pointerup', 300);
  assert.equal(sheet(), null, 'dismissed after a long downward drag');
  await p; // afterClosed resolves
  opener.remove();
});

test('bottom-sheet: a short drag snaps back (stays open, transform cleared)', () => {
  const { ref, opener } = openWith({ content: 'x' });
  const handle: HTMLElement = region('handle') as HTMLElement;
  dragPointer(handle, 'pointerdown', 0);
  dragPointer(handle, 'pointermove', 15);
  dragPointer(handle, 'pointerup', 15);
  assert.ok(sheet(), 'still open after a small drag');
  assert.equal(sheet()!.style.transform, '', 'snapped back to no transform');
  ref.close();
  opener.remove();
});

test('bottom-sheet: dragToDismiss:false shows no handle', () => {
  const { ref, opener } = openWith({ content: 'x', dragToDismiss: false });
  assert.equal(region('handle'), null, 'no grab handle');
  ref.close();
  opener.remove();
});

test('bottom-sheet: afterClosed resolves with the close result', async () => {
  const { ref, opener } = openWith({ content: 'x' });
  const p: Promise<unknown> = ref.afterClosed();
  ref.close('shared');
  assert.equal(await p, 'shared');
  opener.remove();
});
