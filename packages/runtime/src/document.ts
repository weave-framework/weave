/**
 * `@weave-framework/runtime/document` — the DOM-FREE half of the server surface (Phase E, E0.4/E1.2).
 *
 * The page/document assembly is pure string work with no DOM or reactive dependency, so it lives in its own
 * entry — importable from the Node CLI (`prerender`) without pulling in the DOM-typed `runtime/dom` /
 * `runtime/graph`. `renderPage` (in `runtime/server`, which DOES touch the reactive graph) produces a
 * {@link PageArtifact}; {@link renderDocument} here assembles it into a full HTML document.
 */

/** The two halves of an SSG page: the rendered component HTML + a `<script>` embedding the state snapshot. */
export interface PageArtifact {
  /** The component's server-rendered HTML (carries `data-won-*` markers for the resumable target). */
  html: string;
  /** A `<script type="application/weave" id="…">` embedding the serialized state, for `resumePage()`. */
  snapshotScript: string;
  /** The `document.title` the render set (if any) — used as the page `<title>` unless overridden. */
  title?: string;
  /**
   * E1.9 — non-fatal diagnostics from a `resumable` render: component instances the server could not make
   * resumable (a binding that can't be serialized), which the client will CSR-mount instead. The build logs
   * these per route, so a silent downgrade to client rendering is visible.
   */
  warnings?: string[];
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

/** Escape a serialized-JSON string so it is safe to embed inside a `<script>` (no `</script>` break-out). */
export function scriptSafe(json: string): string {
  return json.replace(/</g, '\\u003c');
}

/** Copies of `server-dom.ts:27-28` — this entry is DOM-free and must not import the DOM-typed half. */
const escapeText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** Assemble a complete HTML document from a {@link PageArtifact} — the SSG output for one page. */
export function renderDocument(artifact: PageArtifact, options: DocumentOptions = {}): string {
  // An explicit option wins; else the title the render captured (document.title); else none.
  const title: string = options.title ?? artifact.title ?? '';
  const { head = '', entry, lang } = options;
  // The title is routinely derived from DATA (a route-title effect reading a CMS record), so unescaped it is
  // a stored XSS in every generated page. `head` is the one raw hole by design — injecting markup is its job.
  return (
    `<!DOCTYPE html>\n<html${lang ? ` lang="${escapeAttr(lang)}"` : ''}>\n<head>\n<meta charset="utf-8">\n` +
    (title ? `<title>${escapeText(title)}</title>\n` : '') +
    (head ? head + '\n' : '') +
    `</head>\n<body>\n${artifact.html}\n${artifact.snapshotScript}\n` +
    (entry ? `<script type="module" src="${escapeAttr(entry)}"></script>\n` : '') +
    `</body>\n</html>\n`
  );
}
