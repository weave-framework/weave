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
  import { renderToString, renderComponent } from '@weave-framework/runtime/server';
  import * as dom from '@weave-framework/runtime/dom';
  import { signal, computed, effect, root } from '@weave-framework/runtime';
  import { resumableHandler } from '@weave-framework/runtime/resume';
  import { compileTemplate } from '@weave-framework/compiler';
  export const rt = { ...dom, signal, computed, effect, root, resumableHandler };
  export { renderToString, renderComponent, compileTemplate, signal, dom };
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
const { rt, renderToString, renderComponent, compileTemplate, signal } = await import(pathToFileURL(out).href);

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
  const node = render('<button on:click={{inc}}>go</button>', { inc }, ['inc'], { resumable: true });
  const html = renderToString(node);
  ok(/<button data-won-click="w0#\d+">go<\/button>/.test(html), `resumable marker present in server HTML (got: ${html})`);
}

// 5) full component via renderComponent (defineComponent mount path → string)
{
  const { code } = compileTemplate('<h1>{{ title }}</h1>', { mode: 'function', scope: ['title'] });
  const renderFn = new Function('rt', '_c', code.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;'))(rt, {});
  const App = rt.defineComponent(renderFn, (props) => ({ title: props.title }));
  eq(renderComponent(App, { title: 'Weave SSR' }), '<h1>Weave SSR<!----></h1>', 'renderComponent mounts a defineComponent to a string');
}

console.log('');
if (failures) {
  console.error(`✖ ${failures} server-render check(s) failed.`);
  process.exit(1);
}
console.log('✓ headless render to string works.');
