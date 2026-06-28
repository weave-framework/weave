/**
 * @weave/runtime/dom — the tiny runtime the compiler targets.
 *
 * These helpers create real DOM once and wire fine-grained signal bindings.
 * There is no Virtual DOM and no tree diffing: each helper updates exactly one
 * node / attribute / property. The compiler decides at build time whether an
 * expression is static (`setX`) or reactive (`bindX`), so the runtime never
 * branches on `typeof value` the way the v0.1 runtime renderer did.
 *
 * M1 scope: structure (template/clone/child/anchor/insert), text, attribute,
 * property, event, and ref bindings, plus mount. Keyed lists (`reconcileKeyed`)
 * and control flow arrive in M2/M4.
 */

import { effect, signal, createOwner, runInOwner, disposeOwner, onDispose, getOwner } from './reactive.js';
import type { Signal, Owner } from './reactive.js';

/* ──────────────────────────── structure ──────────────────────────── */

/** Parse an HTML string into a reusable, cached `<template>`. Parsed once. */
export function template(html: string): HTMLTemplateElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl;
}

/** Clone a template's single root node (the common single-root component case). */
export function clone(tpl: HTMLTemplateElement): Element {
  const root = tpl.content.firstElementChild ?? tpl.content.firstChild;
  return root!.cloneNode(true) as Element;
}

/** Clone a template's whole content as a fragment (multi-root components). */
export function cloneFragment(tpl: HTMLTemplateElement): DocumentFragment {
  return tpl.content.cloneNode(true) as DocumentFragment;
}

/**
 * Walk to a descendant by child-index path, resolved at compile time.
 * `child(root, 1)` → root.childNodes[1]; `child(root, 1, 0)` → root.childNodes[1].childNodes[0].
 */
export function child(node: Node, ...path: number[]): Node {
  let n: Node = node;
  for (const i of path) n = n.childNodes[i];
  return n;
}

/** Insert a comment placeholder, the stable anchor a dynamic region renders before. */
export function anchor(parent: Node, before: Node | null = null): Comment {
  const c = document.createComment('');
  parent.insertBefore(c, before);
  return c;
}

/** Insert `node` into `parent` before `before` (or append). */
export function insert(parent: Node, node: Node, before: Node | null = null): void {
  parent.insertBefore(node, before);
}

/* ──────────────────────────── text ──────────────────────────── */

function textBefore(anchorNode: Comment): Text {
  const t = document.createTextNode('');
  anchorNode.parentNode!.insertBefore(t, anchorNode);
  return t;
}

function stringify(v: unknown): string {
  return v == null || v === false ? '' : String(v);
}

/** Static text at an anchor (compiler-classified non-reactive expression). */
export function setText(anchorNode: Comment, value: unknown): void {
  textBefore(anchorNode).data = stringify(value);
}

/** Reactive text: one effect, one text node, updated in place. */
export function bindText(anchorNode: Comment, fn: () => unknown): void {
  const t = textBefore(anchorNode);
  effect(() => {
    t.data = stringify(fn());
  });
}

/* ──────────────────────────── attributes / properties ──────────────────────────── */

function applyAttr(el: Element, name: string, value: unknown): void {
  if (value === false || value == null) {
    el.removeAttribute(name);
  } else if (value === true) {
    el.setAttribute(name, '');
  } else {
    el.setAttribute(name, String(value));
  }
}

/** Static attribute (boolean/null aware). */
export function setAttr(el: Element, name: string, value: unknown): void {
  applyAttr(el, name, value);
}

/** Reactive attribute. */
export function bindAttr(el: Element, name: string, fn: () => unknown): void {
  effect(() => applyAttr(el, name, fn()));
}

/** Reactive DOM property (e.g. `.value`, `.checked`). */
export function bindProp(el: Element, name: string, fn: () => unknown): void {
  effect(() => {
    (el as unknown as Record<string, unknown>)[name] = fn();
  });
}

/** Toggle a single class reactively (`class:done={cond}`). */
export function bindClass(el: Element, name: string, fn: () => unknown): void {
  effect(() => {
    el.classList.toggle(name, !!fn());
  });
}

/* ──────────────────────────── events / refs ──────────────────────────── */

/** Attach an event listener. Static — handlers are never reactive. */
export function listen(
  el: Element,
  type: string,
  handler: (e: Event) => void,
  opts?: AddEventListenerOptions
): void {
  el.addEventListener(type, handler, opts);
}

/** Assign an element reference to a signal or a callback (`ref={el}` / `bind:this`). */
export function setRef(target: Signal<Element | null> | ((el: Element) => void), el: Element): void {
  if (typeof target === 'function' && 'set' in target) {
    (target as Signal<Element | null>).set(el);
  } else {
    (target as (el: Element) => void)(el);
  }
}

/* ──────────────────────────── two-way binding (forms) ──────────────────────────── */

/**
 * Two-way `bind:*` between a form control and a writable signal. One effect
 * writes the signal → the DOM; native input events write the DOM → the signal.
 * `kind` is decided by the compiler from the binding name:
 *
 *  - `'value'`  — text / textarea / number / range / `<select>` (single or multiple).
 *                 Number/range read as `valueAsNumber`; a multiple select as `string[]`.
 *  - `'checked'` — a checkbox as a boolean.
 *  - `'group'`  — a radio (or value-checkbox): the signal holds the *selected value*.
 *
 * Text inputs are IME-safe: the DOM is not overwritten mid-composition, and the
 * signal is written once composition ends. The signal is the source of truth, so
 * we only assign back to the DOM when the value actually differs (no caret jump).
 */
export function bindValue(el: Element, sig: Signal<unknown>, kind: 'value' | 'checked' | 'group'): void {
  if (kind === 'checked') {
    const box = el as HTMLInputElement;
    effect(() => {
      box.checked = !!sig();
    });
    el.addEventListener('change', () => sig.set(box.checked));
    return;
  }

  if (kind === 'group') {
    const radio = el as HTMLInputElement;
    effect(() => {
      radio.checked = sig() === radio.value;
    });
    el.addEventListener('change', () => {
      if (radio.checked) sig.set(radio.value);
    });
    return;
  }

  // kind === 'value'
  const isSelect = el.tagName === 'SELECT';
  const multiple = isSelect && (el as HTMLSelectElement).multiple;
  const input = el as HTMLInputElement;
  const numeric = !isSelect && (input.type === 'number' || input.type === 'range');
  let composing = false;

  effect(() => {
    const v = sig();
    if (composing) return; // don't fight the IME mid-composition
    if (multiple) {
      const set = new Set((Array.isArray(v) ? v : []).map(String));
      for (const opt of (el as HTMLSelectElement).options) opt.selected = set.has(opt.value);
    } else if (numeric) {
      // compare numerically so typing "1." (NaN mid-edit) doesn't get clobbered
      if (input.valueAsNumber !== v) input.value = v == null ? '' : String(v);
    } else {
      const s = v == null ? '' : String(v);
      if (input.value !== s) input.value = s;
    }
  });

  const read = (): unknown => {
    if (multiple) {
      return [...(el as HTMLSelectElement).selectedOptions].map((o) => o.value);
    }
    return numeric ? input.valueAsNumber : input.value;
  };
  const write = (): unknown => sig.set(read());

  el.addEventListener('input', write);
  if (isSelect) el.addEventListener('change', write); // <select> commits on change
  if (!isSelect && !numeric) {
    el.addEventListener('compositionstart', () => {
      composing = true;
    });
    el.addEventListener('compositionend', () => {
      composing = false;
      write();
    });
  }
}

/* ──────────────────────────── keyed reconciliation ──────────────────────────── */

/** One rendered row in a keyed list. `node` is its single root node. */
export interface Row {
  key: unknown;
  node: ChildNode;
  /** torn down when the row is removed (disposes the row's effects) */
  dispose?: () => void;
}

/**
 * Longest-increasing-subsequence of `arr` (Vue's battle-tested `getSequence`).
 * `0` marks a brand-new item to skip. Returns the indices that may stay put.
 */
function getSequence(arr: number[]): number[] {
  const p = arr.slice();
  const result = [0];
  let i, j, u, v, c;
  const len = arr.length;
  for (i = 0; i < len; i++) {
    const arrI = arr[i];
    if (arrI !== 0) {
      j = result[result.length - 1];
      if (arr[j] < arrI) {
        p[i] = j;
        result.push(i);
        continue;
      }
      u = 0;
      v = result.length - 1;
      while (u < v) {
        c = (u + v) >> 1;
        if (arr[result[c]] < arrI) u = c + 1;
        else v = c;
      }
      if (arrI < arr[result[u]]) {
        if (u > 0) p[i] = result[u - 1];
        result[u] = i;
      }
    }
  }
  u = result.length;
  v = result[u - 1];
  while (u-- > 0) {
    result[u] = v;
    v = p[v];
  }
  return result;
}

/**
 * Reconcile a keyed list against new data with **minimal DOM moves**. Reuses the
 * existing node for an unchanged key (preserving identity, focus, scroll and any
 * uncontrolled input state) and only moves the smallest set of nodes needed
 * (those outside the longest stable run). This is the real reconciler the v0.1
 * `each()` lacked — it used to clear and rebuild the whole list.
 *
 * Rows are single-root (the common `@for` over `<li>`/component case).
 * `end` is a stable anchor (comment) marking the end of the list region.
 */
export function reconcileKeyed<T>(
  parent: Node,
  end: Node,
  prev: Row[],
  data: readonly T[],
  keyOf: (item: T, i: number) => unknown,
  create: (item: T, i: number) => Row
): Row[] {
  const prevByKey = new Map<unknown, { row: Row; oldIndex: number }>();
  prev.forEach((row, i) => prevByKey.set(row.key, { row, oldIndex: i }));

  const next: Row[] = new Array(data.length);
  const newToOld: number[] = new Array(data.length).fill(0); // 0 ⇒ brand new
  const reused = new Set<Row>();

  for (let i = 0; i < data.length; i++) {
    const key = keyOf(data[i], i);
    const hit = prevByKey.get(key);
    if (hit && !reused.has(hit.row)) {
      reused.add(hit.row);
      hit.row.key = key;
      next[i] = hit.row;
      newToOld[i] = hit.oldIndex + 1;
    } else {
      const row = create(data[i], i);
      row.key = key;
      next[i] = row;
    }
  }

  // Remove rows whose key vanished.
  for (const row of prev) {
    if (!reused.has(row)) {
      row.dispose?.();
      row.node.remove();
    }
  }

  // Place nodes back-to-front; nodes in the LIS are already in order and stay put.
  const seq = getSequence(newToOld);
  let s = seq.length - 1;
  let anchorNode: Node = end;
  for (let i = data.length - 1; i >= 0; i--) {
    const row = next[i];
    const isNew = newToOld[i] === 0;
    if (isNew || s < 0 || i !== seq[s]) {
      parent.insertBefore(row.node, anchorNode); // new or moved
    } else {
      s--; // stable: leave untouched (no DOM move → focus/scroll preserved)
    }
    anchorNode = row.node;
  }

  return next;
}

/* ──────────────────────────── control flow ──────────────────────────── */

const NONE = Symbol('none');

function placeBefore(parent: Node, node: Node, anchorNode: Node): ChildNode[] {
  const nodes: ChildNode[] =
    node instanceof DocumentFragment ? ([...node.childNodes] as ChildNode[]) : [node as ChildNode];
  for (const n of nodes) parent.insertBefore(n, anchorNode);
  return nodes;
}

function firstChildNode(node: Node): ChildNode {
  return (node instanceof DocumentFragment ? node.firstChild : node) as ChildNode;
}

/**
 * `@if` / `@else` / `@switch`. `selector` returns the chosen branch's render
 * function (a stable reference — same branch ⇒ no remount), or null. The branch
 * runs in its own ownership scope so its effects are disposed when it unmounts.
 */
export function ifBlock(anchor: Comment, selector: () => (() => Node | null) | null): void {
  const parent = anchor.parentNode!;
  // Capture the *construction-time* (lexical) owner. Branch owners parent to it so
  // context (`inject`) keeps working after a re-render driven by an external signal
  // (e.g. navigation), where the ambient owner at effect-re-run time is unrelated.
  const host = getOwner();
  let owner: Owner | null = null;
  let nodes: ChildNode[] = [];
  let prev: unknown = NONE;

  const clear = () => {
    if (owner) {
      disposeOwner(owner);
      owner = null;
    }
    nodes.forEach((n) => n.remove());
    nodes = [];
  };

  effect(() => {
    const next = selector();
    if (next === prev) return; // same branch → leave the live DOM untouched
    prev = next;
    clear();
    if (next) {
      owner = runInOwner(host, () => createOwner(null));
      const node = runInOwner(owner, () => next());
      nodes = node ? placeBefore(parent, node, anchor) : [];
    }
  });
  onDispose(clear);
}

/** Per-row reactive context exposed to a `@for` body (item + implicit `$` vars). */
export interface ForContext<T> {
  item: () => T;
  index: () => number;
  count: () => number;
  first: () => boolean;
  last: () => boolean;
  even: () => boolean;
  odd: () => boolean;
}

interface EachRow<T> extends Row {
  owner: Owner;
  itemSig: Signal<T>;
  indexSig: Signal<number>;
  countSig: Signal<number>;
}

/**
 * `@for ... track`. Keyed, with reactive per-row `item` and positional `$`
 * variables that update across reorders. Each row owns its effects (disposed on
 * removal). Uses {@link reconcileKeyed} for minimal DOM moves. Rows are
 * single-root (a `@for` body wraps one element). `emptyRender` is the `@empty`.
 */
export function eachBlock<T>(
  anchor: Comment,
  items: () => readonly T[] | null | undefined,
  keyOf: (item: T, i: number) => unknown,
  renderRow: (ctx: ForContext<T>) => Node,
  emptyRender?: () => Node
): void {
  const parent = anchor.parentNode!;
  // Construction-time owner — row/empty owners parent to it (see ifBlock) so context
  // survives reconciles driven by an external signal.
  const host = getOwner();
  let rows: EachRow<T>[] = [];
  let emptyOwner: Owner | null = null;
  let emptyNodes: ChildNode[] = [];

  const clearEmpty = () => {
    if (emptyOwner) {
      disposeOwner(emptyOwner);
      emptyOwner = null;
    }
    emptyNodes.forEach((n) => n.remove());
    emptyNodes = [];
  };
  const removeRows = () => {
    rows.forEach((r) => {
      disposeOwner(r.owner);
      r.node.remove();
    });
    rows = [];
  };

  effect(() => {
    const data = items() || [];

    if (data.length === 0) {
      removeRows();
      if (emptyRender && !emptyOwner) {
        emptyOwner = runInOwner(host, () => createOwner(null));
        const node = runInOwner(emptyOwner, () => emptyRender());
        emptyNodes = placeBefore(parent, node, anchor);
      }
      return;
    }
    clearEmpty();

    rows = reconcileKeyed(parent, anchor, rows, data, keyOf, (item, i) => {
      const itemSig = signal(item) as Signal<T>;
      const indexSig = signal(i);
      const countSig = signal(data.length);
      const ctx: ForContext<T> = {
        item: itemSig,
        index: indexSig,
        count: countSig,
        first: () => indexSig() === 0,
        last: () => indexSig() === countSig() - 1,
        even: () => indexSig() % 2 === 0,
        odd: () => indexSig() % 2 === 1,
      };
      const owner = runInOwner(host, () => createOwner(null));
      const node = runInOwner(owner, () => renderRow(ctx));
      return {
        key: keyOf(item, i),
        node: firstChildNode(node),
        dispose: () => disposeOwner(owner),
        owner,
        itemSig,
        indexSig,
        countSig,
      } as EachRow<T>;
    }) as EachRow<T>[];

    // Refresh item + positional signals for every row (reused rows included),
    // so immutable updates and reorders flow into the existing DOM.
    rows.forEach((r, i) => {
      r.itemSig.set(data[i] as T);
      r.indexSig.set(i);
      r.countSig.set(data.length);
    });
  });
  onDispose(() => {
    removeRows();
    clearEmpty();
  });
}

/* ──────────────────────────── defer ──────────────────────────── */

/** A `@defer` trigger spec (emitted by codegen). `when` is reactive; the rest fire once. */
export type DeferTrigger =
  | { on: 'when'; when: () => unknown }
  | { on: 'idle' }
  | { on: 'viewport' }
  | { on: 'timer'; ms: number }
  | { on: 'interaction' }
  | { on: 'hover' }
  | { on: 'immediate' };

/** First Element among a node list (the placeholder's root — for viewport/interaction/hover). */
function firstElement(nodes: ChildNode[]): Element | null {
  for (const n of nodes) if (n instanceof Element) return n;
  return null;
}

/**
 * `@defer` — gate the rendering of `content` until `trigger` fires; show the optional
 * `placeholder` until then. Each region renders in its own owner scope (parented to the
 * construction-time owner, like {@link ifBlock}), so effects dispose on unmount/swap and
 * context still resolves. `viewport`/`interaction`/`hover` observe the placeholder's root
 * element; with no placeholder they fire immediately (nothing to observe).
 */
export function deferBlock(
  anchor: Comment,
  trigger: DeferTrigger,
  content: () => Node,
  placeholder?: () => Node
): void {
  const parent = anchor.parentNode!;
  const host = getOwner();
  let owner: Owner | null = null;
  let nodes: ChildNode[] = [];
  let fired = false;
  let disposed = false;
  let disarm: (() => void) | void;

  const clear = (): void => {
    if (owner) {
      disposeOwner(owner);
      owner = null;
    }
    nodes.forEach((n) => n.remove());
    nodes = [];
  };
  const render = (fn: () => Node): void => {
    clear();
    owner = runInOwner(host, () => createOwner(null));
    const node = runInOwner(owner, () => fn());
    nodes = node ? placeBefore(parent, node, anchor) : [];
  };

  if (placeholder) render(placeholder);

  const fire = (): void => {
    if (fired || disposed) return;
    fired = true;
    if (disarm) disarm();
    render(content);
  };

  disarm = arm(trigger, fire, () => firstElement(nodes), host);
  onDispose(() => {
    disposed = true;
    if (disarm) disarm();
    clear();
  });
}

/** Wire a trigger to `fire`; return a teardown. `target()` yields the placeholder root. */
function arm(
  trigger: DeferTrigger,
  fire: () => void,
  target: () => Element | null,
  host: Owner | null
): (() => void) | void {
  const g = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  switch (trigger.on) {
    case 'immediate':
      fire();
      return;
    case 'when':
      // Reactive: fire when the condition becomes truthy. Runs in the host owner so it
      // is tracked + disposed there; `fire` disarms it after the first truthy read.
      return runInOwner(host, () =>
        effect(() => {
          if ((trigger as { when: () => unknown }).when()) fire();
        })
      );
    case 'idle': {
      if (g.requestIdleCallback) {
        const id = g.requestIdleCallback(fire);
        return () => g.cancelIdleCallback?.(id);
      }
      const t = setTimeout(fire, 1);
      return () => clearTimeout(t);
    }
    case 'timer': {
      const t = setTimeout(fire, (trigger as { ms: number }).ms);
      return () => clearTimeout(t);
    }
    case 'viewport': {
      const el = target();
      if (!el || typeof IntersectionObserver === 'undefined') return void fire();
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) fire();
      });
      io.observe(el);
      return () => io.disconnect();
    }
    case 'interaction':
    case 'hover': {
      const el = target();
      if (!el) return void fire();
      const events =
        trigger.on === 'hover' ? ['pointerenter', 'focusin'] : ['click', 'keydown'];
      const handler = (): void => fire();
      for (const ev of events) el.addEventListener(ev, handler);
      return () => {
        for (const ev of events) el.removeEventListener(ev, handler);
      };
    }
  }
}

/* ──────────────────────────── components ──────────────────────────── */

/**
 * Insert a child component's (or slot's) output before an anchor. Handles a
 * single node, a fragment (its children are inserted), or null (no-op). The
 * child instantiates within the current ownership scope, so its effects are
 * disposed when the surrounding region unmounts.
 */
export function mountChild(anchorNode: Comment, node: Node | null): void {
  if (node) anchorNode.parentNode!.insertBefore(node, anchorNode);
}

/** A component instance: takes props + slots, returns its DOM. */
export type Component = (props?: Record<string, unknown>, slots?: Record<string, () => Node>) => Node;

/**
 * Glue a compiled `render(ctx, slots)` to a `setup(props)`. The loader emits
 * `export default defineComponent(render, setup)` per component. `ctx` exposes
 * `setup()`'s bindings as own properties over `props` on the prototype, so a
 * template name resolves to a binding first, else to a (lazy, reactive) prop
 * getter.
 *
 * Each instance runs in its **own** owner scope, registered for disposal with the
 * surrounding region (so it tears down when that region unmounts). This gives each
 * component a private context frame: a `provide` in `setup` is visible to this
 * component's descendants but not to its siblings, and `inject` walks up to the
 * provider — exactly the tree-context semantics other frameworks expose.
 */
export function defineComponent(
  render: (ctx: Record<string, unknown>, slots: Record<string, () => Node>) => Node,
  setup?: (props: Record<string, unknown>) => Record<string, unknown> | void
): Component {
  return (props = {}, slots = {}) => {
    const owner = createOwner(); // _parent = surrounding owner (context chain)
    onDispose(() => disposeOwner(owner)); // surrounding scope disposes this instance
    return runInOwner(owner, () => {
      const bindings = setup ? setup(props) || {} : {};
      const ctx = Object.assign(Object.create(props), bindings);
      return render(ctx, slots);
    });
  };
}

/** Mount a root component into a container under a fresh owner. Returns an unmount fn. */
export function mountComponent(
  component: Component,
  container: Element,
  props?: Record<string, unknown>
): () => void {
  const owner = createOwner(null);
  const node = runInOwner(owner, () => component(props, {}));
  const unmount = mount(node, container);
  return () => {
    disposeOwner(owner);
    unmount();
  };
}

/** Optional fallbacks for {@link lazy} while loading or on failure. */
export interface LazyOptions {
  /** Rendered while the loader is in flight (e.g. a spinner). */
  loading?: Component;
  /** Rendered if the loader rejects; receives the error. */
  error?: (err: unknown) => Node;
}

/**
 * Wrap a dynamic import as a {@link Component} for code-splitting — `lazy(() =>
 * import('./Heavy'))`. The loader runs **once** (shared across every instance and
 * cached), resolving to the module's `default` export (or a component returned
 * directly). Until it settles, the optional `loading` fallback shows; on success the
 * real component renders with the same props/slots; on failure the optional `error`
 * fallback shows. Usable anywhere a component is — including a route
 * (`{ path, component: lazy(() => import('./Page')) }`).
 */
export function lazy(
  loader: () => Promise<{ default: Component } | Component>,
  opts: LazyOptions = {}
): Component {
  let resolved: Component | null = null;
  let failed: unknown = null;
  let started = false;
  const state = signal<'loading' | 'ready' | 'error'>('loading');

  const start = (): void => {
    if (started) return;
    started = true;
    loader().then(
      (m) => {
        resolved = (typeof m === 'function' ? m : m.default) as Component;
        state.set('ready');
      },
      (e) => {
        failed = e ?? new Error('lazy: load failed');
        state.set('error');
      }
    );
  };

  return (props = {}, slots = {}) => {
    start();
    const host = document.createElement('div');
    host.style.display = 'contents';
    const anchor = document.createComment('lazy');
    host.appendChild(anchor);
    ifBlock(anchor, () => {
      const s = state();
      if (s === 'ready') {
        const comp = resolved!;
        return () => comp(props, slots);
      }
      if (s === 'error') return opts.error ? () => opts.error!(failed) : null;
      return opts.loading ? () => opts.loading!(props, slots) : null;
    });
    return host;
  };
}

/**
 * Error boundary: render the default slot, but if it throws during render — or an effect
 * inside it throws later — swap to `fallback(err, reset)` instead of letting the error
 * propagate. `reset()` clears the error and re-renders the protected content. Routing is
 * owner-based (see `catchError`): the boundary owner's `_onError` catches any error raised
 * in its subtree; an error inside the fallback itself escapes to an outer boundary.
 *
 * Usage: `<ErrorBoundary fallback={(err, reset) => …}>…</ErrorBoundary>`.
 */
export const ErrorBoundary: Component = (props = {}, slots = {}) => {
  const fallback = (props as { fallback?: (err: unknown, reset: () => void) => Node }).fallback;
  const host = document.createElement('div');
  host.style.display = 'contents';
  const anchor = document.createComment('boundary');
  host.appendChild(anchor);

  const failure = signal<{ err: unknown } | null>(null);
  let failing = false;
  // Defer the swap to a microtask: the error often surfaces *inside* the children's
  // render/effect run, so flipping the signal synchronously would re-enter the same
  // ifBlock mid-render. The microtask lets the current pass unwind first. The `failing`
  // latch keeps the first error and ignores the cascade until reset.
  const fail = (err: unknown): void => {
    if (failing) return;
    failing = true;
    queueMicrotask(() => failure.set({ err }));
  };
  const reset = (): void => {
    failing = false;
    failure.set(null);
  };

  ifBlock(anchor, () => {
    const f = failure();
    if (f) {
      return () => (fallback ? fallback(f.err, reset) : document.createComment('error'));
    }
    return () => {
      // Route effect errors from this subtree here, and catch synchronous render errors.
      const owner = getOwner();
      if (owner) owner._onError = fail;
      try {
        return slots.default ? slots.default() : document.createComment('empty');
      } catch (err) {
        fail(err);
        return document.createComment('pending');
      }
    };
  });

  return host;
};

/* ──────────────────────────── mount ──────────────────────────── */

/** Mount a node into a container, replacing its contents. Returns an unmount fn. */
export function mount(node: Node, container: Element): () => void {
  container.textContent = '';
  const nodes = node instanceof DocumentFragment ? [...node.childNodes] : [node];
  container.append(node);
  return () => nodes.forEach((n) => (n as ChildNode).remove());
}
