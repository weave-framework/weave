/**
 * verify:resume — the server→client round-trip gate (Phase E).
 *
 * Builds a REAL app through the REAL CLI (`buildSsg({ resume: true })`), then loads the emitted static files in
 * a REAL browser and asserts the resumed page's actual numbers. Everything else in the suite proves one side or
 * the other: `verify:ssg` renders in Node and reads the HTML as text; the `.browser.ts` tests resume in a browser
 * but feed it HTML they re-parsed from a string. Nothing joined the two, so a break in the seam BETWEEN them was
 * invisible to every gate at once.
 *
 * ## Why this file exists
 *
 * It is the gate that would have caught E1.46. The client entry handed `adopt` the mount target's
 * `firstElementChild`, which is only correct for a SINGLE-ROOT root component. Every test app was single-root, so
 * the whole suite stayed green while resume was, in fact, dead for any multi-root app — the docs shell included.
 * It failed by THROWING on the first adopt step, before any console listener could attach, and the page still
 * LOOKED right (the server HTML is right). It cost a full session of wrong theories to find by hand.
 *
 * So the assertions below are deliberately about OBSERVABLE state, never about emitted code:
 *   - the root is MULTI-ROOT (two components at the top level, like the docs shell) — the shape that broke;
 *   - `setup` must NOT re-run on the client (that is resume; if it runs, the page merely client-rendered and
 *     every other assertion here would pass anyway — which is exactly how this stayed hidden);
 *   - an uncaught page error is a FAILURE, not something to be read out of a console log later;
 *   - a bare `effect()` in setup keeps driving `document.title` after resume (E1.47);
 *   - a regex in setup does not get the component refused (E1.48).
 *
 * Run: `node tools/verify-resume.mjs` (wired as `pnpm verify:resume`). Needs a built workspace? No — it bundles
 * the CLI from source, exactly as verify:ssg does.
 */
import { build as esbuild } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`);
  if (!cond) failures++;
};
const eq = (actual, expected, msg) => ok(actual === expected, `${msg} (got ${JSON.stringify(actual)})`);

/* ── bundle the CLI from source (same approach as verify:ssg) ── */

const cacheDir = join(repo, 'node_modules', '.weave');
mkdirSync(cacheDir, { recursive: true });
const entryOut = join(cacheDir, 'resume-gate-entry.mjs');
await esbuild({
  stdin: {
    contents: `
      export { generateServerEntry, generateEntry, discoverCustomElements } from './packages/cli/src/entry.ts';
      export { buildSsg } from './packages/cli/src/build.ts';
    `,
    resolveDir: repo,
    sourcefile: 'resume-gate-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  external: ['esbuild'],
  outfile: entryOut,
});
const { generateServerEntry, generateEntry, discoverCustomElements, buildSsg } = await import(pathToFileURL(entryOut).href);

console.log('verify:resume — a real app, built by the real CLI, resumed in a real browser\n');

/* ── the app: MULTI-ROOT, the shape E1.46 broke ── */

const app = mkdtempSync(join(here, '.resume-gate-app-'));
const outDir = mkdtempSync(join(here, '.resume-gate-out-'));
let server;
let browser;
try {
  // A child with its own state + its own on:click — nested resume (its ctx rides the state map under its own id).
  writeFileSync(
    join(app, 'counter.ts'),
    `import { signal, type Signal } from '@weave-framework/runtime';
export const template =
  '<button class="counter" on:click={{ bump }}>count {{ n() }}</button>';
export function setup(): { n: Signal<number>; bump: () => void } {
  (globalThis as Record<string, unknown>).__childSetupRan = true;
  const n = signal(3);
  const bump = (): void => n.set((v) => v + 1);
  return { n, bump };
}
`
  );

  // The root: TWO components at the top level → a fragment root, no single root element.
  // This is the docs shell's shape, and the one no test app had.
  // The SECOND top-level root. It must carry its own INTERACTION, not just its own text: the server HTML
  // already contains the right text, so reading it back proves nothing about adopt. (A first draft asserted
  // exactly that and passed with the fix reverted and the page dead.) Only a click that changes it can tell
  // an adopted root from inert server markup.
  writeFileSync(
    join(app, 'panel.ts'),
    `import { signal, type Signal } from '@weave-framework/runtime';
export const template =
  '<section class="panel"><b class="tail">{{ tail() }}</b>' +
  '<button class="tail-btn" on:click={{ flip }}>flip</button></section>';
export function setup(): { tail: Signal<string>; flip: () => void } {
  const tail = signal('server');
  const flip = (): void => tail.set('adopted');
  return { tail, flip };
}
`
  );

  writeFileSync(
    join(app, 'app.ts'),
    `import { signal, effect, type Signal } from '@weave-framework/runtime';
import Counter from './counter';
import Panel from './panel';
void Counter; void Panel;
export const template =
  '<Counter />' +
  '<Panel />';
export function setup(): { slug: Signal<string> } {
  (globalThis as Record<string, unknown>).__rootSetupRan = true;
  const slug = signal('/alpha/');
  // E1.48 — a regex in setup must not get the component refused (the scan used to read \`$\` as a variable).
  // E1.47 — a BARE effect: it binds no name, so derive never rebuilt it and this stopped after resume.
  effect(() => {
    document.title = 'T:' + slug().replace(/\\/+$/, '').replace(/^\\//, '');
  });
  return { slug };
}
`
  );

  const rootComponent = join(app, 'app.ts');
  await buildSsg({
    virtualEntry: { code: generateEntry(rootComponent, '#app', app, discoverCustomElements(app), { resume: true }), resolveDir: app },
    serverEntry: { code: generateServerEntry(rootComponent, app, { resumable: true }), resolveDir: app },
    mount: '#app',
    outDir,
    minify: false,
    styleLang: 'css',
    resume: true,
    title: 'unset',
    lang: 'en',
  });

  const indexFile = join(outDir, 'index.html');
  ok(existsSync(indexFile), 'the CLI emitted index.html');
  const doc = readFileSync(indexFile, 'utf8');

  // The server really rendered BOTH roots (so a client failure below is about resume, not about the render).
  ok(/class="counter"/.test(doc) && /class="panel"/.test(doc), 'server rendered BOTH top-level roots');
  ok(doc.includes('__weave_snapshot__'), 'the state snapshot is embedded');
  // (No check that the bundle literally contains `adopt.container = true`. It was here for one run and it was
  // both wrong — esbuild renames the local to `adopt3` — and against the point: the emitted TEXT is not the
  // behaviour. Whether the contract reached the entry is proven below, by the second root actually adopting.)

  /* ── what the page actually COSTS ── */

  // The E1 exit criterion asks for a per-PAGE budget, and nothing measured one. Every budget in verify:size is
  // a runtime ENTRY weighed in isolation (reactive, dom, adopt, graph…), which answers "how big is the library"
  // — not "what does a resumed page ship", the number a reader of the page actually pays. They diverge: a page
  // carries the entry code the bundler kept, the compiled components, AND the state snapshot inlined in the HTML.
  //
  // MEASURED, not assumed: this is the whole JS the page links plus its snapshot. It is the SAME main.js for
  // every route — buildSsg splits only on an explicit `@defer` import, so there is no per-route or per-island
  // chunking today. E1.2's other half ("static subtrees ship zero JS") is therefore NOT built: resume avoids
  // re-RENDERING, it does not yet avoid SHIPPING. This budget pins the cost that exists so it cannot grow in
  // silence, and it is the number that must FALL when island chunking lands.
  const pageJs = [...doc.matchAll(/<script[^>]+src="\/([^"]+\.js)"/g)].map((m) => m[1]);
  const jsBytes = pageJs.reduce((n, f) => n + gzipSync(readFileSync(join(outDir, f))).length, 0);
  const snapBytes = gzipSync(Buffer.from((/id="__weave_snapshot__"[^>]*>([\s\S]*?)<\/script>/.exec(doc) ?? ['', ''])[1])).length;
  // 8.75 KB gz against a measured 7.6 — ~15% headroom, the same margin verify:size runs (SPA core sits at
  // 20.9/22.0). A budget with 2× headroom catches nothing; this one has to bite before the number doubles.
  // Raise it only with a reason written down, exactly as verify:size demands.
  const PAGE_BUDGET = 8_960;
  ok(
    jsBytes + snapBytes <= PAGE_BUDGET,
    `a resumed page ships ${(jsBytes / 1024).toFixed(1)} KB gz JS + ${snapBytes} B snapshot ` +
      `(budget ${(PAGE_BUDGET / 1024).toFixed(0)} KB) — files: ${pageJs.join(', ')}`
  );

  /* ── serve the emitted files exactly as a static host would ── */

  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  server = createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    const file = join(outDir, url === '/' ? 'index.html' : url.replace(/^\/+/, ''));
    if (!existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  /* ── load it in a REAL browser ── */

  browser = await chromium.launch();
  const page = await browser.newPage();
  // An uncaught error is a FAILURE. E1.46 threw on adopt's first step and nothing reported it: the page looked
  // right, and by the time anything read the console the throw was long gone. Collect from before navigation.
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message)));
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });

  eq(pageErrors.length, 0, `no uncaught page error${pageErrors.length ? `: ${pageErrors[0]}` : ''}`);
  eq(consoleErrors.length, 0, `no console error${consoleErrors.length ? `: ${consoleErrors[0]}` : ''}`);

  // THE assertion that separates resume from a client re-render. Every other check below passes either way —
  // which is precisely why a dead resume hid behind a green suite for a whole session.
  const setupRan = await page.evaluate(() => ({
    root: !!globalThis.__rootSetupRan,
    child: !!globalThis.__childSetupRan,
  }));
  eq(setupRan.root, false, "the root's setup did NOT re-run on the client (resumed, not client-rendered)");
  eq(setupRan.child, false, "the child's setup did NOT re-run either (nested resume, not a CSR island)");

  // E1.46 — the SECOND root must actually be ADOPTED, and only a behaviour change can show that: handed
  // `firstElementChild`, adopt walked into the FIRST root's insides, ran off its end and threw, so nothing on
  // the page adopted — yet the second root's TEXT was still right, because the server had rendered it.
  eq(await page.textContent('.tail'), 'server', 'the second root shows its server-rendered text');
  await page.click('.tail-btn');
  eq(await page.textContent('.tail'), 'adopted', 'the second top-level root is LIVE after resume (E1.46)');

  // E1.47 — a bare `effect()` in setup still drives document.title after resume. It binds no name, so nothing
  // rebuilt it and the title froze at whatever the server rendered.
  eq(await page.title(), 'T:alpha', 'a bare effect() in setup was rebuilt and drove document.title (E1.47/E1.48)');

  // Interactive IN PLACE: the adopted button's own handler runs against its own resumed ctx, and the very
  // same text node is updated (a re-render would have replaced it).
  eq(await page.textContent('.counter'), 'count 3', 'the child rendered its server value');
  const sameNode = await page.evaluate(() => {
    const b = document.querySelector('.counter');
    globalThis.__node = [...b.childNodes].find((n) => n.nodeType === 3 && n.data.trim() === '3');
    return !!globalThis.__node;
  });
  ok(sameNode, 'the dynamic text is its own node in the server HTML (the resumable marker held)');
  await page.click('.counter');
  eq(await page.textContent('.counter'), 'count 4', 'a click on the resumed child ran its handler over its resumed ctx');
  eq(await page.evaluate(() => globalThis.__node?.data), '4', 'and it updated the SAME text node — adopted in place, not re-rendered');

  // (The bare effect's LIVENESS — that it re-subscribed rather than just replaying once — is pinned by
  // `E1.47: the rebuilt effect is LIVE on a resumed page` in resumable.browser.ts, which can reach the resumed
  // ctx directly. A first draft tried to assert it here through a `globalThis.__weaveResumeCtx` that does not
  // exist, and passed itself with `x === 'T:omega' || x === 'T:alpha'` — an assertion that asserts nothing.
  // What THIS gate proves about the effect is that it ran at all after resume: the title above is `T:alpha`,
  // which only the rebuilt effect (and its two regexes) can produce.)
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((r) => server.close(r));
  rmSync(app, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
}

/* ── per-route code splitting: a page must not carry every OTHER page ── */

// The gate for E1.2's payload half. `--ssg` used to generate the routes manifest with STATIC imports for BOTH
// bundles, because the headless render is synchronous and cannot await a lazy chunk. That constraint is the
// server's alone, but it was applied to the client too — so every prerendered route linked one main.js holding
// the whole app (the real docs: 350.8 KB gz, on every page). The fix aliases the eager manifest into the SERVER
// bundle only; the client keeps `lazy()` and esbuild's `splitting` gives each page its own chunk (docs: 9.1 KB
// + ~0.5 KB). Nothing else here would notice this regressing: the pages would still render, still resume, and
// still pass every other assertion — they would just quietly get 36× heavier again.
await routeSplitGate();

async function routeSplitGate() {
  const rapp = mkdtempSync(join(here, '.resume-gate-routed-'));
  // outDir must live OUTSIDE the app: publicDir defaults to the project root, so a dist/ inside it would be
  // copied into itself (cp EINVAL).
  const rout = mkdtempSync(join(here, '.resume-gate-routed-out-'));
  try {
    // Driven through the REAL CLI binary, not buildSsg directly — because the thing that can regress lives in
    // the CLI (`syncRoutes` decides lazy-vs-eager) as much as in the bundler (the server-side alias). A first
    // draft called generateRoutes itself and therefore could NOT see `syncRoutes` being reverted: it passed
    // happily with the bug put back. A gate that cannot fail is not a gate.
    const pages = join(rapp, 'src', 'pages');
    mkdirSync(pages, { recursive: true });
    writeFileSync(join(pages, 'index.ts'), `import { signal, type Signal } from '@weave-framework/runtime';
export const template = '<h1 class="t">HOME_ONLY_MARKER {{ n() }}</h1>';
export function setup(): { n: Signal<number> } { return { n: signal(1) }; }
`);
    writeFileSync(join(pages, 'about.ts'), `import { signal, type Signal } from '@weave-framework/runtime';
export const template = '<h1 class="t">ABOUT_ONLY_MARKER {{ n() }}</h1>';
export function setup(): { n: Signal<number> } { return { n: signal(2) }; }
`);
    writeFileSync(join(rapp, 'src', 'app.ts'), `import { createRouter, RouterView, type Router } from '@weave-framework/router';
import { routes } from './pages/routes.gen';
void RouterView;
export const template = '<main><RouterView router={{ router }} /></main>';
export function setup(): { router: Router } {
  // Declared, not returned inline: a const is what E1.11 re-derives. An inline-returned VALUE is not
  // (returnEntries takes functions only), so returning createRouter(routes) straight out of the object
  // makes the whole root unserializable and it falls back to CSR — with only a build warning to say so.
  const router: Router = createRouter(routes);
  return { router };
}
`);
    writeFileSync(join(rapp, 'weave.config.ts'), `import { defineConfig } from '@weave-framework/cli';
export default defineConfig({
  root: 'src/app',
  routesDir: 'src/pages',
  build: { minify: false },
  ssg: { resume: true },
});
`);
    const cli = join(repo, 'packages', 'cli', 'bin', 'weave.mjs');
    execFileSync(process.execPath, [cli, 'build', '--ssg', '--config', join(rapp, 'weave.config.ts'), '--out', rout], {
      cwd: rapp,
      stdio: 'pipe',
    });

    const mainJs = readFileSync(join(rout, 'main.js'), 'utf8');
    const chunks = readdirSync(rout).filter((f) => f.endsWith('.js') && f !== 'main.js');
    ok(chunks.length >= 2, `each page is its own chunk (got ${chunks.length}: ${chunks.join(', ')})`);
    // THE assertion: a route's code must not sit in the bundle EVERY page downloads. Before this, `--ssg`
    // generated the manifest with static imports for both bundles — because the synchronous headless render
    // cannot await a lazy chunk — so one main.js carried the whole app to every route (the real docs: 350.8 KB
    // gz per page; now 9.1 KB + the page's own ~0.5 KB chunk).
    ok(!mainJs.includes('HOME_ONLY_MARKER'), "main.js does NOT carry the '/' route's code");
    ok(!mainJs.includes('ABOUT_ONLY_MARKER'), "main.js does NOT carry the '/about' route's code");
    // …and the pages still PRERENDER — splitting must never be bought with empty HTML. That works because
    // `lazy()` hands its import to the headless render's async sink (E1.3), so the render settles it. Before
    // that a lazy route prerendered EMPTY, which is why --ssg forced static imports on both bundles and every
    // route shipped the whole app.
    const homeHtml = readFileSync(join(rout, 'index.html'), 'utf8');
    const aboutHtml = readFileSync(join(rout, 'about', 'index.html'), 'utf8');
    ok(/HOME_ONLY_MARKER/.test(homeHtml) && !/ABOUT_ONLY_MARKER/.test(homeHtml), "'/' prerendered its OWN route — lazy, and still full HTML");
    ok(/ABOUT_ONLY_MARKER/.test(aboutHtml), "'/about' prerendered its own route");
  } finally {
    rmSync(rapp, { recursive: true, force: true });
    rmSync(rout, { recursive: true, force: true });
  }
}

console.log(
  failures === 0
    ? '\n✓ resume round-trip works — real CLI build, real browser, multi-root, setup never re-ran, routes split.'
    : `\n✗ ${failures} check(s) failed.`
);
process.exit(failures ? 1 : 0);
