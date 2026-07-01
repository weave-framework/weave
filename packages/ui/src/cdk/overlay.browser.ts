import { test, assert } from '../../../../tools/harness.js';
import { effect, createOwner, runInOwner, disposeOwner, type Owner } from '@weave-framework/runtime';
import {
  createOverlay,
  overlayContainer,
  globalPosition,
  type PositionStrategy,
  type OverlayRef,
} from '@weave-framework/ui/cdk';

function content(text: string = 'panel'): HTMLElement {
  const el: HTMLElement = document.createElement('div');
  el.textContent = text;
  return el;
}

const z = (el: HTMLElement): number => parseInt(el.style.zIndex || '0', 10);

test('overlay: attach inserts the panel into the shared container with the content', () => {
  const ref: OverlayRef = createOverlay();
  const c: HTMLElement = content('hello');
  const panel: HTMLElement = ref.attach(c);
  assert.equal(panel, ref.overlayElement);
  assert.equal(panel.parentElement, overlayContainer(), 'panel is in the overlay container');
  assert.equal(panel.textContent, 'hello');
  assert.equal(ref.attached(), true);
  ref.dispose();
});

test('overlay: the container is a single shared singleton in <body>', () => {
  const a: OverlayRef = createOverlay();
  const b: OverlayRef = createOverlay();
  a.attach(content('a'));
  b.attach(content('b'));
  assert.equal(overlayContainer(), a.overlayElement.parentElement);
  assert.equal(a.overlayElement.parentElement, b.overlayElement.parentElement, 'same container');
  assert.equal(overlayContainer().parentElement, document.body);
  a.dispose();
  b.dispose();
});

test('overlay: later overlays stack above earlier ones (monotonic z-index)', () => {
  const a: OverlayRef = createOverlay();
  const b: OverlayRef = createOverlay();
  a.attach(content());
  b.attach(content());
  assert.ok(z(b.overlayElement) > z(a.overlayElement), 'b panel above a panel');
  a.dispose();
  b.dispose();
});

test('overlay: no backdrop by default', () => {
  const ref: OverlayRef = createOverlay();
  ref.attach(content());
  assert.equal(ref.backdropElement, null);
  ref.dispose();
});

test('overlay: hasBackdrop renders a backdrop below the panel and routes clicks', () => {
  const ref: OverlayRef = createOverlay({ hasBackdrop: true });
  ref.attach(content());
  const backdrop: HTMLElement = ref.backdropElement!;
  assert.ok(backdrop, 'backdrop created');
  assert.equal(backdrop.parentElement, overlayContainer());
  assert.ok(z(ref.overlayElement) > z(backdrop), 'panel sits above its backdrop');

  let clicks: number = 0;
  const unsub: () => void = ref.onBackdropClick(() => clicks++);
  backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(clicks, 1, 'handler fired on backdrop click');
  unsub();
  backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(clicks, 1, 'unsubscribed handler no longer fires');
  ref.dispose();
});

test('overlay: detach removes panel + backdrop and can re-attach', () => {
  const ref: OverlayRef = createOverlay({ hasBackdrop: true });
  ref.attach(content('first'));
  const backdrop: HTMLElement = ref.backdropElement!;
  ref.detach();
  assert.equal(ref.overlayElement.parentElement, null, 'panel removed');
  assert.equal(backdrop.parentElement, null, 'backdrop removed');
  assert.equal(ref.attached(), false);
  assert.equal(ref.overlayElement.textContent, '', 'content cleared');

  ref.attach(content('second'));
  assert.equal(ref.attached(), true);
  assert.equal(ref.overlayElement.textContent, 'second', 're-attached with new content');
  ref.dispose();
});

test('overlay: attach replaces the previous content (single attach)', () => {
  const ref: OverlayRef = createOverlay();
  ref.attach(content('one'));
  ref.attach(content('two'));
  assert.equal(ref.overlayElement.textContent, 'two');
  assert.equal(overlayContainer().querySelectorAll('.weave-overlay').length >= 1, true);
  ref.dispose();
});

test('overlay: dispose detaches and blocks further attach', () => {
  const ref: OverlayRef = createOverlay();
  ref.attach(content());
  ref.dispose();
  assert.equal(ref.attached(), false);
  let threw: boolean = false;
  try {
    ref.attach(content());
  } catch {
    threw = true;
  }
  assert.equal(threw, true, 'attach after dispose throws');
});

test('overlay: panelClass and backdropClass are applied', () => {
  const ref: OverlayRef = createOverlay({ hasBackdrop: true, panelClass: 'my-panel', backdropClass: ['b1', 'b2'] });
  ref.attach(content());
  assert.ok(ref.overlayElement.classList.contains('my-panel'));
  assert.ok(ref.backdropElement!.classList.contains('b1') && ref.backdropElement!.classList.contains('b2'));
  ref.dispose();
});

test('overlay: a custom position strategy is applied on attach and updatePosition', () => {
  let applied: number = 0;
  const strategy: PositionStrategy = { apply: () => applied++ };
  const ref: OverlayRef = createOverlay({ positionStrategy: strategy });
  ref.attach(content());
  assert.equal(applied, 1, 'applied on attach');
  ref.updatePosition();
  assert.equal(applied, 2, 'applied again on updatePosition');
  ref.dispose();
});

test('overlay: globalPosition centers by default (transform + 50%)', () => {
  const ref: OverlayRef = createOverlay({ positionStrategy: globalPosition() });
  const panel: HTMLElement = ref.attach(content());
  assert.equal(panel.style.left, '50%');
  assert.equal(panel.style.top, '50%');
  assert.ok(panel.style.transform.includes('-50%'));
  ref.dispose();
});

test('overlay: globalPosition can anchor to an edge instead of centering', () => {
  const ref: OverlayRef = createOverlay({
    positionStrategy: globalPosition({ centerHorizontally: false, centerVertically: false, top: '10px', left: '20px' }),
  });
  const panel: HTMLElement = ref.attach(content());
  assert.equal(panel.style.top, '10px');
  assert.equal(panel.style.left, '20px');
  ref.dispose();
});

test('overlay: attached() is reactive', async () => {
  const ref: OverlayRef = createOverlay();
  const seen: boolean[] = [];
  const stop: () => void = effect(() => {
    seen.push(ref.attached());
  });
  await Promise.resolve();
  ref.attach(content());
  await Promise.resolve();
  ref.detach();
  await Promise.resolve();
  assert.deepEqual(seen, [false, true, false], 'saw detached → attached → detached');
  stop();
  ref.dispose();
});

test('overlay: owner disposal tears the overlay down (no leak)', () => {
  const owner: Owner = createOwner();
  const ref: OverlayRef = runInOwner(owner, () => {
    const r: OverlayRef = createOverlay();
    r.attach(content());
    return r;
  });
  assert.equal(ref.attached(), true);
  disposeOwner(owner);
  assert.equal(ref.attached(), false, 'disposed with its owner');
  assert.equal(ref.overlayElement.parentElement, null);
});
