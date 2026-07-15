/**
 * Node smoke for the SSG build plumbing (Phase E, E1.3b) — root-render prerender + CSR client.
 *
 * Part 1 (this commit) pins the entry generators: `generateServerEntry` emits a Node module that renders the
 * root headlessly, and `generateEntry` still emits the client CSR mount. Part 2 (E1.3b-2) extends this with a
 * real end-to-end `weave build --ssg` into a temp dir.
 *
 * Run: `node packages/cli/test/ssg.smoke.mjs` (wired as `pnpm verify:ssg`).
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

const entry = `
  export { generateServerEntry, generateEntry } from './packages/cli/src/entry.ts';
`;
const cacheDir = join(repo, 'node_modules', '.weave');
mkdirSync(cacheDir, { recursive: true });
const out = join(cacheDir, 'ssg-smoke-entry.mjs');
await esbuild({
  stdin: { contents: entry, resolveDir: repo, sourcefile: 'ssg-smoke-entry.ts', loader: 'ts' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  packages: 'external',
  outfile: out,
});
const { generateServerEntry, generateEntry } = await import(pathToFileURL(out).href);

console.log('verify:ssg — SSG build plumbing\n');

// The server entry: imports the root, renders it headlessly, exports render().
const rootDir = join(repo, 'app');
const server = generateServerEntry(join(rootDir, 'App.ts'), rootDir);
ok(server.includes(`import Root from "./App";`), 'server entry: imports the root (./App)');
ok(server.includes(`from "@weave-framework/runtime/server"`), 'server entry: imports renderPage from runtime/server');
ok(/export function render\(\)\s*\{\s*return renderPage\(Root, \{\}\);\s*\}/.test(server), 'server entry: exports render() → renderPage(Root, {})');

// A root component nested a folder deep still resolves relative to rootDir.
const nested = generateServerEntry(join(rootDir, 'pages', 'Home.ts'), rootDir);
ok(nested.includes(`import Root from "./pages/Home";`), 'server entry: nested root path is relative to rootDir');

// The client entry is unchanged CSR mount (resumePage is E1.3c) — the server HTML is a first-paint shell.
const client = generateEntry(join(rootDir, 'App.ts'), '#app', rootDir, []);
ok(client.includes('mountComponent(Root, "#app")'), 'client entry: still a CSR mountComponent at the mount selector');

console.log('');
if (failures) {
  console.error(`✖ ${failures} ssg check(s) failed.`);
  process.exit(1);
}
console.log('✓ SSG entry generators emit the server + client bootstraps.');
