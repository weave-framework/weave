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

/** The two halves of an SSG page: the rendered component HTML + a `<script>` embedding the state snapshot. */
export interface PageArtifact {
  /** The component's server-rendered HTML (carries `data-won-*` markers for the resumable target). */
  html: string;
  /** A `<script type="application/weave" id="…">` embedding the serialized state, for `resumePage()`. */
  snapshotScript: string;
}

/** Escape a serialized-JSON string so it is safe to embed inside a `<script>` (no `</script>` break-out). */
function scriptSafe(json: string): string {
  return json.replace(/</g, '\\u003c');
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

/** Options for {@link renderDocument}. */
export interface DocumentOptions {
  title?: string;
  /** Extra markup for `<head>` (meta, links, inline styles). */
  head?: string;
  /** Client entry module URL — emitted as `<script type="module" src="…">` after the snapshot. */
  entry?: string;
  lang?: string;
}

/** Assemble a complete HTML document from a {@link PageArtifact} — the SSG output for one page. */
export function renderDocument(artifact: PageArtifact, options: DocumentOptions = {}): string {
  const { title = '', head = '', entry, lang } = options;
  return (
    `<!DOCTYPE html>\n<html${lang ? ` lang="${lang}"` : ''}>\n<head>\n<meta charset="utf-8">\n` +
    (title ? `<title>${title}</title>\n` : '') +
    (head ? head + '\n' : '') +
    `</head>\n<body>\n${artifact.html}\n${artifact.snapshotScript}\n` +
    (entry ? `<script type="module" src="${entry}"></script>\n` : '') +
    `</body>\n</html>\n`
  );
}

export { installServerDom } from './server-dom.js';
