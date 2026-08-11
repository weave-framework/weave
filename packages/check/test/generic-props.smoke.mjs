/**
 * Node smoke test for @weave-framework/check — W-8: a GENERIC component's props.
 *
 * A component whose `setup` is generic used to ship a default export with its type parameters thrown
 * away. Both producers of that default flattened `setup`'s first parameter — `Parameters<typeof setup>[0]`
 * in the shipped `.d.ts`, `F extends (props: infer P, …)` in the virtual module — and TypeScript resolves
 * an UNINSTANTIATED generic's parameter to `unknown`, never to its declared default (a default applies to
 * a CALL, not to destructuring a type).
 *
 * The loud half was that `Select<Option>(…)` would not compile. The silent half is the one that matters:
 * a TEMPLATE checked its props against that same flattened default, so `options` was `unknown[]` and
 * accepted an array of anything at all — and a template cannot write a type argument, so an author had no
 * way to get the checking back.
 *
 * Run: `node packages/check/test/generic-props.smoke.mjs` (wired into verify:check).
 */
import { build as esbuild } from 'esbuild';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`);
  if (!cond) failures++;
};

const cacheDir = join(repo, 'node_modules', '.weave');
mkdirSync(cacheDir, { recursive: true });
const out = join(cacheDir, 'check-for-generic-props-test.mjs');
await esbuild({
  entryPoints: [join(repo, 'packages', 'check', 'src', 'index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  external: ['typescript'],
  outfile: out,
});
const { checkProject } = await import(pathToFileURL(out).href);

console.log('\npackages/check/test/generic-props.smoke.mjs');

/**
 * A generic `<Picker>` (the shape `@weave-framework/ui`'s data-driven components have: a type parameter
 * with a declared default, props typed through it) plus a parent template that uses it.
 */
function check(parentHtml, parentSetup = 'export function setup(): Record<string, never> { return {}; }\n') {
  const dir = mkdtempSync(join(tmpdir(), 'weave-generic-'));
  mkdirSync(join(dir, 'app'), { recursive: true });
  writeFileSync(
    join(dir, 'app', 'picker.ts'),
    'export interface PickerProps<T> {\n' +
      '  items: T[];\n' +
      '  label?: (item: T) => string;\n' +
      '  onPick?: (item: T) => void;\n' +
      '}\n' +
      'export function setup<T = { value: string }>(props: PickerProps<T>): { items: () => T[] } {\n' +
      '  return { items: (): T[] => props.items };\n' +
      '}\n'
  );
  writeFileSync(join(dir, 'app', 'picker.html'), '<div>{{ items().length }}</div>\n');
  writeFileSync(join(dir, 'app', 'page.ts'), `import Picker from './picker';\nvoid Picker;\n${parentSetup}`);
  writeFileSync(join(dir, 'app', 'page.html'), parentHtml);
  const diags = checkProject([dir]);
  rmSync(dir, { recursive: true, force: true });
  return diags.filter((d) => /page\.(ts|html)$/.test(d.file.replace(/\\/g, '/')));
}

// ── 1. THE SILENT ONE: a template passing items of the wrong shape must not compile. ──
{
  const setup =
    'export function setup(): { rows: () => Array<{ nope: string }> } {\n' +
    "  return { rows: () => [{ nope: 'x' }] };\n" +
    '}\n';
  const diags = check('<Picker items={{ rows() }} label={{ (i: { value: string }) => i.value }} />\n', setup);
  ok(diags.length > 0, 'items of the wrong shape are rejected — the checking the author wrote PickerProps<T> for');
}

// ── 2. Correct usage with a DOMAIN type (not the declared default) is silent. ──
{
  const setup =
    'export interface Row { id: number; name: string }\n' +
    'export function setup(): { rows: () => Row[]; show: (r: Row) => string } {\n' +
    "  return { rows: (): Row[] => [{ id: 1, name: 'a' }], show: (r: Row): string => r.name };\n" +
    '}\n';
  const diags = check('<Picker items={{ rows() }} label={{ show }} />\n', setup);
  ok(diags.length === 0, `a domain type flows through the type parameter (got: ${diags.map((d) => d.message).join(' | ')})`);
}

// ── 3. The parameter is INFERRED from the props, not fixed to the declared default. ──
{
  const setup =
    'export interface Row { id: number; name: string }\n' +
    'export function setup(): { rows: () => Row[]; take: (n: number) => void } {\n' +
    "  return { rows: (): Row[] => [{ id: 1, name: 'a' }], take: (_n: number): void => {} };\n" +
    '}\n';
  // `onPick` receives a Row, so handing it a `(n: number) => void` is a real mismatch.
  const diags = check('<Picker items={{ rows() }} onPick={{ take }} />\n', setup);
  ok(diags.length > 0, 'a callback prop is checked against the INFERRED parameter, not against `unknown`');
  ok(
    diags.some((d) => /Row|number/.test(d.message)),
    `and the message names the real types (got: ${diags.map((d) => d.message).join(' | ')})`
  );
}

// ── 4. Nothing regressed for an ordinary component: a wrong prop type is still caught, at the key. ──
{
  const dir = mkdtempSync(join(tmpdir(), 'weave-plain-'));
  mkdirSync(join(dir, 'app'), { recursive: true });
  writeFileSync(
    join(dir, 'app', 'chip.ts'),
    'export function setup(props: { label: string }): { label: () => string } {\n' +
      '  return { label: (): string => props.label };\n' +
      '}\n'
  );
  writeFileSync(join(dir, 'app', 'chip.html'), '<b>{{ label() }}</b>\n');
  writeFileSync(
    join(dir, 'app', 'page.ts'),
    "import Chip from './chip';\nvoid Chip;\nexport function setup(): { n: () => number } { return { n: (): number => 1 }; }\n"
  );
  writeFileSync(join(dir, 'app', 'page.html'), '<Chip label={{ n() }} />\n');
  const diags = checkProject([dir]).filter((d) => /page\.html$/.test(d.file.replace(/\\/g, '/')));
  rmSync(dir, { recursive: true, force: true });
  ok(diags.length > 0, 'a non-generic component still rejects a wrong prop type');
  // Checking by CALL moved this diagnostic from the prop KEY to the prop's EXPRESSION: TypeScript pins a
  // contextual mismatch in a call argument to the value, where it pinned an annotated const's to the key.
  // Both are MAPPED spans, so both reach the editor — the thing that must never regress is that it maps
  // at all, since an unmapped diagnostic is dropped by Volar and silently shows nothing.
  const col = '<Chip label={{ n() }} />'.indexOf('n()') + 1;
  ok(
    diags.some((d) => d.line === 1 && Math.abs(d.col - col) <= 2),
    `and it lands on the expression that is wrong (want ~1:${col}, got ${diags.map((d) => `${d.line}:${d.col}`).join(',')})`
  );
}

// ── 4b. An UNDECLARED prop reports on its expression too, and its MESSAGE names the prop. ──
// In a call argument TypeScript pins both classes of prop error to the value, where an annotated const
// put the excess-property one on the key. The span moved; nothing was lost, because the span it moved to
// is mapped and the message says which prop is wrong.
{
  const line = '<Picker items={{ [] }} nosuch={{ 1 }} />';
  const diags = check(`${line}\n`);
  const col = line.indexOf('{{ 1 }}') + 4;
  ok(
    diags.some((d) => d.line === 1 && Math.abs(d.col - col) <= 3 && /nosuch/.test(d.message)),
    `an undeclared prop is reported on its value, naming the prop (want ~1:${col}, got ${diags.map((d) => `${d.line}:${d.col}`).join(',')})`
  );
}

// ── 5. An undeclared prop is still rejected — the call must not widen what a child accepts. ──
{
  const diags = check('<Picker items={{ [] }} nosuch={{ 1 }} />\n');
  ok(
    diags.some((d) => /nosuch/.test(d.message)),
    `a prop the child does not declare is rejected (got: ${diags.map((d) => d.message).join(' | ')})`
  );
}

// ── 5b. A contract that REQUIRES accessors for an option type its defaults cannot read (W-8's
// criterion 4) reaches the template too. This is the shape `@weave-framework/ui` now ships: the
// requirement is conditional on the inferred parameter, so it can only work if the template
// instantiates the generic rather than flattening it. ──
{
  const dir = mkdtempSync(join(tmpdir(), 'weave-required-'));
  mkdirSync(join(dir, 'app'), { recursive: true });
  writeFileSync(
    join(dir, 'app', 'picker.ts'),
    'export type SelfDescribing = string | { value: string };\n' +
      'export type Needs<T> = [T] extends [SelfDescribing] ? unknown : { label: (item: T) => string };\n' +
      'export interface PickerProps<T> { items: T[]; label?: (item: T) => string }\n' +
      'export function setup<T = { value: string }>(props: PickerProps<T> & Needs<T>): { items: () => T[] } {\n' +
      '  return { items: (): T[] => props.items };\n' +
      '}\n'
  );
  writeFileSync(join(dir, 'app', 'picker.html'), '<div>{{ items().length }}</div>\n');
  const parent = (html, setup) => {
    writeFileSync(join(dir, 'app', 'page.ts'), `import Picker from './picker';\nvoid Picker;\n${setup}`);
    writeFileSync(join(dir, 'app', 'page.html'), html);
    return checkProject([dir]).filter((d) => /page\.(ts|html)$/.test(d.file.replace(/\\/g, '/')));
  };
  const domain =
    'export interface Row { id: string; name: string }\n' +
    'export function setup(): { rows: () => Row[]; show: (r: Row) => string } {\n' +
    "  return { rows: (): Row[] => [{ id: '1', name: 'a' }], show: (r: Row): string => r.name };\n" +
    '}\n';
  const missing = parent('<Picker items={{ rows() }} />\n', domain);
  ok(missing.length > 0, 'a domain option type with no accessor is rejected — the runtime would read undefined');
  const supplied = parent('<Picker items={{ rows() }} label={{ show }} />\n', domain);
  ok(supplied.length === 0, `and supplying it compiles (got: ${supplied.map((d) => d.message).join(' | ')})`);
  const selfDescribing =
    'export function setup(): { rows: () => Array<{ value: string }> } {\n' +
    "  return { rows: () => [{ value: 'a' }] };\n" +
    '}\n';
  const dflt = parent('<Picker items={{ rows() }} />\n', selfDescribing);
  ok(dflt.length === 0, `a self-describing option type still needs nothing (got: ${dflt.map((d) => d.message).join(' | ')})`);
  const empty = parent('<Picker items={{ [] }} />\n');
  ok(empty.length === 0, `and an empty list does not collapse the contract to never (got: ${empty.map((d) => d.message).join(' | ')})`);
  rmSync(dir, { recursive: true, force: true });
}

// ── 6. An unknown TAG still surfaces on the tag itself, not swallowed by the call shape. ──
{
  const diags = check('<Nope items={{ [] }} />\n');
  ok(
    diags.some((d) => /Cannot find name 'Nope'/.test(d.message)),
    `an unknown component tag is still reported (got: ${diags.map((d) => d.message).join(' | ')})`
  );
}

rmSync(out, { force: true });

if (failures) {
  console.error(`\n✗ ${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\n✓ a generic component's props are checked against its own type parameter.");
