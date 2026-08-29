/**
 * `weave merge` — the template merge driver, exercised through a real `git merge`.
 *
 * The feature is a claim about git, so the gate makes git say it: every scenario is played twice,
 * once in a plain repository and once in one with the driver installed, and the plain repository has
 * to CONFLICT before the driven one is allowed to merge. Without that control the whole file could
 * pass while resolving cases git was never troubled by. (It caught exactly that: an attribute added
 * to a tag and a button added three lines below it is not a conflict for git at all — only changes
 * landing in the same hunk are, which for a template usually means the same line.)
 *
 * Run: `node packages/cli/test/merge.smoke.mjs` (wired into `pnpm verify:merge`).
 */
import { build as esbuild } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error('X ' + msg);
    failed++;
  } else console.log('+ ' + msg);
};

console.log('\npackages/cli/test/merge.smoke.mjs');

const cliJs = join(repo, 'tools', '.verify-merge-bundle.mjs');
await esbuild({
  entryPoints: [join(repo, 'packages/cli/src/cli.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: cliJs,
  external: ['esbuild', 'typescript', 'sass'],
});
const runner = join(repo, 'tools', '.verify-merge-runner.mjs');
writeFileSync(runner, "import { main } from './.verify-merge-bundle.mjs';\nawait main(process.argv.slice(2));\n");
process.on('exit', () => {
  rmSync(cliJs, { force: true });
  rmSync(runner, { force: true });
});

const BASE = `<div class="card">
  <h2>{{ title }}</h2>
  <a href="/details">details</a>
</div>
`;

/** A repository holding `card.html`, with the driver installed or not. */
const makeRepo = (withDriver) => {
  const dir = mkdtempSync(join(repo, 'tools', '.verify-merge-repo-'));
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  const file = join(dir, 'card.html');
  git('init', '-b', 'main');
  git('config', 'user.email', 'gate@example.test');
  git('config', 'user.name', 'gate');
  writeFileSync(file, BASE);
  if (withDriver) {
    const install = spawnSync(process.execPath, [runner, 'merge', '--install'], { cwd: dir, encoding: 'utf8' });
    ok(install.status === 0, 'weave merge --install succeeds inside a git repo');
    ok(
      readFileSync(join(dir, '.gitattributes'), 'utf8').includes('*.html merge=weave-template'),
      'it writes the .gitattributes line, so the whole team gets the same behaviour',
    );
    ok(
      git('config', '--get', 'merge.weave-template.driver').stdout.includes('weave merge %O %A %B'),
      'and registers the driver in this clone',
    );
    // A real install names `weave`, which is not on PATH inside the monorepo — point the registered
    // driver at this build of the CLI instead.
    git(
      'config',
      'merge.weave-template.driver',
      `"${process.execPath.replace(/\\/g, '/')}" "${runner.replace(/\\/g, '/')}" merge %O %A %B %X %Y`,
    );
  }
  git('add', '-A');
  git('commit', '-m', 'base');
  return { dir, git, file, base: git('rev-parse', 'HEAD').stdout.trim() };
};

const plain = makeRepo(false);
const driven = makeRepo(true);

/** Play one merge in `r`: `theirs` edits on a branch, `ours` on main. */
const play = (r, name, ours, theirs) => {
  r.git('checkout', '-b', name, 'main');
  writeFileSync(r.file, theirs);
  r.git('commit', '-am', name + ' theirs');
  r.git('checkout', 'main');
  writeFileSync(r.file, ours);
  r.git('commit', '-am', name + ' ours');
  const merged = r.git('merge', '--no-edit', name);
  const text = readFileSync(r.file, 'utf8');
  // Back to the base for the next scenario. `HEAD~1` is NOT the base: after a merge that succeeded
  // it is the commit this side made, so the next scenario would start from this one's edit.
  r.git('merge', '--abort');
  r.git('reset', '--hard', r.base);
  return { status: merged.status, text };
};

// A handler added to a tag, and that tag's own label reworded. A tag and its text share a LINE,
// which is why git cannot help: two changes to different things, one hunk.
const OURS_1 = BASE.replace('<a href="/details">', '<a href="/details" on:click={{ open }}>');
const THEIRS_1 = BASE.replace('>details</a>', '>see details</a>');
const control1 = play(plain, 'one', OURS_1, THEIRS_1);
ok(control1.status !== 0 && control1.text.includes('<<<<<<<'), 'git ALONE conflicts on a handler-vs-label edit');
const driven1 = play(driven, 'one', OURS_1, THEIRS_1);
ok(driven1.status === 0, 'with the driver the same merge is clean');
ok(
  driven1.text.includes('on:click={{ open }}') && driven1.text.includes('>see details</a>'),
  'and both changes are in the file',
);
ok(!driven1.text.includes('<<<<<<<'), 'with no conflict markers left behind');
ok(driven1.text.includes('<h2>{{ title }}</h2>'), 'and the untouched lines are untouched');

// Two different attributes on the same tag.
const OURS_2 = BASE.replace('<a href="/details">', '<a href="/details" class="cta">');
const THEIRS_2 = BASE.replace('<a href="/details">', '<a href="/details" aria-label="details">');
ok(play(plain, 'two', OURS_2, THEIRS_2).status !== 0, 'git ALONE conflicts on two attributes added to one tag');
const driven2 = play(driven, 'two', OURS_2, THEIRS_2);
ok(driven2.status === 0, 'the driver merges them');
ok(
  driven2.text.includes('class="cta"') && driven2.text.includes('aria-label="details"'),
  'keeping both attributes',
);

// The same attribute, two values: a real disagreement, and it must stay one.
const driven3 = play(driven, 'three', BASE.replace('/details"', '/detail"'), BASE.replace('/details"', '/more"'));
ok(driven3.status !== 0, 'the same attribute changed two ways is still a conflict');
ok(driven3.text.includes('<<<<<<<') && driven3.text.includes('>>>>>>>'), "and git's markers are what is left");

// A file the template parser rejects must come out exactly as git alone would leave it.
const DOC = '<!DOCTYPE html>\n<html>\n<head><title>a</title></head>\n<body>x</body>\n</html>\n';
for (const r of [plain, driven]) {
  writeFileSync(r.file, DOC);
  r.git('commit', '-am', 'doctype');
  r.base = r.git('rev-parse', 'HEAD').stdout.trim();
}
const four = ['four', DOC.replace('<title>a</title>', '<title>b</title>'), DOC.replace('<body>x</body>', '<body>y</body>')];
const control4 = play(plain, ...four);
const driven4 = play(driven, ...four);
ok(
  driven4.status === control4.status && driven4.text === control4.text,
  'a file the template parser rejects is left exactly as git alone leaves it',
);

for (const r of [plain, driven]) rmSync(r.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

if (failed) {
  console.error('\nX ' + failed + ' merge check(s) failed\n');
  process.exit(1);
}
console.log('\n+ templates merge by structure, and disagreements stay conflicts\n');
process.exit(0);
