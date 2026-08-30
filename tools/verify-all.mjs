/**
 * Run locally exactly what CI runs — by READING CI, not by keeping a second list.
 *
 * The 3.2.0 release went out with a red CI: `verify:skills` failed on five new runtime exports, and it
 * failed because the pre-release check was a list of gates chosen by hand. There were 52 commands in
 * the workflow and about 18 in the hand-picked list. A second list of what to run is a list that drifts;
 * this one cannot, because it is parsed out of `.github/workflows/ci.yml` at the moment it runs.
 *
 *   node tools/verify-all.mjs            # everything CI runs
 *   node tools/verify-all.mjs --list     # just print the commands, run nothing
 *
 * Environment setup steps (installing dependencies, installing browsers) are skipped: they belong to the
 * runner, not to a working checkout.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');

/** Steps that set the runner up rather than check the code. */
const SETUP = [/pnpm install/, /playwright install/];

const commands = [];
for (const line of workflow.split('\n')) {
  const m = /^\s+run:\s+(pnpm|node)\s+(.+?)\s*$/.exec(line);
  if (!m) continue;
  const cmd = `${m[1]} ${m[2]}`;
  if (SETUP.some((re) => re.test(cmd))) continue;
  if (!commands.includes(cmd)) commands.push(cmd);
}

if (process.argv.includes('--list')) {
  for (const c of commands) console.log(c);
  process.exit(0);
}

console.log(`verify:all — ${commands.length} commands, read from .github/workflows/ci.yml\n`);
const failures = [];
for (const cmd of commands) {
  const started = process.hrtime.bigint();
  const r = spawnSync(cmd, { cwd: root, shell: true, stdio: 'pipe', encoding: 'utf8' });
  const ms = Number((process.hrtime.bigint() - started) / 1000000n);
  const ok = r.status === 0;
  if (!ok) failures.push({ cmd, out: (r.stdout ?? '') + (r.stderr ?? '') });
  console.log(`${ok ? '+' : 'X'} ${cmd.padEnd(52)} ${String(ms).padStart(6)} ms`);
}

if (failures.length) {
  for (const f of failures) {
    console.error(`\n${'='.repeat(60)}\nX ${f.cmd}\n${'='.repeat(60)}`);
    console.error(f.out.split('\n').slice(-40).join('\n'));
  }
  console.error(`\nX ${failures.length} of ${commands.length} failed\n`);
  process.exit(1);
}
console.log(`\n+ all ${commands.length} CI commands pass\n`);
