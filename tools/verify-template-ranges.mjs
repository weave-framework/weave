/**
 * Guard: the scaffold must install the version being released.
 *
 * `create-weave` writes a template `package.json` whose `@weave-framework/*` ranges are caret-pinned. Those
 * ranges are a SEPARATE fact from the lockstep version, and nothing tied them together — so when 2.0.0
 * shipped, the template still said `^1.0.0`, a caret does not cross a major, and `npm create weave@latest`
 * kept installing 1.8.0. Every fix in the major, including two security fixes, was invisible to exactly the
 * people most likely to be affected: brand-new projects.
 *
 * The dry run cannot see this (it packs, it does not resolve), and neither can the browser suite (its bundler
 * resolves workspace paths directly). It was caught by the post-publish end-to-end scaffold, once — this
 * makes it a gate that runs before.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version;
const major = version.split('.')[0];

const tplPath = join(repo, 'packages/create-weave/template/package.json');
const tpl = JSON.parse(readFileSync(tplPath, 'utf8'));

console.log('\ntools/verify-template-ranges.mjs');

const problems = [];
for (const field of ['dependencies', 'devDependencies']) {
  for (const [name, range] of Object.entries(tpl[field] ?? {})) {
    if (!name.startsWith('@weave-framework/')) continue;
    const wanted = `^${major}.0.0`;
    if (range !== wanted) problems.push(`  ${field}.${name}: "${range}" — expected "${wanted}"`);
  }
}

if (problems.length) {
  console.error(`x the scaffold template does not track the release major (${version}):\n`);
  for (const p of problems) console.error(p);
  console.error(
    '\n  A caret range does not cross a major, so a scaffolded app would install the PREVIOUS major and\n' +
      '  miss everything in this release. Update packages/create-weave/template/package.json.\n'
  );
  process.exit(1);
}
console.log(`ok  scaffold template tracks ${version} (all @weave-framework/* ranges are ^${major}.0.0)\n`);
