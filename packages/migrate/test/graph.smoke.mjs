/**
 * Node smoke for `@weave-framework/migrate` graph keys — the folder each node is grouped by.
 *
 * The graph draws 227 cards for one real application, and no arrangement of that many makes a picture worth
 * reading. Grouping is the answer, and the folder a file lives in is the axis: measured, it covers 170 of the
 * 227 nodes and its first level separates the application from the shared component and service libraries.
 * (Angular's lazy boundaries were measured first and reach only 57 of the 227, so they group nothing.)
 *
 * Two things make or break that key, and each is guarded here:
 *   root     — the key is relative to the deepest folder holding EVERY file read, not to the analysed unit.
 *              An application reaches into sibling workspace libraries, so half its files sit outside it;
 *              measured against the unit, 110 of 227 nodes fell into one bucket named after the drive letter.
 *   carriers — `src`, `app`, `lib(s)`, `apps`, `projects` are repeated by every workspace and say nothing
 *              about what a file is. Left in, the first level of every group is the word "src".
 *
 * Run: `node packages/migrate/test/graph.smoke.mjs` (wired as `pnpm verify:migrate-graph`).
 */
import { build as esbuild } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rmSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const app = join(here, 'fixtures', 'alias-modules', 'app');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`);
  if (!cond) failures++;
};

console.log('\nverify:migrate-graph — every node carries the folder it is grouped by\n');

const bundles = {};
for (const name of ['analyze', 'graph']) {
  const out = join(here, `.graph.${name}.mjs`);
  await esbuild({
    entryPoints: [join(repo, 'packages', 'migrate', 'src', `${name}.ts`)],
    bundle: true, format: 'esm', platform: 'node', outfile: out, packages: 'external',
  });
  bundles[name] = await import(pathToFileURL(out).href);
}

const facts = bundles.analyze.assembleFactsOpening(app, ['*']);
const graph = bundles.graph.buildGraph(facts);
const at = (label) => graph.nodes.find((n) => n.label === label);

const one = at('OneService');
const two = at('TwoService');
const shell = at('ShellComponent');
const three = at('ThreeService');
ok(one && two && shell && three, `the fixture yields all four nodes (${[one, two, shell, three].filter(Boolean).length}/4)`);

// Every node with a source file gets a key; a node without one (a route, an npm class) gets none.
const sourced = graph.nodes.filter((n) => ['component', 'service', 'ngmodule'].includes(n.kind));
ok(sourced.every((n) => n.folder !== undefined), `every sourced node has a folder key (${sourced.filter((n) => n.folder !== undefined).length}/${sourced.length})`);

// The root is the deepest folder holding EVERY file, so the two module barrels differ by their own name only.
ok(one?.folder === 'modules/one', `the first module keys on its own folder (got "${one?.folder}")`);
ok(two?.folder === 'modules/two', `the second keys on its own, not merged with the first (got "${two?.folder}")`);

// The library OUTSIDE the analysed unit is the case that proves the root is common rather than unit-relative:
// `shared/three` sits beside the application, so a unit-relative key cannot express it without the full path.
ok(three?.folder === 'shared/three', `a library outside the unit keys on its own folder (got "${three?.folder}")`);
ok(!(three?.folder ?? '').includes(':'), 'no key falls back to an absolute path with a drive letter');

// `app` is a carrier: ShellComponent lives in src/app/shell and must key on "shell".
ok(shell?.folder === 'shell', `carrier segments are dropped from the key (got "${shell?.folder}")`);
ok(!sourced.some((n) => (n.folder ?? '').split('/').some((p) => ['src', 'app', 'lib', 'libs', 'apps'].includes(p))),
   'no key contains a carrier segment anywhere');

// The keys must actually separate: one group per module, not everything in one bucket.
const groups = new Set(sourced.map((n) => (n.folder || '(root)').split('/')[0]));
ok(groups.size >= 2, `the keys separate the nodes into groups (${groups.size}: ${[...groups].join(', ')})`);

// The file each node came from travels with it, so the UI can show where a card lives.
ok(one?.file?.endsWith('one.service.ts'), `each node carries its own file (got "${one?.file}")`);

/* A route and the screen it opens are one card.

   Raised by the reader: a route card already prints its component name under the path, and then the
   component gets a card of its own in another colour — one screen drawn twice, and its dependencies a
   second click away. Measured before doing it: no route renders more than one component, and no component
   is rendered by more than one route. But the second case DOES happen, which is why `sharedWith` exists,
   so the merge fires only where it is exactly one to one. The fixture has both shapes. */
const solo = graph.nodes.find((n) => n.component === 'SoloComponent');
ok(solo !== undefined && solo.kind === 'route',
   `the route and its only component are one card (${solo?.kind} "${solo?.label}")`);
ok(!graph.nodes.some((n) => n.label === 'SoloComponent'),
   'and the component has no second card of its own');
ok(solo?.folder === 'screens' && (solo?.file ?? '').endsWith('solo.component.ts'),
   `the merged card carries where the SCREEN lives (${solo?.folder}, ${solo?.file})`);
ok(graph.edges.some((e) => e.from === solo?.id && e.kind === 'injects'),
   'the dependencies of the screen now hang off the route card, one click away instead of two');

ok(graph.nodes.some((n) => n.label === 'SharedComponent'),
   'a component two routes reach keeps its own card — merging it into one of them would hide the other');
const intoShared = graph.edges.filter((e) => e.kind === 'renders' && graph.nodes.find((n) => n.id === e.to)?.label === 'SharedComponent');
ok(intoShared.length === 2,
   `and both routes still point at it (${intoShared.length} renders edges)`);

for (const name of ['analyze', 'graph']) rmSync(join(here, `.graph.${name}.mjs`), { force: true });
console.log(`\n${failures ? `${failures} failing` : 'all green'}\n`);
process.exit(failures ? 1 : 0);
