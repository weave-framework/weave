/**
 * Driving Weave components in a test — the parts a consumer cannot reasonably write themselves.
 *
 * Everything here came out of measuring this library's own suite rather than imagining what a harness
 * should have. Across 61 browser-test files there are ~95 hand-rolled `createOwner` / `runInOwner`
 * pairs and 63 `compileTemplate` calls, each carrying a **hand-written list of the names its `setup`
 * returns**. That list is duplication of something the compiler already computes (`inferCtxNames`), and
 * it goes stale silently: adding a binding to a component makes its own tests fail with
 * `<name> is not defined` — a message about the harness, not about the component. It happened twice in
 * one day (a toolbar gaining `role`, an icon gaining `iconClass`).
 *
 * So `mount` derives the scope, and the mounted component is disposed with its owner.
 *
 * Deliberately NOT here: a query language, or assertions. Your test runner already has both, and a
 * second vocabulary to learn is a cost with nothing behind it.
 *
 * **This is a testing module.** It is a subpath of the library rather than a package of its own because
 * it needs the library's internals — the overlay container, the focus machinery — and a separate
 * package would force those into the public API, which is frozen. It is `sideEffects`-free and reaches
 * no production bundle; `pnpm verify:ui-testing` proves that rather than asserting it.
 */

import { compileTemplate, inferCtxNames, parseTemplate, type TemplateNode } from '@weave-framework/compiler';
import { createOwner, disposeOwner, effect, runInOwner, signal, tick, type Owner } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { overlayContainer } from '../cdk/overlay.js';

/**
 * What a function-mode template references as `rt`. The compiler emits calls against this object, so a
 * harness that hands it the wrong shape fails with a message about `rt`, not about the component.
 */
const RT: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };

export { tick };

/** A component as its module exports it: a template plus the `setup` that fills it. */
export interface ComponentModule {
  template: string;
  setup: (props: never, ...rest: never[]) => Record<string, unknown>;
}

/** A component as the build emits it — the default export. */
export type BuiltComponent = (props: never, slots?: Record<string, () => Node>) => Node;

/** A mounted component: its root element, and the teardown that disposes its owner. */
export interface Mounted<T extends Element = HTMLElement> {
  el: T;
  /** Dispose the owner and detach the element. Safe to call twice. */
  dispose: () => void;
}

type Slots = Record<string, () => Node>;

/**
 * Mount a component and return its root element.
 *
 * Takes either form: the built default export, or the `{ template, setup }` module the source has.
 * For the source form the ctx scope is DERIVED from the template — the same inference the real build
 * uses — so a component that grows a binding does not also need its tests edited.
 */
export function mount<T extends Element = HTMLElement>(
  component: BuiltComponent | ComponentModule,
  props: Record<string, unknown> = {},
  slots: Slots = {}
): Mounted<T> {
  const owner: Owner = createOwner();
  let disposed: boolean = false;

  const el: T = runInOwner(owner, () => {
    if (typeof component === 'function') return (component as (p: unknown, s?: Slots) => Node)(props, slots) as unknown as T;

    const nodes: TemplateNode[] = parseTemplate(component.template);
    const { code } = compileTemplate(component.template, { mode: 'function', scope: inferCtxNames(nodes) });
    const ctx: Record<string, unknown> = (component.setup as (p: unknown) => Record<string, unknown>)(props);
    const make: (c: unknown, rt: unknown, slots: unknown) => Node = new Function('ctx', 'rt', '_c', code) as never;
    return make(ctx, RT, slots) as unknown as T;
  }) as T;

  document.body.appendChild(el as unknown as Node);
  return {
    el,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      disposeOwner(owner);
      (el as unknown as ChildNode).remove();
    },
  };
}

/**
 * Press a key on an element — the shape every roving-tabindex component is tested through, and the one
 * consumers get subtly wrong (a `keydown` that does not bubble reaches no handler).
 */
export function press(el: Element, key: string, init: KeyboardEventInit = {}): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

/** Click an element the way a user would — bubbling, cancelable. */
export function click(el: Element, init: MouseEventInit = {}): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
}

/**
 * What a component rendered OUTSIDE itself: dialogs, menus, tooltips and the pickers all render into
 * the overlay container, so they are not under the element `mount` returned. This is the piece a
 * consumer cannot write without knowing where the library puts them.
 */
export function overlay(selector: string = '.weave-overlay'): HTMLElement | null {
  return overlayContainer().querySelector<HTMLElement>(selector);
}

/** Every currently open overlay, in the order they were opened. */
export function overlays(selector: string = '.weave-overlay'): HTMLElement[] {
  return [...overlayContainer().querySelectorAll<HTMLElement>(selector)];
}

/** The focused element — for asserting that focus was trapped, moved, or returned. */
export function focused(): Element | null {
  return document.activeElement;
}
