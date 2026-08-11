/**
 * Gate on the ui publish build's typed-default injection (`tools/ui-typed-default.mjs`).
 *
 * WHY: `build-ui-components.mjs` rewrites each compiled component's default export so the dist
 * ships a props-typed callable. It used to do that by RECONSTRUCTING the expected tail —
 * `export default defineComponent(render, setup);` — and throwing on anything else. But the
 * compiler emits four different tails, and one of them is what a component gets the moment it
 * declares `export const propDefaults` (a shipped feature): a THIRD argument. So the first ui
 * component to use propDefaults would fail the publish build, with a message blaming the
 * compiler. Nothing caught it because no ui component uses propDefaults yet.
 *
 * This runs the REAL compiler over one component per tail shape and asserts the injection keeps
 * whatever it emitted, verbatim. It is the gate for that class of failure, not for one shape.
 */
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { typeDefault } from './ui-typed-default.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));

let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error(`✖ ${msg}`);
    failed++;
  } else {
    console.log(`✔ ${msg}`);
  }
};

// Bundle the compiler so this script calls the same `compileComponent` the build does.
const tmp = mkdtempSync(join(tmpdir(), 'weave-typed-default-'));
const compilerJs = join(tmp, 'compiler.mjs');
await build({
  entryPoints: [join(repo, 'packages/compiler/src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: compilerJs,
});
const { compileComponent, genericDefaultProps } = await import(pathToFileURL(compilerJs).href);

/** One component per tail the compiler can emit. `expect` is the call it must produce. */
const CASES = [
  {
    name: 'no setup',
    script: '',
    template: '<div class="x">hi</div>',
    hasSetup: false,
    expect: 'defineComponent(render)',
  },
  {
    name: 'setup',
    script: `export function setup(props: { label?: string }) { return { label: props.label ?? '' }; }`,
    template: '<div>{{ label }}</div>',
    hasSetup: true,
    expect: 'defineComponent(render, setup)',
  },
  {
    name: 'setup + propDefaults',
    script:
      `export const propDefaults = { size: 'md' };\n` +
      `export function setup(props: { size?: string }) { return { size: props.size ?? '' }; }`,
    template: '<div>{{ size }}</div>',
    hasSetup: true,
    expect: 'defineComponent(render, setup, propDefaults)',
  },
  {
    name: 'propDefaults, no setup',
    script: `export const propDefaults = { size: 'md' };`,
    template: '<div class="x">hi</div>',
    hasSetup: false,
    expect: 'defineComponent(render, undefined, propDefaults)',
  },
  {
    name: 'extend (RFC 0008)',
    script: `import Base from './base.js';\nexport const extend = Base;`,
    template: '<div class="x">hi</div>',
    hasSetup: false,
    expect: 'defineComponent(render, extendSetup(extend, undefined))',
  },
];

for (const c of CASES) {
  const { code } = compileComponent(
    { script: c.script, template: c.template, styles: undefined },
    { filename: `case-${c.name}.ts` }
  );
  // The premise first: if the compiler stops emitting this tail, say so loudly here rather than
  // letting the assertion below pass for the wrong reason.
  ok(
    code.includes(`export default ${c.expect};`),
    `[${c.name}] the compiler emits \`${c.expect}\``
  );

  let out;
  try {
    out = typeDefault(code, c.hasSetup, genericDefaultProps, c.name);
  } catch (e) {
    ok(false, `[${c.name}] typeDefault threw: ${e.message}`);
    continue;
  }
  ok(out.includes(`const _weaveDefault = ${c.expect} as unknown as `), `[${c.name}] the emitted call is kept verbatim`);
  ok(out.trimEnd().endsWith('export default _weaveDefault;'), `[${c.name}] the module ends with the typed default`);
  ok(!/export default defineComponent\(/.test(out), `[${c.name}] the plain default is gone`);
  const propsType = c.hasSetup ? 'Parameters<typeof setup>[0]' : 'Record<string, unknown>';
  ok(out.includes(`(props: ${propsType},`), `[${c.name}] props type is ${propsType}`);
  // A component instance always returns its DOM — the runtime's own `Component` says so. `unknown`
  // here cost every imperative call site a cast, which is most of the composition surface.
  ok(out.includes(`slots?: Record<string, () => Node>) => Node;`), `[${c.name}] returns Node, and slots are () => Node`);
  // Everything before the default export must survive untouched (render body, imports, setup).
  ok(
    out.startsWith(code.slice(0, code.lastIndexOf('export default '))),
    `[${c.name}] the module body above the default is unchanged`
  );
}

// A module the compiler could not have produced must still be rejected, not silently mangled.
{
  let threw = false;
  try {
    typeDefault('export const nope = 1;\n', false, genericDefaultProps, 'nope');
  } catch {
    threw = true;
  }
  ok(threw, 'a module with no compileComponent default is rejected');
}

/* ── W-8 — a GENERIC setup's type parameters must survive onto the default export ──
 * `Parameters<typeof setup>[0]` applied to an uninstantiated generic resolves every type parameter to
 * `unknown`; the declared default does not apply, because a default is for a CALL, not for destructuring
 * a type. So `<Select options={{ … }}>` was checked against `unknown[]` and took an array of anything —
 * in a template, where an author cannot write a type argument to get the checking back.
 *
 * One case per declaration shape the ui package actually uses, because each writes it differently. */
const GENERIC_CASES = [
  { name: 'inline object default', decl: 'export function setup<T = { value: string; label: string }>(props: SelectProps<T>)', typeParams: 'T = { value: string; label: string }', propsType: 'SelectProps<T>' },
  { name: 'T = unknown', decl: 'export function setup<T = unknown>(props: ListProps<T>)', typeParams: 'T = unknown', propsType: 'ListProps<T>' },
  { name: 'T = Record<…>', decl: 'export function setup<T = Record<string, unknown>>(props: TableProps<T>)', typeParams: 'T = Record<string, unknown>', propsType: 'TableProps<T>' },
  { name: 'a differently-named parameter', decl: 'export function setup<N = unknown>(props: TreeProps<N>)', typeParams: 'N = unknown', propsType: 'TreeProps<N>' },
  { name: 'constrained + a function-typed default', decl: 'export function setup<T extends object = () => void>(props: XProps<T>)', typeParams: 'T extends object = () => void', propsType: 'XProps<T>' },
  // RENAMED in the destructure on purpose: `{ items }` has no colon inside it, so it cannot tell a
  // depth-aware scan from one that takes the first colon it sees. `{ items: rows }` can.
  { name: 'a destructured props parameter', decl: 'export function setup<T = unknown>({ items: rows }: YProps<T>)', typeParams: 'T = unknown', propsType: 'YProps<T>' },
  // A second parameter is a real shape (`setup(props, base)` for an extension) and must not be swallowed.
  { name: 'a second parameter', decl: 'export function setup<T = unknown>(props: WProps<T>, base: BaseCtx)', typeParams: 'T = unknown', propsType: 'WProps<T>' },
  // An optional props parameter — the `?` sits before the colon, so it must not become part of the type.
  { name: 'an optional props parameter', decl: 'export function setup<T = unknown>(props?: VProps<T>)', typeParams: 'T = unknown', propsType: 'VProps<T>' },
  { name: 'an arrow-declared setup', decl: 'export const setup = <T = unknown,>(props: ZProps<T>): { a: number } => ({ a: 1 })', typeParams: 'T = unknown', propsType: 'ZProps<T>' },
];

for (const g of GENERIC_CASES) {
  const script = `${g.decl} { return { a: 1 }; }`;
  const read = genericDefaultProps(script);
  ok(read?.typeParams === g.typeParams, `[generic: ${g.name}] type parameters read as \`${g.typeParams}\` (got \`${read?.typeParams}\`)`);
  ok(read?.propsType === g.propsType, `[generic: ${g.name}] props type read as \`${g.propsType}\` (got \`${read?.propsType}\`)`);
  const { code } = compileComponent({ script, template: '<div>x</div>', styles: undefined }, { filename: 'g.ts' });
  const out = typeDefault(code, true, genericDefaultProps, g.name);
  ok(
    out.includes(`as unknown as <${g.typeParams}>(props: ${g.propsType}, slots?: Record<string, () => Node>) => Node;`),
    `[generic: ${g.name}] the default carries them instead of flattening to \`unknown\``
  );
  ok(!out.includes('Parameters<typeof setup>[0]'), `[generic: ${g.name}] the lossy extraction is gone`);
}

// A generic setup with no annotation on its props parameter cannot be carried — and degrading it silently
// to `unknown` is the whole defect, so it fails the build naming the component.
{
  const script = 'export function setup<T = unknown>(props) { return { a: 1 }; }';
  const { code } = compileComponent({ script, template: '<div>x</div>', styles: undefined }, { filename: 'bad.ts' });
  let message = '';
  try {
    typeDefault(code, true, genericDefaultProps, 'src/bad/bad.ts');
  } catch (e) {
    message = e.message;
  }
  ok(/generic/.test(message) && /src\/bad\/bad\.ts/.test(message), `an unannotated generic setup fails the build, naming the component (got: ${message || 'no error'})`);
}

// And the REAL components: every generic one in the ui source must be readable. A new one that is not
// would otherwise ship its props as `unknown` with nothing saying so.
{
  const { readFileSync, readdirSync } = await import('node:fs');
  const src = join(repo, 'packages/ui/src');
  const generic = [];
  for (const dir of readdirSync(src, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const file = join(src, dir.name, `${dir.name}.ts`);
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!/export\s+(?:async\s+)?function\s+setup\s*</.test(text)) continue;
    generic.push(dir.name);
    const read = genericDefaultProps(text);
    ok(!!read?.typeParams && !!read?.propsType, `[ui/${dir.name}] its generic setup is readable (${read?.typeParams ?? 'unreadable'})`);
  }
  ok(generic.length >= 6, `every data-driven ui component is covered (found ${generic.length}: ${generic.join(', ')})`);
}

if (failed) {
  console.error(`\n✖ ${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\n✓ the ui publish build injects a typed default for every tail the compiler emits.');
