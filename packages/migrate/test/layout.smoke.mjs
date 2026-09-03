/**
 * Node smoke for the migration UI's layout and folder folding — nothing is drawn off the canvas.
 *
 * The layout's own comment says a diagram that quietly omits things cannot be trusted about the things it does
 * show, and then it listed the kinds it would rescue: `component` and `ngmodule`. When folder groups arrived
 * they matched neither, so three cards standing for 77 nodes vanished from a 20-card canvas with no error
 * anywhere — the picture simply looked finished. Only counting caught it.
 *
 * So this gate asserts the property rather than any particular kind: every node in the graph handed to
 * `layout` comes back with a position, whatever it is.
 *
 * It also covers what folding is FOR — fewer cards, all edges preserved as relationships between what is
 * left, and a way back to every group.
 *
 * Run: `node packages/migrate/test/layout.smoke.mjs` (wired as `pnpm verify:migrate-layout`).
 */
import { build as esbuild } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rmSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`);
  if (!cond) failures++;
};

console.log('\nverify:migrate-layout — every node gets a place, and folding keeps the graph honest\n');

const bundles = {};
for (const [name, entry] of [
  ['layout', join(repo, 'packages', 'migrate', 'ui', 'src', 'app', 'layout.ts')],
  ['group', join(repo, 'packages', 'migrate', 'ui', 'src', 'app', 'group.ts')],
]) {
  const out = join(here, `.layout.${name}.mjs`);
  await esbuild({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, packages: 'external' });
  bundles[name] = await import(pathToFileURL(out).href);
}
const { layout } = bundles.layout;
const { collapse } = bundles.group;

/* A graph shaped like a real one: a route spine, plus three folders of nodes hanging off it, plus a folder
   nothing on the spine points at — which is the case that was silently dropped. */
const node = (id, kind, folder) => ({ id, kind, label: id, detail: '', weight: 1, ...(folder ? { folder } : {}) });
const graph = {
  root: '/ws',
  nodes: [
    node('module:app', 'module'),
    node('route:home', 'route'),
    node('route:admin', 'route'),
    node('component:Home', 'component', 'app/home'),
    node('component:HomeCard', 'component', 'app/home'),
    node('component:Admin', 'component', 'app/admin'),
    node('service:Api', 'service', 'services/api'),
    node('service:Auth', 'service', 'services/auth'),
    // Reached by nothing structural — the shape that used to disappear.
    node('component:Orphan', 'component', 'orphans'),
    node('external:HttpClient', 'external'),
  ],
  edges: [
    { from: 'module:app', to: 'route:home', kind: 'child' },
    { from: 'module:app', to: 'route:admin', kind: 'child' },
    { from: 'route:home', to: 'component:Home', kind: 'renders' },
    { from: 'route:admin', to: 'component:Admin', kind: 'renders' },
    { from: 'component:Home', to: 'component:HomeCard', kind: 'uses' },
    { from: 'component:Home', to: 'service:Api', kind: 'injects' },
    { from: 'component:Admin', to: 'service:Api', kind: 'injects' },
    { from: 'component:Admin', to: 'service:Auth', kind: 'injects' },
    { from: 'service:Api', to: 'external:HttpClient', kind: 'injects' },
  ],
};

// ── the property that was broken: everything gets a place, folded or not.
const flat = layout(graph);
ok(flat.nodes.length === graph.nodes.length,
   `unfolded: every node is placed (${flat.nodes.length}/${graph.nodes.length})`);

const folded = collapse(graph, new Set());
const drawn = layout(folded.graph);
ok(drawn.nodes.length === folded.graph.nodes.length,
   `folded: every node is placed (${drawn.nodes.length}/${folded.graph.nodes.length})`);

const missing = folded.graph.nodes.filter((n) => !drawn.nodes.some((p) => p.id === n.id)).map((n) => n.id);
ok(missing.length === 0, missing.length ? `left off the canvas: ${missing.join(', ')}` : 'no node is left off the canvas');

// The group nothing points at is the specific regression: it must be on the canvas like any other.
ok(drawn.nodes.some((n) => n.id === 'group:orphans'),
   'a folder nothing structural points at is still drawn');

// ── what folding is for.
ok(folded.graph.nodes.length < graph.nodes.length,
   `folding reduces the card count (${graph.nodes.length} -> ${folded.graph.nodes.length})`);
const groupCards = folded.graph.nodes.filter((n) => n.kind === 'group');
ok(groupCards.length === folded.groups.length,
   `one card per folder (${groupCards.length} cards, ${folded.groups.length} folders)`);
ok(folded.groups.every((g) => g.total > 0 && g.members.length === g.total),
   'each folder reports what it holds');

// An edge inside one folder is that folder's business; an edge between two becomes a link between the cards.
ok(!folded.graph.edges.some((e) => e.from === e.to), 'no folder links to itself');
const apiCard = folded.graph.nodes.find((n) => n.id === 'group:services');
ok(apiCard !== undefined, 'services fold into one card');
ok(folded.graph.edges.some((e) => e.to === 'group:services'),
   'the folder is still reachable — the edges into its members became edges into it');

// Opening a folder swaps its card for its members, and everything still gets placed.
const opened = collapse(graph, new Set(['app']));
ok(!opened.graph.nodes.some((n) => n.id === 'group:app'), 'an opened folder has no card of its own');
ok(opened.graph.nodes.some((n) => n.id === 'component:Home'), 'an opened folder shows its members');
const openDrawn = layout(opened.graph);
ok(openDrawn.nodes.length === opened.graph.nodes.length,
   `opened: every node is placed (${openDrawn.nodes.length}/${opened.graph.nodes.length})`);

for (const name of ['layout', 'group']) rmSync(join(here, `.layout.${name}.mjs`), { force: true });
console.log(`\n${failures ? `${failures} failing` : 'all green'}\n`);
process.exit(failures ? 1 : 0);
