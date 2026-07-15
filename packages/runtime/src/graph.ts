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
 * Scope (E0.3): the graph rebuild + lazy-handler contract — the heart of resumability. Automatic DOM-binding
 * *adoption* (running the compiled render in adopt mode so bindings re-attach to the server DOM without
 * hand-wiring) is the headless DOM seam, E0.4. Per-instance captured closure state (each `@for` row's own
 * handler data) needs serialized lexical scope — a later slice; a component-level handler that closes over
 * `ctx` resumes today.
 */
import { signal, type Signal } from './reactive.js';
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
 * A factory binding handler site-refs to handlers over the RESUMED ctx. In the full pipeline the compiler
 * emits this (extracted from the resumable render); E0.3 hand-authors it, which is what pins the contract.
 */
export type HandlerFactory = (ctx: Record<string, unknown>) => Record<string, ResumeHandler>;

export interface ResumeOptions {
  /** The serialized reactive state from the server ({@link snapshot}). */
  snapshot: Wire;
  /** Map handler site-refs → handlers over the resumed ctx. */
  handlers: HandlerFactory;
  /** Extra delegated event types to arm even if absent at scan time (see `resumeEvents`). */
  extraEvents?: string[];
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

/**
 * Resume a server-rendered subtree: rebuild its reactive graph from `snapshot` and wire its handlers
 * lazily against the existing DOM — WITHOUT calling `setup`. Returns the rebuilt `ctx` (live signals) and a
 * dispose handle. The first interaction with a `data-won-*` element resolves its handler (from
 * `handlers(ctx)`, by exact id then by site prefix) and invokes it against the resumed graph.
 */
export function resume(root: Element, options: ResumeOptions): ResumeApp {
  const ctx: Record<string, unknown> = deserialize(options.snapshot) as Record<string, unknown>;
  const table: Record<string, ResumeHandler> = options.handlers(ctx);
  const ctl: ResumeControl = resumeEvents(root, {
    resolve: (id) => table[id] ?? table[siteOf(id)],
    extraEvents: options.extraEvents,
  });
  return { ctx, dispose: () => ctl.dispose() };
}
