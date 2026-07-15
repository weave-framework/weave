/** Weave CLI entry — `weave build` / `weave dev` / `weave check` / `weave routes`. */

import { build, buildSsg } from './build.js';
import { dev } from './dev.js';
import { generateRoutes } from './routes.js';
import { loadConfig } from './config.js';
import type { ResolvedConfig } from './config.js';
import { discoverCustomElements, generateEntry, generateServerEntry, type CustomElement } from './entry.js';
import { checkProject, type Diagnostic } from '@weave-framework/check';

function flag(args: string[], name: string): string | undefined {
  const i: number = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/**
 * Regenerate the file-based routes module from the pages dir (when configured). `eager` (SSG) emits static
 * imports instead of `lazy()` chunks: the headless server render is synchronous, so a lazy chunk's async
 * import would not resolve in time and the route would render empty. A later normal `dev`/`build` rewrites it
 * lazy again (the file is git-ignored).
 */
function syncRoutes(config: ResolvedConfig, eager: boolean = false): void {
  if (!config.routesDir) return;
  const written: string = generateRoutes(config.routesDir, { lazy: !eager });
  console.log(`weave routes → ${written}${eager ? ' (eager, for --ssg)' : ''}`);
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
  // build + dev into the config-driven pipeline (Angular-style); else the flags drive it.
  const config: ResolvedConfig | null = await loadConfig(process.cwd(), flag(rest, '--config'));

  if (cmd === 'build') {
    try {
      if (config) {
        const ssg: boolean = rest.includes('--ssg');
        // file-based routing: regenerate routes.gen.ts before bundling — eager for --ssg (synchronous
        // headless render), lazy otherwise (code-split SPA chunks).
        syncRoutes(config, ssg);
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
          // Routed when the app uses file-based routing or prerenders any non-root route: the server entry
          // then imports the router's SSR seam. A pure root-only app (only `/`) stays router-free (no dep).
          const routed: boolean = config.routesDir != null || config.ssgRoutes.some((r) => r !== '/');
          await buildSsg({
            virtualEntry: virtualEntryFor(config)!,
            serverEntry: {
              code: generateServerEntry(config.rootComponent, config.root, { routed }),
              resolveDir: config.root,
            },
            mount: config.mount,
            routes: config.ssgRoutes,
            outDir,
            minify: config.minify,
            styleLang: config.styleLang,
            styles: config.styles,
            publicDir: config.publicDir,
          });
          console.log(`weave build --ssg → ${outDir}/ (${config.ssgRoutes.length} route${config.ssgRoutes.length === 1 ? '' : 's'})`);
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
