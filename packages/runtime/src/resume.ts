/**
 * `@weave-framework/runtime/resume` — resumable event dispatch (Phase E, E0.2a).
 *
 * The runtime side of **resumability**: server-rendered HTML carries a *handler reference* on each
 * interactive element (a stable id string) instead of a live listener, and the client wires **nothing**
 * until the first interaction. This module attaches ONE delegated listener per used event type to a
 * root, and — only when an event actually fires — resolves the referenced handler (which may be a
 * lazily-imported chunk) and invokes it. No component `setup` re-runs, no per-element listeners, no
 * handler code shipped until it is needed.
 *
 * This is the contract the compiler's `resumable` target (E0.2b) emits against, and a building block of
 * the full resume entry (E0.3). It is a separate subpath — 0 bytes for a plain client SPA (invariant I3).
 *
 * The wire convention: an element opts a handler in via an attribute `data-won-<event>="<ref>"` (e.g.
 * `data-won-click="c3#7"`). `<ref>` is opaque to this module — the caller's {@link ResumeOptions.resolve}
 * maps it to a function (sync, or a Promise for a lazy import).
 *
 *   import { resumeEvents, handlerAttr } from '@weave-framework/runtime/resume';
 *   const h = resumeEvents(document.body, { resolve: (ref) => import('./handlers.js').then(m => m[ref]) });
 */

/** A resumed event handler. Receives the DOM event + the element that carried the reference. */
export type ResumeHandler = (event: Event, element: Element) => void;

export interface ResumeOptions {
  /**
   * Map a handler reference (from the `data-won-*` attribute) to a handler — sync or lazy (Promise). `element`
   * is the node that carried the reference; a multi-component resume (E1.8) uses it to resolve the ref against
   * the handler table of the NEAREST enclosing component instance (site prefixes collide across components).
   */
  resolve: (ref: string, element: Element) => ResumeHandler | Promise<ResumeHandler> | undefined;
  /**
   * Also listen for these event types even if no element currently carries a `data-won-<type>` (useful
   * when nodes are added after resume). By default only the types found under `root` at call time are
   * delegated.
   */
  extraEvents?: string[];
}

/** A live resume registration. */
export interface ResumeControl {
  /** Remove all delegated listeners. */
  dispose: () => void;
}

const PREFIX = 'data-won-';

/** The attribute an element carries to reference a resumable handler for `event` (shared with the compiler). */
export function handlerAttr(event: string): string {
  return PREFIX + event;
}

/** Collect the distinct event types referenced by `data-won-<event>` attributes under `root` (inclusive). */
function discoverEventTypes(root: Element): Set<string> {
  const types = new Set<string>();
  const scan = (el: Element): void => {
    const attrs: NamedNodeMap = el.attributes;
    for (let i = 0; i < attrs.length; i++) {
      const name: string = attrs[i].name;
      if (name.startsWith(PREFIX)) types.add(name.slice(PREFIX.length));
    }
  };
  scan(root);
  const all: NodeListOf<Element> = root.querySelectorAll('*');
  for (let i = 0; i < all.length; i++) scan(all[i]);
  return types;
}

/**
 * Attach delegated, lazy handler dispatch to `root`. Walks from the event target up to `root`, finds the
 * nearest element carrying `data-won-<type>`, resolves the referenced handler, and invokes it. A handler
 * that resolves to a Promise is awaited before the invoke (the event is still passed through).
 */
export function resumeEvents(root: Element, options: ResumeOptions): ResumeControl {
  const types = discoverEventTypes(root);
  if (options.extraEvents) for (const t of options.extraEvents) types.add(t);

  const attrFor = (type: string): string => PREFIX + type;

  const dispatch = (type: string) => (event: Event): void => {
    const attr: string = attrFor(type);
    // Walk the composed path from target up to (and including) root, honouring bubbling order.
    let node: Element | null = event.target instanceof Element ? event.target : null;
    while (node) {
      if (node.hasAttribute(attr)) {
        const ref: string | null = node.getAttribute(attr);
        const el: Element = node;
        if (ref != null) {
          const resolved: ResumeHandler | Promise<ResumeHandler> | undefined = options.resolve(ref, el);
          if (resolved) {
            if (typeof (resolved as Promise<ResumeHandler>).then === 'function') {
              (resolved as Promise<ResumeHandler>).then((h) => h(event, el));
            } else {
              (resolved as ResumeHandler)(event, el);
            }
          }
        }
        return; // first match wins (nearest ancestor), like a directly-bound listener
      }
      if (node === root) break;
      node = node.parentElement;
    }
  };

  const listeners: Array<[string, (event: Event) => void]> = [];
  for (const type of types) {
    const fn = dispatch(type);
    root.addEventListener(type, fn);
    listeners.push([type, fn]);
  }

  return {
    dispose(): void {
      for (const [type, fn] of listeners) root.removeEventListener(type, fn);
      listeners.length = 0;
    },
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * E0.2b — resumable handler registration (the compiler's `resumable` target).
 *
 * In `resumable` mode the codegen emits `resumableHandler(node, event, siteRef, fn)` in place of an
 * eager `listen(...)`. Instead of attaching a live listener, it (a) stamps the element with
 * `data-won-<event>="<id>"` so a delegated {@link resumeEvents} can find it after load, and (b) records
 * `id → fn` in the active {@link collectResumable} session for the resume resolver to look up. This is
 * the seam the full resume entry (E0.3) and headless server render (E0.4) build on.
 * ──────────────────────────────────────────────────────────────────────────── */

/** A collecting session: generated instance-id → handler, plus a monotonic counter for uniqueness. */
interface HandlerSink {
  map: Map<string, ResumeHandler>;
  n: number;
}
let activeSink: HandlerSink | null = null;
let fallbackN: number = 0;

/**
 * Stamp a resumable handler reference onto `node` and register its handler.
 *
 * The id is INSTANCE-unique — `siteRef#<n>` where `<n>` is a per-session counter — so repeated rows of a
 * `@for` each get their own handler rather than a shared one. `siteRef` (assigned by the compiler per
 * event site) is the stable prefix a later chunk-splitter (E0.3) maps to an importable handler export.
 * Returns the generated id. Note: `once`/`capture`/`passive` listener options are not carried by the
 * delegated resume path yet — a resumable build ignores those modifiers (the guard modifiers
 * `preventDefault`/`stopPropagation`/`self` still apply, since they live in the handler body).
 */
export function resumableHandler(node: Element, event: string, siteRef: string, handler: ResumeHandler): string {
  // No session ⇒ a LIVE CLIENT render of a resumable build (E1.9): a CSR fallback, a route swap, a `@for` row
  // added after resume. Nothing to bridge to, so wire a real listener. The marker is deliberately NOT stamped
  // — it means "awaiting resume", and would make the delegated dispatch fire this handler a second time.
  if (!activeSink) {
    node.addEventListener(event, (e: Event) => handler(e, node));
    return `${siteRef}#live`;
  }
  const id: string = `${siteRef}#${activeSink.n++}`;
  node.setAttribute(PREFIX + event, id);
  activeSink.map.set(id, handler);
  return id;
}

/**
 * Run `render` while collecting every {@link resumableHandler} it triggers into a fresh registry, then
 * return the rendered node alongside that `id → handler` map. This is what a server render (or the E0.2b
 * test) uses to pair the emitted `data-won-*` markers with resolvable handlers. Nestable — restores the
 * previous session on exit. Only handlers registered DURING this call are captured; rows a `@for` adds
 * later (after the session closes) fall outside it (full dynamic-row resume is E0.3).
 */
export function collectResumable<T>(render: () => T): { node: T; handlers: Map<string, ResumeHandler> } {
  const prev: HandlerSink | null = activeSink;
  const sink: HandlerSink = { map: new Map<string, ResumeHandler>(), n: 0 };
  activeSink = sink;
  try {
    const node: T = render();
    return { node, handlers: sink.map };
  } finally {
    activeSink = prev;
  }
}
