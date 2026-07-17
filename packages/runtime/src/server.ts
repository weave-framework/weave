/**
 * `@weave-framework/runtime/server` — headless render to an HTML string (Phase E, E0.4).
 *
 * The server counterpart to a client mount: install the in-house headless DOM ({@link installServerDom}),
 * run the SAME compiler-emitted render the browser runs — no second render path (RFC 0009 §4) — and
 * serialize the resulting node tree to HTML. Importing this module installs the shim as globals, so any
 * component module imported AFTER it parses its template strings against the headless DOM. In a browser
 * (real `document` present) the install is a no-op, so this is safe to import anywhere; it is its own entry
 * and ships 0 bytes to a client SPA (invariant I3).
 *
 *   import { renderComponent } from '@weave-framework/runtime/server';
 *   import App from './App.weave';                    // imported AFTER runtime/server → templates parse headless
 *   const html = renderComponent(App, { title: 'Hi' });
 *
 * Pair with `@weave-framework/runtime/graph` on the client: the server render can carry `data-won-*`
 * resumable markers (the compiler's `resumable` target), and the same reactive state serializes via
 * `snapshot()` for the client to `resume()` — with `setup` never re-run.
 */
import { installServerDom, serializeNode, type SNode } from './server-dom.js';
import { createOwner, runInOwner, disposeOwner, type Owner } from './reactive.js';
import { snapshot, collectStates, finalizeStates, ROOT_ID, SNAPSHOT_ID, type DroppedState } from './graph.js';
import { collectResumable } from './resume.js';
import { scriptSafe, type PageArtifact } from './document.js';
import type { Component } from './dom.js';

// Install on import, so a component module imported afterward parses its `template(...)` strings headlessly.
installServerDom();

/**
 * E1.3 — the async seam. The render is synchronous but data is not: `resource()` defers its fetcher to a
 * microtask, so a headless render finished before any fetch resolved and an SSG page shipped empty + `loading`,
 * with the client refetching exactly what the build had just fetched.
 *
 * A GLOBAL, not an exported function: `@weave-framework/data` must not import this entry, or every fetching
 * client SPA would bundle the headless render (I3). Same shape as {@link installServerDom} — the server
 * installs, the library looks (`data`'s `trackServerAsync`). Absent in a browser → one `undefined` compare.
 */
const ASYNC_SINK: string = '__weaveAsync';

/**
 * Run `render`, then drain what the sink collected — repeatedly, since settling one fetch can start another
 * (a resource whose `source` reads another's data). Rejections are absorbed: a failed fetch lands in `error()`
 * and renders as such, which is the app's business, not a build failure. Bounded, so a self-retriggering
 * resource cannot hang the build forever.
 */
async function settleAsync<T>(render: () => T): Promise<T> {
  const g: Record<string, unknown> = globalThis as Record<string, unknown>;
  const prev: unknown = g[ASYNC_SINK];
  const sink: Promise<unknown>[] = [];
  g[ASYNC_SINK] = sink;
  try {
    const out: T = render();
    for (let round: number = 0; sink.length && round < 20; round++) {
      await Promise.allSettled(sink.splice(0));
      await Promise.resolve(); // let the .then() that writes the signal run before checking for more
    }
    return out;
  } finally {
    if (prev === undefined) delete g[ASYNC_SINK];
    else g[ASYNC_SINK] = prev;
  }
}

/** Serialize an already-built node tree (element / text / comment / fragment) to an HTML string. */
export function renderToString(node: unknown): string {
  return serializeNode(node as SNode);
}

/**
 * Mount a component to an HTML string under a fresh, immediately-disposed owner (mirrors `mountComponent`,
 * but emits a string instead of attaching to a container). One-shot: reactive bindings fill their initial
 * values synchronously; `onMount` and live event listeners are inert on the server.
 */
export function renderComponent(component: Component, props?: Record<string, unknown>): string {
  const owner: Owner = createOwner(null);
  try {
    const node: unknown = runInOwner(owner, () => component(props ?? {}, {}));
    return serializeNode(node as SNode);
  } finally {
    disposeOwner(owner);
  }
}

/**
 * Render a component to its SSG artifact: the component HTML plus a snapshot `<script>` the client
 * `resumePage()` rebuilds its reactive graph from. Two capture modes:
 *  - **resumable** (E1.4, `resumable: true`) — the islands path. A `resumable`-compiled render self-registers
 *    each instance's ctx via its `$wid` preamble; we tag the root `$wid = $root`, run inside {@link collectStates},
 *    and snapshot the `{ $root, c0, … }` instance-state map (a shared signal serializes once). `options.state`
 *    is ignored — the map IS the state.
 *  - **explicit** (E1.2, default) — snapshot the caller's `state` record (byte-for-byte prior behaviour;
 *    `collectStates` is inert for an eager render, which never calls `registerState`).
 */
export async function renderPage(
  component: Component,
  options: { props?: Record<string, unknown>; state?: Record<string, unknown>; resumable?: boolean } = {}
): Promise<PageArtifact> {
  // Reset the shared title so a prior route's value never leaks; the render may set `document.title`
  // (e.g. a route-title effect), which we capture below for the page's <title>.
  const doc: { title?: string } | undefined = (globalThis as { document?: { title?: string } }).document;
  if (doc) doc.title = '';
  // Tag the root so its resumable render registers its ctx under `$root` (the child-`$wid` mechanism, applied
  // to the root). Harmless for an eager component — it has no `$wid` preamble, so the prop is just ignored.
  const props: Record<string, unknown> | undefined = options.resumable
    ? { ...options.props, $wid: ROOT_ID }
    : options.props;
  const dropped: DroppedState[] = [];
  // E1.3 — build the node, SETTLE, then serialize (it was one synchronous `renderComponent` call, which is why
  // a page with a `resource()` prerendered empty). The owner must OUTLIVE the wait: disposing it early — as
  // `renderComponent` does in its `finally` — kills the bindings that write the fetched value into the node.
  const owner: Owner = createOwner(null);
  let node: unknown;
  const states: Record<string, unknown> = await settleAsync(() =>
    collectStates(() => {
      // A collecting session marks this as THE server render: each `on:` site stamps its `data-won-*` marker for
      // the client to resume, instead of wiring a live listener (which is what a client-side render of the same
      // resumable build does). The captured id→handler map is discarded — the client rebuilds handlers from the
      // compiled `handlers(ctx)` factory over the resumed ctx.
      node = collectResumable(() => runInOwner(owner, () => component(props ?? {}, {}))).node;
    }, dropped)
  );
  // Settled: every tracked fetch has resolved and its effect has written through into `node`.
  const html: string = serializeNode(node as SNode);
  disposeOwner(owner);
  // A signal can be reassigned AFTER its component registered — re-check before encoding, or the build dies
  // inside `snapshot()` with no clue which component was at fault (E1.9).
  if (options.resumable) finalizeStates(states, dropped);
  const wire: unknown = options.resumable ? snapshot(states) : snapshot(options.state ?? {});
  const json: string = scriptSafe(JSON.stringify(wire));
  const title: string | undefined = doc?.title || undefined;
  // E1.9 — say which components fell back to client rendering, and why. A silent downgrade is exactly the
  // kind of defect the resume warnings exist to surface.
  const warnings: string[] = dropped.map(
    (d) =>
      `${d.id === ROOT_ID ? 'the root component' : `component instance \`${d.id}\``} is not resumable — ` +
      `binding \`${d.key}\` cannot be serialized (${d.reason}) — it will be client-rendered instead ` +
      `(its setup re-runs). Keep non-serializable values (a router, a store with methods, a class instance) ` +
      `out of what setup() returns, or accept client rendering for this component.`
  );
  return {
    html,
    snapshotScript: `<script type="application/weave" id="${SNAPSHOT_ID}">${json}</script>`,
    title,
    ...(warnings.length ? { warnings } : {}),
  };
}

// The document-assembly layer is DOM-free — re-exported here for convenience, defined in `./document`.
export { renderDocument, type PageArtifact, type DocumentOptions } from './document.js';
export { installServerDom } from './server-dom.js';
