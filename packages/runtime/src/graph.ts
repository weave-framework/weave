/**
 * `@weave-framework/runtime/graph` — the Phase E resume entry.
 *
 * The client-side counterpart to a server render: rebuild the reactive state from a serialized snapshot, adopt
 * the server DOM in place, and wire handlers LAZILY — WITHOUT re-running `setup` (RFC 0009 §3). That is what
 * makes Weave *resumable* rather than *hydrated*: the server already ran the app logic and rendered the DOM.
 * A conformance test spies on `setup` and asserts zero calls.
 *
 *   const wire = snapshot({ count });                                  // server / build
 *   const { ctx } = resume(root, { snapshot: wire, adopt: render.adopt, handlers: render.handlers });
 *
 * Its own entry (own size budget); 0 bytes for a plain client SPA (invariant I3). Importing it registers a
 * `signal` (de)serializer, so reactive state round-trips through `serialize`/`deserialize`.
 *
 * What crosses the wire is only what can: signals + plain data. Functions are dropped by {@link registerState}
 * and rebuilt client-side instead — handlers by the compiled `handlers(ctx)` factory (E1.5 inlines a named
 * `setup` handler's body into it), computeds by `derive(ctx)` (E1.6). Known gaps: a `@for` row's per-instance
 * closure state, and router-block adopt.
 */
import { signal, root as reactiveRoot, type Signal } from './reactive.js';
import { serialize, deserialize, registerSerializableType, type Wire } from './serialize.js';
import { resumeEvents, type ResumeHandler, type ResumeControl } from './resume.js';
import { collectInstances, type ResumedInstance } from './adopt.js';

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

/** A component instance the server render could NOT make resumable, and why (E1.9). */
export interface DroppedState {
  /** The instance id (`$root`, `c0`, …) that will be absent from the snapshot. */
  id: string;
  /** The setup binding that cannot cross the wire (`router`, a store with methods, a class instance). */
  key: string;
  /** The codec's reason. */
  reason: string;
}

let droppedSink: DroppedState[] | null = null;

/** Per-instance derived keys, keyed by the states map: {@link finalizeStates} runs after the session closed. */
const derivedKeys: WeakMap<object, Record<string, readonly string[]>> = new WeakMap();

export function collectStates(fn: () => void, dropped?: DroppedState[]): Record<string, unknown> {
  const prev: Record<string, unknown> | null = collector;
  const prevDropped: DroppedState[] | null = droppedSink;
  const states: Record<string, unknown> = {};
  collector = states;
  droppedSink = dropped ?? null;
  try {
    fn();
    return states;
  } finally {
    collector = prev;
    droppedSink = prevDropped;
  }
}

/**
 * Register a resumable component instance's ctx under its compile-time id — called from a resumable component's
 * OWN render preamble when the parent tagged it with a `$wid` prop (static-position child). No-op outside a
 * {@link collectStates} session (so it costs nothing on the client / in a plain SPA — no runtime/dom change).
 *
 * Only SERIALIZABLE state is captured: signals + plain data. A top-level function is NOT state — a handler is
 * rebuilt by the compiled `handlers(ctx)` factory (E1.5), a `computed` by `derive` (E1.6) — so both are
 * dropped. Signals are callable too, but the codec claims them ({@link isSignal}), so they are kept.
 *
 * E1.9 — a binding that cannot cross the wire at all (a `router`, a store with methods, a class instance)
 * makes the whole instance non-resumable and it is dropped: half a ctx is worse than none (the render's
 * bindings would resume against `undefined`). A missing `states[id]` is the client's signal to CSR-mount that
 * component instead — its `setup` re-runs and all still works. Previously this FAILED THE BUILD.
 */
export function registerState(id: string, ctx: unknown, derived?: readonly string[]): void {
  if (!collector) return;
  if (derived?.length) {
    let m: Record<string, readonly string[]> | undefined = derivedKeys.get(collector);
    if (!m) { m = {}; derivedKeys.set(collector, m); }
    m[id] = derived; // finalizeStates re-probes after the render and needs the same exemption
  }
  const src: Record<string, unknown> = ctx as Record<string, unknown>;
  const clean: Record<string, unknown> = {};
  for (const key of Object.keys(src)) {
    const v: unknown = src[key];
    if (typeof v === 'function' && !isSignal(v)) continue; // a handler/computed — rebuilt, not state
    // Probe this binding on its own so a failure can NAME it. The throwaway encode costs build time only.
    try {
      serialize(v);
    } catch (e) {
      // `derived` are the keys the compiled `derive(ctx)` rebuilds from module scope (E1.11) — a `router`,
      // a store. Leaving one out is not a hole: derive fills it client-side, so the instance still resumes.
      // Anything else unserializable IS a hole (the render would bind against `undefined`), so the whole
      // instance is dropped and the client CSR-mounts it instead (E1.9).
      if (derived?.includes(key)) continue;
      if (droppedSink) droppedSink.push({ id, key, reason: (e as Error).message });
      return;
    }
    clean[key] = v;
  }
  collector[id] = clean;
}

/**
 * Re-check every collected instance once the render is OVER, dropping any that can no longer serialize (E1.9).
 *
 * {@link registerState} probes a binding the moment the component registers it — but the render continues after
 * that, and a signal can be REASSIGNED before the snapshot is taken (a later effect storing a class instance,
 * say). The value the snapshot actually encodes is the one at the END, so the decisive check belongs here;
 * without it the build dies on `snapshot()` with no clue which component was at fault (dogfound on the docs
 * site). A dropped instance simply CSR-mounts on the client, and the caller reports it.
 *
 * E1.16 — a DERIVED key that turns unserializable is NOT a drop: `derive` rebuilds it, so only the key leaves
 * the snapshot. That is an element `ref`'s normal life — `signal(null)` at register time, a DOM node once
 * `setRef` ran. Narrow on purpose: nothing rebuilds a plain binding, so that still drops the ctx (E1.9).
 */
export function finalizeStates(states: Record<string, unknown>, dropped?: DroppedState[]): void {
  const derived: Record<string, readonly string[]> = derivedKeys.get(states) ?? {};
  for (const id of Object.keys(states)) {
    const ctx: Record<string, unknown> = states[id] as Record<string, unknown>;
    if (ctx == null || typeof ctx !== 'object') continue;
    for (const key of Object.keys(ctx)) {
      try {
        serialize(ctx[key]);
      } catch (e) {
        if (derived[id]?.includes(key)) {
          delete ctx[key];
          continue;
        }
        if (dropped) dropped.push({ id, key, reason: (e as Error).message });
        delete states[id];
        break;
      }
    }
  }
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
export type AdoptFn = (
  root: Element,
  ctx: Record<string, unknown>,
  slots?: Record<string, unknown>,
  states?: Record<string, unknown>,
) => unknown;

/**
 * The compiled render's computed re-deriver (E1.6) — `render.derive`. `registerState` drops every function
 * from the snapshot, which is right for a handler (the `handlers` factory rebuilds it) but fatal for a
 * `computed`: the template CALLS it, so a resumed `ctx.doubled` of `undefined` throws and takes the whole
 * page's resume with it. The compiler emits this from the `computed(…)` declarations in `setup`, rewritten
 * against ctx, and it re-assigns each onto the resumed ctx in declaration order.
 */
export type DeriveFn = (ctx: Record<string, unknown>) => unknown;

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
  /**
   * The compiled render's computed re-deriver (typically `render.derive`, E1.6). A `computed` cannot cross the
   * snapshot, so it is rebuilt here over the resumed signals — BEFORE `adopt`, since the render's bindings
   * call it (`{{ doubled() }}`). Absent when the component declares no computeds.
   */
  derive?: DeriveFn;
}

export interface ResumeApp {
  /** The rebuilt ROOT reactive state (live signals) — produced by deserialize, NOT by re-running setup. */
  ctx: Record<string, unknown>;
  /** The full resumed state map (E1.2c-6): the root ctx plus every child component instance's ctx by id. */
  states: Record<string, unknown>;
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
  /** The compiled render's computed re-deriver (typically `render.derive`) — runs before adopt (E1.6). */
  derive?: DeriveFn;
  /** Where to read the snapshot `<script>` from (default: the global `document`). */
  document?: Document;
  /**
   * E1.9 — CSR fallback for a root the server could not make resumable (a binding that can't cross the wire;
   * see {@link registerState}). Called INSTEAD of resuming, and must render the app itself (clear the server
   * DOM + `mountComponent`). Without it, such a page throws rather than degrading.
   */
  fallback?: () => void;
}

/**
 * Client entry for an SSG/SSR page (E1.2): read the embedded state snapshot (the `SNAPSHOT_ID` script that
 * `renderPage` emitted) and {@link resume} `root` against it — lazy handlers, no `setup`. Throws loudly if
 * the snapshot script is missing. Returns the {@link ResumeApp}.
 */
export function resumePage(options: ResumePageOptions): ResumeApp | null {
  const doc: Document = options.document ?? (globalThis as { document?: Document }).document!;
  const el: HTMLElement | null = doc.getElementById(SNAPSHOT_ID);
  if (!el) throw new Error(`resumePage: no snapshot <script id="${SNAPSHOT_ID}"> found in the document.`);
  const wire: Wire = JSON.parse(el.textContent || 'null') as Wire;
  // E1.9 — the root is resumable iff the server registered it. A map WITHOUT `$root` means it had a binding
  // that couldn't cross the wire, so resuming would run the render's bindings against nothing: CSR instead.
  if (options.fallback) {
    const decoded: unknown = deserialize(wire);
    if (decoded == null || typeof decoded !== 'object' || !(ROOT_ID in (decoded as Record<string, unknown>))) {
      options.fallback();
      return null;
    }
  }
  return resume(options.root, {
    snapshot: wire,
    handlers: options.handlers,
    extraEvents: options.extraEvents,
    adopt: options.adopt,
    derive: options.derive,
  });
}

/**
 * Resume a server-rendered subtree: rebuild its reactive graph from `snapshot` and wire its handlers
 * lazily against the existing DOM — WITHOUT calling `setup`. Returns the rebuilt `ctx` (live signals) and a
 * dispose handle. The first interaction with a `data-won-*` element resolves its handler (from
 * `handlers(ctx)`, by exact id then by site prefix) and invokes it against the resumed graph.
 */
export function resume(root: Element, options: ResumeOptions): ResumeApp {
  // The snapshot is either a single root ctx (E1.2b) or a multi-instance map `{ $root, c0, c1, … }` (E1.2c-6).
  // A `$root` key means the map form — the root ctx lives there and the whole map is the component states.
  const decoded: Record<string, unknown> = deserialize(options.snapshot) as Record<string, unknown>;
  const isMap: boolean = decoded != null && ROOT_ID in decoded;
  const ctx: Record<string, unknown> = (isMap ? decoded[ROOT_ID] : decoded) as Record<string, unknown>;
  const states: Record<string, unknown> = decoded;
  // Adopt the server DOM's reactive bindings in place FIRST (E1.2b-2), inside a reactive root so the
  // re-attached effects are owned + disposable — no re-render, `setup` never runs. Then arm delegated events.
  let disposeAdopt: () => void = () => {};
  let instances: ResumedInstance[] = [];
  if (options.adopt || options.derive) reactiveRoot((dispose) => {
    // Collect each adopted child component instance (E1.8) so its OWN events resolve against ITS ctx.
    instances = collectInstances(() => {
      // Rebuild the computeds BEFORE adopt (E1.6): the render's bindings call them, and a computed created
      // here is owned by this root, so it disposes with the rest.
      if (options.derive) options.derive(ctx);
      if (options.adopt) options.adopt(root, ctx, {}, states);
    });
    disposeAdopt = dispose;
  });

  // Event resolution is ANCESTRY-SCOPED (E1.8). Each component instance owns its DOM subtree; a `data-won-*`
  // ref (`w0#n`) resolves by prefix (`w0`) within the NEAREST enclosing instance's handler table — the root,
  // or any adopted child. This disambiguates the per-component site prefixes, which collide across components.
  // Tables are built lazily (only on first event) + cached; a child's ctx already carries its derived computeds.
  const tables: Map<Element, () => Record<string, ResumeHandler>> = new Map();
  // E1.20 — a factory also takes the instance's `props`. A root has none, and `{}` is right, not a guess:
  // `mountComponent` passes a root no props either.
  const addInstance = (
    el: Element,
    factory: (c: Record<string, unknown>, p?: Record<string, unknown>) => Record<string, unknown>,
    c: Record<string, unknown>,
    p?: Record<string, unknown>,
  ): void => {
    let built: Record<string, ResumeHandler> | undefined;
    tables.set(el, () => (built ??= factory(c, p ?? {}) as Record<string, ResumeHandler>));
  };
  if (options.handlers) addInstance(root, options.handlers, ctx);
  for (const inst of instances) addInstance(inst.root, inst.handlers, inst.ctx, inst.props);

  const resolve = (id: string, el: Element): ResumeHandler | undefined => {
    let node: Element | null = el;
    while (node) {
      const get = tables.get(node);
      if (get) {
        const table: Record<string, ResumeHandler> = get();
        const h: ResumeHandler | undefined = table[id] ?? table[siteOf(id)];
        if (h) return h; // else keep walking out — a forwarded handler may belong to an ancestor instance
      }
      if (node === root) break;
      node = node.parentElement;
    }
    return undefined;
  };

  const ctl: ResumeControl = resumeEvents(root, { resolve, extraEvents: options.extraEvents });
  return { ctx, states, dispose: () => { ctl.dispose(); disposeAdopt(); } };
}
