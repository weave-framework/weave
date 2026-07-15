/**
 * `@weave-framework/runtime/graph` — the Phase E (E0.3) resume entry.
 *
 * The client-side counterpart to a server render: rebuild a component's reactive state from a serialized
 * snapshot and wire its event handlers LAZILY, WITHOUT re-running `setup` (RFC 0009 §3). This is what makes
 * Weave *resumable* rather than *hydrated* — the server already ran the app logic and rendered the DOM; the
 * client adopts that DOM, deserializes the signal graph (E0.1), and only resolves + invokes a handler when
 * the user actually interacts (the delegated dispatch of E0.2a). `setup` is never called on the client — a
 * conformance test spies on it and asserts zero calls.
 *
 * Its own entry (own size budget); 0 bytes for a plain client SPA (invariant I3). Importing this module
 * registers a `signal` (de)serializer, so a reactive-state record round-trips through `serialize`/`deserialize`.
 *
 *   // server / build:
 *   const wire = snapshot({ count });
 *   // client:
 *   const { ctx } = resume(root, { snapshot: wire, handlers: (c) => ({ w0: () => c.count.set((n) => n + 1) }) });
 *
 * Scope: the graph rebuild + lazy-handler contract (E0.3) plus DOM-binding *adoption* (E1.2b-2) — pass the
 * compiled render's `adopt` fn as `options.adopt` and resume re-attaches its reactive bindings to the server
 * DOM in place (no re-render, no `setup`). Adopt is emitted for flat single-root components today; blocks
 * (`@if`/`@for`/components) need the marker cursor walk (E1.2c) and fall back to CSR. Per-instance captured
 * closure state (each `@for` row's own handler data) needs serialized lexical scope — a later slice; a
 * component-level handler that closes over `ctx` resumes today.
 */
import { signal, root as reactiveRoot, type Signal } from './reactive.js';
import { serialize, deserialize, registerSerializableType, type Wire } from './serialize.js';
import { resumeEvents, type ResumeHandler, type ResumeControl } from './resume.js';

/** Duck-typed signal check — a callable carrying the writable-signal surface (avoids branding the hot core). */
function isSignal(v: unknown): v is Signal<unknown> {
  return (
    typeof v === 'function' &&
    typeof (v as { set?: unknown }).set === 'function' &&
    typeof (v as { peek?: unknown }).peek === 'function' &&
    typeof (v as { update?: unknown }).update === 'function'
  );
}

// A signal crosses the wire as its current value and is rebuilt as a fresh LIVE signal on the other side.
// Registered once, on import — so both `snapshot` (server) and `resume` (client) see it in the global registry.
registerSerializableType({
  tag: 'signal',
  test: isSignal,
  encode: (s) => (s as Signal<unknown>).peek(), // untracked read — the value, recursively encoded
  decode: (v) => signal(v),
});

/** Server/build: serialize a record of reactive state (signals + plain values) for the client to resume. */
export function snapshot(state: Record<string, unknown>): Wire {
  return serialize(state);
}

/**
 * The key under which the ROOT component's ctx lives in a multi-instance snapshot map (E1.2c-6). Static-position
 * child component instances live under their compiler-assigned ids (`c0`, `c1`, …); a `$` prefix can't collide
 * with those, so the map stays a flat `{ [$root]: rootCtx, c0: …, c1: … }` that `serialize` dedups by reference.
 */
export const ROOT_ID: string = '$root';

/**
 * Per-instance state collection (E1.2c-6). A resumable SERVER render collects each component instance's ctx —
 * so the client can resume it WITHOUT re-running `setup`. `collectStates(fn)` runs a render with a session
 * active and returns the `{ id → ctx }` map every {@link registerState} call filled; the caller adds the root
 * under {@link ROOT_ID} and {@link snapshot}s the whole map (one blob — a signal shared across components
 * serializes once, by structural sharing). Nestable/reentrant-safe; a no-op outside a session.
 */
let collector: Record<string, unknown> | null = null;

export function collectStates(fn: () => void): Record<string, unknown> {
  const prev: Record<string, unknown> | null = collector;
  const states: Record<string, unknown> = {};
  collector = states;
  try {
    fn();
    return states;
  } finally {
    collector = prev;
  }
}

/** Register a resumable component instance's ctx under its compile-time id. No-op outside {@link collectStates}. */
export function registerState(id: string, ctx: unknown): void {
  if (collector) collector[id] = ctx;
}

/**
 * A factory binding handler site-refs to handlers over the RESUMED ctx. In the full pipeline the compiler
 * emits this (extracted from the resumable render); E0.3 hand-authors it, which is what pins the contract.
 */
export type HandlerFactory = (ctx: Record<string, unknown>) => Record<string, ResumeHandler>;

/**
 * The compiled render's ADOPT variant (E1.2b-2): re-attach the render's reactive DOM bindings to the
 * server-rendered `root` IN PLACE against the resumed `ctx` — no `clone`, no re-render, no `setup`. The
 * compiler emits it as `render.adopt` for a flat single-root resumable component; absent for others.
 */
export type AdoptFn = (root: Element, ctx: Record<string, unknown>, slots?: Record<string, unknown>) => unknown;

export interface ResumeOptions {
  /** The serialized reactive state from the server ({@link snapshot}). */
  snapshot: Wire;
  /** Map handler site-refs → handlers over the resumed ctx. Optional — a render with no resumable events (e.g.
   *  an adopt-only fragment) emits no `handlers` factory; resume then just re-attaches DOM bindings. */
  handlers?: HandlerFactory;
  /** Extra delegated event types to arm even if absent at scan time (see `resumeEvents`). */
  extraEvents?: string[];
  /**
   * The compiled render's adopt variant (typically `render.adopt`). When present, resume re-attaches the
   * render's reactive DOM bindings to the existing server DOM in place (E1.2b-2) so signal updates flow
   * without a client re-render. When absent, only events resume (the DOM is whatever the server produced).
   */
  adopt?: AdoptFn;
}

export interface ResumeApp {
  /** The rebuilt reactive state (live signals) — produced by deserialize, NOT by re-running setup. */
  ctx: Record<string, unknown>;
  /** Tear down the delegated resume listeners. */
  dispose: () => void;
}

/** The compile-site prefix of an instance id (`"w0#3"` → `"w0"`); a bare ref is returned unchanged. */
function siteOf(id: string): string {
  const hash: number = id.indexOf('#');
  return hash === -1 ? id : id.slice(0, hash);
}

/** The id of the `<script type="application/weave">` a server render embeds the state snapshot into. */
export const SNAPSHOT_ID: string = '__weave_snapshot__';

export interface ResumePageOptions {
  /** The server-rendered root to resume (its subtree carries the `data-won-*` markers). */
  root: Element;
  /** Map handler site-refs → handlers over the resumed ctx (typically a compiled module's `render.handlers`).
   *  Optional — absent when the render has no resumable events (see {@link ResumeOptions.handlers}). */
  handlers?: HandlerFactory;
  /** Extra delegated event types (see `resumeEvents`). */
  extraEvents?: string[];
  /** The compiled render's adopt variant (typically `render.adopt`) — re-attaches reactive DOM in place (E1.2b-2). */
  adopt?: AdoptFn;
  /** Where to read the snapshot `<script>` from (default: the global `document`). */
  document?: Document;
}

/**
 * Client entry for an SSG/SSR page (E1.2): read the embedded state snapshot (the `SNAPSHOT_ID` script that
 * `renderPage` emitted) and {@link resume} `root` against it — lazy handlers, no `setup`. Throws loudly if
 * the snapshot script is missing. Returns the {@link ResumeApp}.
 */
export function resumePage(options: ResumePageOptions): ResumeApp {
  const doc: Document = options.document ?? (globalThis as { document?: Document }).document!;
  const el: HTMLElement | null = doc.getElementById(SNAPSHOT_ID);
  if (!el) throw new Error(`resumePage: no snapshot <script id="${SNAPSHOT_ID}"> found in the document.`);
  const wire: Wire = JSON.parse(el.textContent || 'null') as Wire;
  return resume(options.root, {
    snapshot: wire,
    handlers: options.handlers,
    extraEvents: options.extraEvents,
    adopt: options.adopt,
  });
}

/**
 * Resume a server-rendered subtree: rebuild its reactive graph from `snapshot` and wire its handlers
 * lazily against the existing DOM — WITHOUT calling `setup`. Returns the rebuilt `ctx` (live signals) and a
 * dispose handle. The first interaction with a `data-won-*` element resolves its handler (from
 * `handlers(ctx)`, by exact id then by site prefix) and invokes it against the resumed graph.
 */
export function resume(root: Element, options: ResumeOptions): ResumeApp {
  const ctx: Record<string, unknown> = deserialize(options.snapshot) as Record<string, unknown>;
  // Adopt the server DOM's reactive bindings in place FIRST (E1.2b-2), inside a reactive root so the
  // re-attached effects are owned + disposable — no re-render, `setup` never runs. Then arm delegated events.
  let disposeAdopt: () => void = () => {};
  if (options.adopt) reactiveRoot((dispose) => {
    options.adopt!(root, ctx, {});
    disposeAdopt = dispose;
  });
  const table: Record<string, ResumeHandler> = options.handlers ? options.handlers(ctx) : {};
  const ctl: ResumeControl = resumeEvents(root, {
    resolve: (id) => table[id] ?? table[siteOf(id)],
    extraEvents: options.extraEvents,
  });
  return { ctx, dispose: () => { ctl.dispose(); disposeAdopt(); } };
}
