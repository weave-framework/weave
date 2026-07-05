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

/** The kind of a registered devtools node — a `signal`, a `computed`, or an `effect`. */
export type DevKind = 'signal' | 'computed' | 'effect';

/**
 * The minimal shape of an ownership scope that devtools needs to build the tree — a
 * structural view of the runtime's `Owner` (no import, so devtools stays free of the
 * reactive core that imports it). `_parent` is the ambient scope at creation; `name` is
 * set by `mountComponent` (a component scope names itself after the component).
 */
export interface DevOwner {
  _parent: DevOwner | null;
  name?: string;
}

/** One registered reactive node. `read` yields its current value (absent for effects). */
export interface DevNode {
  id: number;
  name: string;
  kind: DevKind;
  read?: () => unknown;
  /** The ownership scope this node was created in (for the component/owner tree). */
  owner?: DevOwner | null;
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
  node?: object,
  owner?: DevOwner | null
): () => void {
  if (!enabled || !name) return noop;
  const id: number = nextId++;
  registry.set(id, { id, name, kind, read, owner });
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

/* ─────────────────────────────── trigger trace ─────────────────────────────── */

/**
 * One recorded propagation event: a value change in `from` marked `to` dirty. This is
 * the *temporal* view — "what just fired and what it caused" — as opposed to the static
 * {@link inspectGraph} edges ("what depends on what"). `seq` is a monotonic counter (no
 * `Date.now()` in the core, so replay/tests stay deterministic).
 */
export interface DevTrigger {
  from: number;
  to: number;
  fromName: string;
  toName: string;
  seq: number;
}

let traceSeq: number = 0;
let traceCap: number = 500;
const traceBuf: DevTrigger[] = [];

/** Set the trigger-trace ring-buffer size (drop-oldest past the cap). Default 500. */
export function setTraceLimit(n: number): void {
  traceCap = Math.max(1, Math.floor(n));
  while (traceBuf.length > traceCap) traceBuf.shift();
}

/**
 * Core hook: record that a value change in `fromNode` dirtied `toNode`. A no-op unless
 * devtools are on AND both ends are registered named nodes — so an unnamed graph, or a
 * production build, records nothing. Called from the reactive propagation path.
 */
export function recordTrigger(fromNode: object, toNode: object): void {
  if (!enabled) return;
  const from: number | undefined = nodeToId.get(fromNode);
  if (from === undefined) return;
  const to: number | undefined = nodeToId.get(toNode);
  if (to === undefined) return;
  traceBuf.push({
    from,
    to,
    fromName: registry.get(from)?.name ?? '?',
    toName: registry.get(to)?.name ?? '?',
    seq: ++traceSeq,
  });
  if (traceBuf.length > traceCap) traceBuf.shift();
}

/** Recent trigger events, newest first (all up to the cap, or the last `limit`). */
export function inspectTrace(limit?: number): DevTrigger[] {
  const rev: DevTrigger[] = [...traceBuf].reverse();
  return limit != null ? rev.slice(0, limit) : rev;
}

/** Trigger events touching a node (as source or target), newest first — the panel's per-node slice. */
export function traceFor(id: number, limit?: number): DevTrigger[] {
  const hits: DevTrigger[] = traceBuf.filter((t) => t.from === id || t.to === id).reverse();
  return limit != null ? hits.slice(0, limit) : hits;
}

/** Clear the trigger-trace ring-buffer. */
export function clearTrace(): void {
  traceBuf.length = 0;
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

/* ─────────────────────────────── owner tree ─────────────────────────────── */

/** A scope in the component/owner tree: its directly-owned nodes + child scopes. */
export interface DevOwnerNode {
  /** Synthetic id for this scope (stable within one {@link inspectTree} call). */
  id: number;
  /** The scope name — set for component scopes by `mountComponent`; undefined otherwise. */
  name?: string;
  /** The registered reactive nodes created directly in this scope. */
  nodes: DevSnapshot[];
  /** Nested child scopes. */
  children: DevOwnerNode[];
}

/**
 * The component/owner tree: registered nodes nested under the scope hierarchy they were
 * created in (the shape developers think in), rather than the flat {@link inspect} list.
 * Scopes with no name are anonymous control-flow/render scopes; component scopes carry the
 * component name. Nodes created outside any scope collect under a leading `(unowned)` root.
 */
export function inspectTree(): DevOwnerNode[] {
  const snapById: Map<number, DevSnapshot> = new Map<number, DevSnapshot>();
  for (const s of inspect()) snapById.set(s.id, s);

  const owners: Map<DevOwner, DevSnapshot[]> = new Map<DevOwner, DevSnapshot[]>();
  const unowned: DevSnapshot[] = [];
  for (const node of registry.values()) {
    const snap: DevSnapshot | undefined = snapById.get(node.id);
    if (!snap) continue;
    const o: DevOwner | null | undefined = node.owner;
    if (!o) {
      unowned.push(snap);
      continue;
    }
    if (!owners.has(o)) owners.set(o, []);
    owners.get(o)!.push(snap);
  }
  // Pull in each owner's ancestor chain so the tree stays connected even through
  // intermediate scopes that own no registered node of their own.
  for (const o of [...owners.keys()]) {
    let p: DevOwner | null = o._parent;
    while (p) {
      if (!owners.has(p)) owners.set(p, []);
      p = p._parent;
    }
  }

  const idMap: Map<DevOwner, number> = new Map<DevOwner, number>();
  let oid: number = 1;
  for (const o of owners.keys()) idMap.set(o, oid++);

  const build = (o: DevOwner): DevOwnerNode => ({
    id: idMap.get(o)!,
    name: o.name,
    nodes: owners.get(o) ?? [],
    children: [...owners.keys()].filter((c) => c._parent === o).map(build),
  });

  const roots: DevOwnerNode[] = [...owners.keys()]
    .filter((o) => !o._parent || !owners.has(o._parent))
    .map(build);
  if (unowned.length) roots.unshift({ id: 0, nodes: unowned, children: [] });
  return roots;
}
