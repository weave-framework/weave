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
const { compileComponent } = await import(pathToFileURL(compilerJs).href);

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
    out = typeDefault(code, c.hasSetup);
  } catch (e) {
    ok(false, `[${c.name}] typeDefault threw: ${e.message}`);
    continue;
  }
  ok(out.includes(`const _weaveDefault = ${c.expect} as unknown as `), `[${c.name}] the emitted call is kept verbatim`);
  ok(out.trimEnd().endsWith('export default _weaveDefault;'), `[${c.name}] the module ends with the typed default`);
  ok(!/export default defineComponent\(/.test(out), `[${c.name}] the plain default is gone`);
  const propsType = c.hasSetup ? 'Parameters<typeof setup>[0]' : 'Record<string, unknown>';
  ok(out.includes(`(props: ${propsType},`), `[${c.name}] props type is ${propsType}`);
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
    typeDefault('export const nope = 1;\n', false);
  } catch {
    threw = true;
  }
  ok(threw, 'a module with no compileComponent default is rejected');
}

if (failed) {
  console.error(`\n✖ ${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\n✓ the ui publish build injects a typed default for every tail the compiler emits.');
