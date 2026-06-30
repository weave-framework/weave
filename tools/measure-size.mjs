/**
 * M11 — size budget. Measures the gzipped footprint of the Weave runtime and a
 * representative compiled component, and guards against regressions.
 *
 * Three kinds of number, all minified + gzipped (level 9, what a CDN actually
 * serves):
 *   1. reactive-core / runtime-full — the framework's own runtime surface.
 *   2. counter-app — the real tree-shaken payload a user ships for the counter
 *      example (compiled component + only the runtime helpers it imports).
 *   3. counter-component — the compiled component module on its own (per-component
 *      cost: how much the codegen adds per `.weave`, independent of the runtime).
 *
 * Fixed ceilings live in `tools/size-budget.json` (regression guard). Any breach
 * exits 1. Run: `pnpm run size`.
 */
import { build, transform } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const gz = (text) => gzipSync(Buffer.from(text), { level: 9 }).length;
const raw = (text) => Buffer.byteLength(text);

/** Bundle a stdin module (importing real packages) → minified ESM text. */
async function bundleStdin(contents, plugins = []) {
  const r = await build({
    stdin: { contents, resolveDir: root, loader: 'ts' },
    bundle: true,
    minify: true,
    format: 'esm',
    write: false,
    plugins,
    logLevel: 'silent',
  });
  return r.outputFiles[0].text;
}

// ── The Weave esbuild loader (mirrors verify-build.mjs), for the counter app ──
const tmp = mkdtempSync(join(tmpdir(), 'weave-size-'));
const compilerJs = join(tmp, 'compiler.mjs');
await build({
  entryPoints: ['packages/compiler/src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: compilerJs,
  logLevel: 'silent',
});
const { compileComponent, parseSfc } = await import(pathToFileURL(compilerJs).href);

const weave = {
  name: 'weave',
  setup(b) {
    b.onLoad({ filter: /\.weave$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8');
      const { code } = compileComponent(parseSfc(source), { filename: args.path });
      return { contents: code, loader: 'ts', resolveDir: dirname(args.path) };
    });
  },
};

// ── Measurements ──
// Measure the reactive core alone (reactive.ts), not the package index — the index
// also re-exports owner-level features (context: provide/inject) whose cost belongs to
// runtime-full. This keeps "reactive-core" the reactive primitives only.
const reactiveV2 = await bundleStdin(`export * from './packages/runtime/src/reactive.js';`);
const runtimeV2 = await bundleStdin(
  `export * from '@weave/runtime';\nexport * from '@weave/runtime/dom';`
);

const counterApp = (
  await build({
    entryPoints: ['examples/__fixtures__/v2/main.ts'],
    bundle: true,
    minify: true,
    format: 'esm',
    write: false,
    plugins: [weave],
    logLevel: 'silent',
  })
).outputFiles[0].text;

// Per-component cost: the compiled module on its own, minified.
const counterSrc = readFileSync('examples/__fixtures__/v2/counter.weave', 'utf8');
const { code: counterModule } = compileComponent(parseSfc(counterSrc), {
  filename: 'counter.weave',
});
const counterComponent = (await transform(counterModule, { loader: 'ts', minify: true })).code;

const measured = {
  'reactive-core': { v2: reactiveV2 },
  'runtime-full': { v2: runtimeV2 },
  'counter-app': { v2: counterApp },
  'counter-component': { v2: counterComponent },
};

// ── Report + enforce ──
const budgetPath = 'tools/size-budget.json';
const budget = existsSync(budgetPath) ? JSON.parse(readFileSync(budgetPath, 'utf8')) : { limits: {} };
const limits = budget.limits ?? {};

const fmt = (n) => `${(n / 1024).toFixed(2)} kB`;
const pad = (s, n) => String(s).padEnd(n);
let failed = false;

console.log('Weave size budget (minified + gzip)\n');
console.log(`  ${pad('target', 20)}${pad('gzip', 12)}${pad('raw', 12)}limit`);
console.log('  ' + '─'.repeat(54));

for (const [name, { v2 }] of Object.entries(measured)) {
  const g = gz(v2);
  const r = raw(v2);
  const limit = limits[name];
  let limitStr = limit ? fmt(limit) : '(unset)';
  if (limit && g > limit) {
    failed = true;
    limitStr += ' ✖';
  }
  console.log(`  ${pad(name, 20)}${pad(fmt(g), 12)}${pad(fmt(r), 12)}${limitStr}`);
}

console.log('');
if (failed) {
  console.error('✖ size budget exceeded (a fixed limit was breached)');
  process.exit(1);
}
console.log('✔ size budget OK');
