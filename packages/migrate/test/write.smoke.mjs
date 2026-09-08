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
  ['workspace', join(repo, 'packages', 'migrate', 'src', 'workspace.ts')],
]) {
  const out = join(here, `.write.${name}.mjs`);
  await esbuild({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, packages: 'external' });
  bundles[name] = await import(pathToFileURL(out).href);
}
const { planFor, writePlanned } = bundles.write;
const { librariesFor, shapeOf, sourceAliases: ws_sourceAliases } = bundles.workspace;

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

/* ── the workspace layout ──
   A source workspace library is a PROJECT in the target, not a folder inside one app. Measured on a real
   Angular workspace: flat output held 24 imports naming 12 source libraries and answered to none of them,
   because the boundary that gave them their names was gone. */
const three = sourced.find((n) => n.label === 'ThreeService');
const appNode = sourced.find((n) => n.label === 'ShellComponent');
ok(!!three, 'the fixture has a service from a SEPARATE workspace library to place');
const flat = planFor(facts, graph, a, '', [three.key], 'flat');
const ws = planFor(facts, graph, a, '', [three.key], 'workspace');
ok(flat.files.length === ws.files.length, `both layouts write the same files (${flat.files.length})`);
ok(flat.files.every((f) => f.path.startsWith('src/')), `flat puts a library inside the app (${flat.files[0]?.path})`);
// The EXACT path, not a prefix match: `/^three\/src\/lib\//` also accepted
// `three/src/lib/three/three.service.ts`, which repeats the library name inside its own project.
ok(
  String(ws.files.map((f) => f.path)) === 'three/src/lib/three.service.ts',
  `workspace gives it its own project (${ws.files.map((f) => f.path).join(', ')})`
);
ok(!ws.files.some((f) => f.path.startsWith('src/three/')), 'and does not also leave it inside the app');
// A file from the analysed unit itself is the application in either layout.
const appFile = sourced.find((n) => n.label === 'ShellComponent');
ok(
  planFor(facts, graph, a, '', [appFile.key], 'workspace').files.every((f) => f.path.startsWith('src/')),
  'the application’s own files stay in src/ under both layouts',
);
// The chosen folder still applies, so a workspace target can put migrated projects under `services/`.
const wsNested = planFor(facts, graph, a, 'services', [three.key], 'workspace');
ok(
  String(wsNested.files.map((f) => f.path)) === 'services/three/src/lib/three.service.ts',
  `and the chosen folder holds the projects (${wsNested.files[0]?.path})`
);
// …and only the projects. `subdir` says where LIBRARIES live, so applying it to the application filed the app
// under its own libraries: `src/libs/archiving/…`, which reads as though the app were one of them.
ok(
  planFor(facts, graph, a, 'libs', [appNode.key], 'workspace').files.every((f) => !f.path.startsWith('src/libs/')),
  `the chosen folder never appears in the application's own path (${planFor(facts, graph, a, 'libs', [appNode.key], 'workspace').files[0]?.path})`,
);

/* ── which libraries the target must have ──
   The import path is taken from the SOURCE workspace's own tsconfig, never invented. That is the whole trick:
   recreate `@sps-services/auth` under that name and the converted imports resolve with nothing rewritten. On
   the real Angular workspace this finds 12 libraries for one route — the same 12 the broken imports named. */
const aliases = ws_sourceAliases(facts);
ok(aliases.size >= 4, `the source workspace's own aliases are read (${aliases.size})`);
const norm = (p) => p.split('\\').join('/');
const filesFor = (node) => facts.files.filter((f) => node.file && norm(f).endsWith(node.file));
const needed = librariesFor(facts, filesFor(three), 'libs');
ok(needed.length === 1, `a service from one library needs one library (${needed.length})`);
ok(needed[0]?.importPath === '@fx/three', `under the name the SOURCE gave it (${needed[0]?.importPath})`);
ok(needed[0]?.name === 'three' && needed[0]?.directory === 'libs', `at libs/three (${needed[0]?.directory}/${needed[0]?.name})`);
/* The application is not one of its own libraries, however the walk happened to grant it.
   This needs a workspace whose tsconfig aliases the APP ITSELF, or the assertion passes for the wrong reason:
   in the shared fixture the app has no alias, so `librariesFor` skips it on "no import path" and the guard
   that actually matters is never reached. A mutation deleting that guard stayed green until this existed. */
const wsRoot = mkdtempSync(join(tmpdir(), 'weave-ws-'));
mkdirSync(join(wsRoot, 'app', 'src'), { recursive: true });
mkdirSync(join(wsRoot, 'services', 'auth', 'src'), { recursive: true });
writeFileSync(
  join(wsRoot, 'tsconfig.base.json'),
  JSON.stringify({ compilerOptions: { paths: { '@x/app': ['app/src/index.ts'], '@x/auth': ['services/auth/src/index.ts'] } } }),
  'utf8',
);
const appDir = join(wsRoot, 'app');
const authDir = join(wsRoot, 'services', 'auth');
const fake = { unit: appDir, granted: [appDir, authDir], files: [] };
ok(ws_sourceAliases(fake).size === 2, `both aliases are read, the app's included (${ws_sourceAliases(fake).size})`);
const bothDirs = [join(appDir, 'src', 'a.ts'), join(authDir, 'src', 'b.ts')];
const picked = librariesFor(fake, bothDirs, 'libs');
ok(
  String(picked.map((l) => l.importPath)) === '@x/auth',
  `only the library is listed, never the application (${picked.map((l) => l.importPath).join(', ') || 'none'})`,
);
rmSync(wsRoot, { recursive: true, force: true });
ok(!librariesFor(facts, [], 'libs').length, 'no files means no libraries');
// A target with nx.json is an Nx workspace; anything else is one application.
ok(shapeOf(a) === 'single', 'a plain folder is a single project');
writeFileSync(join(a, 'nx.json'), '{}', 'utf8');
ok(shapeOf(a) === 'nx', 'a folder with nx.json is an Nx workspace');
rmSync(join(a, 'nx.json'), { force: true });

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
for (const name of ['analyze', 'graph', 'write', 'workspace']) rmSync(join(here, `.write.${name}.mjs`), { force: true });
console.log(`\n${failures ? `${failures} failing` : 'all green'}\n`);
process.exit(failures ? 1 : 0);
