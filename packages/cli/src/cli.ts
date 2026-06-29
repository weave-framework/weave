/** Weave CLI entry — `weave build` / `weave dev` / `weave check` / `weave routes`. */

import { build } from './build.js';
import { dev } from './dev.js';
import { generateRoutes } from './routes.js';
import { loadConfig } from './config.js';
import type { ResolvedConfig } from './config.js';
import { discoverCustomElements, generateEntry, type CustomElement } from './entry.js';
import { checkProject, type Diagnostic } from '@weave/check';

function flag(args: string[], name: string): string | undefined {
  const i: number = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
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
    if (config) {
      await build({
        entry: config.entry,
        virtualEntry: virtualEntryFor(config),
        outDir: config.outDir,
        minify: config.minify,
        styleLang: config.styleLang,
        styles: config.styles,
        publicDir: config.publicDir,
        index: config.index,
        clean: true, // a fresh, self-contained artifact each prod build
      });
      console.log(`weave build → ${config.outDir}/`);
      return;
    }
    // `weave build` is the production bundle → minify by default; `--no-minify` opts out.
    await build({ entry, outDir: outdir, minify: !rest.includes('--no-minify') });
    console.log(`weave build → ${outdir}/`);
    return;
  }
  if (cmd === 'dev') {
    if (config) {
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

  console.error(
    'usage: weave <build|dev|check|routes> [entry|paths…] [--config file] [--out dir] [--serve dir] [--port n] [--no-minify] [--eager]'
  );
  process.exit(1);
}

function formatDiagnostic(d: Diagnostic): string {
  return `${d.file}:${d.line}:${d.col} - ${d.category} TS${d.code}: ${d.message}`;
}
