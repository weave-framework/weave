/**
 * HTML shell injection — the framework wires the required `<script>`/`<link>` (and,
 * in dev, the live-reload client) into the author's `index.html` at compile/serve
 * time. The author writes a clean shell (no entry script, no reload boilerplate) and
 * can't forget or misplace it: `weave build` and `weave dev` both inject here.
 */

export interface InjectOptions {
  /** Module entry to ensure as `<script type="module" src=…>` (e.g. `/main.js`). */
  script: string;
  /** Stylesheet href to ensure as `<link rel="stylesheet">` (prod only; dev injects CSS via JS). */
  css?: string;
  /** Live-reload SSE endpoint — wires an `EventSource` reload client (dev only). */
  liveReload?: string;
}

/** Escape a string for safe use inside a `RegExp`. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Defensively drop a pre-existing live-reload `<script>` (an `EventSource(...reload...)`)
 * so re-injection never doubles it. The `(?:(?!<\/script>)[\s\S])*?` guard keeps the
 * match inside one `<script>` element; author comments are left untouched.
 */
function stripLiveReload(html: string): string {
  return html.replace(
    /[ \t]*<script>(?:(?!<\/script>)[\s\S])*?EventSource\([^)]*reload[^)]*\)[\s\S]*?<\/script>\n?/gi,
    ''
  );
}

/**
 * Inject the entry script (always), an optional stylesheet link (prod), and an
 * optional live-reload client (dev) into an HTML shell — each only if absent.
 * Root-absolute hrefs so a client-route refresh (SPA fallback) still resolves them.
 */
export function injectHtml(html: string, opts: InjectOptions): string {
  let out: string = stripLiveReload(html);

  if (opts.css && !new RegExp(`<link[^>]+href=["']${escapeRe(opts.css)}["']`, 'i').test(out)) {
    out = out.replace(/<\/head>/i, `    <link rel="stylesheet" href="${opts.css}" />\n  </head>`);
  }

  if (!new RegExp(`<script[^>]+src=["']${escapeRe(opts.script)}["']`, 'i').test(out)) {
    out = out.replace(
      /<\/body>/i,
      `    <script type="module" src="${opts.script}"></script>\n  </body>`
    );
  }

  if (opts.liveReload) {
    const client: string = `<script>new EventSource(${JSON.stringify(
      opts.liveReload
    )}).addEventListener("message",()=>location.reload());</script>`;
    out = out.replace(/<\/body>/i, `    ${client}\n  </body>`);
  }

  return out;
}
