/**
 * Node smoke for the SSG output layer (Phase E, E1.3) — `prerender` writes a static HTML file per route.
 *
 * Bundles the TS sources on the fly (esbuild, platform=node), renders a tiny component per route with
 * route-specific state, prerenders three routes to a temp dir, and asserts each file exists as a complete
 * document (server HTML + embedded snapshot + client entry) with the right route→file mapping.
 *
 * Run: `node packages/cli/test/prerender.smoke.mjs` (wired as `pnpm verify:prerender`).
 */
import { build as esbuild } from 'esbuild';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`);
  if (!cond) failures++;
};

const entry = `
  import { renderPage } from '@weave-framework/runtime/server';
  import * as dom from '@weave-framework/runtime/dom';
  import { signal, computed, effect, root } from '@weave-framework/runtime';
  import { compileTemplate } from '@weave-framework/compiler';
  import { prerender, routeToFile } from './packages/cli/src/prerender.ts';
  export const rt = { ...dom, signal, computed, effect, root };
  export { renderPage, compileTemplate, signal, prerender, routeToFile };
`;

const cacheDir = join(repo, 'node_modules', '.weave');
mkdirSync(cacheDir, { recursive: true });
const out = join(cacheDir, 'prerender-smoke-entry.mjs');
await esbuild({
  stdin: { contents: entry, resolveDir: repo, sourcefile: 'prerender-smoke-entry.ts', loader: 'ts' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  outfile: out,
});
const { rt, renderPage, compileTemplate, signal, prerender, routeToFile } = await import(pathToFileURL(out).href);

console.log('verify:prerender — SSG output layer\n');

// route → file mapping
ok(routeToFile('/') === 'index.html', "routeToFile: '/' → index.html");
ok(routeToFile('/about') === 'about/index.html', "routeToFile: '/about' → about/index.html");
ok(routeToFile('/docs/intro/') === 'docs/intro/index.html', "routeToFile: nested + trailing slash");

// a component that renders its route's title; render(route) builds the artifact with route-specific state
const { code } = compileTemplate('<main><h1>{{ title }}</h1></main>', { mode: 'function', scope: ['title'] });
const renderFn = new Function('rt', '_c', code.replace(/return render\(ctx, \{\}\);\s*$/, 'return render;'))(rt, {});
const Page = rt.defineComponent(renderFn, (props) => ({ title: props.title }));

const titles = { '/': 'Home', '/about': 'About', '/docs/intro': 'Intro' };
const outDir = mkdtempSync(join(tmpdir(), 'weave-ssg-'));
try {
  const written = await prerender({
    outDir,
    routes: Object.keys(titles),
    render: (route) => renderPage(Page, { props: { title: titles[route] }, state: { visits: signal(0) } }),
    document: (route) => ({ title: titles[route], entry: '/main.js', lang: 'en' }),
  });

  ok(written.length === 3, `wrote 3 files (got ${written.length})`);
  ok(written.includes('index.html') && written.includes('about/index.html') && written.includes('docs/intro/index.html'), 'returned the expected relative paths');

  for (const [route, title] of Object.entries(titles)) {
    const file = join(outDir, routeToFile(route));
    if (!existsSync(file)) { ok(false, `${route}: file written`); continue; }
    const doc = readFileSync(file, 'utf8');
    ok(
      doc.startsWith('<!DOCTYPE html>') &&
        doc.includes(`<h1>${title}`) &&
        doc.includes('id="__weave_snapshot__"') &&
        doc.includes('<script type="module" src="/main.js">') &&
        doc.includes(`<title>${title}</title>`),
      `${route}: complete document (server HTML + snapshot + entry + title)`
    );
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log('');
if (failures) {
  console.error(`✖ ${failures} prerender check(s) failed.`);
  process.exit(1);
}
console.log('✓ SSG prerender output layer works.');
