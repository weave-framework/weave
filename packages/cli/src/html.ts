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
/**
 * A JavaScript string literal safe to embed in an inline `<script>`.
 *
 * `JSON.stringify` is right for JSON and not quite right for code: it leaves `</` raw, so a value carrying
 * `</script>` would close the very block it sits in, and it leaves U+2028/U+2029 raw. The value here is an
 * internal path today, but the whole point of escaping at the boundary is that it does not depend on where
 * the value came from. Lossless — both forms decode back to the original.
 * (CodeQL: js/bad-code-sanitization. Same reasoning as the compiler's own emitter.)
 */
function jsLiteral(s: string): string {
  return JSON.stringify(s)
    .replace(/<\//g, '<\\/')
    .replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

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
    // Two messages, not one. A failed rebuild used to send `reload` like any other, so the page reloaded
    // into a bundle that no longer existed (404) and went WHITE, with the real error only in the terminal.
    // Now a failure sends `error:<text>` and paints an overlay over the last working page; the next
    // successful build sends `reload` and the overlay goes with it.
    const client: string = `<script>(function(){var o;new EventSource(${jsLiteral(opts.liveReload)})
.addEventListener("message",function(e){var d=e.data||"";
if(d.indexOf("error:")===0){if(!o){o=document.createElement("div");o.id="__weave_error";
o.setAttribute("style","position:fixed;inset:0;z-index:2147483647;overflow:auto;margin:0;padding:24px;"
+"background:#1b1b1fef;color:#ffb4ab;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap");
document.body.appendChild(o);}o.textContent=decodeURIComponent(d.slice(6));return;}
if(o){o.remove();o=undefined;}location.reload();});})();</script>`;
    out = out.replace(/<\/body>/i, `    ${client}\n  </body>`);
  }

  return out;
}
