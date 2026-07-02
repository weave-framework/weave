/**
 * Drag & Drop — the headless pointer-drag + reorder engine under reorderable Lists,
 * Table rows, Tree nodes, and single-axis drag gestures (the Bottom Sheet's drag-to-
 * dismiss). Zero styling: it tracks the live pointer drag and exposes state as signals +
 * callbacks; the consumer paints the dragged element, the preview, and the placeholder.
 *
 * Two primitives:
 *  - **`draggable(el, opts)`** — a standalone free-drag: pointer (or a `handle`) drag →
 *    an `offset()` signal (constrainable to one `axis`) + `onStart`/`onMove`/`onEnd`. The
 *    single-gesture case (drag a sheet down, release past a threshold to dismiss).
 *  - **`dropList(container, opts)`** — a reorderable list: on a drag it computes the
 *    **insertion index** by counting the sibling midpoints the pointer has crossed, exposes
 *    `dragging()`/`activeIndex()`/`overIndex()` signals, and fires `onDrop({previousIndex,
 *    currentIndex})` on release. Full **keyboard DnD** (Space lift → Arrows move → Space
 *    drop, Escape cancel) for a11y. `moveItemInArray` applies the result.
 *
 * Built on native pointer events + pointer capture (no window listeners to leak). Zero-dep.
 *
 *   const list = dropList(ul, { onDrop: ({ previousIndex, currentIndex }) =>
 *     rows.set(moveItemInArray(rows(), previousIndex, currentIndex)) });
 */
import { signal, onDispose, type Signal } from '@weave-framework/runtime';

/** Which axis a drag / list runs along. */
export type DragOrientation = 'vertical' | 'horizontal';
/** A pointer offset. */
export interface DragPoint {
  x: number;
  y: number;
}

function disabledOf(d?: boolean | (() => boolean)): boolean {
  return typeof d === 'function' ? d() : !!d;
}

/* ─────────────────────────── draggable ─────────────────────────── */

/** A move event during a free-drag: the offset from the drag start + the live pointer position. */
export interface DragMove {
  /** Offset from drag start along x (0 when `axis: 'y'`). */
  dx: number;
  /** Offset from drag start along y (0 when `axis: 'x'`). */
  dy: number;
  /** Live pointer clientX. */
  x: number;
  /** Live pointer clientY. */
  y: number;
  event: PointerEvent;
}

export interface DraggableOptions {
  /** Restrict drag-start to this element (or a selector within `el`). Default: the whole element. */
  handle?: HTMLElement | string;
  /** Disable dragging (boolean or a reactive getter). */
  disabled?: boolean | (() => boolean);
  /** Constrain movement to one axis. Default `both`. */
  axis?: 'x' | 'y' | 'both';
  /** Pixels the pointer must move before a drag starts (a click-vs-drag guard). Default 0. */
  threshold?: number;
  onStart?: (event: PointerEvent) => void;
  onMove?: (move: DragMove) => void;
  onEnd?: (move: DragMove) => void;
}

export interface DraggableRef {
  /** Whether a drag is currently in progress. Reactive. */
  dragging(): boolean;
  /** The current offset from the drag start (reset to 0 on release). Reactive. */
  offset(): DragPoint;
  /** Detach listeners (also runs on owner disposal). */
  destroy(): void;
}

function resolveHandle(el: HTMLElement, handle?: HTMLElement | string): HTMLElement | null {
  if (!handle) return el;
  return typeof handle === 'string' ? el.querySelector<HTMLElement>(handle) : handle;
}

/** Make `el` free-draggable via pointer events. Headless — the consumer moves the element. */
export function draggable(el: HTMLElement, options: DraggableOptions = {}): DraggableRef {
  const axis: 'x' | 'y' | 'both' = options.axis ?? 'both';
  const threshold: number = options.threshold ?? 0;
  const dragging: Signal<boolean> = signal<boolean>(false);
  const offset: Signal<DragPoint> = signal<DragPoint>({ x: 0, y: 0 });

  let active: boolean = false;
  let started: boolean = false;
  let pointerId: number = -1;
  let startX: number = 0;
  let startY: number = 0;

  const constrain = (dx: number, dy: number): DragPoint => ({ x: axis === 'y' ? 0 : dx, y: axis === 'x' ? 0 : dy });

  const onPointerDown = (event: PointerEvent): void => {
    if (disabledOf(options.disabled) || event.button !== 0) return;
    const handle: HTMLElement | null = resolveHandle(el, options.handle);
    if (!handle || !handle.contains(event.target as Node)) return;
    active = true;
    started = threshold === 0;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    try {
      el.setPointerCapture(pointerId);
    } catch {
      /* synthetic test events have no active pointer id */
    }
    if (started) {
      dragging.set(true);
      options.onStart?.(event);
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!active) return;
    const rawDx: number = event.clientX - startX;
    const rawDy: number = event.clientY - startY;
    if (!started) {
      if (Math.hypot(rawDx, rawDy) < threshold) return;
      started = true;
      dragging.set(true);
      options.onStart?.(event);
    }
    const point: DragPoint = constrain(rawDx, rawDy);
    offset.set(point);
    options.onMove?.({ dx: point.x, dy: point.y, x: event.clientX, y: event.clientY, event });
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!active) return;
    active = false;
    try {
      el.releasePointerCapture(pointerId);
    } catch {
      /* ignore */
    }
    if (started) {
      const point: DragPoint = constrain(event.clientX - startX, event.clientY - startY);
      options.onEnd?.({ dx: point.x, dy: point.y, x: event.clientX, y: event.clientY, event });
    }
    started = false;
    dragging.set(false);
    offset.set({ x: 0, y: 0 });
  };

  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerUp);

  const destroy = (): void => {
    el.removeEventListener('pointerdown', onPointerDown);
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerup', onPointerUp);
    el.removeEventListener('pointercancel', onPointerUp);
  };
  onDispose(destroy);

  return { dragging: (): boolean => dragging(), offset: (): DragPoint => offset(), destroy };
}

/* ─────────────────────────── dropList ─────────────────────────── */

/** The reorder result — apply with `moveItemInArray(data, previousIndex, currentIndex)`. */
export interface DropEvent {
  previousIndex: number;
  currentIndex: number;
}

export interface DropListOptions {
  /** Selector for the draggable items (default: the container's direct element children). */
  itemSelector?: string;
  /** Selector (within an item) for a drag handle — only a pointerdown on it starts a drag. */
  handle?: string;
  /** List axis. Default `vertical`. */
  orientation?: DragOrientation;
  /** Disable reordering (boolean or a reactive getter). */
  disabled?: boolean | (() => boolean);
  /** Keyboard DnD (Space lift → Arrows → Space drop). Default true — set false when the host
   *  already binds Space/Arrows (e.g. a listbox/tree that selects on Space). */
  keyboard?: boolean;
  /** Called on a committed reorder. */
  onDrop: (event: DropEvent) => void;
}

export interface DropListRef {
  /** Whether a drag is in progress. Reactive. */
  dragging(): boolean;
  /** The index of the item being dragged, or -1. Reactive. */
  activeIndex(): number;
  /** The live insertion index (where the item would drop), or -1. Reactive. */
  overIndex(): number;
  /** Detach listeners (also runs on owner disposal). */
  destroy(): void;
}

/** Move an item within an array (immutably) — the standard `onDrop` applier. */
export function moveItemInArray<T>(array: T[], from: number, to: number): T[] {
  const copy: T[] = array.slice();
  if (from < 0 || from >= copy.length) return copy;
  const clampedTo: number = Math.max(0, Math.min(to, copy.length - 1));
  const [item] = copy.splice(from, 1);
  copy.splice(clampedTo, 0, item);
  return copy;
}

/** Make `container`'s children a reorderable drop list (pointer + keyboard). Headless. */
export function dropList(container: HTMLElement, options: DropListOptions): DropListRef {
  const orientation: DragOrientation = options.orientation ?? 'vertical';
  const dragging: Signal<boolean> = signal<boolean>(false);
  const activeIndex: Signal<number> = signal<number>(-1);
  const overIndex: Signal<number> = signal<number>(-1);
  let pointerId: number = -1;
  let keyboardLifted: boolean = false;

  const items = (): HTMLElement[] =>
    options.itemSelector
      ? Array.from(container.querySelectorAll<HTMLElement>(options.itemSelector))
      : (Array.from(container.children).filter((c): c is HTMLElement => c instanceof HTMLElement));

  const itemFrom = (target: Node | null): HTMLElement | null => {
    const els: HTMLElement[] = items();
    let node: Node | null = target;
    while (node && node !== container) {
      if (node instanceof HTMLElement && els.includes(node)) return node;
      node = node.parentNode;
    }
    return null;
  };

  const midpoint = (rect: DOMRect): number =>
    orientation === 'horizontal' ? rect.left + rect.width / 2 : rect.top + rect.height / 2;

  // The insertion index = how many non-dragged items' midpoints the pointer has passed.
  const computeOver = (from: number, coord: number): number => {
    const els: HTMLElement[] = items();
    let idx: number = 0;
    for (let i: number = 0; i < els.length; i++) {
      if (i === from) continue;
      if (coord > midpoint(els[i].getBoundingClientRect())) idx++;
    }
    return idx;
  };

  const startDrag = (from: number): void => {
    activeIndex.set(from);
    overIndex.set(from);
    dragging.set(true);
  };
  const endDrag = (commit: boolean): void => {
    const from: number = activeIndex();
    const to: number = overIndex();
    dragging.set(false);
    activeIndex.set(-1);
    overIndex.set(-1);
    keyboardLifted = false;
    if (commit && from >= 0 && to >= 0 && from !== to) options.onDrop({ previousIndex: from, currentIndex: to });
  };

  /* pointer */
  const onPointerDown = (event: PointerEvent): void => {
    if (disabledOf(options.disabled) || event.button !== 0) return;
    const item: HTMLElement | null = itemFrom(event.target as Node);
    if (!item) return;
    if (options.handle && !(event.target as HTMLElement).closest(options.handle)) return;
    const from: number = items().indexOf(item);
    if (from < 0) return;
    pointerId = event.pointerId;
    try {
      container.setPointerCapture(pointerId);
    } catch {
      /* synthetic events */
    }
    startDrag(from);
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging() || keyboardLifted) return;
    overIndex.set(computeOver(activeIndex(), orientation === 'horizontal' ? event.clientX : event.clientY));
  };
  const onPointerUp = (): void => {
    if (!dragging() || keyboardLifted) return;
    try {
      container.releasePointerCapture(pointerId);
    } catch {
      /* ignore */
    }
    endDrag(true);
  };

  /* keyboard DnD: Space lift/drop, Arrows move, Escape cancel */
  const onKeyDown = (event: KeyboardEvent): void => {
    if (disabledOf(options.disabled)) return;
    if (event.key === ' ' || event.key === 'Spacebar') {
      if (!keyboardLifted) {
        const item: HTMLElement | null = itemFrom(event.target as Node);
        const from: number = item ? items().indexOf(item) : -1;
        if (from < 0) return;
        keyboardLifted = true;
        startDrag(from);
      } else {
        endDrag(true);
      }
      event.preventDefault();
      return;
    }
    if (!dragging() || !keyboardLifted) return;
    const vertical: boolean = orientation === 'vertical';
    const n: number = items().length;
    if ((vertical && event.key === 'ArrowDown') || (!vertical && event.key === 'ArrowRight')) {
      overIndex.set(Math.min(n - 1, overIndex() + 1));
      event.preventDefault();
    } else if ((vertical && event.key === 'ArrowUp') || (!vertical && event.key === 'ArrowLeft')) {
      overIndex.set(Math.max(0, overIndex() - 1));
      event.preventDefault();
    } else if (event.key === 'Escape') {
      endDrag(false);
      event.preventDefault();
    }
  };

  const useKeyboard: boolean = options.keyboard !== false;
  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointercancel', onPointerUp);
  if (useKeyboard) container.addEventListener('keydown', onKeyDown);

  const destroy = (): void => {
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerup', onPointerUp);
    container.removeEventListener('pointercancel', onPointerUp);
    if (useKeyboard) container.removeEventListener('keydown', onKeyDown);
  };
  onDispose(destroy);

  return {
    dragging: (): boolean => dragging(),
    activeIndex: (): number => activeIndex(),
    overIndex: (): number => overIndex(),
    destroy,
  };
}
