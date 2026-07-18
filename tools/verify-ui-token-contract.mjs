/**
 * Gate: a public design token may be DEPRECATED, never deleted.
 *
 * VERSIONING.md freezes two things, not one — the exported API *and* the UI design-token
 * contract. A consumer who set `--weave-button-mark-width` in their theme wrote code against
 * that promise. Delete the token and their override silently stops doing anything: no build
 * error, no console warning, just a value that quietly no longer applies. That is a MAJOR
 * change, and in a 1.x line it is simply a broken promise.
 *
 * It happened. Between 1.6.0 and this gate, five tokens were deleted outright — button
 * `mark-width`, chips `remove-font-size`, input `clear-size`, and `typography.cell-size` in
 * both pickers — each because the rule that read it had gone away (a `×` character became a
 * lucide icon, an underline became a tonal fill). The reasoning written into the diff was
 * "a public token that no rule reads is worse than no token". That is a fair design opinion
 * and it does not outrank a published compatibility promise: an inert token is deprecated,
 * kept, and removed in a major. The same batch got this right for expansion's
 * `marker-weight`, which is what made the inconsistency obvious.
 *
 * Ground truth is the BUILT stylesheet — the names the library actually emits — not a list
 * kept in step by hand, and not the SCSS source (which would need a second parser to agree
 * with sass). The snapshot is committed, so a removal shows up as a deleted line in review
 * even before CI speaks.
 *
 *   pnpm verify:ui-tokens            fail on any drift
 *   pnpm verify:ui-tokens --update   re-record the snapshot (after an intended addition)
 *
 * Requires a built `docs/dist/app.css` (`pnpm docs:build`), same input as `docs:tokens`.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const builtCss = join(root, 'docs', 'dist', 'app.css');
const snapshotPath = join(root, 'packages', 'ui', 'token-contract.json');
const update = process.argv.includes('--update');

if (!existsSync(builtCss)) {
  console.error(
    `\n✖ no built stylesheet at ${builtCss}.\n` +
      '  The token contract is read from what the library actually emits — run `pnpm docs:build` first.\n'
  );
  process.exit(1);
}

const emitted = [...readFileSync(builtCss, 'utf8').matchAll(/(--weave-[a-z0-9-]+)\s*:/gi)].map((m) => m[1]);
const current = [...new Set(emitted)].sort();

// A partial or stale build would look like a mass deletion. Refuse to judge on it.
if (current.length < 50) {
  console.error(`\n✖ only ${current.length} --weave-* tokens in dist/app.css — stale or partial build, not judging\n`);
  process.exit(1);
}

if (update || !existsSync(snapshotPath)) {
  writeFileSync(snapshotPath, JSON.stringify({ tokens: current }, null, 2) + '\n');
  console.log(`✔ recorded ${current.length} public design tokens in packages/ui/token-contract.json`);
  process.exit(0);
}

const recorded = JSON.parse(readFileSync(snapshotPath, 'utf8')).tokens;
const removed = recorded.filter((t) => !current.includes(t));
const added = current.filter((t) => !recorded.includes(t));

if (removed.length) {
  console.error(`\n✖ ${removed.length} public design token(s) are no longer emitted:\n`);
  for (const t of removed) console.error(`    ${t}`);
  console.error(
    '\n  The design-token contract is frozen public API (VERSIONING.md). Removing a token is a MAJOR\n' +
      '  change, and it fails silently for the consumer — their override just stops applying.\n' +
      '  If the rule that read it is gone, keep emitting the token as a DEPRECATED no-op with a comment\n' +
      "  saying what replaced it (see expansion's `marker-weight`). Renaming counts as removing.\n"
  );
  process.exit(1);
}

if (added.length) {
  console.error(`\n✖ ${added.length} new public design token(s) are not recorded:\n`);
  for (const t of added) console.error(`    ${t}`);
  console.error(
    '\n  Adding a token is fine (a MINOR change) — but it has to be recorded, or a later deletion of it\n' +
      '  would go unnoticed. Run `pnpm verify:ui-tokens --update` and commit the snapshot.\n'
  );
  process.exit(1);
}

console.log(`✔ public design-token contract intact (${current.length} tokens, none removed)`);
