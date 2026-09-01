/**
 * No source file holds a raw control byte.
 *
 * Not a style rule. A `\b`, `\f`, `\x00` or `\x01` typed into a shell heredoc is INTERPRETED on the way
 * to disk, so the file ends up holding the character the escape names instead of the escape. What it
 * then does is invisible, because every text tool reacts by refusing to read the file: `grep` reports
 * `Binary file … matches` and prints nothing, and a reviewer scrolls past.
 *
 * Five were found in one scan, and one of them was reader-facing: a published page showed
 * `D:\my-app\src<FF>eatures<BS>readcrumbs` where a Windows path was meant — the `\f` and the `\b` had
 * been eaten. Two more sat in the URL-normalizing regex that guards `href` and `<Icon svg={…}>` against
 * a scheme split by a control character; those behaved correctly and still made their file unreadable
 * to search.
 *
 * The value is never the problem — `\u0000` as a separator is fine. Writing it as a BYTE is.
 *
 * Read-only. Run: `node tools/verify-no-control-bytes.mjs`
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

const SKIP = new Set(['node_modules', 'dist', '.git', '.aigit', 'coverage', '.compiled', '.pnpm-store']);
const EXT = /\.(ts|tsx|mjs|cjs|js|jsx|md|html|scss|css|json|yml|yaml)$/;

/** Tab (9), LF (10) and CR (13) are text. Everything else below 32 is not. */
const isControl = (b) => b < 9 || b === 11 || b === 12 || (b >= 14 && b < 32);

const VISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;
const hex = (n) => '0x' + n.toString(16).padStart(2, '0');

const found = [];
let scanned = 0;
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const f = join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else if (EXT.test(e.name)) {
      scanned++;
      const buf = readFileSync(f);
      for (let i = 0; i < buf.length; i++) {
        if (!isControl(buf[i])) continue;
        // Show the neighbourhood, with the offender itself made visible.
        const near = buf
          .subarray(Math.max(0, i - 40), i + 20)
          .toString('utf8')
          .replace(VISIBLE, (c) => '<' + hex(c.charCodeAt(0)) + '>')
          .replace(/[\r\n]+/g, ' ');
        found.push({ file: f.split(sep).join('/'), byte: hex(buf[i]), at: i, near });
        break;
      }
    }
  }
})('.');

console.log(`\ntools/verify-no-control-bytes.mjs — ${scanned} source files scanned`);
if (found.length) {
  console.error(`\n✖ ${found.length} file(s) hold a raw control byte — an escape was interpreted before it reached disk:\n`);
  for (const f of found) console.error(`  ${f.file}  ${f.byte} at offset ${f.at}\n      …${f.near}…\n`);
  console.error('  Write the ESCAPE, not the byte. The value is fine; the byte is not.');
  process.exit(1);
}
console.log('✓ no source file holds a raw control byte\n');
