/**
 * Print the RELEASE-NOTES.md section for one version — the body used as the GitHub
 * Release notes. The publish workflow runs this before creating the Release.
 *
 * A release section is a `## <version>` heading (optionally `## <version> — <date>`)
 * and everything under it up to the next `## ` heading. The heading line itself is
 * dropped (the Release already carries the version as its title).
 *
 * Fails loud (exit 1) if there is no section for the requested version — so a publish
 * that forgot to write the notes stops BEFORE anything reaches npm, rather than shipping
 * an empty Release.
 *
 * Usage:
 *   node tools/extract-release-notes.mjs 0.2.53
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (!version) {
  process.stderr.write('usage: node tools/extract-release-notes.mjs <version>\n');
  process.exit(2);
}

const file = fileURLToPath(new URL('../RELEASE-NOTES.md', import.meta.url));
const lines = readFileSync(file, 'utf8').split(/\r?\n/);

const isHeading = (l) => /^##\s+/.test(l);
// The first whitespace-delimited token after "## " is the version (so "## 0.2.53 — date" matches "0.2.53").
const headingVersion = (l) => (/^##\s+(\S+)/.exec(l) ?? [])[1];

let start = -1;
for (let i = 0; i < lines.length; i++) {
  if (isHeading(lines[i]) && headingVersion(lines[i]) === version) {
    start = i;
    break;
  }
}

if (start === -1) {
  process.stderr.write(
    `No RELEASE-NOTES.md section for version ${version} — expected a "## ${version}" heading. ` +
      'Write the notes (rename the "## Unreleased" section) before the [publish] commit.\n',
  );
  process.exit(1);
}

let end = lines.length;
for (let i = start + 1; i < lines.length; i++) {
  if (isHeading(lines[i])) {
    end = i;
    break;
  }
}

const body = lines
  .slice(start + 1, end)
  .join('\n')
  .trim();

if (!body) {
  process.stderr.write(`RELEASE-NOTES.md section for ${version} is empty.\n`);
  process.exit(1);
}

process.stdout.write(body + '\n');
