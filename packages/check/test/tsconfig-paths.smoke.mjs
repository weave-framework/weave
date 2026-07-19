/**
 * `weave check` must honour the project's own tsconfig.
 *
 * The checker used a hardcoded set of compiler options with no `paths` and no `baseUrl`, so every app using
 * path aliases — the norm in a real codebase, and universal in one being migrated from another framework —
 * got "Cannot find module" on every aliased import. A wall of errors produced by the framework's own quality
 * tool, against a project that is actually correct, is the fastest way to get that tool switched off.
 *
 * This builds a throwaway project with a `paths` alias and asserts the alias resolves.
 */
import { build } from 'esbuild';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error(`✖ ${msg}`);
    failed++;
  } else {
    console.log(`✔ ${msg}`);
  }
};

console.log('\npackages/check/test/tsconfig-paths.smoke.mjs');

const outFile = join(repo, 'tools', '.verify-check-paths-bundle.mjs');
await build({
  entryPoints: [join(repo, 'packages/check/src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: outFile,
  external: ['typescript'],
});
const { checkProject } = await import(pathToFileURL(outFile).href);
process.on('exit', () => rmSync(outFile, { force: true }));

const app = mkdtempSync(join(tmpdir(), 'weave-check-paths-'));
mkdirSync(join(app, 'src', 'lib'), { recursive: true });
mkdirSync(join(app, 'src', 'ui'), { recursive: true });

writeFileSync(
  join(app, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        baseUrl: '.',
        paths: { '@lib/*': ['src/lib/*'] },
      },
    },
    null,
    2
  )
);

// The aliased module.
writeFileSync(join(app, 'src', 'lib', 'greet.ts'), 'export function greet(name: string): string {\n  return `hi ${name}`;\n}\n');

// A component importing it through the alias.
writeFileSync(
  join(app, 'src', 'ui', 'hello.ts'),
  "import { greet } from '@lib/greet';\n\nexport function setup() {\n  const text: string = greet('weave');\n  return { text };\n}\n"
);
writeFileSync(join(app, 'src', 'ui', 'hello.html'), '<p>{{ text }}</p>\n');

const diags = checkProject([join(app, 'src')]);
const missing = diags.filter((d) => /Cannot find module/i.test(d.message));

ok(diags.length >= 0, `checkProject ran (${diags.length} diagnostic(s))`);
ok(
  missing.length === 0,
  `an aliased import resolves via the project's tsconfig paths${
    missing.length ? ` — got: ${missing.map((d) => d.message).join(' | ')}` : ''
  }`
);

// And a REAL error must still be reported — the fix must not have made the checker permissive.
writeFileSync(
  join(app, 'src', 'ui', 'broken.ts'),
  "export function setup() {\n  const n: number = 'not a number';\n  return { n };\n}\n"
);
writeFileSync(join(app, 'src', 'ui', 'broken.html'), '<p>{{ n }}</p>\n');
const diags2 = checkProject([join(app, 'src')]);
ok(
  diags2.some((d) => d.category === 'error'),
  'a genuine type error is still reported'
);

rmSync(app, { recursive: true, force: true });

if (failed) {
  console.error(`\n✖ ${failed} check(s) failed\n`);
  process.exit(1);
}
console.log('\n✓ weave check honours the project tsconfig\n');
