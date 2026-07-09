/**
 * Node smoke test for the Weave editor tooling — a component `.ts` that imports a
 * child component used ONLY in its sibling `.html` template must NOT be reported as
 * an "unused import". The virtual the plugin feeds tsserver (built by
 * `@weave-framework/check/emit`) appends a template harness that references each
 * component tag as `typeof Tag`, so the import is genuinely used and `noUnusedLocals`
 * stays quiet — which is what lets an author drop the `void Tag;` keep-alive lines.
 *
 * Two cases isolate the harness's effect under `noUnusedLocals`:
 *   1. child used in the template (no `void`)  → ZERO "declared but never read";
 *   2. child imported but used NOWHERE          → still reported (control — proves
 *      the check is actually on and the test would catch a regression).
 *
 * Run: `node packages/typescript-plugin/test/unused-import.smoke.mjs` (verify:tsplugin).
 */
import { build as esbuild } from 'esbuild';
import ts from 'typescript';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`);
  if (!cond) failures++;
};

const cacheDir = join(repo, 'node_modules', '.weave');
mkdirSync(cacheDir, { recursive: true });
const out = join(cacheDir, 'emit-for-unused-test.mjs');
await esbuild({
  entryPoints: [join(repo, 'packages', 'check', 'src', 'emit.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  external: ['typescript'],
  outfile: out,
});
const { buildVirtualSeparate } = await import(pathToFileURL(out).href);

console.log('\npackages/typescript-plugin/test/unused-import.smoke.mjs');

const OPTIONS = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  types: [],
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  esModuleInterop: true,
  noUnusedLocals: true, // the whole point — the editor's unused-import check
};

/**
 * Type-check a component `page.ts` (its virtual, WITH the template harness) next to a
 * real `foo.ts` module, under noUnusedLocals. Returns the "declared but never read"
 * diagnostics for the page.
 */
function unusedDiagsFor(pageSrc, htmlSrc) {
  const dir = mkdtempSync(join(tmpdir(), 'weave-unused-'));
  const pagePath = resolve(dir, 'page.ts');
  const htmlPath = resolve(dir, 'page.html');
  const fooPath = resolve(dir, 'foo.ts');
  writeFileSync(fooPath, `export default function Foo(_props: Record<string, never>): unknown { return null; }\n`);
  const v = buildVirtualSeparate(pagePath, pageSrc, htmlPath, htmlSrc);

  const host = ts.createCompilerHost(OPTIONS, true);
  const realGetSourceFile = host.getSourceFile.bind(host);
  const norm = (p) => p.replace(/\\/g, '/').toLowerCase();
  host.getSourceFile = (fileName, lv, onError, shouldCreate) => {
    if (norm(fileName) === norm(pagePath)) return ts.createSourceFile(fileName, v.text, lv, true);
    return realGetSourceFile(fileName, lv, onError, shouldCreate);
  };
  const realReadFile = host.readFile.bind(host);
  host.readFile = (f) => (norm(f) === norm(pagePath) ? v.text : realReadFile(f));

  const program = ts.createProgram([pagePath, fooPath], OPTIONS, host);
  const sf = program.getSourceFile(pagePath);
  const diags = program.getSemanticDiagnostics(sf);
  rmSync(dir, { recursive: true, force: true });
  // 6133: 'X' is declared but its value is never read. We care only about the IMPORT
  // (`Foo`) — the harness's own `__weave__` fn is unmapped scaffolding the editor never
  // surfaces on the user's `.ts`, so it isn't part of what an author sees.
  return diags.filter((d) => d.code === 6133 && /\bFoo\b/.test(ts.flattenDiagnosticMessageText(d.messageText, '\n')));
}

// 1. Foo used only in the template — no `void Foo` — must not be flagged unused.
{
  const diags = unusedDiagsFor(
    `import Foo from './foo';\nexport function setup() { const x = 1; return { x }; }\n`,
    `<Foo /><b>{{ x }}</b>\n`
  );
  ok(diags.length === 0, `a template-only component import is NOT reported unused (no \`void\` needed) — got ${diags.length}`);
  if (diags.length) for (const d of diags) console.log(`      · ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
}

// 2. Control: Foo imported but used nowhere (template doesn't name it) — still flagged,
//    proving noUnusedLocals is active and the test would catch a regression.
{
  const diags = unusedDiagsFor(
    `import Foo from './foo';\nexport function setup() { const x = 1; return { x }; }\n`,
    `<b>{{ x }}</b>\n`
  );
  ok(diags.length >= 1, `a genuinely-unused import IS still reported (control) — got ${diags.length}`);
}

console.log(failures ? `\n✖ ${failures} check failure(s)` : '\n✔ unused-import smoke passed');
process.exit(failures ? 1 : 0);
