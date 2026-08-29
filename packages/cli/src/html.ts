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
  /**
   * The sub-path the app is served under (`/my-app`), published to the page as `__WEAVE_BASE__`.
   *
   * It has to come from the DOCUMENT, not from the entry module: `import` declarations hoist, so an
   * assignment written above them in the generated entry would run after the router had already
   * initialised. A classic inline script before the module tag is the only order that holds.
   */
  base?: string;
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

/** The parts of an author's `index.html` a generated page has to inherit to be the same site. */
export interface DocumentShell {
  /** The `<html>` element's attributes, verbatim (`lang="en" data-theme="light"`), or ''. */
  htmlAttrs: string;
  /** The head's contents, minus what the generator emits itself (`<title>`, `<meta charset>`). */
  head: string;
}

/**
 * Read an author's `index.html` as a shell for `weave build --ssg`.
 *
 * A prerendered page used to be assembled from nothing — charset, title, stylesheet, done. Everything else
 * the author's own document said was silently dropped: the viewport meta (so every generated page rendered
 * unscaled on a phone), `lang` and any theme attribute, the description and social meta the whole point of
 * static generation is to serve, the favicon, and `<base>` — whose absence also broke every RELATIVE URL,
 * because a page at `/learn/templates` resolves them against `/learn/` and not the root.
 *
 * `<title>` and `<meta charset>` are dropped here because the generator emits them per page: the title is
 * the route's own, captured from the render.
 */
export function documentShell(html: string): DocumentShell {
  const htmlTag: RegExpMatchArray | null = html.match(/<html\b([^>]*)>/i);
  const headMatch: RegExpMatchArray | null = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  const head: string = (headMatch?.[1] ?? '')
    .replace(/[ \t]*<title\b[^>]*>[\s\S]*?<\/title>\s*\n?/gi, '')
    .replace(/[ \t]*<meta\b[^>]*\bcharset\b[^>]*>\s*\n?/gi, '')
    .replace(/^\s*\n|\s+$/g, '');
  return { htmlAttrs: (htmlTag?.[1] ?? '').trim(), head };
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

  if (opts.base) {
    const decl: string = `<script>window.__WEAVE_BASE__=${jsLiteral(opts.base)}</script>`;
    if (!out.includes('__WEAVE_BASE__')) out = out.replace(/<\/head>/i, `    ${decl}
  </head>`);
  }

  if (opts.liveReload) {
    // Two messages, not one. A failed rebuild used to send `reload` like any other, so the page reloaded
    // into a bundle that no longer existed (404) and went WHITE, with the real error only in the terminal.
    // Now a failure sends `error:<text>` and paints an overlay over the last working page; the next
    // successful build sends `reload` and the overlay goes with it.
    // The same overlay also catches a RUNTIME error that leaves nothing on the page. A `setup()` that
    // throws produced a blank white document with the message only in the console — the most confusing
    // possible outcome for someone who has just started, and the one every framework's newcomer hits.
    // It is deliberately conditional on an EMPTY page: an app that rendered and then threw somewhere is
    // the developer's own console to read, and covering a working screen with a modal would be worse.
    const client: string = `<script>(function(){var o;
function show(t){if(!o){o=document.createElement("div");o.id="__weave_error";
o.setAttribute("style","position:fixed;inset:0;z-index:2147483647;overflow:auto;margin:0;padding:24px;"
+"background:#1b1b1fef;color:#ffb4ab;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap");
document.body.appendChild(o);}o.textContent=t;}
function blank(){var b=document.body;if(!b)return true;
if((b.innerText||"").trim())return false;
for(var i=0;i<b.children.length;i++){var c=b.children[i];
if(c===o||c.tagName==="SCRIPT")continue;
if(c.getBoundingClientRect().height>0)return false;}
return true;}
function runtime(err){if(!blank())return;
show("The app threw before it rendered anything.\\n\\n"+((err&&(err.stack||err.message))||String(err))
+"\\n\\n(weave dev shows this because the page is empty — the same error is in the console.)");}
addEventListener("error",function(e){runtime(e.error||e.message);});
addEventListener("unhandledrejection",function(e){runtime(e.reason);});
new EventSource(${jsLiteral(opts.liveReload)})
.addEventListener("message",function(e){var d=e.data||"";
if(d.indexOf("error:")===0){show(decodeURIComponent(d.slice(6)));return;}
if(o){o.remove();o=undefined;}location.reload();});})();</script>`;
    out = out.replace(/<\/body>/i, `    ${client}\n  </body>`);
  }

  return out;
}
