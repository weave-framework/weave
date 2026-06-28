/** Weave CLI entry — `weave build` / `weave dev`. */

import { build } from './build.js';
import { dev } from './dev.js';

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  const entry = rest.find((a) => !a.startsWith('-')) ?? 'src/main.ts';
  const outdir = flag(rest, '--out') ?? 'dist';

  if (cmd === 'build') {
    await build({ entry, outdir, minify: rest.includes('--minify') });
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

  console.error('usage: weave <build|dev> [entry] [--out dir] [--serve dir] [--port n] [--minify]');
  process.exit(1);
}
