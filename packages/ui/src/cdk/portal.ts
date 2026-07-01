/**
 * Portal — imperatively render a node into a container elsewhere in the DOM (by
 * default `<body>`), with owner-scoped teardown. This is the basis of the overlay
 * engine: dropdowns, dialogs, and tooltips render at the top of the document so
 * they escape `overflow`/`z-index`/`transform` traps, yet stay tied to the logic
 * that created them.
 *
 * Unlike the runtime's `mount` (which *replaces* a container's contents), a portal
 * **appends** and removes only its own nodes — the container's other children are
 * untouched. Zero-dep; append/remove + a reactive `attached` signal.
 */

import { signal, onDispose, type Signal } from '@weave-framework/runtime';

export interface PortalOptions {
  /** Target container — an `Element` or a CSS selector. Defaults to `document.body`. */
  container?: Element | string;
}

export interface PortalHandle {
  /** The container the content was attached into. */
  readonly container: Element;
  /** Whether the portal is currently attached. Reactive — read it to subscribe. */
  attached(): boolean;
  /** Remove the portalled content and mark detached. Idempotent. */
  detach(): void;
}

function resolveContainer(target: Element | string): Element {
  if (typeof target !== 'string') return target;
  if (typeof document === 'undefined') {
    throw new Error('weave cdk portal: no document (portals are browser-only)');
  }
  const el: Element | null = document.querySelector(target);
  if (!el) throw new Error(`weave cdk portal: container "${target}" matched no element`);
  return el;
}

/**
 * Attach `content` (a `Node` or a factory returning one) into `options.container`
 * (default `<body>`). Returns a {@link PortalHandle}. If called inside an owner
 * scope (a component `setup`, an effect), the portal auto-detaches when that scope
 * disposes, so overlays never leak.
 */
export function portal(content: Node | (() => Node), options: PortalOptions = {}): PortalHandle {
  const container: Element = resolveContainer(
    options.container ?? (typeof document !== 'undefined' ? document.body : (undefined as unknown as Element)),
  );
  const node: Node = typeof content === 'function' ? content() : content;
  // A fragment empties into the container on append — capture its children first so
  // detach() can remove exactly what we added.
  const nodes: ChildNode[] =
    node instanceof DocumentFragment ? [...(node.childNodes as NodeListOf<ChildNode>)] : [node as ChildNode];
  container.append(node);

  const _attached: Signal<boolean> = signal<boolean>(true);
  let done: boolean = false;

  const detach = (): void => {
    if (done) return;
    done = true;
    for (const n of nodes) n.remove();
    _attached.set(false);
  };

  // Owner-scoped safety net: tear down with the surrounding scope (no-op outside one).
  onDispose(detach);

  return {
    container,
    attached: () => _attached(),
    detach,
  };
}
