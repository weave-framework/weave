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
import { snapshot, SNAPSHOT_ID } from './graph.js';
import { scriptSafe, type PageArtifact } from './document.js';
import type { Component } from './dom.js';

// Install on import, so a component module imported afterward parses its `template(...)` strings headlessly.
installServerDom();

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
 * Render a component to its SSG artifact (E1.2): the component HTML plus a snapshot `<script>` carrying the
 * reactive `state` the client `resumePage()` rebuilds. `props`/`state` are the same signals the component
 * reads (via props/context) and that get serialized — hand them the writable state so it round-trips.
 */
export function renderPage(
  component: Component,
  options: { props?: Record<string, unknown>; state?: Record<string, unknown> } = {}
): PageArtifact {
  const html: string = renderComponent(component, options.props);
  const json: string = scriptSafe(JSON.stringify(snapshot(options.state ?? {})));
  return { html, snapshotScript: `<script type="application/weave" id="${SNAPSHOT_ID}">${json}</script>` };
}

// The document-assembly layer is DOM-free — re-exported here for convenience, defined in `./document`.
export { renderDocument, type PageArtifact, type DocumentOptions } from './document.js';
export { installServerDom } from './server-dom.js';
