import { test, assert } from '../../../../tools/harness.js';
import { effect, createOwner, runInOwner, disposeOwner, type Owner } from '@weave-framework/runtime';
import { resizeSignal, mutationSignal, type Size } from '@weave-framework/ui/cdk';

const raf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
const tick = (): Promise<void> => new Promise((r) => queueMicrotask(r));

function box(w: number, h: number): HTMLElement {
  const el: HTMLElement = document.createElement('div');
  el.style.cssText = `width:${w}px;height:${h}px;`;
  document.body.appendChild(el);
  return el;
}

test('resizeSignal: initial size, then updates when the element resizes', async () => {
  const el: HTMLElement = box(50, 30);
  const size: () => Size = resizeSignal(el);
  assert.equal(size().width, 50, 'initial width');
  assert.equal(size().height, 30, 'initial height');
  el.style.width = '90px';
  await raf();
  await raf();
  assert.equal(size().width, 90, 'observed the resize');
  el.remove();
});

test('resizeSignal: drives an effect', async () => {
  const el: HTMLElement = box(40, 40);
  const size: () => Size = resizeSignal(el);
  const widths: number[] = [];
  const stop: () => void = effect(() => {
    widths.push(size().width);
  });
  el.style.width = '120px';
  await raf();
  await raf();
  assert.ok(widths.includes(120), 'effect re-ran with the new width');
  stop();
  el.remove();
});

test('mutationSignal: ticks on child + attribute changes', async () => {
  const el: HTMLElement = box(10, 10);
  const changes: () => number = mutationSignal(el);
  assert.equal(changes(), 0);
  el.appendChild(document.createElement('span'));
  await tick();
  assert.equal(changes(), 1, 'child addition');
  el.setAttribute('data-x', '1');
  await tick();
  assert.equal(changes(), 2, 'attribute change');
  el.remove();
});

test('mutationSignal: stops after owner disposal', async () => {
  const el: HTMLElement = box(10, 10);
  const owner: Owner = createOwner();
  const changes: () => number = runInOwner(owner, () => mutationSignal(el));
  el.appendChild(document.createElement('i'));
  await tick();
  const seen: number = changes();
  disposeOwner(owner);
  el.appendChild(document.createElement('b'));
  await tick();
  assert.equal(changes(), seen, 'no ticks after disconnect');
  el.remove();
});
