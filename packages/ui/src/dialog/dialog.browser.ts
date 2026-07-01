import { test, assert } from '../../../../tools/harness.js';
import { overlayContainer } from '@weave-framework/ui/cdk';
import { openDialog, type DialogOptions, type DialogRef } from '@weave-framework/ui/dialog';

const panel = (): HTMLElement | null => overlayContainer().querySelector('.weave-dialog');
const backdrop = (): HTMLElement | null => overlayContainer().querySelector('.weave-overlay-backdrop');
const region = (part: string): HTMLElement | null =>
  overlayContainer().querySelector(`.weave-dialog__${part}`);

interface Opened {
  ref: DialogRef;
  opener: HTMLButtonElement;
}

// Open with an opener button focused, so focus-restore is observable.
function openWith(opts: Partial<DialogOptions> & { content: DialogOptions['content'] }): Opened {
  const opener: HTMLButtonElement = document.createElement('button');
  document.body.appendChild(opener);
  opener.focus();
  const ref: DialogRef = openDialog({ onClose: (): void => {}, ...opts });
  return { ref, opener };
}

test('dialog: content is mandatory and always rendered; header/actions absent by default', () => {
  const { ref, opener } = openWith({ content: 'Just a body' });
  assert.ok(panel(), 'panel shown');
  assert.ok(region('content'), 'content region present');
  assert.equal(region('content')?.textContent, 'Just a body');
  assert.equal(region('header'), null, 'no header when none given');
  assert.equal(region('actions'), null, 'no actions when none given');
  ref.close();
  opener.remove();
});

test('dialog: a title renders the header and wires aria-labelledby', () => {
  const { ref, opener } = openWith({ title: 'Delete item?', content: 'Body' });
  const header: HTMLElement | null = region('header');
  assert.ok(header, 'header rendered from title');
  assert.equal(header?.textContent, 'Delete item?');
  assert.equal(panel()?.getAttribute('aria-labelledby'), header?.id, 'labelledby points at the header');
  assert.equal(panel()?.getAttribute('aria-describedby'), region('content')?.id, 'describedby points at content');
  ref.close();
  opener.remove();
});

test('dialog: actions region renders only when actions are provided', () => {
  const actionsNode: HTMLElement = document.createElement('div');
  const btn: HTMLButtonElement = document.createElement('button');
  btn.textContent = 'OK';
  actionsNode.appendChild(btn);
  const { ref, opener } = openWith({ content: 'Body', actions: actionsNode });
  assert.ok(region('actions'), 'actions region present');
  assert.equal(region('actions')?.querySelector('button')?.textContent, 'OK');
  ref.close();
  opener.remove();
});

test('dialog: header/content/actions render in that document order', () => {
  const a: HTMLElement = document.createElement('div');
  a.textContent = 'A';
  const { ref, opener } = openWith({ title: 'H', content: 'C', actions: a });
  const kids: string[] = Array.from(panel()!.children).map((c) => (c as HTMLElement).className);
  assert.deepEqual(kids, ['weave-dialog__header', 'weave-dialog__content', 'weave-dialog__actions']);
  ref.close();
  opener.remove();
});

test('dialog: role + aria-modal (default dialog, or alertdialog)', () => {
  const { ref, opener } = openWith({ content: 'x' });
  assert.equal(panel()?.getAttribute('role'), 'dialog');
  assert.equal(panel()?.getAttribute('aria-modal'), 'true');
  ref.close();
  const alert: Opened = openWith({ content: 'y', role: 'alertdialog' });
  assert.equal(panel()?.getAttribute('role'), 'alertdialog');
  alert.ref.close();
  opener.remove();
  alert.opener.remove();
});

test('dialog: has a dimming (non-transparent) backdrop', () => {
  const { ref, opener } = openWith({ content: 'x' });
  const b: HTMLElement | null = backdrop();
  assert.ok(b, 'backdrop present');
  assert.ok(!b!.classList.contains('weave-overlay-backdrop--transparent'), 'a dimming scrim, not a click-catcher');
  ref.close();
  opener.remove();
});

test('dialog: focus moves into the dialog on open (first tabbable)', () => {
  const actionsNode: HTMLElement = document.createElement('div');
  const btn: HTMLButtonElement = document.createElement('button');
  btn.textContent = 'Confirm';
  actionsNode.appendChild(btn);
  const { ref, opener } = openWith({ content: 'Body', actions: actionsNode });
  assert.equal(document.activeElement, btn, 'first tabbable (the action button) focused');
  ref.close();
  opener.remove();
});

test('dialog: closing restores focus to the opener', () => {
  const { ref, opener } = openWith({ content: 'x' });
  assert.notEqual(document.activeElement, opener, 'focus left the opener on open');
  ref.close();
  assert.equal(document.activeElement, opener, 'focus restored to the opener on close');
  opener.remove();
});

test('dialog: Escape closes a dismissable dialog', () => {
  const { ref, opener } = openWith({ content: 'x' });
  panel()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(panel(), null, 'closed on Escape');
  opener.remove();
  void ref;
});

test('dialog: dismissable:false ignores Escape and backdrop clicks', () => {
  const { ref, opener } = openWith({ content: 'x', dismissable: false });
  panel()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(panel(), 'Escape did NOT close it');
  backdrop()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.ok(panel(), 'backdrop click did NOT close it');
  ref.close(); // programmatic close still works
  assert.equal(panel(), null);
  opener.remove();
});

test('dialog: a backdrop click closes a dismissable dialog', () => {
  const { ref, opener } = openWith({ content: 'x' });
  backdrop()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(panel(), null, 'closed on backdrop click');
  opener.remove();
  void ref;
});

test('dialog: afterClosed resolves with the close result', async () => {
  const { ref, opener } = openWith({ content: 'x' });
  const p: Promise<unknown> = ref.afterClosed();
  ref.close('confirmed');
  assert.equal(await p, 'confirmed', 'resolves with the result');
  // Resolves immediately when already closed.
  assert.equal(await ref.afterClosed(), 'confirmed');
  opener.remove();
});

test('dialog: per-dialog width/height are applied inline (number → px)', () => {
  const { ref, opener } = openWith({ content: 'x', width: 420, height: '50vh' });
  assert.equal(panel()?.style.width, '420px', 'numeric width → px');
  assert.equal(panel()?.style.height, '50vh', 'string height passed through');
  ref.close();
  opener.remove();
});

test('dialog: two dialogs stack — the second panel sits above the first', () => {
  const first: Opened = openWith({ content: 'first' });
  const second: Opened = openWith({ content: 'second' });
  const panels: HTMLElement[] = Array.from(overlayContainer().querySelectorAll('.weave-dialog')) as HTMLElement[];
  assert.equal(panels.length, 2, 'both dialogs present');
  // The z-index lives on the .weave-overlay wrapper (the panel's parent), not the dialog.
  const z = (el: HTMLElement): number => parseInt((el.parentElement as HTMLElement).style.zIndex || '0', 10);
  assert.ok(z(panels[1]) > z(panels[0]), 'the second dialog stacks above the first');
  second.ref.close();
  first.ref.close();
  first.opener.remove();
  second.opener.remove();
});

test('dialog: close is idempotent (no double onClose / afterClosed)', async () => {
  let closes: number = 0;
  const opener: HTMLButtonElement = document.createElement('button');
  document.body.appendChild(opener);
  const ref: DialogRef = openDialog({ content: 'x', onClose: (): void => { closes++; } });
  ref.close('a');
  ref.close('b'); // no-op
  assert.equal(closes, 1, 'onClose fired once');
  assert.equal(await ref.afterClosed(), 'a', 'first result kept');
  opener.remove();
});
