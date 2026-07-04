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
export function registerDevNode(kind: DevKind, name: string | undefined, read?: () => unknown): () => void {
  if (!enabled || !name) return noop;
  const id: number = nextId++;
  registry.set(id, { id, name, kind, read });
  emitChange();
  return () => {
    registry.delete(id);
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
