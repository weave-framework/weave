/**
 * `weave check --impact <file>` — what renders this component, directly and through others.
 *
 * The question every author asks before editing a component, and the honest answer was never available:
 * grep finds a tag's NAME, which is not the same as the components that actually resolve to this file.
 *
 * Both resolution paths are covered on purpose, because covering only one made the feature look like it
 * worked while reporting almost nothing: a child can be reached by an explicit `import` (how a real app
 * mostly does it) or by the no-import convention. Reading only the convention found 1 user across the
 * whole docs site; reading both finds 111 for its `doc-page`.
 *
 * Run: `node packages/cli/test/impact.smoke.mjs` (wired into `pnpm verify:impact`).
 */
import { build as esbuild } from 'esbuild';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error('X ' + msg);
    failed++;
  } else console.log('+ ' + msg);
};

console.log('\npackages/cli/test/impact.smoke.mjs');

const cliJs = join(repo, 'tools', '.verify-impact-bundle.mjs');
await esbuild({
  entryPoints: [join(repo, 'packages/cli/src/cli.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: cliJs,
  external: ['esbuild', 'typescript', 'sass'],
});
const { main } = await import(pathToFileURL(cliJs).href);
process.on('exit', () => rmSync(cliJs, { force: true }));

const app = mkdtempSync(join(repo, 'tools', '.verify-impact-app-'));
const write = (rel, text) => {
  const p = join(app, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
};
const setup = (body) => 'export function setup(): { x: number } {\n  ' + (body ?? '') + '\n  const x = 1;\n  return { x };\n}\n';

// Leaf: the component under study.
write('src/lib/leaf/leaf.ts', setup());
write('src/lib/leaf/leaf.html', '<b>{{ x }}</b>\n');

// A user in the same directory, with NO import — the convention path.
write('src/lib/leaf/near.ts', setup());
write('src/lib/leaf/near.html', '<div><Leaf /></div>\n');

// A user in another directory that IMPORTS it — the path a real app mostly takes.
write('src/lib/mid/mid.ts', "import Leaf from '../leaf/leaf';\nvoid Leaf;\n" + setup());
write('src/lib/mid/mid.html', '<section><Leaf /></section>\n');

// And a page that renders that one, so `mid` is reached transitively.
write('src/pages/top.ts', "import Mid from '../lib/mid/mid';\nvoid Mid;\n" + setup());
write('src/pages/top.html', '<main><Mid /></main>\n');

// And one more level above it: without this the transitive walk is only ever one step deep, and the
// queue it pushes onto is never actually needed — a test that cannot fail if the walk stops early.
const NLC = String.fromCharCode(10);
write('src/pages/root.ts', "import Top from './top';" + NLC + 'void Top;' + NLC + setup());
write('src/pages/root.html', '<div><Top /></div>' + NLC);

// A component nobody renders.
write('src/lib/lonely/lonely.ts', setup());
write('src/lib/lonely/lonely.html', '<i>{{ x }}</i>\n');

const run = async (args) => {
  const said = [];
  const realLog = console.log;
  const realErr = console.error;
  const realExit = process.exit;
  const cwd = process.cwd();
  console.log = (...a) => said.push(a.join(' '));
  console.error = (...a) => said.push(a.join(' '));
  process.exit = () => {
    throw new Error('__exit__');
  };
  process.chdir(app);
  try {
    await main(args);
  } catch (e) {
    if (!String(e && e.message).includes('__exit__')) throw e;
  } finally {
    process.chdir(cwd);
    console.log = realLog;
    console.error = realErr;
    process.exit = realExit;
  }
  return said.join('\n');
};

const out = await run(['check', '--impact', 'src/lib/leaf/leaf.ts', 'src']);
ok(/rendered by 4 files/.test(out), 'four files reach it (got ' + JSON.stringify(out) + ')');
ok(out.includes('src/lib/leaf/near.ts'), 'the no-import convention user is found');
ok(out.includes('src/lib/mid/mid.ts'), 'the explicitly imported user is found');
ok(/and reached through those[\s\S]*src\/pages\/top\.ts/.test(out), 'the page above it is transitive, not direct');
ok(/and reached through those[\s\S]*src\/pages\/root\.ts/.test(out), 'and so is the one above THAT — the walk does not stop at one step');
ok(!/directly[\s\S]*src\/pages\/top\.ts/.test(out.split('and reached through')[0]), 'the transitive one is not listed as direct');

const none = await run(['check', '--impact', 'src/lib/lonely/lonely.ts', 'src']);
ok(/nothing under src renders/.test(none), 'a component nobody renders says so plainly (got ' + JSON.stringify(none) + ')');

// It must not type-check when asked this: the question is asked BEFORE editing, often on a red tree.
ok(!/type error/.test(out), 'and it answers without running the type checker');

rmSync(app, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

if (failed) {
  console.error('\nX ' + failed + ' impact check(s) failed\n');
  process.exit(1);
}
console.log('\n+ --impact reports who renders a component, by import and by convention\n');
process.exit(0);
