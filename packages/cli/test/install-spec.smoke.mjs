/**
 * A package spec from a migrated repository must never reach a shell as an operator.
 *
 * `weave migrate` offers to install what the converted app now needs, and the specs are discovered from
 * the repository being migrated — which is, by definition, code the user did not write. `runInstall`
 * builds a single shell line (unavoidable: on Windows the package managers are `.cmd` shims), so what
 * keeps it safe is the grammar every spec is checked against, and nothing else.
 *
 * That grammar allowed `|`, spaces, `<` and `>` in the version part, because semver ranges use them —
 * and so does a shell. `pkg@|| calc` passed the check, which means it did NOT appear in the refused
 * list, which means the user saw an ordinary install prompt and one `y` ran the command. The guard
 * existed and its own comment named this exact threat; the character set was where it leaked.
 *
 * A range that needs `||` or a space is now refused rather than quoted: refusing is a message the user
 * reads, and quoting is a thing that has to stay right forever.
 *
 * Run: `node packages/cli/test/install-spec.smoke.mjs` (wired into `pnpm verify:install-spec`).
 */
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error('X ' + msg);
    failed++;
  } else console.log('+ ' + msg);
};

console.log('\npackages/cli/test/install-spec.smoke.mjs');

const bundle = join(repo, 'tools', '.verify-install-spec-bundle.mjs');
await build({
  entryPoints: [join(repo, 'packages/cli/src/migrate-convert.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
  external: ['esbuild', 'typescript', 'sass'],
});
const { checkSpecs } = await import(pathToFileURL(bundle).href);

const allowed = (spec) => checkSpecs([spec]).safe.length === 1;

/* ── What must keep working, or this is just a way to refuse everything ── */
for (const spec of ['lodash', '@scope/pkg', 'pkg@1.2.3', '@scope/pkg@^2.0.0', 'pkg@~1.2', 'pkg@1.2.3-beta.1']) {
  ok(allowed(spec), `an ordinary spec is allowed: ${spec}`);
}

/* ── What must never reach a shell ── */
const NL = String.fromCharCode(10);
const TAB = String.fromCharCode(9);
for (const [what, spec] of [
  ['a command separator', 'pkg; calc'],
  ['an AND chain', 'pkg && calc'],
  ['an OR chain in the version', 'pkg@|| calc'],
  ['a pipe in the version', 'pkg@ | calc'],
  ['a pipe after a range', 'pkg@>=1 |calc'],
  ['a redirect', 'pkg@1 > out'],
  ['a backtick', 'pkg`calc`'],
  ['a subshell', 'pkg$(calc)'],
  ['a newline', 'pkg' + NL + 'calc'],
  ['a tab', 'pkg@1' + TAB + 'calc'],
  ['a quote', "pkg' ; calc; '"],
  ['a flag', '--registry=http://evil'],
  ['a path', '../../etc/passwd'],
  ['a URL', 'http://evil/x.tgz'],
  ['a bare space in the version', 'pkg@1 2'],
]) {
  ok(!allowed(spec), `${what} is refused: ${JSON.stringify(spec)}`);
}

rmSync(bundle, { force: true });

console.log('\n----------------------------------------');
if (failed) {
  console.error(`install-spec smoke FAILED (${failed})\n`);
  process.exit(1);
}
console.log('install-spec smoke passed\n');
