/**
 * `prerender` — the SSG output layer (Phase E, E1.3). Given a list of routes and a way to render each to a
 * {@link PageArtifact} (component HTML + embedded state snapshot, from `renderPage`), write a static
 * `<outDir>/<route>/index.html` per route via `renderDocument`. The client resumes each page with
 * `resumePage` — lazy handlers, no `setup` re-run.
 *
 * The `render` function is PLUGGABLE — it is the seam the full `weave build --ssg` (E1.3b) fills with a
 * server bundle of the app (each route → its component, rendered headlessly). Here it is a plain function,
 * so the orchestration (route → file, dir creation, document assembly) is testable on its own and reusable.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
// The DOM-free document layer — keeps the Node CLI's typecheck out of the runtime's DOM-typed code.
import { renderDocument, type PageArtifact, type DocumentOptions } from '@weave-framework/runtime/document';

export interface PrerenderConfig {
  /** Output directory (the built site root). */
  outDir: string;
  /** Route paths to prerender — `/`, `/about`, `/docs/intro`. */
  routes: string[];
  /** Render one route to its artifact (HTML + snapshot). Sync or async (a lazy route may import a chunk). */
  render: (route: string) => PageArtifact | Promise<PageArtifact>;
  /** Document options — a constant, or per-route (title/head vary by page). */
  document?: DocumentOptions | ((route: string) => DocumentOptions);
}

/** Map a route path to its output file: `/` → `index.html`, `/about` → `about/index.html`. */
export function routeToFile(route: string): string {
  const clean: string = route.replace(/^\/+|\/+$/g, '');
  return clean === '' ? 'index.html' : `${clean}/index.html`;
}

/**
 * Prerender every route to a static HTML file under `outDir`. Returns the written relative paths (in route
 * order). Each file is a complete document: the server-rendered component, the embedded state snapshot, and
 * the client entry — ready to serve and resume.
 */
export async function prerender(config: PrerenderConfig): Promise<string[]> {
  const written: string[] = [];
  for (const route of config.routes) {
    const artifact: PageArtifact = await config.render(route);
    const docOpts: DocumentOptions =
      (typeof config.document === 'function' ? config.document(route) : config.document) ?? {};
    const rel: string = routeToFile(route);
    const abs: string = join(config.outDir, rel);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, renderDocument(artifact, docOpts));
    written.push(rel);
  }
  return written;
}
