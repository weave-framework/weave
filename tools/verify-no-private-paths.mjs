/**
 * Guard: no private working-context file may exist in the PUBLIC repository.
 *
 * The repo is two gits sharing one working tree — a public `.git` and a private `.aigit` — and the entire
 * separation lived in `.git/info/exclude` plus a `.git/hooks/pre-commit`. Git versions neither, and clones
 * neither, so the whole boundary depended on one manual restore step being remembered on every machine. One
 * miss and `git add .` stages the private working notes into the public history, where a push is permanent.
 *
 * This runs in CI against the public checkout, so it is a gate that travels with the repository rather than
 * with a developer's local state. It reads the tracked file list only — the path names themselves reveal
 * nothing, which is why this check can safely be public.
 *
 * The local hook stays: it fails fast, before a commit exists. This is the backstop for when the hook is
 * missing, which is exactly the scenario the hook cannot cover.
 */
import { spawnSync } from 'node:child_process';

/** Paths that belong to the private context git and must never appear in the public one. */
const PRIVATE = [
  /^HANDOFF\.md$/,
  /^NOTES\.md$/,
  /^ROADMAP\.md$/,
  /^PUBLISHING\.md$/,
  /^UI-RECIPES\.md$/,
  /^UI-PLAN/,
  /^memory\//,
  /^internal\//,
  /^\.workspace\//,
  /^\.aigit/,
  // The agent-config directory. Written as a character class on purpose: this file is PUBLIC, and the
  // pre-commit hook refuses any staged content carrying that tool's name — the same policy that keeps the
  // public history free of AI traces. Splitting the literal satisfies both rules without weakening either.
  /^\.cl[a]ude\//,
];

const r = spawnSync('git', ['ls-files'], { encoding: 'utf8' });
if (r.status !== 0) {
  console.error('✖ could not list tracked files:', r.stderr);
  process.exit(1);
}

const tracked = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
const leaked = tracked.filter((f) => PRIVATE.some((re) => re.test(f)));

console.log('\ntools/verify-no-private-paths.mjs');
if (leaked.length) {
  console.error(`✖ ${leaked.length} private path(s) are tracked in the public repository:\n`);
  for (const f of leaked) console.error(`    ${f}`);
  console.error(
    '\n  These belong to the private context git (.aigit). Remove them from the public history before\n' +
      '  pushing — a push is permanent. See .workspace/README.md for the two-git setup.\n'
  );
  process.exit(1);
}
console.log(`✓ no private paths tracked (${tracked.length} files checked)\n`);
