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
    // A route WITH a folder: the shape that was being swallowed into a group.
    node('route:profile', 'route', 'app/home'),
    node('component:Home', 'component', 'app/home'),
    node('component:HomeCard', 'component', 'app/home'),
    node('component:Admin', 'component', 'app/admin'),
    node('service:Api', 'service', 'services/api'),
    node('service:Auth', 'service', 'services/auth'),
    // Reached by nothing structural — the shape that used to disappear.
    node('component:Orphan', 'component', 'orphans'),
    node('external:HttpClient', 'external'),
    // Hangs off the ROOT, whose y is the average of its children's rows and therefore off-grid. A card
    // revealed beside it lands on that same off-grid row, a few pixels from one already there — which is
    // an overlap that comparing exact coordinates cannot see.
    node('component:Badge', 'component', 'chrome'),
    node('component:Widget1', 'component', 'widgets'),
    node('component:Widget2', 'component', 'widgets'),
    node('component:Widget3', 'component', 'widgets'),
    node('component:Widget4', 'component', 'widgets'),
    node('component:Widget5', 'component', 'widgets'),
    node('component:Widget6', 'component', 'widgets'),
    node('component:Widget7', 'component', 'widgets'),
    node('component:Widget8', 'component', 'widgets'),
    node('component:Widget9', 'component', 'widgets'),
    node('component:Widget10', 'component', 'widgets'),
    // Ten widgets under one folder, all used by one component: enough cards in one column that a
    // staircase shows up as height, which three cards cannot do.
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
    { from: 'module:app', to: 'component:Badge', kind: 'uses' },
    { from: 'component:Admin', to: 'component:Widget1', kind: 'uses' },
    { from: 'component:Admin', to: 'component:Widget2', kind: 'uses' },
    { from: 'component:Admin', to: 'component:Widget3', kind: 'uses' },
    { from: 'component:Admin', to: 'component:Widget4', kind: 'uses' },
    { from: 'component:Admin', to: 'component:Widget5', kind: 'uses' },
    { from: 'component:Admin', to: 'component:Widget6', kind: 'uses' },
    { from: 'component:Admin', to: 'component:Widget7', kind: 'uses' },
    { from: 'component:Admin', to: 'component:Widget8', kind: 'uses' },
    { from: 'component:Admin', to: 'component:Widget9', kind: 'uses' },
    { from: 'component:Admin', to: 'component:Widget10', kind: 'uses' },
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

/* The route tree is the spine, and folding part of it breaks the picture's whole point. Reported from a
   screenshot: selecting a lazy route showed a link to its parent and nothing else, because its one child was a
   route WITH a component — so it had a folder, and was swallowed into the application's group. */
ok(folded.graph.nodes.some((n) => n.id === 'route:profile'),
   'a route with a folder is drawn, not folded into that folder');
for (const spine of ['route:home', 'route:admin', 'module:app']) {
  ok(folded.graph.nodes.some((n) => n.id === spine), `${spine} is drawn even when folded`);
}
ok(folded.graph.edges.some((e) => e.from === 'route:home' && e.to.startsWith('group:')),
   'a route still links to the folder its component fell into');

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

/* No staircase. Every pass after the route tree places into a column of its own, and they used to share the
   tree's running row counter — so each new column started where the previous one ended and the canvas grew
   downwards forever. Measured on a real application: 95 cards needed 5652 pixels of height, the last column
   beginning at y=3712 with nothing above it. Reported as "labai keistas isdestymas".

   The property is that height follows the TALLEST COLUMN, not the total number of cards. */
const columnsOf = (l) => {
  const by = new Map();
  for (const n of l.nodes) by.set(n.x, [...(by.get(n.x) ?? []), n]);
  return [...by.values()];
};
// Everything open: ten widgets in one column, which is where a staircase becomes visible AS height.
const wideOpen = layout(collapse(graph, new Set(['app', 'widgets', 'services'])).graph);

for (const [name, l] of [["folded", drawn], ["opened", openDrawn], ["all open", wideOpen]]) {
  const cols = columnsOf(l);
  const tallest = Math.max(...cols.map((c) => c.length));
  // Row pitch plus generous room for padding and the separation pass.
  const ceiling = tallest * 120 + 400;
  ok(l.height <= ceiling,
     `${name}: height follows the tallest column, not the card count (${Math.round(l.height)} <= ${ceiling}, ${l.nodes.length} cards in ${cols.length} columns, tallest ${tallest})`);
  const startsHigh = cols.filter((c) => Math.min(...c.map((n) => n.y)) < l.height / 2).length;
  ok(startsHigh === cols.length,
     `${name}: every column starts in the top half (${startsHigh}/${cols.length})`);
}

/* Lighting a selection. The path must be computed on the graph that is DRAWN, not the one behind it.
   Reported as "I selected a route and it shows no dependencies at all": the path was found against the raw
   graph, so it named a component that folding had replaced with its folder card. Every edge on screen then
   failed the "both ends lit" test, and the whole picture dimmed at once. */
const { pathThrough } = bundles.layout;
const drawnIds = new Set(folded.graph.nodes.map((n) => n.id));
const litFolded = pathThrough(folded.graph, 'route:home');
ok([...litFolded].every((id) => drawnIds.has(id)),
   `every lit id is a card on the canvas (${[...litFolded].filter((id) => !drawnIds.has(id)).join(', ') || 'all of them'})`);
ok(litFolded.has('group:app'),
   `the route lights the folder its component fell into (${[...litFolded].join(', ')})`);
const litRaw = pathThrough(graph, 'route:home');
ok([...litRaw].some((id) => !drawnIds.has(id)),
   'the raw graph really does name ids that are not on the folded canvas — so the two are not interchangeable');

// The symptom itself, reproduced: an edge is drawn lit only when BOTH ends are on the path.
const bothEnds = (lit) => folded.graph.edges.filter((e) => lit.has(e.from) && lit.has(e.to)).length;
ok(bothEnds(litFolded) > 0, `selecting a route lights at least one edge (${bothEnds(litFolded)})`);
ok(bothEnds(litRaw) < bothEnds(litFolded),
   `the raw path would light fewer edges on the drawn canvas (${bothEnds(litRaw)} vs ${bothEnds(litFolded)}) — which is the reported blank selection`);

/* Revealing a selection's neighbours. Selecting a card whose neighbours are all folded lit one edge to a
   folder card and looked, in the reader's words, like "nieko nenutiko". The neighbours are lifted out of
   their folders — just them, not the folder's other seventy members. */
const neighbours = new Set(graph.edges.filter((e) => e.from === 'route:home' || e.to === 'route:home')
  .map((e) => (e.from === 'route:home' ? e.to : e.from)));
const revealed = collapse(graph, new Set(), neighbours);
ok(revealed.graph.nodes.some((n) => n.id === 'component:Home'),
   'a folded neighbour of the selection is drawn in its own right');
ok(revealed.graph.nodes.some((n) => n.kind === 'group' && n.folder === 'app'),
   'its folder is still folded — only the neighbour was lifted, not the whole folder');
ok(!revealed.graph.nodes.some((n) => n.id === 'component:HomeCard'),
   'a non-neighbour in that same folder stays folded');
const revealedLit = pathThrough(revealed.graph, 'route:home');
ok(revealedLit.has('component:Home'),
   `the path now names the real neighbour rather than its folder (${[...revealedLit].join(', ')})`);
const appCard = revealed.graph.nodes.find((n) => n.kind === 'group' && n.folder === 'app');
ok(appCard.weight < folded.groups.find((g) => g.key === 'app').total,
   `the folder card counts what is STILL inside it (${appCard.weight} of ${folded.groups.find((g) => g.key === 'app').total})`);

/* Following a link. The links panel names the real neighbour, which may be a card that folding has replaced
   with its folder — so selecting it has to open that folder first, or the trail dead-ends at the moment the
   reader follows it: reported as the panel vanishing on click, selecting nothing. */
const { groupKeyOf } = bundles.group;
const buried = graph.nodes.find((n) => n.id === 'component:HomeCard');
const buriedKey = groupKeyOf(buried);
ok(buriedKey === 'app', `a folded component reports the folder holding it (got ${buriedKey})`);
ok(!folded.graph.nodes.some((n) => n.id === buried.id), 'and it really is off the canvas while that folder is shut');
const reopened = collapse(graph, new Set([buriedKey]));
ok(reopened.graph.nodes.some((n) => n.id === buried.id),
   'opening the folder it reports brings it back — which is what following a link must do');
ok(groupKeyOf(graph.nodes.find((n) => n.id === 'route:home')) === null,
   'a spine node reports no folder to open, because it is never folded');

/* A selection must not redraw the picture. `layout` is deterministic, so adding one card re-flows every
   other one — measured live, selecting a card moved cards out from under the pointer, so the next click
   landed on something else. That single fact is every complaint about selecting: "nieko nenutiko", a card
   that "pats pasikeite is pilko i zalia", needing three clicks before anything was drawn. */
const { layoutBeside } = bundles.layout;
const stable = layout(collapse(graph, new Set()).graph);
const withNeighbour = layoutBeside(collapse(graph, new Set(), new Set(['component:Home', 'component:Badge'])).graph, stable, ['component:Home', 'component:Badge']);
const wasAt = new Map(stable.nodes.map((n) => [n.id, `${n.x},${n.y}`]));
const shifted = withNeighbour.nodes.filter((n) => wasAt.has(n.id) && wasAt.get(n.id) !== `${n.x},${n.y}`);
ok(shifted.length === 0,
   shifted.length
     ? `${shifted.length} card(s) moved when one was revealed: ${shifted.slice(0, 3).map((n) => `${n.id} ${wasAt.get(n.id)} -> ${n.x},${n.y}`).join("; ")}`
     : `every one of the ${stable.nodes.length} cards already drawn stays exactly where it was`);
ok(withNeighbour.nodes.some((n) => n.id === 'component:Home'), 'and the revealed card is on the canvas');
/* Overlap, not coordinate equality. Counting distinct "x,y" strings only answers this question when every
   card sits on a grid, and they do not: the tree gives a parent the average of its children's rows. A card
   at y=140 and one at y=154 have two distinct positions and are drawn on top of each other, both being 76
   pixels tall. Reported from a screenshot after a few clicks along a trail — this assertion was green for
   the whole time that was happening. */
const overlapsIn = (view) => {
  const out = [];
  for (let a = 0; a < view.nodes.length; a++) {
    for (let b = a + 1; b < view.nodes.length; b++) {
      const p = view.nodes[a];
      const q = view.nodes[b];
      if (Math.abs(p.x - q.x) < 168 && Math.abs(p.y - q.y) < 90) out.push(`${p.id}@${p.x},${p.y} x ${q.id}@${q.x},${q.y}`);
    }
  }
  return out;
};
const firstOverlaps = overlapsIn(withNeighbour);
ok(firstOverlaps.length === 0,
   firstOverlaps.length
     ? `${firstOverlaps.length} card(s) drawn on top of each other: ${firstOverlaps.slice(0, 3).join("; ")}`
     : `no two of the ${withNeighbour.nodes.length} cards overlap`);
ok(withNeighbour.width >= stable.width && withNeighbour.height >= stable.height,
   `the canvas never shrinks under the reader (${Math.round(stable.width)}x${Math.round(stable.height)} -> ${Math.round(withNeighbour.width)}x${Math.round(withNeighbour.height)})`);

/* Following a trail: reveals accumulate, and each step must leave the previous ones exactly where they are.
   Placing new cards in GRAPH order instead of reveal order lets a card revealed on step three take the cell
   of one revealed on step one — measured live, 5 of 48 cards moved on the third click of a trail. */
/* Two widgets, both hanging off the same anchor, revealed in the OPPOSITE order to the one they sit in
   the graph. That is what makes the ordering load-bearing: with graph order the later reveal takes the
   earlier one's cell, and with reveal order it cannot. */
const trail1 = ['component:Widget5'];
const trail2 = ['component:Widget5', 'component:Widget2'];
const step1 = layoutBeside(collapse(graph, new Set(), new Set(trail1)).graph, stable, trail1);
const step2 = layoutBeside(collapse(graph, new Set(), new Set(trail2)).graph, stable, trail2);
const at1 = new Map(step1.nodes.map((n) => [n.id, `${n.x},${n.y}`]));
const movedOnStep2 = step2.nodes.filter((n) => at1.has(n.id) && at1.get(n.id) !== `${n.x},${n.y}`);
ok(movedOnStep2.length === 0,
   movedOnStep2.length
     ? `${movedOnStep2.length} card(s) moved on the next step: ${movedOnStep2.slice(0, 3).map((n) => `${n.id} ${at1.get(n.id)} -> ${n.x},${n.y}`).join("; ")}`
     : `a second step leaves all ${step1.nodes.length} cards of the first exactly where they were`);
ok(step2.nodes.length > step1.nodes.length,
   `and the trail grows (${step1.nodes.length} -> ${step2.nodes.length} cards)`);

/* Fitting. Measured against a real graph and a real pane: 1512x1704 inside 1122x495. */
const { fitScale } = bundles.layout;
ok(Math.round(fitScale(1512, 1704, 1122, 495) * 100) === 28,
   `fit uses the tighter axis, not the width (got ${Math.round(fitScale(1512, 1704, 1122, 495) * 100)}%, width alone would be 73%)`);
ok(fitScale(1512, 1704, 1122, 495) < (1122 - 24) / 1512,
   'a graph taller than its box is not left three quarters off-screen');
ok(fitScale(200, 200, 1200, 900) === 1, 'a small graph is not blown up to fill the box');
ok(fitScale(1512, 1704, 0, 399) === 1, 'a pane with no width yields 1, not an unreadable 25%');
ok(fitScale(1512, 1704, 1122, 0) === 1, 'a pane with no height yields 1 too');
ok(fitScale(0, 0, 1200, 900) === 1, 'an empty graph yields 1');

for (const name of ['layout', 'group']) rmSync(join(here, `.layout.${name}.mjs`), { force: true });
console.log(`\n${failures ? `${failures} failing` : 'all green'}\n`);
process.exit(failures ? 1 : 0);
