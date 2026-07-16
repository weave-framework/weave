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
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
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

console.log(
  failures === 0
    ? '\n✓ resume round-trip works — real CLI build, real browser, multi-root, setup never re-ran.'
    : `\n✗ ${failures} check(s) failed.`
);
process.exit(failures ? 1 : 0);
