/**
 * `weave merge` — a git merge driver for templates.
 *
 * Two people touching the same template is the everyday case: one adds a handler to a button, the
 * other adds a row under it. Those are adjacent LINES, so git reports a conflict and someone has to
 * resolve, by hand, a disagreement that never existed.
 *
 * The order here is what makes this safe to install: git's own merge runs FIRST, and its result is
 * used whenever it is clean. Only on the files git could not merge is the template read as a tree
 * (see `mergeTemplates`), and only if THAT produces something that parses is it offered. Otherwise
 * the conflict git produced is written out untouched, exactly as if this driver were not installed.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeTemplates } from '@weave-framework/compiler';

/** The name the driver is registered under, in `.gitattributes` and in the repo's git config. */
const DRIVER: string = 'weave-template';

/** Extensions a Weave template lives in. */
const PATTERNS: string[] = ['*.html', '*.weave'];

/**
 * Run git's own three-way line merge. `-p` keeps it out of the working tree.
 *
 * The labels matter more than they look: they are what a person reads above and below a conflict.
 * Git hands the driver its own (`HEAD`, the branch name) as `%X`/`%Y`, but only since 2.44 — an
 * older git passes the placeholder through untouched, so a label still starting with `%` is not a
 * label and the plain words are used instead.
 */
function lineMerge(
  base: string, ours: string, theirs: string, oursLabel: string, theirsLabel: string,
): { text: string; clean: boolean } | null {
  const label = (l: string, fallback: string): string => (!l || l.startsWith('%') ? fallback : l);
  const r: SpawnSyncReturns<string> = spawnSync(
    'git',
    [
      'merge-file', '-p',
      '-L', label(oursLabel, 'ours'), '-L', 'base', '-L', label(theirsLabel, 'theirs'),
      ours, base, theirs,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  // A negative status is git failing (unreadable file, no git); a positive one is the number of
  // conflicts, which is a perfectly good answer.
  if (r.error || r.status === null || r.status < 0) return null;
  return { text: r.stdout, clean: r.status === 0 };
}

/** Register the driver in this repository: the git config entry, plus the `.gitattributes` lines. */
function install(): number {
  const root: SpawnSyncReturns<string> = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (root.status !== 0) {
    console.error('weave merge --install: not inside a git repository.');
    return 1;
  }
  const dir: string = root.stdout.trim();
  const set = (key: string, value: string): void => {
    spawnSync('git', ['config', key, value], { cwd: dir });
  };
  set(`merge.${DRIVER}.name`, 'Weave template merge (merges the tree, falls back to git)');
  // Git's own placeholders: `%O` base, `%A` ours (and the file to write into), `%B` theirs, and
  // `%X`/`%Y` the labels it would have put on the conflict itself.
  set(`merge.${DRIVER}.driver`, 'weave merge %O %A %B %X %Y');

  const file: string = join(dir, '.gitattributes');
  const current: string = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const missing: string[] = PATTERNS.map((p: string) => `${p} merge=${DRIVER}`)
    .filter((line: string) => !current.includes(line));
  if (missing.length) {
    const sep: string = current === '' || current.endsWith('\n') ? '' : '\n';
    writeFileSync(file, current + sep + missing.join('\n') + '\n');
  }
  console.log(
    `weave merge: installed.\n` +
      `  .gitattributes  ${missing.length ? missing.join(', ') : 'already listed'}\n` +
      `  git config      merge.${DRIVER}.driver\n\n` +
      `The config entry is local to this clone, so each person on the team runs this once ` +
      `(the .gitattributes lines are committed and shared).`,
  );
  return 0;
}

/**
 * The driver itself. `argv` is what git passes: base, ours, theirs — with the merged result written
 * back over `ours`. Returns the process exit code: 0 merged, 1 conflicts left in the file.
 */
export function runMerge(argv: string[]): number {
  if (argv[0] === '--install') return install();
  const [base, ours, theirs, oursLabel, theirsLabel] = argv;
  if (!base || !ours || !theirs) {
    console.error(
      'usage: weave merge <base> <ours> <theirs>   (git calls this; run `weave merge --install` once to register it)',
    );
    return 1;
  }

  const line: { text: string; clean: boolean } | null =
    lineMerge(base, ours, theirs, oursLabel ?? '', theirsLabel ?? '');
  if (line && line.clean) {
    writeFileSync(ours, line.text);
    return 0;
  }

  let merged: string | null = null;
  try {
    merged = mergeTemplates(readFileSync(base, 'utf8'), readFileSync(ours, 'utf8'), readFileSync(theirs, 'utf8'));
  } catch {
    merged = null; // an unreadable side is git's problem to report, not ours to guess at
  }
  if (merged !== null) {
    writeFileSync(ours, merged);
    console.error('weave merge: merged by structure — the two changes touch different nodes.');
    return 0;
  }

  if (!line) {
    console.error('weave merge: could not merge, and git merge-file is unavailable to fall back to.');
    return 1;
  }
  writeFileSync(ours, line.text);
  return 1;
}
