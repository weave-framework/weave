/**
 * Audit the documentation against the code, in both directions.
 *
 * The docs have been maintained by editing them, which answers "is this page good?" and never answers
 * "is this page still true?". Those are different questions and only one of them has been asked. This
 * asks the other one, from the source outwards:
 *
 *   1. DEAD IMPORTS  — every symbol a docs code block imports from `@weave-framework/*` must be a real
 *                      export of that package. A renamed or removed API leaves a snippet that cannot
 *                      run, and nothing on the page looks wrong.
 *   2. COVERAGE      — every public export, split by who it is FOR. An app author's API that no page
 *                      names is a capability nobody can discover; a compiler internal is not.
 *   3. TEMPLATE      — every block keyword and binding prefix the parser accepts, against the docs.
 *   4. CLI           — every command and flag the CLI prints, against the docs.
 *
 * Read-only. It reports; it changes nothing.
 *
 * Run: `node tools/audit-docs.mjs [--section=imports|coverage|template|cli]`
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, sep, dirname } from 'node:path';

const only = (process.argv.find((a) => a.startsWith('--section=')) ?? '').split('=')[1];
const want = (name) => !only || only === name;

/* ────────────────────────────── the corpus ────────────────────────────── */

const docFiles = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const f = join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (e.name.endsWith('.md')) docFiles.push(f);
  }
})('docs/src/content');

const rel = (f) => f.split(sep).join('/');
const docs = docFiles.map((f) => ({ file: rel(f), text: readFileSync(f, 'utf8') }));
const corpusWords = new Set();
for (const d of docs) for (const t of d.text.split(/[^A-Za-z0-9_$]+/)) corpusWords.add(t);
// The generated reference is documentation a reader reads, so it counts. Leaving it out reported the CDK
// as 27% covered on the same day its 102 exports were published to /reference/ui-cdk with signatures.
// Prose pages and the reference answer different questions, but "does any page name this" is one bar.
for (const gen of ['docs/src/content/api.gen.ts']) {
  if (existsSync(gen)) for (const t of readFileSync(gen, 'utf8').split(/[^A-Za-z0-9_$]+/)) corpusWords.add(t);
}

/* ─── every export of every package, read from its source index ─── */

const packages = readdirSync('packages').filter((p) => existsSync(`packages/${p}/package.json`));

/**
 * Every name an entry file exports, following `export * from` and `export { … } from`.
 *
 * ONE walker for both the package root and its sub-paths. Two of them was the bug: the sub-path version
 * did not follow `export *`, so `@weave-framework/ui/cdk` — which is nothing but twenty `export *` lines
 * — appeared to export nothing, and `dropList`, `moveItemInArray` and `DropEvent` were reported dead on
 * pages where they work.
 */
function namesFrom(entry) {
  const names = new Map(); // name -> the file that exports it
  const seen = new Set();
  (function walk(f) {
    if (seen.has(f) || !existsSync(f)) return;
    seen.add(f);
    const src = readFileSync(f, 'utf8');
    // `export type { … } from` counts too. Missing the `type` keyword made `MenuItem` — re-exported on
    // menu.ts line 22 — look absent, and reported a working snippet as broken.
    for (const m of src.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}(?:\s*from\s*'([^']+)')?/g)) {
      for (const part of m[1].split(',')) {
        const n = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop().trim();
        if (n && /^[A-Za-z_$]/.test(n)) names.set(n, f);
      }
    }
    for (const m of src.matchAll(/export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) {
      // `@internal` is not a documentation gap, it is a declaration that this is not for readers — the
      // API generator already honours it. Without this the audit demanded pages for `ifBlock`,
      // `adoptText` and `AdoptCursor`, which only the compiler's own output ever calls.
      const before = src.slice(Math.max(0, m.index - 400), m.index);
      const doc = before.lastIndexOf('/**');
      if (doc !== -1 && before.slice(doc).includes('@internal') && !before.slice(doc).includes('*/\n\n')) continue;
      names.set(m[1], f);
    }
    for (const m of src.matchAll(/export\s*\*\s*from\s*'([^']+)'/g)) {
      walk(join(dirname(f), m[1].replace(/\.js$/, '') + '.ts'));
    }
  })(entry);
  return names;
}

/** A package's own entry file, from its `exports['.']` — `@weave-framework/cli` has no `src/index.ts`. */
function rootEntry(pkg) {
  const pj = JSON.parse(readFileSync(`packages/${pkg}/package.json`, 'utf8'));
  const dot = pj.exports?.['.'];
  const target = typeof dot === 'string' ? dot : (dot?.types ?? dot?.import ?? dot?.default);
  if (typeof target === 'string' && target.endsWith('.ts')) return join(`packages/${pkg}`, target.replace(/^\.\//, ''));
  return existsSync(`packages/${pkg}/src/index.ts`) ? `packages/${pkg}/src/index.ts` : null;
}

const api = new Map(); // pkg -> Map(name -> file)
for (const p of packages) {
  const entry = rootEntry(p);
  if (entry) api.set(p, namesFrom(entry));
}

/**
 * Sub-path entries a package ships (`@weave-framework/ui/dialog`), resolved through the package's own
 * `exports` map rather than a guessed path convention.
 *
 * Guessing was the first version and it invented 74 "dead imports" out of correct documentation: UI
 * components live at `src/dialog/dialog.ts`, and `src/dialog.ts` does not exist. The package.json IS the
 * contract, so it is what gets read.
 */
function subpathExports(pkg) {
  const pj = JSON.parse(readFileSync(`packages/${pkg}/package.json`, 'utf8'));
  const out = new Map();
  for (const [key, value] of Object.entries(pj.exports ?? {})) {
    if (key === '.' || key === './package.json') continue;
    const target = typeof value === 'string' ? value : (value.types ?? value.import ?? value.default);
    if (typeof target !== 'string' || !target.endsWith('.ts')) continue;
    const src = join(`packages/${pkg}`, target.replace(/^\.\//, ''));
    if (!existsSync(src)) continue;
    const names = namesFrom(src);
    const text = readFileSync(src, 'utf8');
    // A Weave COMPONENT module has no `export default` in its source — the compiler synthesizes one
    // (`defineComponent(render, setup)`). Testing the source text for `export default` reported that
    // `@weave-framework/ui/button` has none, on 248 lines of correct documentation. A module is
    // default-importable when it is a component: a sibling template, or a `template`/`setup` export.
    const isComponent =
      existsSync(src.replace(/\.ts$/, '.html')) ||
      /export\s+const\s+template\b/.test(text) ||
      /export\s+(?:async\s+)?(?:function|const)\s+setup\b/.test(text);
    if (isComponent || /export\s+default/.test(text)) names.set('default', src);
    out.set(key.replace(/^\.\//, ''), names);
  }
  return out;
}

const pkgName = (p) => (p === 'create-weave' ? 'create-weave' : `@weave-framework/${p}`);
const byImportPath = new Map(); // '@weave-framework/runtime/dom' -> Set(names)
for (const p of packages) {
  if (!api.has(p)) continue; // no resolvable entry (a private package with no exports map)
  byImportPath.set(pkgName(p), new Set(api.get(p).keys()));
  for (const [sub, names] of subpathExports(p)) {
    byImportPath.set(`${pkgName(p)}/${sub}`, new Set(names.keys()));
  }
}

let problems = 0;

/* ───────────────────────── 1. dead imports ───────────────────────── */

if (want('imports')) {
  console.log('\n=== 1. Symbols the docs import that the package does not export ===\n');
  const dead = [];
  for (const { file, text } of docs) {
    text.split(/\r?\n/).forEach((line, i) => {
      for (const m of line.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'(@weave-framework\/[a-z-]+(?:\/[a-z-]+)?)'/g)) {
        const known = byImportPath.get(m[2]);
        if (!known) {
          dead.push({ file, line: i + 1, what: `the path '${m[2]}' is not a package entry` });
          continue;
        }
        for (const part of m[1].split(',')) {
          const n = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
          if (n && !known.has(n)) dead.push({ file, line: i + 1, what: `'${n}' is not exported by ${m[2]}` });
        }
      }
      // A default import of a component: `import Button from '@weave-framework/ui/button'`.
      for (const m of line.matchAll(/import\s+[A-Z][\w$]*\s+from\s*'(@weave-framework\/[a-z-]+\/[a-z0-9-]+)'/g)) {
        const known = byImportPath.get(m[1]);
        if (!known) dead.push({ file, line: i + 1, what: `the path '${m[1]}' is not a package entry` });
        else if (!known.has('default')) dead.push({ file, line: i + 1, what: `'${m[1]}' has no default export` });
      }
    });
  }
  if (dead.length) {
    for (const d of dead) console.log(`  ${d.file}:${d.line}  ${d.what}`);
    problems += dead.length;
  } else console.log('  none — every documented import resolves to a real export.');
  console.log(`\n  ${dead.length} dead import(s)`);
}

/* ───────────────────────── 2. coverage, by audience ───────────────────────── */

/* Packages an APP AUTHOR imports. The rest (compiler, check, mcp, nx, plugins, language-server) are
   tooling: their exports are consumed by editors and build steps, and an undocumented one is not a
   capability a reader is missing. Counting them together is what produced "160 undocumented" — a number
   that sounds alarming and cannot be acted on. */
const APP_FACING = ['runtime', 'router', 'store', 'forms', 'i18n', 'data', 'ui'];

if (want('coverage')) {
  console.log('\n=== 2. Public API an app author can use, and whether any page names it ===\n');
  let missTotal = 0;
  for (const p of APP_FACING) {
    // The package root AND every sub-path it publishes. Root-only was a real blind spot: it reported
    // `@weave-framework/ui` as 5 exports, because its 52 CDK primitives live behind `./cdk`, and the CDK
    // is 87% undocumented. The audit was under-reporting the largest gap in the documentation.
    const names = [...api.get(p).keys()];
    for (const [, sub] of subpathExports(p)) for (const n of sub.keys()) if (n !== 'default' && !names.includes(n)) names.push(n);
    const missing = names.filter((n) => !corpusWords.has(n));
    missTotal += missing.length;
    const pct = names.length ? Math.round(((names.length - missing.length) / names.length) * 100) : 100;
    console.log(`  ${pkgName(p).padEnd(28)} ${String(names.length - missing.length).padStart(3)}/${String(names.length).padEnd(3)} named  (${pct}%)`);
    if (missing.length) console.log(`      missing: ${missing.join(', ')}`);
  }
  console.log(`\n  ${missTotal} app-facing export(s) no page names`);
  problems += missTotal;

  console.log('\n  (tooling packages, for reference — an undocumented export here is not a reader-facing gap)');
  for (const p of packages.filter((x) => !APP_FACING.includes(x) && api.has(x))) {
    const names = [...api.get(p).keys()];
    const missing = names.filter((n) => !corpusWords.has(n));
    console.log(`    ${pkgName(p).padEnd(30)} ${String(missing.length).padStart(3)} of ${names.length} unnamed`);
  }
}

/* ───────────────────────── 3. template surface ───────────────────────── */

if (want('template')) {
  console.log('\n=== 3. Template blocks and binding prefixes the parser accepts ===\n');
  const lint = readFileSync('packages/compiler/src/lint.ts', 'utf8');
  const blocks = [...(lint.match(/const BLOCKS[^;]*;/s)?.[0] ?? '').matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  const prefixes = [...(lint.match(/const WEAVE_PREFIXES[^;]*;/s)?.[0] ?? '').matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  const syntax = docs.find((d) => d.file.endsWith('reference/template-syntax.md'))?.text ?? '';
  const templates = docs.find((d) => d.file.endsWith('learn/templates.md'))?.text ?? '';
  const both = syntax + templates;

  const missBlocks = blocks.filter((b) => !new RegExp(`@${b}\\b`).test(both));
  const missPrefix = prefixes.filter((p) => !new RegExp(`${p}:`).test(both));
  console.log(`  blocks:   ${blocks.length} accepted, ${missBlocks.length} undocumented${missBlocks.length ? ' → ' + missBlocks.map((b) => '@' + b).join(', ') : ''}`);
  console.log(`  prefixes: ${prefixes.length} accepted, ${missPrefix.length} undocumented${missPrefix.length ? ' → ' + missPrefix.map((p) => p + ':').join(', ') : ''}`);
  problems += missBlocks.length + missPrefix.length;
}

/* ───────────────────────── 4. CLI surface ───────────────────────── */

if (want('cli')) {
  console.log('\n=== 4. CLI commands and flags, against the docs ===\n');
  const cli = readFileSync('packages/cli/src/cli.ts', 'utf8');
  const help = cli.match(/commands([\s\S]*?)options([\s\S]*?)(examples|`;)/);
  const commands = help ? [...help[1].matchAll(/^\s{2}([a-z]+)[\s[]/gm)].map((m) => m[1]) : [];
  const flags = help ? [...help[2].matchAll(/(--[a-z-]+)/g)].map((m) => m[1]) : [];
  const tooling = docs.find((d) => d.file.endsWith('learn/tooling.md'))?.text ?? '';
  const config = docs.find((d) => d.file.endsWith('reference/config.md'))?.text ?? '';
  const both = tooling + config;

  const missCmd = [...new Set(commands)].filter((c) => !new RegExp(`weave ${c}\\b`).test(both));
  const missFlag = [...new Set(flags)].filter((f) => !both.includes(f));
  console.log(`  commands: ${new Set(commands).size} printed, ${missCmd.length} undocumented${missCmd.length ? ' → ' + missCmd.join(', ') : ''}`);
  console.log(`  flags:    ${new Set(flags).size} printed, ${missFlag.length} undocumented${missFlag.length ? ' → ' + missFlag.join(', ') : ''}`);
  problems += missCmd.length + missFlag.length;
}

console.log(`\n────────────────────────────────────────\n${problems} item(s) to act on\n`);
