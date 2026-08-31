/**
 * The CLI's front door: `--help`, an unknown command, and what a build tells you when it finishes.
 *
 * Before this, every one of those was wrong. `weave --help` printed a single usage line and exited 1 (asking
 * a tool what it does is not an error). `weave build --help` printed nothing and RAN A BUILD, wiping the
 * output directory — a `--help` with side effects. And a finished build said `weave build → dist/` and
 * nothing else: not what was emitted, not how big, not how long, so the first question anyone has about a
 * bundle needed a separate `ls`.
 *
 * Run: `node packages/cli/test/cli-help.smoke.mjs` (wired into `pnpm verify:cli-help`).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const bin = join(repo, 'packages', 'cli', 'bin', 'weave.mjs');

let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error(`✖ ${msg}`);
    failed++;
  } else {
    console.log(`✔ ${msg}`);
  }
};

console.log('\npackages/cli/test/cli-help.smoke.mjs');

/** Run the CLI in `cwd`; returns { status, out } with stdout+stderr joined. */
function run(args, cwd) {
  try {
    const out = execFileSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, out };
  } catch (e) {
    return { status: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

// A real (tiny) app, inside the repo so `@weave-framework/runtime` resolves.
const app = mkdtempSync(join(repo, 'tools', '.verify-cli-help-app-'));
mkdirSync(join(app, 'src', 'app'), { recursive: true });
writeFileSync(join(app, 'src', 'index.html'), '<!doctype html><html><body><div id="app"></div></body></html>');
writeFileSync(join(app, 'src', 'app', 'app.ts'), "import { signal } from '@weave-framework/runtime';\nexport function setup() {\n  const n = signal(1);\n  return { n };\n}\n");
writeFileSync(join(app, 'src', 'app', 'app.html'), '<p>{{ n() }}</p>\n');
writeFileSync(
  join(app, 'weave.config.ts'),
  "import { defineConfig } from '@weave-framework/cli';\nexport default defineConfig({ root: 'src/app/app', index: 'src/index.html', outDir: 'dist' });\n"
);

// 1. `--help` is a success, and lists the commands.
{
  const r = run(['--help'], app);
  ok(r.status === 0, `weave --help exits 0 (got ${r.status})`);
  for (const cmd of ['dev', 'build', 'check', 'routes']) {
    ok(new RegExp(`\\n  ${cmd}\\b`).test(r.out), `it lists \`${cmd}\``);
  }
  ok(/--config/.test(r.out) && /--ssg/.test(r.out), 'it lists the options');
}

// 2. `build --help` prints help and does NOT build.
{
  const r = run(['build', '--help'], app);
  ok(r.status === 0, `weave build --help exits 0 (got ${r.status})`);
  ok(/usage: weave <command>/.test(r.out), 'it prints the help');
  ok(!existsSync(join(app, 'dist')), 'and it did not run a build');
}

// 3. An unknown command fails, and says what is available.
{
  const r = run(['kvailyste'], app);
  ok(r.status === 1, `an unknown command exits 1 (got ${r.status})`);
  ok(/unknown command/.test(r.out), 'it names the problem');
  ok(/usage: weave <command>/.test(r.out), 'and prints the help');
}

// 4. A real build reports what it produced.
{
  const r = run(['build'], app);
  ok(r.status === 0, `the build succeeds (got ${r.status}: ${r.out.slice(0, 300)})`);
  ok(/weave build → .*dist\/ \(\d+ ms\)/.test(r.out), `it reports the elapsed time (got ${r.out.trim().split('\n')[0]})`);
  // The entry name carries a content hash, so this asserts the SHAPE of the summary line, not a name.
  ok(/main-[A-Za-z0-9]+\.js\s+[\d.]+ (B|kB|MB)/.test(r.out), `it lists the entry with a size (got ${JSON.stringify(r.out)})`);
  ok(/\(source maps\)/.test(r.out), 'it summarises source maps in one line rather than listing them');
}

rmSync(app, { recursive: true, force: true });

if (failed) {
  console.error(`\n✖ ${failed} cli check(s) failed\n`);
  process.exit(1);
}
console.log('\n✓ the CLI answers --help, refuses nonsense, and reports what it built\n');
process.exit(0);
