import { test, assert } from '../../../../tools/harness.js';
import { onMount, onDispose, effect, signal, type Signal } from '@weave-framework/runtime';
import { type Component } from '@weave-framework/runtime/dom';
import { overlayContainer } from '@weave-framework/ui/cdk';
import { openDialog, component, type DialogOptions, type DialogRef } from '@weave-framework/ui/dialog';

/** Flush microtasks — onMount is deferred via queueMicrotask. */
const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));

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

test('dialog: opening shields the background (inert + aria-hidden), backdrop stays clickable, cleared on close', () => {
  const bg: HTMLDivElement = document.createElement('div');
  document.body.appendChild(bg);
  const { ref, opener } = openWith({ content: 'x' });
  // Background siblings of the overlay container become inert + aria-hidden (AT/pointer/Tab can't reach them)…
  assert.ok(bg.hasAttribute('inert'), 'background app element is inert while the modal is open');
  assert.equal(bg.getAttribute('aria-hidden'), 'true', 'background app element is aria-hidden');
  assert.ok(opener.hasAttribute('inert'), 'the opener is shielded too');
  // …but the backdrop stays interactive (it dismisses the dialog), and the panel itself is reachable.
  assert.ok(!backdrop()?.hasAttribute('inert'), 'backdrop is NOT inert (still click-to-dismiss)');
  assert.ok(!panel()?.hasAttribute('inert'), 'the dialog panel is not inert');
  ref.close();
  assert.ok(!bg.hasAttribute('inert'), 'inert cleared on close');
  assert.ok(!bg.hasAttribute('aria-hidden'), 'aria-hidden cleared on close');
  bg.remove();
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

/* ─────────────────── a component as content (FW-18) ─────────────────── */

/**
 * A probe component that records its lifecycle and stays reactive off a prop. `onMount`/`onDispose`
 * only run under an owner, and `effect` only re-runs while its owner is live — so this shows both
 * that `openDialog` mounted it with an owner and that it tore that owner down on close.
 */
function probe(log: string[]): Component {
  return (props?: Record<string, unknown>): Node => {
    const el: HTMLDivElement = document.createElement('div');
    const label: () => string = (props?.label as () => string) ?? ((): string => '');
    onMount((): void => { log.push('mount'); });
    onDispose((): void => { log.push('dispose'); });
    effect((): void => { el.textContent = label(); }); // tracks the signal → region stays live
    return el;
  };
}

test('dialog: a [Component, props] content region mounts with an owner and stays reactive (FW-18)', async () => {
  const log: string[] = [];
  const text: Signal<string> = signal<string>('first');
  const { ref, opener } = openWith({ content: [probe(log), { label: text }] });
  await tick(); // onMount is deferred
  assert.deepEqual(log, ['mount'], 'the component mounted under an owner — onMount ran');
  assert.equal(region('content')?.textContent, 'first', 'the effect rendered the prop');
  text.set('second');
  assert.equal(region('content')?.textContent, 'second', 'the region is live — a signal change re-renders it');
  ref.close();
  assert.deepEqual(log, ['mount', 'dispose'], 'closing disposed the component');
  opener.remove();
});

test('dialog: closing disposes the component so its effects stop (FW-18)', () => {
  const log: string[] = [];
  const text: Signal<string> = signal<string>('a');
  const { ref, opener } = openWith({ content: [probe(log), { label: text }] });
  assert.equal(region('content')?.textContent, 'a');
  ref.close();
  assert.ok(log.includes('dispose'), 'onDispose ran on close');
  const node: HTMLElement = region('content') as HTMLElement; // detached, but grab the last ref
  text.set('b'); // must NOT re-run the disposed effect
  assert.notEqual(node?.textContent, 'b', 'a disposed effect no longer tracks the signal');
  opener.remove();
});

test('dialog: the component() helper is the tuple, and works in header and actions too (FW-18)', async () => {
  const h: string[] = [];
  const c: string[] = [];
  const a: string[] = [];
  const { ref, opener } = openWith({
    header: component(probe(h)),
    content: component(probe(c), { label: (): string => 'body' }),
    actions: component(probe(a)),
  });
  await tick();
  assert.deepEqual([h, c, a], [['mount'], ['mount'], ['mount']], 'every region mounted its component');
  assert.equal(region('content')?.textContent, 'body');
  ref.close();
  assert.deepEqual([h, c, a], [['mount', 'dispose'], ['mount', 'dispose'], ['mount', 'dispose']], 'all disposed on close');
  opener.remove();
});

test('dialog: a () => Node factory is unchanged — called bare, not treated as a component (FW-18)', () => {
  let calls: number = 0;
  const { ref, opener } = openWith({
    content: (): Node => {
      calls++;
      const el: HTMLSpanElement = document.createElement('span');
      el.textContent = 'made';
      return el;
    },
  });
  assert.equal(calls, 1, 'the factory was called once');
  assert.equal(region('content')?.textContent, 'made', 'and its node inserted, exactly as before');
  ref.close();
  opener.remove();
});
