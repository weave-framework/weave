/**
 * Every `var(--token)` the migration UI reads must be defined somewhere in its own stylesheets.
 *
 * This gate exists because of a failure that produced no error anywhere: `--orange` was never defined, so the
 * legend's service swatch, the guard marks on every card and the guard edges all resolved to nothing and drew
 * invisibly. CSS has no such thing as an undefined-variable error — it simply skips the declaration — so the
 * only signal was a person noticing white on white and saying so.
 *
 * Run: `node packages/migrate/test/tokens.smoke.mjs` (part of `pnpm verify:migrate-ui`).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const uiSrc = join(here, '..', 'ui', 'src');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`);
  if (!cond) failures++;
};

console.log('\nverify:migrate-tokens — every var(--x) the UI reads is defined\n');

/** Every .scss/.css file under the UI source. */
const styleFiles = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (['.scss', '.css'].includes(extname(full))) styleFiles.push(full);
  }
};
walk(uiSrc);

const sources = styleFiles.map((f) => ({ file: f, text: readFileSync(f, 'utf8') }));
const all = sources.map((s) => s.text).join('\n');

// Declarations: `--name:` at the start of a declaration. Uses: `var(--name)`, ignoring any fallback.
const declared = new Set([...all.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
const used = new Map();
for (const { file, text } of sources) {
  for (const m of text.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
    if (!used.has(m[1])) used.set(m[1], file);
  }
}

// Tokens the UI library defines for itself (`--w-*`) come from its own stylesheet, not ours.
const ours = [...used.keys()].filter((t) => !t.startsWith('--w-'));
const missing = ours.filter((t) => !declared.has(t));

console.log(`  ${styleFiles.length} stylesheet(s) · ${declared.size} declared · ${ours.length} read`);
ok(missing.length === 0, missing.length ? `undefined and silently invisible: ${missing.join(', ')}` : 'no token is read without being defined');
for (const token of missing) console.log(`      ${token} — first read in ${used.get(token).replace(uiSrc, 'ui/src')}`);

console.log(`\n${failures ? `${failures} failing` : 'all green'}\n`);
process.exit(failures ? 1 : 0);
