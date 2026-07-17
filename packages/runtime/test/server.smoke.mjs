/**
 * Node smoke for @weave-framework/runtime/server (Phase E, E0.4) — headless render to an HTML string.
 *
 * Runs in PURE Node (no real DOM): importing `runtime/server` installs the in-house headless DOM as the
 * globals, and the UNCHANGED `runtime/dom` render path runs against it. Bundles the TS sources on the fly
 * (esbuild, platform=node), compiles a few templates, renders them, and asserts the exact HTML — including
 * a `data-won-*` resumable marker (the SSR half of resume). Proves RFC 0009 §4's seam end-to-end.
 *
 * Run: `node packages/runtime/test/server.smoke.mjs` (wired as `pnpm verify:server`).
 */
import { build as esbuild } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`);
  if (!cond) failures++;
};
const eq = (actual, expected, msg) => ok(actual === expected, `${msg}${actual === expected ? '' : `\n      expected: ${expected}\n      actual:   ${actual}`}`);

// Bundle an entry that imports runtime/server FIRST (installs the headless-DOM globals), then the runtime
// + compiler, and re-exports what the test drives. Everything shares this Node process's globalThis.
const entry = `
  import { renderToString, renderComponent, renderPage, renderDocument } from '@weave-framework/runtime/server';
  import * as dom from '@weave-framework/runtime/dom';
  import { signal, computed, effect, root, onMount } from '@weave-framework/runtime';
  import { resumableHandler, collectResumable } from '@weave-framework/runtime/resume';
  import { deserialize } from '@weave-framework/runtime/serialize';
  import { SNAPSHOT_ID, ROOT_ID, collectStates, registerState } from '@weave-framework/runtime/graph';
  import { bindTextResumable, adoptText, blockStart, adoptIsland, blockEndOf, clearBlock, after, adoptComponent } from '@weave-framework/runtime/adopt';
  import { compileTemplate } from '@weave-framework/compiler';
  import { resource } from '@weave-framework/data';
  export const rt = { ...dom, signal, computed, effect, root, onMount, resumableHandler, bindTextResumable, adoptText, blockStart, adoptIsland, blockEndOf, clearBlock, after, adoptComponent, registerState };
  export { renderToString, renderComponent, renderPage, renderDocument, compileTemplate, signal, dom, deserialize, SNAPSHOT_ID, ROOT_ID, collectResumable, resource };
`;

const cacheDir = join(repo, 'node_modules', '.weave');
mkdirSync(cacheDir, { recursive: true });
const out = join(cacheDir, 'server-smoke-entry.mjs');
await esbuild({
  stdin: { contents: entry, resolveDir: repo, sourcefile: 'server-smoke-entry.ts', loader: 'ts' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  outfile: out,
});
const { rt, renderToString, renderComponent, renderPage, renderDocument, compileTemplate, signal, deserialize, SNAPSHOT_ID, ROOT_ID, collectResumable, resource } = await import(pathToFileURL(out).href);

/** Compile a template (function mode) and return the bare render fn (with `.adopt`/`.handlers` attached). */
function compileRender(html, scope, opts = {}, children = {}) {
  const { code } = compileTemplate(html, { mode: 'function', scope, ...opts });
  const body = code.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;');
  return new Function('rt', '_c', body)(rt, children);
}

/** Compile a template (function mode) and instantiate its render against the headless DOM. */
function render(html, ctx, scope, opts = {}) {
  const { code } = compileTemplate(html, { mode: 'function', scope, ...opts });
  const body = code.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;');
  const renderFn = new Function('rt', '_c', body)(rt, {});
  return renderFn(ctx, {});
}

console.log('verify:server — headless render to string\n');

// 1) static + reactive interpolation → filled initial value
{
  const name = signal('Weave');
  const node = render('<p>Hello, {{ name() }}!</p>', { name }, ['name']);
  // bindText inserts the text node BEFORE the `<!---->` anchor, so: "Hello, " + "Weave" + anchor + "!"
  eq(renderToString(node), '<p>Hello, Weave<!---->!</p>', 'static text + interpolation (filled value before anchor)');
}

// 2) attributes: boolean true → bare, false → absent, string value, class + style
{
  const dis = signal(true);
  const cls = signal('a b');
  const node = render(
    '<input class={{cls()}} disabled={{dis()}} type="text">',
    { dis, cls },
    ['dis', 'cls']
  );
  eq(renderToString(node), '<input type="text" class="a b" disabled>', 'attrs: static + reactive class + boolean-true (bare)');
}
{
  const dis = signal(false);
  const node = render('<button disabled={{dis()}}>x</button>', { dis }, ['dis']);
  eq(renderToString(node), '<button>x</button>', 'boolean-false attribute is omitted');
}
{
  const color = signal('red');
  const node = render('<div style:color={{color()}} style:--accent={{"#0a0"}}>x</div>', { color }, ['color']);
  eq(renderToString(node), '<div style="color: red; --accent: #0a0">x</div>', 'style: standard + custom property serialize');
}

// 3) control flow: @for renders a list; @if picks a branch
{
  const items = signal([{ id: 1, t: 'a' }, { id: 2, t: 'b' }]);
  const node = render(
    '<ul>@for (it of items(); track it.id) { <li>{{ it.t }}</li> }</ul>',
    { items },
    ['items']
  );
  const clean = renderToString(node).replaceAll('<!---->', ''); // strip the block/anchor comments
  ok(clean.includes('<li>a</li>') && clean.includes('<li>b</li>'), `@for renders each row (got: ${clean})`);
}
{
  const open = signal(true);
  const node = render('<div>@if (open()) { <p>yes</p> } @else { <p>no</p> }</div>', { open }, ['open']);
  ok(renderToString(node).includes('<p>yes</p>'), '@if renders the taken branch');
}

// 4) the SSR half of resume: the `resumable` target stamps a data-won marker into the server HTML
{
  const inc = () => {};
  // Inside a collecting session — i.e. how renderPage runs it. That is what marks this as THE server render,
  // so each `on:` site stamps its marker for the client to resume instead of wiring a live listener.
  const node = collectResumable(() => render('<button on:click={{inc}}>go</button>', { inc }, ['inc'], { resumable: true })).node;
  const html = renderToString(node);
  ok(/<button data-won-click="w0#\d+">go<\/button>/.test(html), `resumable marker present in server HTML (got: ${html})`);

  // …and WITHOUT a session the same render is a live client render: a real listener, and NO marker (which
  // would otherwise make a delegated dispatcher fire the handler a second time). E1.9.
  let ran = 0;
  const live = render('<button on:click={{go}}>go</button>', { go: () => ran++ }, ['go'], { resumable: true });
  ok(!/data-won-click/.test(renderToString(live)), 'no session → no resume marker (a live render owns its listener)');
}

// 5) full component via renderComponent (defineComponent mount path → string)
{
  const { code } = compileTemplate('<h1>{{ title }}</h1>', { mode: 'function', scope: ['title'] });
  const renderFn = new Function('rt', '_c', code.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;'))(rt, {});
  const App = rt.defineComponent(renderFn, (props) => ({ title: props.title }));
  eq(renderComponent(App, { title: 'Weave SSR' }), '<h1>Weave SSR<!----></h1>', 'renderComponent mounts a defineComponent to a string');
}

// 6) the SSG page artifact: renderPage → HTML + a snapshot <script> that round-trips the state
{
  const { code } = compileTemplate('<h1>{{ title }}</h1>', { mode: 'function', scope: ['title'] });
  const renderFn = new Function('rt', '_c', code.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;'))(rt, {});
  const App = rt.defineComponent(renderFn, (props) => ({ title: props.title }));

  const count = signal(41);
  const artifact = await renderPage(App, { props: { title: 'Docs' }, state: { count } });
  ok(artifact.html.includes('<h1>Docs'), 'renderPage renders the component HTML');
  ok(artifact.snapshotScript.includes(`id="${SNAPSHOT_ID}"`) && artifact.snapshotScript.includes('application/weave'), 'emits the snapshot <script>');

  // the embedded snapshot round-trips the reactive state (parse the JSON out of the <script>)
  const json = artifact.snapshotScript.replace(/^[^>]*>/, '').replace(/<\/script>$/, '').replace(/\\u003c/g, '<');
  const state = deserialize(JSON.parse(json));
  ok(typeof state.count === 'function' && state.count() === 41, 'snapshot round-trips the reactive state (a live signal @ 41)');

  const doc = renderDocument(artifact, { title: 'Weave', entry: '/app.js', lang: 'en' });
  ok(doc.startsWith('<!DOCTYPE html>') && doc.includes('<html lang="en">'), 'renderDocument emits a full document');
  ok(doc.includes(artifact.html) && doc.includes(SNAPSHOT_ID) && doc.includes('<script type="module" src="/app.js">'), 'document embeds the page, snapshot, and client entry');
}

// 7) renderPage captures document.title set during render; renderDocument uses it (option still wins)
{
  const { code } = compileTemplate('<h1>{{ t }}</h1>', { mode: 'function', scope: ['t'] });
  const renderFn = new Function('rt', '_c', code.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;'))(rt, {});
  const Titled = rt.defineComponent(renderFn, () => { document.title = 'Signals — Weave'; return { t: 'Signals' }; });
  const artifact = await renderPage(Titled, {});
  ok(artifact.title === 'Signals — Weave', 'renderPage captures document.title set during render');

  const doc = renderDocument(artifact, { entry: '/app.js' }); // no explicit title → the captured one
  ok(doc.includes('<title>Signals — Weave</title>'), 'renderDocument falls back to the captured title');
  ok(renderDocument(artifact, { title: 'Override' }).includes('<title>Override</title>'), 'an explicit title still wins');

  // a later render with no title resets — the prior route's title must not leak
  const Plain = rt.defineComponent(renderFn, () => ({ t: 'x' }));
  ok((await renderPage(Plain, {})).title === undefined, 'title is reset between renders (no leak)');
}

// 8) E1.4 — the ISLANDS path: a resumable-compiled component renders headlessly (markers + block boundaries
//    serialize), and renderPage({ resumable: true }) captures the per-instance state MAP ({ $root, c0 }) that
//    the client resumePage rebuilds. This is the SSG↔resume seam end-to-end, headless.
{
  // child: a resumable component that self-registers its ctx (via the $wid preamble the parent stamps)
  const childRender = compileRender('<b>{{ label() }}</b>', ['label'], { resumable: true });
  let childSetups = 0;
  const Child = rt.defineComponent(childRender, (props) => { childSetups++; return { label: signal(props.start ?? 'x') }; });
  Child.adopt = childRender.adopt;

  // parent: static <Child/> plus its own reactive text — the whole adoptable component tree
  const parentRender = compileRender('<div><h1>{{ title() }}</h1><Child /></div>', ['title'], { resumable: true }, { Child });
  const Parent = rt.defineComponent(parentRender, (props) => ({ title: signal(props.title ?? 'T') }));
  Parent.adopt = parentRender.adopt;

  const art = await renderPage(Parent, { props: { title: 'Home' }, resumable: true });

  // (a) resumable-CREATE render runs under the headless DOM + serializes: real HTML with the marker + child
  ok(art.html.includes('<h1>') && art.html.includes('Home') && art.html.includes('<b>') && art.html.includes('x'),
    `resumable component renders headless (got: ${art.html})`);
  ok(childSetups === 1, 'child setup ran exactly once on the server (rendered, not double-rendered)');
  ok(art.html.includes('$'), 'dynamic-text marker (\\uXXXX / $) serialized into the server HTML');

  // (b) the snapshot is the per-instance MAP: $root (the parent) + c0 (the static child), each round-tripping
  const json = art.snapshotScript.replace(/^[^>]*>/, '').replace(/<\/script>$/, '').replace(/\\u003c/g, '<');
  const map = deserialize(JSON.parse(json));
  ok(map && typeof map === 'object' && ROOT_ID in map, 'snapshot is the instance-state MAP keyed by id');
  ok(typeof map[ROOT_ID].title === 'function' && map[ROOT_ID].title() === 'Home', 'root ($root) ctx round-trips (title @ Home)');
  ok(map.c0 && typeof map.c0.label === 'function' && map.c0.label() === 'x', 'static child (c0) ctx round-trips (label @ x)');
}

// 9) E1.4 — eager renderPage is unchanged: no $wid tagging, snapshots the explicit `state`, no instance map
{
  const eagerRender = compileRender('<p>{{ t }}</p>', ['t']);
  const Eager = rt.defineComponent(eagerRender, (props) => ({ t: props.t }));
  const n = signal(5);
  const art = await renderPage(Eager, { props: { t: 'hi' }, state: { n } });
  const json = art.snapshotScript.replace(/^[^>]*>/, '').replace(/<\/script>$/, '').replace(/\\u003c/g, '<');
  const state = deserialize(JSON.parse(json));
  ok(!(ROOT_ID in state) && typeof state.n === 'function' && state.n() === 5,
    'eager renderPage still snapshots the explicit state (no instance map, byte-for-byte E1.2)');
}

console.log('');
// 10) E1.3 — a page that FETCHES prerenders WITH its data, and the snapshot carries it.
//     The render is synchronous but `resource()` defers its fetcher to a microtask, so the HTML used to be
//     written before any data existed: an SSG page shipped `loading: true` and empty, and the client then
//     refetched exactly what the build had just fetched. `renderPage` now settles every tracked fetch before
//     serializing — that is what "the client resumes with data already present" means.
{
  const { code } = compileTemplate('<p>{{ label() }}</p>', { mode: 'function', scope: ['label'], resumable: true });
  const renderFn = new Function('rt', '_c', code.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;'))(rt, {});
  const Fetching = rt.defineComponent(renderFn, () => {
    const r = resource(async () => {
      await new Promise((res) => setTimeout(res, 5)); // real async, not a resolved promise
      return 'FETCHED_ON_SERVER';
    });
    return { label: () => r.data() ?? 'PENDING', got: signal('') , res: r };
  });
  const art = await renderPage(Fetching, {});
  ok(art.html.includes('FETCHED_ON_SERVER'), `the prerendered HTML carries the FETCHED value (got: ${art.html})`);
  ok(!art.html.includes('PENDING'), 'and not the pending placeholder');
}

// 11) E1.3 DoD — the same page, rendered WITHOUT settling, is the bug: HTML written before the fetch lands.
//     Proves the wait is what does the work, rather than the fetch happening to be fast.
{
  const { code } = compileTemplate('<p>{{ label() }}</p>', { mode: 'function', scope: ['label'], resumable: true });
  const renderFn = new Function('rt', '_c', code.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;'))(rt, {});
  const Fetching = rt.defineComponent(renderFn, () => {
    const r = resource(async () => {
      await new Promise((res) => setTimeout(res, 5));
      return 'FETCHED_ON_SERVER';
    });
    return { label: () => r.data() ?? 'PENDING' };
  });
  // renderComponent is the OLD synchronous path — build + serialize in one go, no settle.
  const html = renderComponent(Fetching, {});
  ok(html.includes('PENDING') && !html.includes('FETCHED_ON_SERVER'),
    `without settling, the same page prerenders EMPTY — this was every SSG page with data (got: ${html})`);
}

// 12) onMount is INERT under the headless render — enforced, not lucky.
//     It was inert only because the render was fully synchronous. E1.3 made it await data, which handed the
//     microtask queue a turn: every onMount fired against the DOM shim and the first `getComputedStyle` took
//     the whole docs build down. This pins the invariant runtime/server's header has always claimed, and that
//     E1.45's refusal depends on (it refuses to ADOPT a component with a mount hook precisely because the
//     server never runs it — if the server DID run it, that refusal would be wrong).
{
  const { code } = compileTemplate('<p>{{ t }}</p>', { mode: 'function', scope: ['t'] });
  const renderFn = new Function('rt', '_c', code.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;'))(rt, {});
  let mounted = false;
  const Hooked = rt.defineComponent(renderFn, () => {
    rt.onMount(() => { mounted = true; });
    return { t: 'x' };
  });
  const art = await renderPage(Hooked, {}); // awaits — the microtask queue DOES get a turn here
  ok(art.html.includes('x'), 'the component still rendered');
  ok(mounted === false, 'onMount did NOT run on the server, even though the render awaited');
}

if (failures) {
  console.error(`✖ ${failures} server-render check(s) failed.`);
  process.exit(1);
}
console.log('✓ headless render to string works.');
