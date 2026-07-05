/**
 * Stage @weave-framework/ui `src/` → `.compiled/` with every COMPONENT module
 * pre-compiled, so the subsequent `tsc -p tsconfig.compiled.json` emits a real,
 * standalone dist: each component ships `export default defineComponent(render, setup)`
 * (+ a typed default in its `.d.ts`).
 *
 * WHY: the ui build is otherwise plain `tsc`, which ships components UNCOMPILED —
 * `export const template`/`export function setup`, no `render`, NO default export. In
 * the monorepo the dev exports resolve to `src` and the loader compiles on the fly, so
 * `import Button from '@weave-framework/ui/button'` works there and MASKS the gap; a real
 * npm consumer gets the uncompiled dist and `weave build`/`weave check` both fail (no
 * default export). This step closes that gap by running the SAME `compileComponent` the
 * loader uses (packages/cli/src/plugin.ts) at build time.
 *
 * A component = a `.ts` that declares an inline `template` (every ui component does).
 * Non-component modules (barrels, `ripple`, `cdk/*`, type-only) are copied verbatim.
 *
 * Child-tag resolution mirrors `injectChildImports` in packages/cli/src/plugin.ts (the
 * loader's source of truth): a template that composes `<Input>` with no explicit import
 * gets `import Input from '../input/input.js'` prepended, resolved by sibling convention.
 */
import { build } from 'esbuild';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(repo, 'packages/ui/src');
const outDir = join(repo, 'packages/ui/.compiled');

// 1. Bundle the compiler so this Node script can call the real loader helpers.
const tmp = mkdtempSync(join(tmpdir(), 'weave-ui-build-'));
const compilerJs = join(tmp, 'compiler.mjs');
await build({
  entryPoints: [join(repo, 'packages/compiler/src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: compilerJs,
});
const { compileComponent, extractSources, childImportCandidates } = await import(pathToFileURL(compilerJs).href);

/* ── child-tag resolution — mirrors packages/cli/src/plugin.ts ── */

function stripComments(code) {
  let out = '';
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    const d = code[i + 1];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        const ch = code[i];
        if (ch === '\\') {
          out += ch + (code[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += ch;
        i++;
        if (ch === quote) break;
      }
      continue;
    }
    if (c === '/' && d === '/') {
      while (i < n && code[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function importsBinding(script, name) {
  if (!script) return false;
  const code = stripComments(script);
  const word = new RegExp(`\\b${name}\\b`);
  const IMPORT = /import\s+([^;]*?)\s+from\s+['"][^'"]+['"]/g;
  let m;
  while ((m = IMPORT.exec(code)) !== null) {
    if (word.test(m[1])) return true;
  }
  return false;
}

function resolveChildModule(tag, dir) {
  for (const cand of childImportCandidates(tag)) {
    for (const ext of ['.ts', '.weave']) {
      if (existsSync(resolve(dir, cand + ext))) return cand;
    }
  }
  return null;
}

function injectChildImports(code, components, dir, script, filename) {
  const imports = [];
  for (const tag of components) {
    if (importsBinding(script, tag)) continue;
    const cand = resolveChildModule(tag, dir);
    if (cand === null) {
      throw new Error(
        `weave: ${filename} composes <${tag}> but no sibling module was found for it.`
      );
    }
    imports.push(`import ${tag} from ${JSON.stringify(cand + '.js')};`);
  }
  return imports.length ? imports.join('\n') + '\n' + code : code;
}

/* ── per-component compile ── */

const HAS_SETUP = /export\s+(?:async\s+)?function\s+setup\b|export\s+(?:const|let|var)\s+setup\b/;

/** Replace compileComponent's plain default with a props-typed default so `weave check`
 *  (and TS consumers) see `import X from '…/x'` as a callable whose first param is the
 *  component's props. `Parameters<typeof setup>[0]` derives the props from the module's
 *  own setup, so one substitution fits every component. */
function typeDefault(code, hasSetup) {
  const propsType = hasSetup ? 'Parameters<typeof setup>[0]' : 'Record<string, unknown>';
  const call = hasSetup ? 'defineComponent(render, setup)' : 'defineComponent(render)';
  const typed =
    `const _weaveDefault = ${call} as unknown as ` +
    `(props: ${propsType}, slots?: Record<string, () => unknown>) => unknown;\n` +
    `export default _weaveDefault;`;
  const plain = `export default ${call};`;
  if (!code.endsWith(plain)) {
    throw new Error(`weave: unexpected compileComponent tail — cannot inject typed default`);
  }
  return code.slice(0, -plain.length) + typed;
}

let componentCount = 0;

/** Compile one component `.ts` (inline template) to its staged module text. */
function compileOne(tsPath, source, decl) {
  const dir = dirname(tsPath);
  const { code, components } = compileComponent(
    { script: decl.script, template: decl.template, styles: undefined },
    { filename: tsPath }
  );
  const wired = injectChildImports(code, components, dir, decl.script, tsPath);
  const hasSetup = HAS_SETUP.test(decl.script);
  componentCount++;
  // The compiler-generated `render` is untyped JS (in the loader path esbuild strips
  // types without checking it); type-checking of the real source is the `typecheck`
  // gate's job on src/. This staged tree is EMIT-ONLY, so silence tsc's checks on it —
  // declaration emit (the typed default, setup, exported types) still runs.
  return '// @ts-nocheck\n' + typeDefault(wired, hasSetup);
}

/* ── stage the tree ── */

function walk(dir, onFile) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, onFile);
    else onFile(full);
  }
}

rmSync(outDir, { recursive: true, force: true });

walk(srcDir, (full) => {
  // Skip test files — the build excludes them.
  if (/\.(browser|test|spec)\.ts$/.test(full)) return;
  const rel = relative(srcDir, full);
  const dest = join(outDir, rel);
  mkdirSync(dirname(dest), { recursive: true });

  if (!full.endsWith('.ts')) {
    cpSync(full, dest);
    return;
  }
  const source = readFileSync(full, 'utf8');
  const decl = extractSources(source);
  // A component declares an inline template; everything else is an ordinary module.
  if (decl.template === undefined) {
    cpSync(full, dest);
    return;
  }
  writeFileSync(dest, compileOne(full, source, decl));
});

process.stdout.write(`\n✓ staged @weave-framework/ui → .compiled/ (${componentCount} components compiled)\n`);
