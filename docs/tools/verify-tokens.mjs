// Gate: every `var(--x)` the docs reference must actually be defined.
//
// Why this exists: `--fg-muted` was referenced 129 times across 127 demo files and was
// NEVER defined (the real token is `--muted`). CSS answers an undefined var by silently
// falling back — so every one of those demos rendered its "muted" caption in full body
// ink, at full size, and nothing anywhere said a word. `--bg-subtle` and `--field` were
// broken the same way. It was found by eye, in a screenshot, months late.
//
// A fallback does NOT excuse an undefined var: `var(--bg-subtle, transparent)` is just
// `transparent` written the long way round. If the name is undefined the fallback always
// wins, which is never what the author meant. So an undefined name fails here either way.

import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = join(ROOT, 'src');

/** Names the docs do not own: Weave-UI emits `--weave-*` from its theme() mixin. */
const EXTERNAL = /^--weave-/;

/**
 * Only code the docs SITE renders is in scope.
 *
 * `src/content/**` is deliberately excluded, and the distinction is not a technicality:
 * prose is full of code written for the READER'S app, not ours. `learn/styling.md` teaches
 * you to define `--surface-2` / `--text` / `--radius` in your own `main.scss` and then use
 * them — internally consistent, and none of our business. A gate that "fixed" those would
 * be vandalising correct documentation. (Generated `*.gen.ts` mirrors that same prose.)
 */
const IN_SCOPE = (p) => !/[\\/]content[\\/]/.test(p) && !p.endsWith('.gen.ts');

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = (await walk(SRC)).filter(IN_SCOPE);

// 1. Collect every custom property the docs DEFINE (`--name:` at a declaration position).
const defined = new Set();
for (const f of files.filter((f) => f.endsWith('.scss') || f.endsWith('.css'))) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(^|[;{\s])(--[a-z0-9-]+)\s*:/gi)) defined.add(m[2]);
}

// 2. Collect every custom property the docs USE, and where.
const used = new Map(); // name -> [{file, line}]
for (const f of files.filter((f) => /\.(scss|css|html|ts)$/.test(f))) {
  const lines = readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
      const name = m[1];
      if (EXTERNAL.test(name)) continue;
      if (!used.has(name)) used.set(name, []);
      used.get(name).push({ file: relative(ROOT, f), line: i + 1 });
    }
  });
}

// 3. Report every used-but-undefined name.
const broken = [...used.entries()].filter(([name]) => !defined.has(name));

if (broken.length) {
  console.error('\n✖ undefined CSS custom properties referenced by the docs:\n');
  for (const [name, sites] of broken.sort((a, b) => b[1].length - a[1].length)) {
    console.error(`  ${name} — ${sites.length} reference${sites.length > 1 ? 's' : ''}`);
    for (const s of sites.slice(0, 4)) console.error(`      ${s.file}:${s.line}`);
    if (sites.length > 4) console.error(`      … and ${sites.length - 4} more`);
    console.error('');
  }
  console.error(`Defined names available: ${[...defined].sort().join(' ')}\n`);
  process.exit(1);
}

console.log(`✓ docs tokens: ${used.size} custom properties referenced, all defined (${defined.size} defined in total).`);
