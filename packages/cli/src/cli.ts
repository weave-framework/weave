/** Weave CLI entry — `weave build` / `weave dev` / `weave check` / `weave routes`. */

import { build, buildSsg } from './build.js';
import { dev } from './dev.js';
import { generateRoutes, staticRoutePaths } from './routes.js';
import { loadConfig } from './config.js';
import type { ResolvedConfig } from './config.js';
import { discoverCustomElements, generateEntry, generateServerEntry, type CustomElement } from './entry.js';
import { checkProject, type Diagnostic } from '@weave-framework/check';

function flag(args: string[], name: string): string | undefined {
  const i: number = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/**
 * Regenerate the file-based routes module from the pages dir (when configured). Always LAZY
 * (`lazy(() => import(…))`) — that is what esbuild's `splitting` splits on, so each page becomes its own
 * chunk and a reader downloads only their own route.
 *
 * `--ssg` used to force STATIC imports here, for a real reason: the headless render is synchronous, so a lazy
 * chunk's `import()` could not resolve before the render finished and the route prerendered EMPTY. But that
 * constraint belonged to the server, and it was applied to both bundles — so every prerendered route shipped
 * one `main.js` holding the whole app. E1.3 removed the constraint at its root: `lazy()` now hands its import
 * to the headless render's async sink, so the render settles it and the route prerenders in full. One manifest,
 * lazy, for both sides. (The eager twin + the server-side alias plugin that briefly existed here are gone —
 * `verify:resume` proves a routed app still prerenders without them.)
 */
function syncRoutes(config: ResolvedConfig): void {
  if (!config.routesDir) return;
  console.log(`weave routes → ${generateRoutes(config.routesDir, { lazy: true })}`);
}

/** Build the framework-owned entry (Level C) when the config declares a `root` component. */
function virtualEntryFor(config: ResolvedConfig): { code: string; resolveDir: string } | undefined {
  if (!config.rootComponent) return undefined;
  const elements: CustomElement[] = discoverCustomElements(config.root);
  const code: string = generateEntry(config.rootComponent, config.mount, config.root, elements);
  return { code, resolveDir: config.root };
}

export { defineConfig } from './config.js';
export type { WeaveConfig } from './config.js';

export async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  const entry: string = rest.find((a) => !a.startsWith('-')) ?? 'src/main.ts';
  const outdir: string = flag(rest, '--out') ?? 'dist';
  // A `weave.config.ts/json` (auto-discovered in cwd, or via `--config`) switches both
  // build + dev into the config-driven pipeline; else the flags drive it.
  const config: ResolvedConfig | null = await loadConfig(process.cwd(), flag(rest, '--config'));

  if (cmd === 'build') {
    try {
      if (config) {
        const ssg: boolean = rest.includes('--ssg');
        syncRoutes(config); // file-based routing: regenerate routes.gen.ts (lazy) before bundling
        // An explicit `--out` overrides the config's `outDir` (used by `@weave-framework/nx`, which
        // passes the workspace-root `dist/<project>` path); with no flag the config value stands, so
        // a standalone `weave build` is unchanged.
        const outDir: string = flag(rest, '--out') ?? config.outDir;
        // `--ssg` (Phase E, E1.3b): static generation — render the root headlessly to HTML, then the client
        // CSR-mounts over it. Needs a generated bootstrap (a `root` component to render); `entry` mode opts out.
        if (ssg) {
          if (!config.rootComponent) {
            console.error('weave build --ssg needs a config `root` component — it renders the root headlessly.');
            process.exit(1);
          }
          // Routes to prerender: an explicit `ssg.routes`, else every static route derived from `routesDir`
          // (file-based routing), else just `/` (a root-only app). Routed when file-based routing is in play
          // or any non-root route is prerendered — the server entry then imports the router's SSR seam; a pure
          // root-only app stays router-free (no dep).
          const routes: string[] =
            config.ssgRoutes ?? (config.routesDir ? staticRoutePaths(config.routesDir) : ['/']);
          const routed: boolean = config.routesDir != null || routes.some((r) => r !== '/');
          // Islands mode (E1.4): both entries switch to resume — the client adopts the server DOM in place.
          const resume: boolean = config.ssgResume ?? false;
          const clientElements: CustomElement[] = discoverCustomElements(config.root);
          await buildSsg({
            virtualEntry: {
              code: generateEntry(config.rootComponent, config.mount, config.root, clientElements, { resume }),
              resolveDir: config.root,
            },
            serverEntry: {
              code: generateServerEntry(config.rootComponent, config.root, { routed, resumable: resume }),
              resolveDir: config.root,
            },
            mount: config.mount,
            routes,
            outDir,
            minify: config.minify,
            styleLang: config.styleLang,
            styles: config.styles,
            publicDir: config.publicDir,
            resume,
          });
          console.log(`weave build --ssg → ${outDir}/ (${routes.length} route${routes.length === 1 ? '' : 's'})`);
          return;
        }
        await build({
          entry: config.entry,
          virtualEntry: virtualEntryFor(config),
          outDir,
          minify: config.minify,
          styleLang: config.styleLang,
          styles: config.styles,
          publicDir: config.publicDir,
          index: config.index,
          clean: true, // a fresh, self-contained artifact each prod build
        });
        console.log(`weave build → ${outDir}/`);
        return;
      }
      // `weave build` is the production bundle → minify by default; `--no-minify` opts out.
      await build({ entry, outDir: outdir, minify: !rest.includes('--no-minify') });
      console.log(`weave build → ${outdir}/`);
      return;
    } catch (e) {
      // esbuild already prints each error framed at `file:line:col` (including template parse errors
      // surfaced by the loader) — so just summarize + fail, rather than re-dumping esbuild's internal
      // stack. Non-esbuild failures (a bad config, a missing file) still show their message.
      const errs: unknown = (e as { errors?: unknown[] }).errors;
      if (Array.isArray(errs)) {
        console.error(`\nweave build failed — ${errs.length} error${errs.length === 1 ? '' : 's'}.`);
      } else {
        console.error(`\nweave build failed: ${(e as Error)?.message ?? String(e)}`);
      }
      process.exit(1);
    }
  }
  if (cmd === 'dev') {
    if (config) {
      syncRoutes(config); // file-based routing: regenerate routes.gen.ts before serving
      // Serve the static web root (publicDir) from memory (outdir === servedir so
      // `main.js` lives at the web root); nothing is written to disk.
      const { url } = await dev({
        entry: config.entry,
        virtualEntry: virtualEntryFor(config),
        servedir: config.publicDir,
        outdir: config.publicDir,
        port: config.port,
        styleLang: config.styleLang,
        styles: config.styles,
        index: config.index,
        inMemory: true,
        proxy: config.proxy,
      });
      console.log(`weave dev → ${url}`);
      return;
    }
    const servedir: string = flag(rest, '--serve') ?? '.';
    const port: number | undefined = Number(flag(rest, '--port')) || undefined;
    const { url } = await dev({ entry, outdir, servedir, port });
    console.log(`weave dev → ${url}`);
    return;
  }
  if (cmd === 'check') {
    const roots: string[] = rest.filter((a) => !a.startsWith('-'));
    const diags: Diagnostic[] = checkProject(roots.length ? roots : ['src']);
    for (const d of diags) console.error(formatDiagnostic(d));
    const errors: number = diags.filter((d) => d.category === 'error').length;
    if (errors) {
      console.error(`\nweave check: ${errors} error${errors === 1 ? '' : 's'}`);
      process.exit(1);
    }
    console.log('weave check: no type errors');
    return;
  }

  if (cmd === 'routes') {
    const dir: string = rest.find((a) => !a.startsWith('-')) ?? 'src/routes';
    const out: string | undefined = flag(rest, '--out');
    const written: string = generateRoutes(dir, { out, lazy: !rest.includes('--eager') });
    console.log(`weave routes → ${written}`);
    return;
  }

  if (cmd === 'mcp') {
    // Launch the Weave MCP server over stdio (an AI-editor integration). Imported lazily so
    // the CLI doesn't bundle it; `weave-mcp` is the equivalent standalone bin.
    try {
      const mcp: { runStdioServer: (o?: object) => Promise<void> } = await import('@weave-framework/mcp');
      await mcp.runStdioServer();
    } catch (e) {
      console.error(
        `weave mcp: could not start the MCP server — is @weave-framework/mcp installed?\n${(e as Error)?.message ?? String(e)}`
      );
      process.exit(1);
    }
    return;
  }

  console.error(
    'usage: weave <build|dev|check|routes|mcp> [entry|paths…] [--config file] [--out dir] [--serve dir] [--port n] [--no-minify] [--eager] [--ssg]'
  );
  process.exit(1);
}

function formatDiagnostic(d: Diagnostic): string {
  // TS diagnostics carry a `TS<code>`; a template parse error (code 0) has none.
  const code: string = d.code ? ` TS${d.code}` : '';
  return `${d.file}:${d.line}:${d.col} - ${d.category}${code}: ${d.message}`;
}
