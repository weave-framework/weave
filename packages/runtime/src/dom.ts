/**
 * @weave-framework/runtime/dom — the tiny runtime the compiler targets.
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

import { effect, signal, batch, untrack, createOwner, runInOwner, disposeOwner, onDispose, getOwner, onMount } from './reactive.js';
import type { Signal, Owner } from './reactive.js';

/* ──────────────────────────── structure ──────────────────────────── */

/** Parse an HTML string into a reusable, cached `<template>`. Parsed once. */
export function template(html: string): HTMLTemplateElement {
  const tpl: HTMLTemplateElement = document.createElement('template');
  tpl.innerHTML = html;
  return tpl;
}

/**
 * Parse an SVG fragment with the correct namespace. An SVG child element
 * (`<path>`, `<g>`, `<circle>`, …) parsed at the top level of a plain `<template>`
 * lands in the HTML namespace (an `HTMLUnknownElement` the browser never paints),
 * because there is no `<svg>` ancestor to switch the parser into foreign content.
 * The compiler emits this variant for any fragment rooted at an SVG element — an
 * `@if`/`@for`/`@key` body, a component/slot root — so those nodes are real SVG
 * elements. We parse inside a throw-away `<svg>` wrapper, then lift the children
 * into a fresh template (they keep their SVG namespace once created).
 */
export function templateSvg(html: string): HTMLTemplateElement {
  const wrap: HTMLTemplateElement = document.createElement('template');
  wrap.innerHTML = '<svg>' + html + '</svg>';
  const svg: Element = wrap.content.firstElementChild as Element;
  const tpl: HTMLTemplateElement = document.createElement('template');
  while (svg.firstChild) tpl.content.appendChild(svg.firstChild);
  return tpl;
}

/** Clone a template's single root node (the common single-root component case). */
export function clone(tpl: HTMLTemplateElement): Element {
  const root: Element | ChildNode | null = tpl.content.firstElementChild ?? tpl.content.firstChild;
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
  const c: Comment = document.createComment('');
  parent.insertBefore(c, before);
  return c;
}

/** Insert `node` into `parent` before `before` (or append). */
export function insert(parent: Node, node: Node, before: Node | null = null): void {
  parent.insertBefore(node, before);
}

/* ──────────────────────────── text ──────────────────────────── */

function textBefore(anchorNode: Comment): Text {
  const t: Text = document.createTextNode('');
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
  const t: Text = textBefore(anchorNode);
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

/**
 * Set one inline style property reactively (`style:color={c}`, `style:--accent={hex}`). A
 * `--custom` name sets a CSS custom property (great for theming — bind a token to a signal);
 * any other name sets a standard property. A `null`/`undefined`/`false` value removes it.
 */
export function bindStyleProp(el: Element, name: string, fn: () => unknown): void {
  const style: CSSStyleDeclaration = (el as HTMLElement).style;
  effect(() => {
    const v: unknown = fn();
    if (v == null || v === false) style.removeProperty(name);
    else style.setProperty(name, String(v));
  });
}

/**
 * `show={expr}` — toggle visibility via `display` (the element stays in the DOM,
 * unlike `@if` which removes it). Preserves the element's own inline `display`
 * when shown; sets `display: none` when hidden.
 */
export function bindShow(el: HTMLElement, fn: () => unknown): void {
  const original: string = el.style.display === 'none' ? '' : el.style.display;
  effect(() => {
    el.style.display = fn() ? original : 'none';
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

/* ──────────────────────────── use: actions ──────────────────────────── */

/**
 * An attribute directive (`use:action={arg}`). Runs `action(el, arg)` after the
 * element is inserted. Tear-down options: return a cleanup function, call
 * `onDispose` (owner-scoped), or create an `effect` (its `onCleanup`/disposal is
 * tied to the element's region). All fire when the region unmounts. For reactivity
 * over `arg`, pass a getter (`use:tip={() => x()}`) and read it inside an `effect`.
 */
/** A `use:` action's optional return: a teardown fn, or a Svelte-style `{ update, destroy }` handle. */
export interface ActionResult<A = void> {
  /** Called with the new argument whenever the (reactive) `use:action={arg}` argument changes. */
  update?: (arg: A) => void;
  /** Called when the element is removed (owner disposal). */
  destroy?: () => void;
}

/** A `use:` action: runs on mount, may return a teardown fn or an `{ update, destroy }` handle. */
export type Action<A = void> = (el: Element, arg: A) => void | (() => void) | ActionResult<A>;

/**
 * Wire a `use:` action onto an element. Deferred to `onMount` timing so the element is live
 * (focus / measure / 3rd-party init), and skipped if the region is disposed before the
 * microtask fires. The argument is passed as a getter, so a **reactive** action returns
 * `{ update, destroy }`: `update(arg)` re-runs when `use:action={arg}` changes, `destroy()`
 * on removal. A plain action may still just return a teardown fn (now wired to disposal).
 */
export function applyAction<A = void>(el: Element, action: Action<A>, argFn?: () => A): void {
  onMount(() => {
    const result: void | (() => void) | ActionResult<A> = action(el, argFn ? argFn() : (undefined as A));
    if (typeof result === 'function') {
      onDispose(result);
    } else if (result && typeof result === 'object') {
      if (result.update && argFn) {
        let first: boolean = true;
        effect(() => {
          const arg: A = argFn(); // track the reactive argument
          if (first) {
            first = false;
            return; // the initial arg was already applied by the action() call above
          }
          result.update!(arg);
        });
      }
      if (result.destroy) onDispose(result.destroy);
    }
  });
}

/* ──────────────────────────── transitions ──────────────────────────── */

/** What a transition function returns — the Svelte-style transition contract. */
export interface TransitionConfig {
  /** ms before the animation starts. */
  delay?: number;
  /** ms the animation runs (default 300). */
  duration?: number;
  /** ease the 0→1 progress before it drives `css`/`tick`. */
  easing?: (t: number) => number;
  /** per-frame CSS, `t` 0→1 (entering) or 1→0 (leaving), `u = 1 - t`. */
  css?: (t: number, u: number) => string;
  /** per-frame side effect (use sparingly — `css` is GPU-friendlier). */
  tick?: (t: number, u: number) => void;
}

/** A transition: given the node + params, returns how to animate it. */
export type TransitionFn<P = void> = (node: Element, params: P) => TransitionConfig;

/** The four transition lifecycle moments a consumer can hook with `on:<phase>`. */
export type TransitionPhase = 'enterstart' | 'enterend' | 'leavestart' | 'leaveend';

interface Outroable extends ChildNode {
  /** Registered by an `out:`/`transition:` directive; played before removal. */
  __wOut?: () => Promise<void>;
  /** Registered by `on:<phase>` — lifecycle callbacks fired around the animation. */
  __wLifecycle?: Partial<Record<TransitionPhase, () => void>>;
}

/**
 * `on:enterstart / enterend / leavestart / leaveend` — register a lifecycle callback for
 * the element's transition. Enter phases fire around the intro (mount) animation, leave
 * phases around the outro (removal) animation; `*start` fires as the animation begins,
 * `*end` when it finishes (or immediately, if the element has no transition of that mode).
 */
export function transitionEvent(el: Element, phase: TransitionPhase, handler: () => void): void {
  const n: Outroable = el as unknown as Outroable;
  (n.__wLifecycle ??= {})[phase] = handler;
}

function fireLifecycle(node: HTMLElement, phase: TransitionPhase): void {
  (node as unknown as Outroable).__wLifecycle?.[phase]?.();
}

/** Drive one transition with rAF; resolves when it finishes. */
function playTransition(node: HTMLElement, config: TransitionConfig, intro: boolean): Promise<void> {
  const { delay = 0, duration = 300, easing = (t) => t, css, tick } = config;
  const orig: string = node.style.cssText;
  const apply = (p: number): void => {
    const e: number = easing(p);
    const t: number = intro ? e : 1 - e;
    if (css) node.style.cssText = orig + ';' + css(t, 1 - t);
    if (tick) tick(t, 1 - t);
  };
  fireLifecycle(node, intro ? 'enterstart' : 'leavestart');
  apply(0); // set the start frame now (intro: hidden) — runs in a microtask, before paint
  return new Promise<void>((resolve) => {
    const done = (): void => {
      fireLifecycle(node, intro ? 'enterend' : 'leaveend');
      resolve();
    };
    const startAt: number = performance.now() + delay;
    const step = (now: number): void => {
      if (now < startAt) return void requestAnimationFrame(step);
      const p: number = duration <= 0 ? 1 : Math.min(1, (now - startAt) / duration);
      apply(p);
      if (p < 1) return void requestAnimationFrame(step);
      if (intro) node.style.cssText = orig; // entered — drop the inline overrides
      done();
    };
    requestAnimationFrame(step);
  });
}

/**
 * `transition:fn` / `in:fn` / `out:fn` — play an enter/leave animation. The intro
 * runs on mount; the outro is registered on the node so a control-flow block
 * (`@if`/`@for`/`@key`) plays it and **waits** for it before removing the node.
 * `params` is re-read through `fn` each time it plays.
 */
export function transition(
  node: HTMLElement,
  fn: TransitionFn<unknown>,
  params: unknown,
  mode: 'both' | 'in' | 'out'
): void {
  if (mode !== 'out') onMount(() => void playTransition(node, fn(node, params), true));
  if (mode !== 'in') (node as Outroable).__wOut = () => playTransition(node, fn(node, params), false);
}

/** Remove a node, first playing (and awaiting) its registered outro if it has one. */
export function removeWithOutro(node: ChildNode): void {
  const out: (() => Promise<void>) | undefined = (node as Outroable).__wOut;
  if (out) out().then(() => node.remove());
  else node.remove();
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
    const box: HTMLInputElement = el as HTMLInputElement;
    effect(() => {
      box.checked = !!sig();
    });
    el.addEventListener('change', () => sig.set(box.checked));
    return;
  }

  if (kind === 'group') {
    const radio: HTMLInputElement = el as HTMLInputElement;
    effect(() => {
      radio.checked = sig() === radio.value;
    });
    el.addEventListener('change', () => {
      if (radio.checked) sig.set(radio.value);
    });
    return;
  }

  // kind === 'value'
  const isSelect: boolean = el.tagName === 'SELECT';
  const multiple: boolean = isSelect && (el as HTMLSelectElement).multiple;
  const input: HTMLInputElement = el as HTMLInputElement;
  const numeric: boolean = !isSelect && (input.type === 'number' || input.type === 'range');
  let composing: boolean = false;

  const applyValue = (v: unknown): void => {
    if (composing) return; // don't fight the IME mid-composition
    if (multiple) {
      const set: Set<string> = new Set((Array.isArray(v) ? v : []).map(String));
      for (const opt of (el as HTMLSelectElement).options) opt.selected = set.has(opt.value);
    } else if (numeric) {
      // compare numerically so typing "1." (NaN mid-edit) doesn't get clobbered. Object.is, not
      // `!==`, so NaN === NaN holds (a bare `!==` is always true for NaN and would clobber).
      if (!Object.is(input.valueAsNumber, v)) input.value = v == null ? '' : String(v);
    } else {
      const s: string = v == null ? '' : String(v);
      if (input.value !== s) input.value = s;
    }
  };

  effect(() => {
    const v: unknown = sig();
    applyValue(v);
    // A <select>'s <option>s are usually inserted (static, `@for`, or async)
    // AFTER this binding runs — and the browser auto-selects the first option of a
    // freshly-populated select, overriding the bound value. Re-assert once the
    // current render settles so the signal still wins. (`sig()` here is read in a
    // microtask, outside the effect's tracking scope — no extra dependency.)
    if (isSelect) queueMicrotask(() => applyValue(sig()));
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

/**
 * One rendered row in a keyed list. `node` is the row's first node (the anchor the
 * reconciler positions it by). A single-element row is just `node`; a multi-node row
 * (a component / fragment / text body) is the live span from `node` to `end` inclusive,
 * bracketed by marker comments so the reconciler can move or remove it as one unit
 * even as its inner node count changes.
 */
export interface Row {
  key: unknown;
  node: ChildNode;
  /** last node of the row's span; absent ⇒ single-node row (`[node]`). */
  end?: ChildNode;
  /** torn down when the row is removed (disposes the row's effects) */
  dispose?: () => void;
}

/** A row's live nodes: just `node`, or the marker-bracketed span `[node … end]`. */
function rowSpan(row: Row): ChildNode[] {
  if (!row.end || row.end === row.node) return [row.node];
  const out: ChildNode[] = [];
  let n: ChildNode | null = row.node;
  while (n) {
    out.push(n);
    if (n === row.end) break;
    n = n.nextSibling;
  }
  return out;
}

/** Move a row's whole span before `before` (gathered first, since moving shifts siblings). */
function placeRow(parent: Node, row: Row, before: Node): void {
  if (!row.end || row.end === row.node) {
    parent.insertBefore(row.node, before);
    return;
  }
  for (const n of rowSpan(row)) parent.insertBefore(n, before);
}

/**
 * Longest-increasing-subsequence of `arr` (Vue's battle-tested `getSequence`).
 * `0` marks a brand-new item to skip. Returns the indices that may stay put.
 */
function getSequence(arr: number[]): number[] {
  const p: number[] = arr.slice();
  const result: number[] = [0];
  let i: number, j: number, u: number, v: number, c: number;
  const len: number = arr.length;
  for (i = 0; i < len; i++) {
    const arrI: number = arr[i];
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
  const prevByKey: Map<unknown, { row: Row; oldIndex: number }> = new Map<unknown, { row: Row; oldIndex: number }>();
  prev.forEach((row, i) => prevByKey.set(row.key, { row, oldIndex: i }));

  const next: Row[] = new Array(data.length);
  const newToOld: number[] = new Array(data.length).fill(0); // 0 ⇒ brand new
  const reused: Set<Row> = new Set<Row>();

  for (let i: number = 0; i < data.length; i++) {
    const key: unknown = keyOf(data[i], i);
    const hit: { row: Row; oldIndex: number } | undefined = prevByKey.get(key);
    if (hit && !reused.has(hit.row)) {
      reused.add(hit.row);
      hit.row.key = key;
      next[i] = hit.row;
      newToOld[i] = hit.oldIndex + 1;
    } else {
      const row: Row = create(data[i], i);
      row.key = key;
      next[i] = row;
    }
  }

  // Remove rows whose key vanished (playing a leave transition first, if any).
  for (const row of prev) {
    if (!reused.has(row)) {
      row.dispose?.();
      for (const n of rowSpan(row)) removeWithOutro(n);
    }
  }

  // Place nodes back-to-front; nodes in the LIS are already in order and stay put.
  const seq: number[] = getSequence(newToOld);
  let s: number = seq.length - 1;
  let anchorNode: Node = end;
  for (let i: number = data.length - 1; i >= 0; i--) {
    const row: Row = next[i];
    const isNew: boolean = newToOld[i] === 0;
    if (isNew || s < 0 || i !== seq[s]) {
      placeRow(parent, row, anchorNode); // new or moved (whole span)
    } else {
      s--; // stable: leave untouched (no DOM move → focus/scroll preserved)
    }
    anchorNode = row.node;
  }

  return next;
}

/* ──────────────────────────── control flow ──────────────────────────── */

const NONE: symbol = Symbol('none');

function placeBefore(parent: Node, node: Node, anchorNode: Node): ChildNode[] {
  const nodes: ChildNode[] =
    node instanceof DocumentFragment ? ([...node.childNodes] as ChildNode[]) : [node as ChildNode];
  for (const n of nodes) parent.insertBefore(n, anchorNode);
  return nodes;
}

/**
 * `@if` / `@else` / `@switch`. `selector` returns the chosen branch's render
 * function (a stable reference — same branch ⇒ no remount), or null. The branch
 * runs in its own ownership scope so its effects are disposed when it unmounts.
 */
export function ifBlock(anchor: Comment, selector: () => (() => Node | null) | null): void {
  // Capture the *construction-time* (lexical) owner. Branch owners parent to it so
  // context (`inject`) keeps working after a re-render driven by an external signal
  // (e.g. navigation), where the ambient owner at effect-re-run time is unrelated.
  const host: Owner | null = getOwner();
  let owner: Owner | null = null;
  let nodes: ChildNode[] = [];
  let prev: unknown = NONE;

  const clear = (): void => {
    if (owner) {
      disposeOwner(owner);
      owner = null;
    }
    nodes.forEach(removeWithOutro); // play a leave transition (if any) before removal
    nodes = [];
  };

  effect(() => {
    const next: (() => Node | null) | null = selector();
    if (next === prev) return; // same branch → leave the live DOM untouched
    prev = next;
    clear();
    if (next) {
      owner = runInOwner(host, () => createOwner(null));
      // Untrack branch construction — its bindings self-subscribe; a direct signal read during
      // render must not tie this if-block effect to it (the selector is the only real dep).
      const node: Node | null = runInOwner(owner, () => untrack(() => next()));
      // Read the parent at insert time, not construction: a `<Portal>` (or any
      // relocation) can move the anchor after this block is wired.
      nodes = node ? placeBefore(anchor.parentNode!, node, anchor) : [];
    }
  });
  onDispose(clear);
}

/**
 * `<w:element this={tag}>` — a dynamically-tagged element. Builds the element of
 * the current `tag`, wiring its attributes/children via `build`, and **re-creates**
 * it (disposing the old one's effects) whenever `tag` changes. Built on `ifBlock`,
 * deduping by tag string so an unrelated re-render doesn't needlessly rebuild.
 */
export function dynElement(
  anchor: Comment,
  tag: () => string,
  build: (el: HTMLElement) => void
): void {
  let lastTag: string | undefined;
  let thunk: (() => Node) | null = null;
  ifBlock(anchor, () => {
    const t: string = tag();
    if (t !== lastTag) {
      lastTag = t;
      thunk = t
        ? () => {
            // A dynamic tag is attacker-influenceable; a `<script>` created + inserted here would
            // execute. Refuse it loudly rather than build an executable element.
            if (t.toLowerCase() === 'script') {
              throw new Error(`Weave: <w:element> refuses to create a <script> element (it would execute).`);
            }
            const el: HTMLElement = document.createElement(t);
            build(el);
            return el;
          }
        : null;
    }
    return thunk;
  });
}

/**
 * `@key (expr) { … }` — tear down and re-create `content` whenever `key` changes
 * (fresh DOM + effects; replays mount-time work). Built on `ifBlock`: a new thunk
 * per distinct key forces a swap, while an unchanged key leaves the DOM untouched.
 */
export function keyBlock(anchor: Comment, key: () => unknown, content: () => Node | null): void {
  const NONE: symbol = Symbol();
  let last: unknown = NONE;
  let thunk: (() => Node | null) | null = null;
  ifBlock(anchor, () => {
    const k: unknown = key();
    if (k !== last) {
      last = k;
      thunk = () => content();
    }
    return thunk;
  });
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
  // Construction-time owner — row/empty owners parent to it (see ifBlock) so context
  // survives reconciles driven by an external signal.
  const host: Owner | null = getOwner();
  let rows: EachRow<T>[] = [];
  let emptyOwner: Owner | null = null;
  let emptyNodes: ChildNode[] = [];

  const clearEmpty = (): void => {
    if (emptyOwner) {
      disposeOwner(emptyOwner);
      emptyOwner = null;
    }
    emptyNodes.forEach(removeWithOutro); // honor an out: transition on @empty content
    emptyNodes = [];
  };
  // The whole-list removal path (data → empty, and block teardown). Plays each row's
  // leave transition first, just like reconcileKeyed's partial removal and ifBlock —
  // so emptying a `@for` animates out instead of snapping (a transition node with no
  // outro registered removes synchronously).
  const removeRows = (): void => {
    rows.forEach((r) => {
      disposeOwner(r.owner);
      for (const n of rowSpan(r)) removeWithOutro(n);
    });
    rows = [];
  };

  effect(() => {
    // Read the parent at run time, not construction: a `<Portal>` (or any relocation)
    // can move the anchor after this block is wired.
    const parent: Node = anchor.parentNode!;
    const data: readonly T[] = items() || [];

    if (data.length === 0) {
      removeRows();
      if (emptyRender && !emptyOwner) {
        emptyOwner = runInOwner(host, () => createOwner(null));
        const node: Node = runInOwner(emptyOwner, () => untrack(() => emptyRender())); //
        emptyNodes = placeBefore(parent, node, anchor);
      }
      return;
    }
    clearEmpty();

    rows = reconcileKeyed(parent, anchor, rows, data, keyOf, (item, i) => {
      const itemSig: Signal<T> = signal(item) as Signal<T>;
      const indexSig: Signal<number> = signal(i);
      const countSig: Signal<number> = signal(data.length);
      const ctx: ForContext<T> = {
        item: itemSig,
        index: indexSig,
        count: countSig,
        first: () => indexSig() === 0,
        last: () => indexSig() === countSig() - 1,
        even: () => indexSig() % 2 === 0,
        odd: () => indexSig() % 2 === 1,
      };
      const owner: Owner = runInOwner(host, () => createOwner(null));
      // Untrack the row construction: its own bindings create their own effects, so a signal read
      // synchronously during render must NOT subscribe this block effect (else an unrelated change
      // re-runs the whole @for reconcile).
      const rendered: Node = runInOwner(owner, () => untrack(() => renderRow(ctx)));
      // A single-element row is tracked by that one node (the hot path). A fragment
      // row (component / multiple roots / text) has no stable single node — and its
      // node count can vary at runtime (e.g. a top-level @if inside) — so bracket it
      // with marker comments and track the span between them.
      let node: ChildNode, end: ChildNode | undefined;
      if (rendered instanceof DocumentFragment) {
        const start: Comment = document.createComment('');
        const stop: Comment = document.createComment('');
        rendered.insertBefore(start, rendered.firstChild);
        rendered.appendChild(stop);
        node = start;
        end = stop;
      } else {
        node = rendered as ChildNode;
      }
      return {
        key: keyOf(item, i),
        node,
        end,
        dispose: () => disposeOwner(owner),
        owner,
        itemSig,
        indexSig,
        countSig,
      } as EachRow<T>;
    }) as EachRow<T>[];

    // Refresh item + positional signals for every row (reused rows included), so immutable
    // updates and reorders flow into the existing DOM. Batch so a row's three writes coalesce
    // into ONE flush instead of three per row (a binding reading >1 of them recomputes once).
    batch(() => {
      rows.forEach((r, i) => {
        r.itemSig.set(data[i] as T);
        r.indexSig.set(i);
        r.countSig.set(data.length);
      });
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
  const host: Owner | null = getOwner();
  let owner: Owner | null = null;
  let nodes: ChildNode[] = [];
  let fired: boolean = false;
  let disposed: boolean = false;
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
    const node: Node = runInOwner(owner, () => fn());
    // Read the parent at insert time, not construction: when `@defer` sits inside an
    // `@if`/`@for` branch, the anchor is still in a detached clone fragment when this
    // block is wired — and the post-trigger render runs long after the branch was
    // inserted, so the captured parent would be stale (same fix as ifBlock/eachBlock).
    nodes = node ? placeBefore(anchor.parentNode!, node, anchor) : [];
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
  const g: typeof globalThis & {
    requestIdleCallback?: (cb: () => void) => number;
    cancelIdleCallback?: (id: number) => void;
  } = globalThis as typeof globalThis & {
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
        const id: number = g.requestIdleCallback(fire);
        return () => g.cancelIdleCallback?.(id);
      }
      const t: ReturnType<typeof setTimeout> = setTimeout(fire, 1);
      return () => clearTimeout(t);
    }
    case 'timer': {
      const t: ReturnType<typeof setTimeout> = setTimeout(fire, (trigger as { ms: number }).ms);
      return () => clearTimeout(t);
    }
    case 'viewport': {
      const el: Element | null = target();
      if (!el || typeof IntersectionObserver === 'undefined') return void fire();
      const io: IntersectionObserver = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) fire();
      });
      io.observe(el);
      return () => io.disconnect();
    }
    case 'interaction':
    case 'hover': {
      const el: Element | null = target();
      if (!el) return void fire();
      const events: string[] =
        trigger.on === 'hover' ? ['pointerenter', 'focusin'] : ['click', 'keydown'];
      const handler = (): void => fire();
      for (const ev of events) el.addEventListener(ev, handler);
      return () => {
        for (const ev of events) el.removeEventListener(ev, handler);
      };
    }
  }
}

/* ──────────────────────────── await ──────────────────────────── */

/** Minimal shape of a `@weave-framework/data` resource that `awaitBlock` can drive directly. */
interface ResourceLike {
  loading: () => boolean;
  error: () => unknown;
  data: () => unknown;
}
function isResource(x: unknown): x is ResourceLike {
  return (
    !!x &&
    typeof x === 'object' &&
    typeof (x as ResourceLike).loading === 'function' &&
    typeof (x as ResourceLike).data === 'function' &&
    typeof (x as ResourceLike).error === 'function'
  );
}

/**
 * `@await` — render by the settle state of the `source`, which may be a
 * `@weave-framework/data` **resource** (driven off its `loading`/`error`/`data` signals — a
 * refetch shows `pending` again) or a bare **Promise** (or plain value). The three branch
 * fns are optional; `then`/`catch` receive the resolved value / error. Built on
 * {@link ifBlock}, so each branch renders in its own owner scope (disposed on swap/unmount).
 *
 * The `source` is read **reactively**: `source()` is tracked, so when its dependencies change
 * (e.g. `@await fetchUser(id())` as `id` changes) the block re-enters `pending` and settles
 * the new Promise. A stale Promise resolving after the source moved on is ignored (token
 * guard). A stable source with no dependencies simply reads once, as before.
 */
export function awaitBlock(
  anchor: Comment,
  source: () => unknown,
  pending?: () => Node,
  then?: (value: unknown) => Node,
  onCatch?: (err: unknown) => Node
): void {
  const pendingThunk: (() => Node) | null = pending ? () => pending() : null;
  const state: Signal<'pending' | 'then' | 'catch'> = signal<'pending' | 'then' | 'catch'>('pending');
  const value: Signal<unknown> = signal<unknown>(undefined);
  const failure: Signal<unknown> = signal<unknown>(undefined);
  const thenThunk: (() => Node) | null = then ? () => then(value()) : null;
  const catchThunk: (() => Node) | null = onCatch ? () => onCatch(failure()) : null;

  let token: number = 0; // bumped each time the source changes; guards stale settles
  effect(() => {
    const src: unknown = source(); // TRACKED — re-runs when the source's deps change
    const my: number = ++token;

    if (isResource(src)) {
      // Subscribe to the resource's own signals (loading is always read → always a dep).
      if (src.loading()) return void state.set('pending');
      const err: unknown = src.error();
      if (err != null) {
        batch(() => { failure.set(err); state.set('catch'); });
        return;
      }
      batch(() => { value.set(src.data()); state.set('then'); });
      return;
    }

    // A Promise (or plain value): re-enter pending, settle once, ignore if superseded.
    state.set('pending');
    Promise.resolve(src).then(
      (v) => { if (my === token) batch(() => { value.set(v); state.set('then'); }); },
      (e) => { if (my === token) batch(() => { failure.set(e); state.set('catch'); }); }
    );
  });

  ifBlock(anchor, () => {
    const s: 'pending' | 'then' | 'catch' = state();
    return s === 'pending' ? pendingThunk : s === 'catch' ? catchThunk : thenThunk;
  });
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
    const owner: Owner = createOwner(); // _parent = surrounding owner (context chain)
    onDispose(() => disposeOwner(owner)); // surrounding scope disposes this instance
    // Untrack the whole instance construction: a component's reactivity comes from its own internal
    // effects, so setup()/render() reading a signal must not subscribe an enclosing block/effect
    // (which would re-instantiate the component on any unrelated change).
    return runInOwner(owner, () =>
      untrack(() => {
        const bindings: Record<string, unknown> = setup ? setup(props) || {} : {};
      // Define bindings as OWN properties over `props` (on the prototype). Uses
      // descriptors, not assignment: `Object.assign` does a `[[Set]]`, which honours
      // a getter-only prop of the same name on the prototype and throws — so a binding
      // that shadows a like-named prop (the documented case) must be *defined*, not set.
      const ctx: Record<string, unknown> = Object.defineProperties(
        Object.create(props),
        Object.getOwnPropertyDescriptors(bindings)
      );
      const node: Node = render(ctx, slots);
      // Auto-forward component-level `on:X` handlers to the rendered root element. A
      // `<Button on:click={{…}}>` compiles the handler to an `onClick` prop AND records
      // `on:click` in the hidden `$events` marker; attach only those to the root so the
      // consumer's listener fires — a component never has to re-declare events just to be
      // composable. Only `$events` keys are forwarded: a data-callback prop (`onChange`,
      // `onInput`) consumed *inside* the child must NOT also be attached as a DOM listener,
      // or it fires twice (once by the child, once by the bubbled DOM event). Skips a key
      // the component already consumed (a setup binding of the same name shadows it: the
      // component wires that event itself).
      if (node instanceof Element) {
        const events: unknown = props['$events'];
        if (Array.isArray(events)) {
          for (const key of events as string[]) {
            if (!(key in bindings) && typeof props[key] === 'function') {
              node.addEventListener(key.slice(2).toLowerCase(), props[key] as EventListener);
            }
          }
        }
      }
        return node;
      }),
    );
  };
}

/**
 * Mount a root component into a container under a fresh owner. The container is an
 * `Element` or a CSS selector string (`'#app'`, `'.root'`, …) resolved via
 * `querySelector` — a non-matching selector throws. Returns an unmount fn.
 */
export function mountComponent(
  component: Component,
  container: Element | string,
  props?: Record<string, unknown>
): () => void {
  const owner: Owner = createOwner(null);
  // Name the scope after the component so devtools' inspectTree() shows a component tree.
  owner.name = (component as { displayName?: string }).displayName || component.name || 'Component';
  const node: Node = runInOwner(owner, () => component(props, {}));
  const unmount: () => void = mount(node, container);
  return () => {
    disposeOwner(owner);
    unmount();
  };
}

/** Options for {@link defineCustomElement}. */
export interface CustomElementOptions {
  /**
   * Prop names exposed as observed attributes (kebab-cased) **and** JS properties.
   * An attribute change or a property set updates the matching reactive prop.
   */
  props?: string[];
}

const kebab = (p: string): string => p.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
const camel = (a: string): string => a.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());

/**
 * Register a Weave {@link Component} as a native custom element (Web Component) for
 * interop — use `<my-widget label="hi">` from plain HTML or any framework. Renders
 * into the element's **light DOM** (no shadow root), so the component's scoped CSS
 * (collected into the app stylesheet) applies normally. Each declared prop becomes
 * an observed attribute (kebab-cased) and a JS property; both feed a reactive signal,
 * so the mounted component re-renders on change. Mounts on connect, disposes on
 * disconnect. Re-defining the same tag is a no-op.
 */
export function defineCustomElement(
  tag: string,
  component: Component,
  options: CustomElementOptions = {}
): void {
  const propNames: string[] = options.props ?? [];

  class WeaveElement extends HTMLElement {
    static observedAttributes: string[] = propNames.map(kebab);
    private _sigs: Record<string, Signal<unknown>> = {};
    private _dispose?: () => void;

    constructor() {
      super();
      for (const p of propNames) {
        const sig: Signal<unknown> = signal<unknown>(undefined);
        this._sigs[p] = sig;
        // a JS property so `el.label = 'x'` works (and stays reactive)
        Object.defineProperty(this, p, {
          get: () => sig(),
          set: (v: unknown) => sig.set(() => v),
          configurable: true,
          enumerable: true,
        });
      }
    }

    connectedCallback(): void {
      if (this._dispose) return; // already mounted (re-connect without disconnect)
      // seed from any attributes present at mount time
      for (const p of propNames) {
        const a: string | null = this.getAttribute(kebab(p));
        if (a !== null) this._sigs[p].set(() => a);
      }
      const props: Record<string, unknown> = {};
      for (const p of propNames) {
        Object.defineProperty(props, p, { get: () => this._sigs[p](), enumerable: true });
      }
      this._dispose = mountComponent(component, this, props);
    }

    attributeChangedCallback(name: string, _old: string | null, val: string | null): void {
      const p: string = camel(name);
      this._sigs[p]?.set(() => val);
    }

    disconnectedCallback(): void {
      this._dispose?.();
      this._dispose = undefined;
    }
  }

  if (!customElements.get(tag)) customElements.define(tag, WeaveElement);
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
  let started: boolean = false;
  const state: Signal<'loading' | 'ready' | 'error'> = signal<'loading' | 'ready' | 'error'>('loading');

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

  const Lazy: Component & { preload: () => void } = ((props = {}, slots = {}) => {
    start();
    const host: HTMLDivElement = document.createElement('div');
    host.style.display = 'contents';
    const anchor: Comment = document.createComment('lazy');
    host.appendChild(anchor);
    ifBlock(anchor, () => {
      const s: 'loading' | 'ready' | 'error' = state();
      if (s === 'ready') {
        const comp: Component = resolved!;
        return () => comp(props, slots);
      }
      if (s === 'error') return opts.error ? () => opts.error!(failed) : null;
      return opts.loading ? () => opts.loading!(props, slots) : null;
    });
    return host;
  }) as unknown as Component & { preload: () => void };
  // Warm the import ahead of render (router Link prefetch) — runs the loader once.
  Lazy.preload = start;
  return Lazy;
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
  const fallback: ((err: unknown, reset: () => void) => Node) | undefined = (props as { fallback?: (err: unknown, reset: () => void) => Node }).fallback;
  const host: HTMLDivElement = document.createElement('div');
  host.style.display = 'contents';
  const anchor: Comment = document.createComment('boundary');
  host.appendChild(anchor);

  const failure: Signal<{ err: unknown } | null> = signal<{ err: unknown } | null>(null);
  let failing: boolean = false;
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

  // Optional `resetKey`: a reactive value that clears the error when it changes
  // (the React `resetKeys` pattern) — e.g. `resetKey={path()}` to recover on
  // navigation without remounting the protected content. The initial run is skipped.
  const resetKey: unknown = (props as { resetKey?: unknown }).resetKey;
  if (resetKey !== undefined) {
    let first: boolean = true;
    effect(() => {
      (props as { resetKey?: unknown }).resetKey; // track the (reactive) prop getter
      if (first) {
        first = false;
        return;
      }
      reset();
    });
  }

  ifBlock(anchor, () => {
    const f: { err: unknown } | null = failure();
    if (f) {
      return () => (fallback ? fallback(f.err, reset) : document.createComment('error'));
    }
    return () => {
      // Route effect errors from this subtree here, and catch synchronous render errors.
      const owner: Owner | null = getOwner();
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

/**
 * Portal / Teleport: render the default slot into a *different* DOM location while
 * staying in the logical component tree (so owner-scoped effects, context, and
 * disposal all behave as if the content lived here). The canonical use is modals,
 * tooltips, and toasts that must escape an `overflow:hidden`/`z-index` ancestor.
 *
 * `to` is a CSS selector (`to="body"`) or an `Element` (`to={node}`); it defaults
 * to `document.body` and is resolved **once** at mount. The content is created in
 * the current owner, appended to the target, and removed on unmount via
 * `onDispose`. A comment placeholder is returned so the component still occupies
 * its logical slot (and the surrounding region's DOM cleanup is well-defined).
 *
 * Usage: `<Portal to="body"><div class="modal">…</div></Portal>`.
 */
export const Portal: Component = (props = {}, slots = {}) => {
  const to: string | Element | undefined = (props as { to?: string | Element }).to;
  const target: Element =
    (typeof to === 'string' ? document.querySelector(to) : to) ?? document.body;

  const placeholder: Comment = document.createComment('portal');
  const content: Node | null = slots.default ? slots.default() : null;
  if (content) {
    // A fragment empties on insert, so capture the real child nodes first for removal.
    const nodes: Node[] = content instanceof DocumentFragment ? [...content.childNodes] : [content];
    target.appendChild(content);
    onDispose(() => nodes.forEach((n) => (n as ChildNode).remove()));
  }
  return placeholder;
};

/**
 * `<Teleport>` — the familiar name (Vue) for {@link Portal}. Identical behaviour: render the
 * default slot into a different DOM location (`to` selector/element) while staying in the
 * logical component tree. Provided as an alias so either name works; there is one implementation.
 */
export const Teleport: Component = Portal;

/**
 * `<Dynamic is={{ comp }}>` — render a component chosen at runtime, swapping reactively when
 * `is` changes. `is` is the component **value**; because a bound `is={{ current() }}` compiles
 * to a reactive getter, reading it here tracks the source, so the swap is automatic. Every
 * other prop and all slots are forwarded to the rendered component (getters preserved, so
 * forwarded props stay reactive). A non-function `is` renders nothing.
 *
 * Usage: `<Dynamic is={{ tab() === 'a' ? PanelA : PanelB }} title={{ t }}>…</Dynamic>`.
 */
export const Dynamic: Component = (props = {}, slots = {}) => {
  const host: HTMLElement = document.createElement('div');
  host.style.display = 'contents';
  const anchor: Comment = document.createComment('dynamic');
  host.appendChild(anchor);

  // Forward every prop except `is`, preserving property descriptors so getters stay reactive.
  const childProps: Record<string, unknown> = {};
  for (const key in props) {
    if (key === 'is') continue;
    const desc: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(props, key);
    if (desc) Object.defineProperty(childProps, key, desc);
  }

  const thunks: Map<Component, () => Node> = new Map<Component, () => Node>();
  ifBlock(anchor, () => {
    const comp: unknown = (props as { is?: unknown }).is; // reading the getter tracks `is`
    if (typeof comp !== 'function') return null;
    const view: Component = comp as Component;
    let thunk: (() => Node) | undefined = thunks.get(view);
    if (!thunk) {
      thunk = () => view(childProps, slots);
      thunks.set(view, thunk);
    }
    return thunk;
  });
  return host;
};

/**
 * `<KeepAlive is={{ comp }}>` — like {@link Dynamic}, but instead of destroying a component
 * when you swap away, it **detaches and caches** the instance (its DOM *and* live state), then
 * re-attaches the SAME instance when you swap back. The canonical use is tabs/wizard steps
 * whose scroll position, form input, or in-flight state should survive being hidden.
 *
 * Unlike Dynamic (which disposes the outgoing branch), a cached instance stays live while
 * detached — its effects keep running — so its state is exactly preserved. All cached
 * instances are disposed together when the `<KeepAlive>` itself unmounts. Extra props/slots
 * are forwarded (and read once per instance, at first creation).
 */
export const KeepAlive: Component = (props = {}, slots = {}) => {
  const host: HTMLElement = document.createElement('div');
  host.style.display = 'contents';
  const anchor: Comment = document.createComment('keep-alive');
  host.appendChild(anchor);

  const childProps: Record<string, unknown> = {};
  for (const key in props) {
    if (key === 'is') continue;
    const desc: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(props, key);
    if (desc) Object.defineProperty(childProps, key, desc);
  }

  // Each seen component keeps its own persistent owner + captured nodes, cached across swaps.
  const cache: Map<Component, { nodes: ChildNode[]; owner: Owner }> = new Map<
    Component,
    { nodes: ChildNode[]; owner: Owner }
  >();
  let active: ChildNode[] = [];
  const lexical: Owner | null = getOwner();

  effect(() => {
    const comp: unknown = (props as { is?: unknown }).is; // reading the getter tracks `is`
    // Detach the current instance WITHOUT disposing it — its state is kept in the cache.
    for (const n of active) n.remove();
    active = [];
    if (typeof comp !== 'function') return;
    const view: Component = comp as Component;

    let entry: { nodes: ChildNode[]; owner: Owner } | undefined = cache.get(view);
    if (!entry) {
      // Build in a persistent owner parented to the lexical scope (so it survives swaps but is
      // still torn down when KeepAlive unmounts). Untrack construction — only `is` is our dep.
      const owner: Owner = runInOwner(lexical, () => createOwner(null));
      let node: Node = anchor;
      runInOwner(owner, () => untrack(() => { node = view(childProps, slots); }));
      const nodes: ChildNode[] =
        node instanceof DocumentFragment ? ([...node.childNodes] as ChildNode[]) : [node as ChildNode];
      entry = { nodes, owner };
      cache.set(view, entry);
    }
    const parent: Node = anchor.parentNode!;
    for (const n of entry.nodes) parent.insertBefore(n, anchor);
    active = entry.nodes;
  });

  onDispose(() => {
    for (const e of cache.values()) disposeOwner(e.owner);
    cache.clear();
  });
  return host;
};

/* ──────────────────────────── mount ──────────────────────────── */

/**
 * Resolve a mount target: an `Element`, or a CSS selector string resolved via
 * `document.querySelector` (`'#app'`, `'.root'`, `'main'`, `'[data-app]'`, …).
 * Throws a clear error when a selector matches nothing — no silent no-op.
 */
function resolveContainer(target: Element | string): Element {
  if (typeof target !== 'string') return target;
  const el: Element | null = document.querySelector(target);
  if (!el) throw new Error(`weave: mount target "${target}" matched no element`);
  return el;
}

/** Mount a node into a container (an `Element` or CSS selector), replacing its contents. Returns an unmount fn. */
export function mount(node: Node, target: Element | string): () => void {
  const container: Element = resolveContainer(target);
  container.textContent = '';
  const nodes: Node[] = node instanceof DocumentFragment ? [...node.childNodes] : [node];
  container.append(node);
  return () => nodes.forEach((n) => (n as ChildNode).remove());
}
