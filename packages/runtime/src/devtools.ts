/**
 * @weave-framework/runtime/devtools — the introspection layer under a future DevTools UI.
 *
 * Zero-cost when off. Reactive primitives (`signal`/`computed`/`effect`) take an optional
 * `name`; when devtools are enabled, each **named** node registers here so tooling can list
 * the live reactive graph and read current values. Enabling is explicit (`enableDevtools()`)
 * so production pays nothing — an unnamed node, or a named node with devtools off, never
 * touches the registry.
 *
 * This is the "prep" slice of the DevTools roadmap item: names + a registry + `inspect()`.
 * A visual panel (component tree · live values · "who triggers whom" graph) builds on top.
 */

export type DevKind = 'signal' | 'computed' | 'effect';

/** One registered reactive node. `read` yields its current value (absent for effects). */
export interface DevNode {
  id: number;
  name: string;
  kind: DevKind;
  read?: () => unknown;
}

/** A snapshot row from {@link inspect}. */
export interface DevSnapshot {
  id: number;
  name: string;
  kind: DevKind;
  value?: unknown;
}

let enabled: boolean = false;
let nextId: number = 1;
const registry: Map<number, DevNode> = new Map<number, DevNode>();
// The internal reactive node behind each id, and its reverse map — used by
// {@link inspectGraph} to turn a computation's `sources` into edges between registered ids.
const internalNodes: Map<number, object> = new Map<number, object>();
const nodeToId: Map<object, number> = new Map<object, number>();

// Registry-membership change listeners — a panel bridges these to a signal so it
// re-reads when nodes appear/disappear. Value changes are tracked separately (an effect
// that calls inspect() reads each node's getter, so it re-runs on any value change).
const changeListeners: Set<() => void> = new Set<() => void>();
function emitChange(): void {
  for (const cb of changeListeners) cb();
}

/**
 * Subscribe to registry-membership changes (a named node registered or unregistered).
 * Returns an unsubscribe fn. Zero-dep by design — devtools stays free of the reactive
 * core (which imports it); tooling turns this into reactivity on its own side.
 */
export function onDevtoolsChange(cb: () => void): () => void {
  changeListeners.add(cb);
  return () => void changeListeners.delete(cb);
}

/** Turn introspection on (or off). Off by default — production pays nothing. */
export function enableDevtools(on: boolean = true): void {
  enabled = on;
}

/** Whether introspection is currently on. */
export function isDevtoolsEnabled(): boolean {
  return enabled;
}

/**
 * Register a named reactive node. Called by the primitives; a no-op (returning a no-op
 * disposer) when devtools are off or the node is unnamed. Returns an unregister fn the
 * primitive ties to its owner's disposal so the graph doesn't leak.
 */
export function registerDevNode(
  kind: DevKind,
  name: string | undefined,
  read?: () => unknown,
  node?: object
): () => void {
  if (!enabled || !name) return noop;
  const id: number = nextId++;
  registry.set(id, { id, name, kind, read });
  if (node) {
    internalNodes.set(id, node);
    nodeToId.set(node, id);
  }
  emitChange();
  return () => {
    registry.delete(id);
    const n: object | undefined = internalNodes.get(id);
    if (n) {
      nodeToId.delete(n);
      internalNodes.delete(id);
    }
    emitChange();
  };
}

function noop(): void {
  /* nothing to unregister */
}

/**
 * Snapshot the live reactive graph — every registered named node with its current value
 * (values are read defensively; a throwing computed reports the error object, not a crash).
 */
export function inspect(): DevSnapshot[] {
  const out: DevSnapshot[] = [];
  for (const node of registry.values()) {
    const row: DevSnapshot = { id: node.id, name: node.name, kind: node.kind };
    if (node.read) {
      try {
        row.value = node.read();
      } catch (err) {
        row.value = err;
      }
    }
    out.push(row);
  }
  return out;
}

/** Number of registered nodes (mostly for tests / a panel header). */
export function devNodeCount(): number {
  return registry.size;
}

/** A directed edge `from → to`: reading `from` triggers a recompute of `to` (a computed/effect). */
export interface DevEdge {
  from: number;
  to: number;
}

/**
 * The live reactive graph: every registered node plus the edges between them. An edge is
 * derived from a computation's internal `sources` — for each registered computed/effect,
 * every source that is ALSO a registered node yields `source → thisNode` ("source triggers
 * this"). Signals are leaves (no sources). This is the data behind the panel's "who triggers
 * whom" view.
 */
export function inspectGraph(): { nodes: DevSnapshot[]; edges: DevEdge[] } {
  const edges: DevEdge[] = [];
  for (const [id, node] of internalNodes) {
    const sources: Set<unknown> | undefined = (node as { sources?: Set<unknown> }).sources;
    if (!sources) continue; // signals have no `sources` — they're graph leaves
    for (const src of sources) {
      const from: number | undefined = nodeToId.get(src as object);
      if (from !== undefined) edges.push({ from, to: id });
    }
  }
  return { nodes: inspect(), edges };
}
