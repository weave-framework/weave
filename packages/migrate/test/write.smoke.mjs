/**
 * Node smoke for the write step — the only part of the migration service that creates anything.
 *
 * Everything before it reads. This writes, into the project the service was STARTED FROM, and two of its
 * properties are the kind that cost real work when they are wrong:
 *
 *   partial      marking cards exists so an application can be migrated in pieces. `planWrites` converts a
 *                whole unit, so without a filter the first click writes everything and the marks decide
 *                nothing. The filter runs off `WriteItem.source`, added for exactly this.
 *   never clobber the target is the reader's own project. A file that exists is left alone — there is no undo
 *                here, and a migration that overwrote hand-edited code would destroy work this tool cannot
 *                give back.
 *
 * And one that is not about files at all: nothing may be written beside the SOURCE. That application is read
 * and never touched, whatever route is called.
 *
 * Run: `node packages/migrate/test/write.smoke.mjs` (wired as `pnpm verify:migrate-write`).
 */
import { build as esbuild } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const app = join(here, 'fixtures', 'alias-modules', 'app');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`);
  if (!cond) failures++;
};

console.log('\nverify:migrate-write — marks become files, and only the files they name\n');

const bundles = {};
for (const [name, entry] of [
  ['analyze', join(repo, 'packages', 'migrate', 'src', 'analyze.ts')],
  ['graph', join(repo, 'packages', 'migrate', 'src', 'graph.ts')],
  ['write', join(repo, 'packages', 'migrate', 'src', 'write.ts')],
]) {
  const out = join(here, `.write.${name}.mjs`);
  await esbuild({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, packages: 'external' });
  bundles[name] = await import(pathToFileURL(out).href);
}
const { planFor, writePlanned } = bundles.write;

/** Every file under a directory, so 'nothing was added' can be asserted rather than assumed. */
const treeOf = (dir, depth = 0, out = []) => {
  if (depth > 6) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) treeOf(full, depth + 1, out);
    else out.push(full);
  }
  return out;
};
const sameTree = (dir, before) => String(treeOf(dir).sort()) === String(before);
/** The source tree as it stands BEFORE anything here writes a single file. */
const sourceBefore = treeOf(app).sort();

const facts = bundles.analyze.assembleFactsOpening(app, ['*']);
const graph = bundles.graph.buildGraph(facts);
const sourced = graph.nodes.filter((n) => n.file);
ok(sourced.length >= 4, `the fixture yields ${sourced.length} nodes with a source file to choose between`);

const into = () => mkdtempSync(join(tmpdir(), 'weave-write-'));

/* ── the whole point: a mark decides what is written ── */
const one = sourced.find((n) => n.label === 'OneService');
const shell = sourced.find((n) => n.label === 'ShellComponent');
ok(!!one && !!shell, 'both a service and a component are available to mark');

const a = into();
const justOne = planFor(facts, graph, a, '', [one.key]);
const both = planFor(facts, graph, a, '', [one.key, shell.key]);
const everything = planFor(facts, graph, a, '', sourced.map((n) => n.key));

ok(justOne.files.length > 0, `marking one thing plans ${justOne.files.length} file(s)`);
ok(justOne.files.length < everything.files.length,
   `and fewer than marking everything (${justOne.files.length} < ${everything.files.length}) — the filter is doing something`);
ok(both.files.length > justOne.files.length,
   `marking a second thing plans more (${both.files.length} > ${justOne.files.length})`);
ok(justOne.files.every((f) => !f.from || f.from.includes('one')),
   `every planned file with a source came from what was marked (${justOne.files.map((f) => f.from ?? '(unit-wide)').join(', ')})`);
ok(planFor(facts, graph, a, '', []).files.length === 0, 'marking nothing plans nothing');

/* Where it lands, and that the subfolder is honoured rather than ignored. */
const nested = planFor(facts, graph, a, 'legacy', [one.key]);
ok(nested.outRoot === 'src/legacy', `the chosen folder is where it says (${nested.outRoot})`);
ok(nested.files.every((f) => f.path.startsWith('src/legacy/')),
   `and every file lands under it (${nested.files[0]?.path ?? 'none'})`);
ok(justOne.files.every((f) => f.path.startsWith('src/')), `an empty folder puts it in src/ itself (${justOne.files[0]?.path})`);

/* ── writing ── */
const b = into();
const written = writePlanned(facts, graph, b, '', [one.key]);
ok(written.length > 0, `${written.length} file(s) were actually created`);
ok(written.every((w) => existsSync(join(b, w.path))), 'and every one of them is on disk');
ok(readdirSync(b).length > 0, 'the target project is no longer empty');

/* The source application is read-only. Whatever else is true, this must be.
   Snapshotting the tree is the only honest way to assert it. The first version of this looked for converted
   files by grepping their CONTENT for a marker string, and a mutation that redirected every write into the
   source passed it: the file it planted held no such marker. The gate was vacuous, and it took a mutation to
   find out — which is the whole argument for running one. */
ok(sameTree(app, sourceBefore), 'nothing was written into the source application');

/* ── a file that exists is never touched ── */
const first = written[0];
const mine = '// my own work, edited by hand\n';
writeFileSync(join(b, first.path), mine, 'utf8');
const again = writePlanned(facts, graph, b, '', [one.key]);
ok(readFileSync(join(b, first.path), 'utf8') === mine,
   'a second run leaves a file that already exists exactly as it was');
ok(!again.some((w) => w.path === first.path), 'and does not claim to have written it');

/* The plan says so too, before anything is run — so the screen can show it. */
const seen = planFor(facts, graph, b, '', [one.key]);
ok(seen.files.some((f) => f.status === 'skip-exists'),
   `the plan marks what is already there (${seen.files.filter((f) => f.status === 'skip-exists').length} of ${seen.files.length})`);
ok(seen.fresh < seen.files.length, `and counts only the rest as new (${seen.fresh} of ${seen.files.length})`);

/* ── what the output needs ── */
const c = into();
writeFileSync(join(c, 'package.json'), JSON.stringify({ name: 'x', dependencies: {} }), 'utf8');
const needs = planFor(facts, graph, c, '', sourced.map((n) => n.key));
ok(Array.isArray(needs.missing), 'the plan reports which Weave packages the output needs');
ok(needs.missing.length === 0 || needs.install.length > 0,
   `and an install line when any are missing (${needs.missing.join(', ') || 'none missing'})`);

for (const dir of [a, b, c]) rmSync(dir, { recursive: true, force: true });
for (const name of ['analyze', 'graph', 'write']) rmSync(join(here, `.write.${name}.mjs`), { force: true });
console.log(`\n${failures ? `${failures} failing` : 'all green'}\n`);
process.exit(failures ? 1 : 0);
