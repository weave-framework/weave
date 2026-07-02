import { test, assert } from '../../../../tools/harness.js';
import { createOwner, runInOwner, disposeOwner, type Owner } from '@weave-framework/runtime';
import {
  draggable,
  dropList,
  moveItemInArray,
  type DraggableRef,
  type DropListRef,
  type DropEvent,
  type DragMove,
} from '@weave-framework/ui/cdk';

const ITEM_H: number = 40;

interface ListFixture {
  container: HTMLElement;
  items: HTMLElement[];
  remove: () => void;
}

/** A fixed-position vertical list of `n` items (item i midpoint = i*40 + 20 in viewport coords). */
function makeList(n: number): ListFixture {
  const container: HTMLElement = document.createElement('ul');
  container.style.cssText = 'position:fixed; top:0; left:0; width:120px; margin:0; padding:0; list-style:none';
  const items: HTMLElement[] = [];
  for (let i: number = 0; i < n; i++) {
    const li: HTMLElement = document.createElement('li');
    li.textContent = `item ${i}`;
    li.tabIndex = 0;
    li.style.cssText = `height:${ITEM_H}px; box-sizing:border-box`;
    container.appendChild(li);
    items.push(li);
  }
  document.body.appendChild(container);
  return { container, items, remove: (): void => container.remove() };
}

function pointer(type: string, target: EventTarget, clientY: number, clientX: number = 50): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX, clientY }));
}
function key(target: EventTarget, k: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: k }));
}

/* ── moveItemInArray ── */
test('drag-drop: moveItemInArray reorders immutably + clamps out-of-range targets', () => {
  const a: string[] = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveItemInArray(a, 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveItemInArray(a, 3, 0), ['d', 'a', 'b', 'c']);
  assert.deepEqual(a, ['a', 'b', 'c', 'd'], 'source untouched');
  assert.deepEqual(moveItemInArray(a, 1, 99), ['a', 'c', 'd', 'b'], 'to clamps to last');
});

/* ── dropList pointer reorder ── */
test('drag-drop: dragging an item past sibling midpoints computes the insertion index + fires onDrop', () => {
  const l: ListFixture = makeList(4);
  const drops: DropEvent[] = [];
  const owner: Owner = createOwner();
  const ref: DropListRef = runInOwner(owner, () => dropList(l.container, { onDrop: (e) => drops.push(e) }));
  // Grab item 0 (mid 20), drag down to y=130 → past mids 60 & 100, before 140 → currentIndex 2.
  pointer('pointerdown', l.items[0], 20);
  assert.equal(ref.dragging(), true);
  assert.equal(ref.activeIndex(), 0);
  pointer('pointermove', l.container, 130);
  assert.equal(ref.overIndex(), 2, 'crossed two midpoints');
  pointer('pointerup', l.container, 130);
  assert.equal(ref.dragging(), false);
  assert.deepEqual(drops.at(-1), { previousIndex: 0, currentIndex: 2 });
  disposeOwner(owner);
  l.remove();
});

test('drag-drop: a drag that returns to the origin fires no onDrop', () => {
  const l: ListFixture = makeList(4);
  const drops: DropEvent[] = [];
  const owner: Owner = createOwner();
  runInOwner(owner, () => dropList(l.container, { onDrop: (e) => drops.push(e) }));
  pointer('pointerdown', l.items[1], 60);
  pointer('pointermove', l.container, 130); // over 2
  pointer('pointermove', l.container, 60); // back to its own slot → over 1 again
  pointer('pointerup', l.container, 60);
  assert.equal(drops.length, 0, 'no-op reorder emits nothing');
  disposeOwner(owner);
  l.remove();
});

/* ── handle gating ── */
test('drag-drop: with a handle selector, only a pointerdown on the handle starts a drag', () => {
  const l: ListFixture = makeList(3);
  // Add a handle span to each item.
  l.items.forEach((li) => {
    const h: HTMLElement = document.createElement('span');
    h.className = 'handle';
    li.appendChild(h);
  });
  const owner: Owner = createOwner();
  const ref: DropListRef = runInOwner(owner, () => dropList(l.container, { handle: '.handle', onDrop: () => {} }));
  pointer('pointerdown', l.items[0], 20); // on the item body, not the handle
  assert.equal(ref.dragging(), false, 'body press ignored');
  pointer('pointerdown', l.items[0].querySelector('.handle')!, 20);
  assert.equal(ref.dragging(), true, 'handle press starts the drag');
  disposeOwner(owner);
  l.remove();
});

/* ── disabled ── */
test('drag-drop: disabled dropList ignores drags', () => {
  const l: ListFixture = makeList(3);
  const drops: DropEvent[] = [];
  const owner: Owner = createOwner();
  const ref: DropListRef = runInOwner(owner, () => dropList(l.container, { disabled: true, onDrop: (e) => drops.push(e) }));
  pointer('pointerdown', l.items[0], 20);
  pointer('pointermove', l.container, 130);
  pointer('pointerup', l.container, 130);
  assert.equal(ref.dragging(), false);
  assert.equal(drops.length, 0);
  disposeOwner(owner);
  l.remove();
});

/* ── keyboard DnD ── */
test('drag-drop: keyboard — Space lifts, Arrows move, Space drops', () => {
  const l: ListFixture = makeList(4);
  const drops: DropEvent[] = [];
  const owner: Owner = createOwner();
  const ref: DropListRef = runInOwner(owner, () => dropList(l.container, { onDrop: (e) => drops.push(e) }));
  l.items[0].focus();
  key(l.items[0], ' '); // lift item 0
  assert.equal(ref.dragging(), true);
  assert.equal(ref.overIndex(), 0);
  key(l.items[0], 'ArrowDown');
  key(l.items[0], 'ArrowDown');
  assert.equal(ref.overIndex(), 2);
  key(l.items[0], ' '); // drop
  assert.equal(ref.dragging(), false);
  assert.deepEqual(drops.at(-1), { previousIndex: 0, currentIndex: 2 });
  disposeOwner(owner);
  l.remove();
});

test('drag-drop: keyboard — Escape cancels a lift without an onDrop', () => {
  const l: ListFixture = makeList(4);
  const drops: DropEvent[] = [];
  const owner: Owner = createOwner();
  const ref: DropListRef = runInOwner(owner, () => dropList(l.container, { onDrop: (e) => drops.push(e) }));
  l.items[1].focus();
  key(l.items[1], ' ');
  key(l.items[1], 'ArrowDown');
  assert.equal(ref.overIndex(), 2);
  key(l.items[1], 'Escape');
  assert.equal(ref.dragging(), false);
  assert.equal(drops.length, 0, 'cancel commits nothing');
  disposeOwner(owner);
  l.remove();
});

/* ── destroy ── */
test('drag-drop: destroy removes listeners (a later pointerdown is inert)', () => {
  const l: ListFixture = makeList(3);
  const owner: Owner = createOwner();
  const ref: DropListRef = runInOwner(owner, () => dropList(l.container, { onDrop: () => {} }));
  ref.destroy();
  pointer('pointerdown', l.items[0], 20);
  assert.equal(ref.dragging(), false, 'no drag after destroy');
  disposeOwner(owner);
  l.remove();
});

/* ── draggable (free-drag) ── */
test('drag-drop: draggable reports the live offset + onMove/onEnd; axis constrains it', () => {
  const el: HTMLElement = document.createElement('div');
  el.style.cssText = 'position:fixed; top:0; left:0; width:80px; height:80px';
  document.body.appendChild(el);
  const moves: DragMove[] = [];
  let ended: DragMove | null = null;
  const owner: Owner = createOwner();
  const ref: DraggableRef = runInOwner(owner, () =>
    draggable(el, { axis: 'y', onMove: (m) => moves.push(m), onEnd: (m) => (ended = m) }),
  );
  pointer('pointerdown', el, 10, 10);
  assert.equal(ref.dragging(), true);
  pointer('pointermove', el, 60, 90); // dy=50, dx would be 80 but axis:y drops it
  assert.deepEqual(ref.offset(), { x: 0, y: 50 });
  assert.equal(moves.at(-1)?.dy, 50);
  assert.equal(moves.at(-1)?.dx, 0, 'x constrained away');
  pointer('pointerup', el, 60, 90);
  assert.equal(ref.dragging(), false);
  assert.deepEqual(ref.offset(), { x: 0, y: 0 }, 'offset resets on release');
  assert.equal((ended as unknown as DragMove).dy, 50);
  disposeOwner(owner);
  el.remove();
});

test('drag-drop: draggable threshold suppresses a sub-threshold move (click vs drag)', () => {
  const el: HTMLElement = document.createElement('div');
  el.style.cssText = 'position:fixed; top:0; left:0; width:80px; height:80px';
  document.body.appendChild(el);
  let started: boolean = false;
  const owner: Owner = createOwner();
  const ref: DraggableRef = runInOwner(owner, () => draggable(el, { threshold: 6, onStart: () => (started = true) }));
  pointer('pointerdown', el, 10, 10);
  assert.equal(ref.dragging(), false, 'not dragging until past threshold');
  pointer('pointermove', el, 13, 13); // hypot(3,3)=4.24 < 6
  assert.equal(started, false);
  pointer('pointermove', el, 20, 20); // hypot(10,10)=14 > 6
  assert.equal(started, true);
  assert.equal(ref.dragging(), true);
  disposeOwner(owner);
  el.remove();
});
