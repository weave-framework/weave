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
