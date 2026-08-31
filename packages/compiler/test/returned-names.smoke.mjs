/**
 * A comment inside `setup`'s returned object must not hide the whole return.
 *
 * `extractReturnedNames` reads what a component hands out, and the resumable target needs it: a module
 * import handed straight out — a `use:` action, typically — can only be shown to survive to the client
 * if it is known to be returned. When the reader cannot parse the return it answers `null`, meaning
 * "assume nothing", and the component is refused and client-rendered.
 *
 * It answered `null` for any return object containing a COMMENT. `objectKeys` tests each entry against
 * an identifier pattern and bails on anything it does not recognise — which is the right instinct for a
 * spread or a computed key, and wrong for a note somebody left beside a value.
 *
 * It took ten rounds of guessing to find, and none of them found it: every probe was written by someone
 * who does not put comments inside a return object. Four real applications did. This is the fixture
 * that would have found it in one.
 *
 * Run: `node packages/compiler/test/returned-names.smoke.mjs` (wired into `pnpm verify:returned-names`).
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

console.log('\npackages/compiler/test/returned-names.smoke.mjs');

const bundle = join(repo, 'tools', '.verify-returned-names-bundle.mjs');
await build({
  entryPoints: [join(repo, 'packages/compiler/src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
  external: ['esbuild', 'typescript', 'sass'],
});
const { extractReturnedNames } = await import(pathToFileURL(bundle).href);

const setupWith = (body) => `export function setup() {\n  return {\n${body}  };\n}\n`;
const names = (body) => {
  const r = extractReturnedNames(setupWith(body));
  return r === null ? null : [...r].sort();
};

const WANT = ['label', 'tooltip'];
ok(
  JSON.stringify(names('    label,\n    tooltip,\n')) === JSON.stringify(WANT),
  'a plain return is read (control — everything below is measured against this)'
);

for (const [what, body] of [
  ['a note on its own line', '    // what this is for\n    label,\n    tooltip,\n'],
  ['a block comment', '    /* what this is for */\n    label,\n    tooltip,\n'],
  ['a note after a member', '    label,\n    tooltip, // the action\n'],
  ['a note between members', '    label,\n    // the action\n    tooltip,\n'],
  ['a multi-line block comment', '    /**\n     * what this is for\n     */\n    label,\n    tooltip,\n'],
]) {
  ok(JSON.stringify(names(body)) === JSON.stringify(WANT), `${what} does not hide the return: ${JSON.stringify(names(body))}`);
}

// The refusals that must survive, or "reads the return" is satisfied by a reader that accepts anything.
ok(names('    ...rest,\n    label,\n') === null, 'a spread still yields null — the full key set is not knowable');
ok(names('    [key]: 1,\n    label,\n') === null, 'and so does a computed key');

rmSync(bundle, { force: true });

console.log('\n----------------------------------------');
if (failed) {
  console.error(`returned-names smoke FAILED (${failed})\n`);
  process.exit(1);
}
console.log('returned-names smoke passed\n');
