import { test, assert } from '../../../../tools/harness.js';
import { ripple } from '@weave-framework/ui/ripple';

function makeHost(): HTMLElement {
  const el = document.createElement('div');
  el.style.width = '100px';
  el.style.height = '40px';
  el.style.position = 'relative';
  document.body.appendChild(el);
  return el;
}

function pointerDown(el: HTMLElement, offsetX = 10, offsetY = 10): void {
  const rect = el.getBoundingClientRect();
  el.dispatchEvent(
    new PointerEvent('pointerdown', {
      clientX: rect.left + offsetX,
      clientY: rect.top + offsetY,
      bubbles: true,
    }),
  );
}

test('ripple: pointerdown appends an aria-hidden .weave-ripple span', () => {
  const host = makeHost();
  const cleanup = ripple(host);
  pointerDown(host);
  const span = host.querySelector('.weave-ripple');
  assert.ok(span, 'ripple span created');
  assert.equal(span!.getAttribute('aria-hidden'), 'true');
  cleanup();
  host.remove();
});

test('ripple: span is sized, then removed on animationend', () => {
  const host = makeHost();
  const cleanup = ripple(host);
  pointerDown(host);
  const span = host.querySelector('.weave-ripple') as HTMLElement;
  assert.ok(parseFloat(span.style.width) > 0, 'span has a width');
  assert.equal(span.style.width, span.style.height, 'circle is square');
  span.dispatchEvent(new AnimationEvent('animationend'));
  assert.equal(host.querySelector('.weave-ripple'), null, 'removed after animationend');
  cleanup();
  host.remove();
});

test('ripple: disabled suppresses the ripple', () => {
  const host = makeHost();
  const cleanup = ripple(host, { disabled: true });
  pointerDown(host);
  assert.equal(host.querySelector('.weave-ripple'), null);
  cleanup();
  host.remove();
});

test('ripple: cleanup detaches the pointerdown listener', () => {
  const host = makeHost();
  const cleanup = ripple(host);
  cleanup();
  pointerDown(host);
  assert.equal(host.querySelector('.weave-ripple'), null, 'no ripple after cleanup');
  host.remove();
});

test('ripple: centered originates from the host centre', () => {
  const host = makeHost();
  const cleanup = ripple(host, { centered: true });
  pointerDown(host, 5, 5); // near a corner — ignored when centered
  const span = host.querySelector('.weave-ripple') as HTMLElement;
  // centre (50,20); radius = hypot(50,20); left = 50 - radius
  const expectedLeft = 50 - Math.hypot(50, 20);
  assert.ok(Math.abs(parseFloat(span.style.left) - expectedLeft) < 0.5, 'centered origin');
  cleanup();
  host.remove();
});
