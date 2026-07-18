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
//
// Pass 2 checks the OTHER direction, and it is the one prose gets wrong. /ui/theming — the
// page that teaches the token system — offered `--weave-button-fill` and
// `--weave-input-underline` as its worked examples. Neither has ever existed (they are
// `--weave-button-background` and `--weave-input-border`). A reader following that page
// would set a variable nothing reads and watch nothing happen. So every `--weave-*` name
// the docs NAME, prose included, is checked against the vars the library actually emits.

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

/* ── Pass 2: every `--weave-*` name the docs mention must be one the library emits. ──
   Ground truth is the built stylesheet, not a list I keep in step by hand. */
const CSS = join(ROOT, 'dist', 'app.css');
let weaveBroken = [];
try {
  const built = readFileSync(CSS, 'utf8');
  const real = new Set([...built.matchAll(/(--weave-[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
  if (real.size < 50) throw new Error(`only ${real.size} --weave-* vars in dist/app.css — stale or partial build`);

  const mentioned = new Map();
  for (const f of (await walk(SRC)).filter((f) => /\.(scss|css|html|ts|md)$/.test(f) && !f.endsWith('.gen.ts'))) {
    const src = readFileSync(f, 'utf8');
    // A file may legitimately name tokens that do not exist HERE: /ui/theming documents
    // `weave.define('rating', …)`, which mints `--weave-rating-*` in the READER'S app. So a
    // prefix registered by a define() in the same file is its own authority. Anything else
    // claiming to be a built-in has to actually be one.
    const local = new Set([...src.matchAll(/define\(\s*['"]([a-z0-9-]+)['"]/gi)].map((m) => m[1]));
    src.split(/\r?\n/).forEach((line, i) => {
      for (const m of line.matchAll(/(--weave-([a-z0-9-]+))/gi)) {
        // A documented PATTERN, not a token: `--weave-grid-list-<key>` describes the shape of a
        // family. The regex stops at `<` and captures `--weave-grid-list-`, a trailing-dash
        // fragment the library can never emit — a false failure. (`--weave-<name>-<key>` never
        // tripped this, because there the placeholder starts immediately; only a real prefix
        // followed by `<` does.) A genuine token reference is never followed by `<`.
        if (line[m.index + m[0].length] === '<') continue;
        if ([...local].some((n) => m[2].startsWith(n + '-'))) continue;
        if (!mentioned.has(m[1])) mentioned.set(m[1], []);
        mentioned.get(m[1]).push({ file: relative(ROOT, f), line: i + 1 });
      }
    });
  }
  weaveBroken = [...mentioned.entries()].filter(([n]) => !real.has(n));
} catch (e) {
  // No built stylesheet at all → SKIP this pass (don't fail): pass 2 needs dist/app.css as its
  // ground truth, and a bare `pnpm docs:tokens` before any build should not false-fail. CI runs
  // `docs:build` first, so it always has one. A build that EXISTS but is stale/partial is a real
  // problem, so that still fails.
  if (e.code === 'ENOENT') {
    console.warn('\n⚠ skipping the --weave-* name check: dist/app.css not built (run `pnpm docs:build` to include it).\n');
  } else {
    console.error(`\n✖ cannot verify --weave-* names: ${e.message}\n`);
    process.exit(1);
  }
}

if (weaveBroken.length) {
  console.error('\n✖ the docs name --weave-* tokens the library does not emit:\n');
  for (const [name, sites] of weaveBroken) {
    console.error(`  ${name}`);
    for (const s of sites.slice(0, 4)) console.error(`      ${s.file}:${s.line}`);
    console.error('');
  }
  process.exit(1);
}

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
