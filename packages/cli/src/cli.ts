/** Weave CLI entry — `weave build` / `weave dev` / `weave check`. */

import { build } from './build.js';
import { dev } from './dev.js';
import { generateRoutes } from './routes.js';
import { checkProject, type Diagnostic } from '@weave/check';

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  const entry = rest.find((a) => !a.startsWith('-')) ?? 'src/main.ts';
  const outdir = flag(rest, '--out') ?? 'dist';

  if (cmd === 'build') {
    // `weave build` is the production bundle → minify by default; `--no-minify` opts out.
    await build({ entry, outdir, minify: !rest.includes('--no-minify') });
    console.log(`weave build → ${outdir}/`);
    return;
  }
  if (cmd === 'dev') {
    const servedir = flag(rest, '--serve') ?? '.';
    const port = Number(flag(rest, '--port')) || undefined;
    const { url } = await dev({ entry, outdir, servedir, port });
    console.log(`weave dev → ${url}`);
    return;
  }
  if (cmd === 'check') {
    const roots = rest.filter((a) => !a.startsWith('-'));
    const diags = checkProject(roots.length ? roots : ['src']);
    for (const d of diags) console.error(formatDiagnostic(d));
    const errors = diags.filter((d) => d.category === 'error').length;
    if (errors) {
      console.error(`\nweave check: ${errors} error${errors === 1 ? '' : 's'}`);
      process.exit(1);
    }
    console.log('weave check: no type errors');
    return;
  }

  if (cmd === 'routes') {
    const dir = rest.find((a) => !a.startsWith('-')) ?? 'src/routes';
    const out = flag(rest, '--out');
    const written = generateRoutes(dir, { out, lazy: !rest.includes('--eager') });
    console.log(`weave routes → ${written}`);
    return;
  }

  console.error(
    'usage: weave <build|dev|check|routes> [entry|paths…] [--out dir] [--serve dir] [--port n] [--no-minify] [--eager]'
  );
  process.exit(1);
}

function formatDiagnostic(d: Diagnostic): string {
  return `${d.file}:${d.line}:${d.col} - ${d.category} TS${d.code}: ${d.message}`;
}
