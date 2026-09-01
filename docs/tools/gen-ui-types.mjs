/**
 * Name every TYPE a UI component subpath exports, on that component's own page.
 *
 * An app author who writes a typed wrapper — `function IconButton(props: ButtonProps)` — needs the name
 * of the type, and the page had the prop TABLE but never the type. 98 of the UI package's exports were
 * named nowhere in the documentation for that reason: not missing from a table, missing from the corpus
 * entirely, so nothing could tell you they existed.
 *
 * This writes one line per page: the real import, with the real names, read from the source the package's
 * `exports` map points at. It invents nothing — no description is generated, because a generated sentence
 * about a type is a sentence nobody wrote and nobody checked.
 *
 * The block is delimited, so the rest of the page stays hand-written. `--check` fails instead of writing;
 * that is what CI runs (`verify:ui-types`).
 *
 * Run: `node docs/tools/gen-ui-types.mjs [--check]`
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const check = process.argv.includes('--check');
const pkg = JSON.parse(readFileSync('packages/ui/package.json', 'utf8'));

const BEGIN = '<!-- gen-ui-types:begin -->';
const END = '<!-- gen-ui-types:end -->';

/** Exported TYPE names of one module: `interface`/`type`/`enum` declarations and `export type { … }`. */
function typeNames(file) {
  const src = readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:declare\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s+type\s*\{([^}]*)\}/gm))
    for (const part of m[1].split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop().trim();
      if (n) names.add(n);
    }
  return [...names];
}

const stale = [];
let written = 0;
for (const [sub, map] of Object.entries(pkg.exports)) {
  if (!sub.startsWith('./') || sub === './package.json') continue;
  const entry = typeof map === 'string' ? map : map.import;
  if (!entry || !entry.endsWith('.ts')) continue;
  const file = 'packages/ui/' + entry.slice(2);
  if (!existsSync(file)) continue;
  const page = `docs/src/content/ui/${sub.slice(2)}.md`;
  if (!existsSync(page)) continue;

  const names = typeNames(file);
  if (!names.length) continue;

  const block = `${BEGIN}\n### Types\n\n~~~ts\nimport type { ${names.join(', ')} } from '@weave-framework/ui${sub.slice(1)}';\n~~~\n${END}`;
  let md = readFileSync(page, 'utf8');
  const has = md.includes(BEGIN) && md.includes(END);
  const current = has ? md.slice(md.indexOf(BEGIN), md.indexOf(END) + END.length) : null;
  if (current === block) continue;

  if (check) {
    stale.push(`${page} — ${has ? 'the Types block is stale' : 'no Types block'} (${names.join(', ')})`);
    continue;
  }
  if (has) md = md.slice(0, md.indexOf(BEGIN)) + block + md.slice(md.indexOf(END) + END.length);
  else {
    // Before the failure section if the page has one (every UI page does), else at the end.
    const at = md.search(/^## When it goes wrong/m);
    md = at === -1 ? `${md.trimEnd()}\n\n${block}\n` : md.slice(0, at) + block + '\n\n' + md.slice(at);
  }
  writeFileSync(page, md, 'utf8');
  written++;
}

if (check) {
  if (stale.length) {
    console.error(`\n✖ ${stale.length} UI page(s) do not name the types their subpath exports:\n`);
    for (const s of stale) console.error(`  ${s}`);
    console.error('\n  Run: node docs/tools/gen-ui-types.mjs\n');
    process.exit(1);
  }
  console.log('✓ every UI page names the types its subpath exports');
} else {
  console.log(`gen-ui-types → ${written} page(s) updated`);
}
