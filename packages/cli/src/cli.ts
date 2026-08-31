/** Weave CLI entry — `weave build` / `weave dev` / `weave check` / `weave routes` / `weave migrate`. */

import { build, buildSsg } from './build.js';
import { dev } from './dev.js';
import { generateRoutes, staticRoutePaths } from './routes.js';
import { loadConfig } from './config.js';
import type { ResolvedConfig } from './config.js';
import { discoverCustomElements, generateEntry, generateServerEntry, type CustomElement } from './entry.js';
import { checkProject, impactOf, type Diagnostic } from '@weave-framework/check';
import { readdirSync, readFileSync, statSync, writeFileSync, type Dirent } from 'node:fs';
import { join } from 'node:path';

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

/**
 * `build` and `dev` need something to bundle. A config declaring neither `root` nor `entry` is a
 * component-LIBRARY config (it exists for `styleLang` and friends) — perfectly valid to load and
 * to `weave check`, but there is no app here to build or serve. Say that, rather than handing
 * esbuild an undefined entry.
 */
function requireAppEntry(config: ResolvedConfig, cmd: string): void {
  if (config.entry || config.rootComponent) return;
  console.error(
    `weave ${cmd}: this config declares neither \`root\` (generated bootstrap) nor \`entry\` ` +
      `(hand-written), so there is no app to ${cmd === 'dev' ? 'serve' : 'build'}. Add one — or, if this ` +
      `is a component library, run \`weave check\` instead (a library config needs no entry).`
  );
  process.exit(1);
}

/** Build the framework-owned entry (Level C) when the config declares a `root` component. */
function virtualEntryFor(
  config: ResolvedConfig,
  devtools: boolean = false,
  state?: string
): { code: string; resolveDir: string } | undefined {
  if (!config.rootComponent) return undefined;
  const elements: CustomElement[] = discoverCustomElements(config.root);
  const code: string = generateEntry(config.rootComponent, config.mount, config.root, elements, { devtools, state });
  return { code, resolveDir: config.root };
}

/**
 * The whole CLI, in one screen.
 *
 * There was no help before this — every form (`weave`, `weave --help`, `weave nonsense`) printed the same
 * one-line usage string and exited 1, and `weave build --help` did not print anything at all: the flag was
 * ignored and a production build ran, wiping `outDir` on the way. A tool whose `--help` has side effects
 * teaches people not to try things.
 */
const HELP: string = `weave — the Weave CLI

usage: weave <command> [options]

commands
  dev                    Start the dev server: watch, rebuild, live-reload
  build                  Write a minified, deployable bundle to dist/
  check [paths…]         Type-check templates and the rest of your .ts (default root: src)
  routes [dir]           Regenerate the file-based route module (default dir: src/routes)
  migrate                Assisted migration of an Angular project into Weave
  mcp                    Run the Weave MCP server over stdio (for AI editors)
  merge --install        Register the template merge driver, so git stops inventing conflicts

options
  --config <file>        Use this weave.config.ts instead of the one found in the current directory
  --out <dir>            Output directory (build), overriding the config's outDir
  --port <n>             Dev server port; steps to the next free one when taken
  --serve <dir>          Dev server web root (config-less mode)
  --no-minify            Leave the build unminified
  --check                Type-check first, and write nothing if it finds errors (build)
  --fix                  Apply the fixes check is certain of, then re-check (check)
  --impact <file>        List what renders this component, directly and transitively (check)
  --devtools             Show the reactive-graph panel in the page (dev)
  --state <name>         Start in a state saved from that panel (dev)
  --ssg                  Prerender every route to static HTML (build)
  --eager                Inline routes instead of code-splitting them (routes)
  -h, --help             Print this

examples
  weave dev                        run the app in this directory
  weave build --ssg                prerender every route
  weave check src lib              type-check two roots
  weave routes src/pages           regenerate routes from a pages directory
  weave dev --state empty          open the app in a state you saved earlier
  weave merge --install            once per clone: git merges templates by structure

docs: https://weaveframework.dev`;

/** Human-readable byte size — the build summary's whole vocabulary. */
function fileSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} kB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * What the build actually produced. `weave build → dist/` said only that the command had run: not what was
 * emitted, not how big it is, not how long it took — so the first thing anyone asks about a build ("is my
 * bundle reasonable?") needed a separate `ls`. Source maps are summarised in one line rather than listed:
 * they are not shipped to a browser, and they are usually the biggest files in the directory.
 */
function summarizeBuild(outDir: string, startedAt: number, checked: boolean = false): void {
  console.log(`weave build → ${outDir}/ (${Date.now() - startedAt} ms)`);
  let entries: Dirent[];
  try {
    entries = readdirSync(outDir, { withFileTypes: true });
  } catch {
    return; // an unreadable outDir is the build's problem to report, not the summary's
  }
  const files: Array<{ name: string; size: number }> = [];
  let maps: number = 0;
  for (const e of entries) {
    if (!e.isFile()) continue;
    const size: number = statSync(join(outDir, e.name)).size;
    if (e.name.endsWith('.map')) {
      maps += size;
      continue;
    }
    files.push({ name: e.name, size });
  }
  files.sort((a, b) => b.size - a.size);
  const width: number = files.reduce((w, f) => Math.max(w, f.name.length), 0);
  for (const f of files) console.log(`  ${f.name.padEnd(width)}  ${fileSize(f.size).padStart(9)}`);
  if (maps) console.log(`  ${'(source maps)'.padEnd(width)}  ${fileSize(maps).padStart(9)}`);
  // A build that did not type-check must not be mistaken for a verdict. `weave check` is the gate and
  // the build does not run it, so a template naming something `setup` never returns bundles cleanly
  // and throws in the browser — with nothing in this output to say the silence meant nothing.
  if (!checked) console.log('  (not type-checked — run `weave check`, or build with `--check`)');
}

export { defineConfig } from './config.js';
export type { WeaveConfig } from './config.js';

export async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;

  // `--help` anywhere, `help`, or no command at all: print the help and succeed. Asking a tool what it can
  // do is not an error, and it must never do the thing instead — `weave build --help` used to build.
  if (cmd === undefined || cmd === 'help' || cmd === '--help' || cmd === '-h' || rest.includes('--help') || rest.includes('-h')) {
    console.log(HELP);
    return;
  }
  const entry: string = rest.find((a) => !a.startsWith('-')) ?? 'src/main.ts';
  const outdir: string = flag(rest, '--out') ?? 'dist';
  // A `weave.config.ts/json` (auto-discovered in cwd, or via `--config`) switches both
  // build + dev into the config-driven pipeline; else the flags drive it.
  const config: ResolvedConfig | null = await loadConfig(process.cwd(), flag(rest, '--config'));

  if (cmd === 'build') {
    const startedAt: number = Date.now();
    // `--check` runs the checker BEFORE bundling and refuses to emit anything if it finds errors: an
    // artifact built from code known to be broken is worse than no artifact. It is opt-in on purpose —
    // making it the default would turn a green pipeline red on unchanged code, which VERSIONING.md
    // grades as a break regardless of how right the new answer is.
    const wantsCheck: boolean = rest.includes('--check');
    if (wantsCheck) {
      const roots: string[] = [config?.root ?? 'src'];
      const diags: Diagnostic[] = checkProject(roots);
      for (const d of diags) console.error(formatDiagnostic(d));
      const errors: number = diags.filter((d) => d.category === 'error').length;
      if (errors) {
        console.error(`
weave build --check: ${errors} error${errors === 1 ? '' : 's'} — nothing was written.`);
        process.exit(1);
      }
    }
    try {
      if (config) {
        requireAppEntry(config, 'build');
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
            base: config.base,
            minify: config.minify,
            styleLang: config.styleLang,
            styles: config.styles,
            publicDir: config.publicDirDeclared ? config.publicDir : undefined,
            // The app's own shell — a generated page inherits its `<html>` attributes and `<head>`, so it is
            // the same document as every other page of the site rather than a bare one built from scratch.
            index: config.index,
            resume,
          });
          console.log(`weave build --ssg → ${outDir}/ (${routes.length} route${routes.length === 1 ? '' : 's'})`);
          return;
        }
        await build({
          entry: config.entry,
          virtualEntry: virtualEntryFor(config),
          outDir,
          base: config.base,
          // Client routes mean deep links; a static host needs the shell under `404.html` to survive a
          // refresh on one. An app with no `routesDir` has no deep links to lose.
          spaFallback: config.routesDir != null,
          minify: config.minify,
          styleLang: config.styleLang,
          styles: config.styles,
          // Only a DECLARED static root is copied — see `publicDirDeclared`.
          publicDir: config.publicDirDeclared ? config.publicDir : undefined,
          index: config.index,
          clean: true, // a fresh, self-contained artifact each prod build
        });
        summarizeBuild(outDir, startedAt, wantsCheck);
        return;
      }
      // `weave build` is the production bundle → minify by default; `--no-minify` opts out.
      await build({ entry, outDir: outdir, minify: !rest.includes('--no-minify') });
      summarizeBuild(outdir, startedAt, wantsCheck);
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
    const devtools: boolean = rest.includes('--devtools');
    const state: string | undefined = flag(rest, '--state');
    if (config) {
      requireAppEntry(config, 'dev');
      syncRoutes(config); // file-based routing: regenerate routes.gen.ts before serving
      // Serve the static web root (publicDir) from memory (outdir === servedir so
      // `main.js` lives at the web root); nothing is written to disk.
      const { url } = await dev({
        entry: config.entry,
        virtualEntry: virtualEntryFor(config, devtools, state),
        base: config.base,
        servedir: config.publicDir,
        outdir: config.publicDir,
        port: config.port,
        styleLang: config.styleLang,
        styles: config.styles,
        index: config.index,
        inMemory: true,
        proxy: config.proxy,
        // Saved states are tooling scratch space, so they live in `.weave/` next to the config the
        // command was run against — not inside the source tree.
        statesDir: join(process.cwd(), '.weave', 'states'),
      });
      console.log(`weave dev → ${url}`);
      // Discoverable without being imposed: the panel is real, and it is off unless asked for.
      if (!devtools) console.log('  (--devtools shows the reactive graph in the page)');
      if (state) console.log(`  (starting in the saved state \`${state}\`)`);
      return;
    }
    const servedir: string = flag(rest, '--serve') ?? '.';
    const port: number | undefined = Number(flag(rest, '--port')) || undefined;
    const { url } = await dev({ entry, outdir, servedir, port });
    console.log(`weave dev → ${url}`);
    return;
  }
  if (cmd === 'check') {
    const flagged: number = rest.indexOf('--impact');
    // `indexOf` returns -1 when the flag is absent, and `-1 + 1` is 0 — so the guard against picking up
    // `--impact`'s argument as a root used to drop the FIRST path instead. `weave check lib` silently
    // checked `src`, and from a directory with no `src` it checked nothing and reported success.
    const roots: string[] = rest.filter((a, i) => !a.startsWith('-') && !(flagged !== -1 && i === flagged + 1));
    const where: string[] = roots.length ? roots : ['src'];
    if (flagged !== -1) {
      const target: string | undefined = rest[flagged + 1];
      if (!target) {
        console.error('weave check --impact needs a file');
        process.exit(1);
      }
      // Asked BEFORE editing, so it reads the graph rather than type-checking anything.
      const { direct, transitive } = impactOf(where, target);
      const total: number = direct.length + transitive.length;
      if (!total) {
        console.log(`nothing under ${where.join(', ')} renders ${target}`);
        return;
      }
      console.log(`${target} is rendered by ${total} file${total === 1 ? '' : 's'}
`);
      if (direct.length) {
        console.log(`  directly (${direct.length}):`);
        for (const f of direct) console.log(`    ${f}`);
      }
      if (transitive.length) {
        console.log(`
  and reached through those (${transitive.length}):`);
        for (const f of transitive) console.log(`    ${f}`);
      }
      return;
    }
    let diags: Diagnostic[] = checkProject(where);
    if (rest.includes('--fix')) {
      // Repeat until a round changes nothing. One round was not enough, and the reason is structural:
      // every declaration `grow-setup` offers is inserted at the SAME offset — the end of `setup`'s body
      // — so they all overlap each other, and `applyFixes` skips a fix that overlaps one already applied.
      // A template naming four missing things therefore got two, printed the other two as errors, and
      // looked broken; running the same command again finished the job. Measured, not reasoned: `save`
      // and `done` landed on the first run, `age` and `label` only on the second.
      //
      // Bounded, because a fix that does not reduce the diagnostic it came from would otherwise spin. The
      // bound is generous: each round applies at least one fix or the loop ends, so ten rounds is ten
      // declarations in one file, and real templates do not out-run it.
      let total: number = 0;
      for (let round: number = 0; round < 10; round++) {
        const applied: number = applyFixes(diags);
        if (!applied) break;
        total += applied;
        diags = checkProject(where); // the files changed; the old diagnostics describe a state that is gone
      }
      if (total) console.log(`weave check --fix: repaired ${total} mistake${total === 1 ? '' : 's'}`);
      else console.log('weave check --fix: nothing to repair');
    }
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

  if (cmd === 'merge') {
    // A git merge driver (and its one-time installer). Lazily imported: it runs once per conflicted
    // file during a merge, and never during a build.
    const { runMerge } = await import('./merge-driver.js');
    const code: number = runMerge(rest);
    if (code !== 0) process.exit(code);
    return;
  }

  if (cmd === 'migrate') {
    // Assisted migration into Weave (RFC 0011). Imported lazily so the migrate code doesn't bloat the CLI bundle.
    const { runMigrate } = await import('./migrate.js');
    await runMigrate();
    return;
  }

  console.error(`weave: unknown command \`${cmd}\`.
`);
  console.error(HELP);
  process.exit(1);
}

/**
 * Apply every fix a diagnostic is certain of, and report how many landed.
 *
 * Per file, back to front: an earlier edit shifts every later offset. A fix overlapping one already
 * applied is skipped rather than stacked — two rules pointing at the same span means at least one of
 * them no longer describes the text that is actually there.
 */
function applyFixes(diags: Diagnostic[]): number {
  const byFile: Map<string, NonNullable<Diagnostic['fix']>[]> = new Map();
  for (const d of diags) {
    if (!d.fix) continue;
    // A fix does not have to belong to the file the diagnostic points at: a TEMPLATE saying it needs a
    // name is answered by a declaration in the component's `.ts`.
    const target: string = d.fix.file ?? d.file;
    const list: NonNullable<Diagnostic['fix']>[] = byFile.get(target) ?? [];
    list.push(d.fix);
    byFile.set(target, list);
  }
  let applied: number = 0;
  for (const [file, fixes] of byFile) {
    let text: string = readFileSync(file, 'utf8');
    let lastStart: number = Number.MAX_SAFE_INTEGER;
    for (const f of [...fixes].sort((a, b) => b.start - a.start)) {
      if (f.end > lastStart) continue; // overlaps a fix already applied
      text = text.slice(0, f.start) + f.text + text.slice(f.end);
      lastStart = f.start;
      applied++;
    }
    writeFileSync(file, text);
  }
  return applied;
}

function formatDiagnostic(d: Diagnostic): string {
  // TS diagnostics carry a `TS<code>`; a template parse error (code 0) has none.
  const code: string = d.code ? ` TS${d.code}` : '';
  return `${d.file}:${d.line}:${d.col} - ${d.category}${code}: ${d.message}`;
}
