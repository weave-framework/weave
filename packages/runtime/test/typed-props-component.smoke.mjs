/**
 * Every place that ACCEPTS a component must accept one that declares typed props.
 *
 * `Component` is `(props?: Record<string, unknown>, …) => Node`. What the compiler emits for a
 * component whose template declares props is `(props: TheseProps, …) => Node`, and that is not
 * assignable: parameters are contravariant, so a function requiring `TheseProps` cannot stand in for
 * one that may be called with `undefined`. Every API that takes `Component` therefore rejects the
 * ordinary case, at the exact call its own documentation shows.
 *
 * This has now been found three separate times — `lazy()` (3.2.0, a routed page with `params`),
 * `component()` for dialogs, and a route's own `component` — each by a real application rather than by
 * anything in this repository. So this checks the FAMILY rather than the instance: one probe per
 * author-facing entry point, so the next one cannot be missed the same way.
 *
 * The negative case matters as much: a value that is not a component at all must still be refused, or
 * "accepts a typed component" is satisfied by a parameter that accepts anything.
 *
 * Run: `node packages/runtime/test/typed-props-component.smoke.mjs` (wired into `pnpm verify:typed-props`).
 */
import ts from 'typescript';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error('X ' + msg);
    failed++;
  } else console.log('+ ' + msg);
};

console.log('\npackages/runtime/test/typed-props-component.smoke.mjs');

const errorsIn = (text) => {
  const dir = mkdtempSync(join(repo, 'tools', '.verify-typed-props-'));
  const file = join(dir, 'probe.ts');
  writeFileSync(file, text);
  const program = ts.createProgram([file], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    types: [],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  });
  const sf = program.getSourceFile(file);
  const diags = [...program.getSemanticDiagnostics(sf), ...program.getSyntacticDiagnostics(sf)];
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  return diags.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
};

/** A page as the compiler emits it: props are required and typed. */
const PAGE =
  'interface PageProps { params: { id: string } }\n' +
  'declare const Page: (props: PageProps, slots?: Record<string, () => Node>) => Node;\n';

const cases = [
  [
    'a route takes a page with typed props',
    'import { route } from "@weave-framework/router";\n' +
      PAGE +
      'export const r = route("/doc/:id", { component: Page });\n',
  ],
  [
    'mountComponent takes a root with typed props',
    'import { mountComponent } from "@weave-framework/runtime/dom";\n' +
      PAGE +
      'export const m = mountComponent(Page, "#app");\n',
  ],
  [
    'defineCustomElement takes one',
    'import { defineCustomElement } from "@weave-framework/runtime/dom";\n' +
      PAGE +
      'defineCustomElement("x-page", Page);\nexport {};\n',
  ],
  [
    'a lazy `loading` fallback may declare props',
    'import { lazy } from "@weave-framework/runtime/dom";\n' +
      PAGE +
      'export const L = lazy(() => import("./nowhere.js") as never, { loading: Page });\n',
  ],
  [
    'renderComponent takes one',
    'import { renderComponent } from "@weave-framework/runtime/server";\n' +
      PAGE +
      'export const html = renderComponent(Page, { params: { id: "1" } });\n',
  ],
];

for (const [what, src] of cases) {
  const errs = errorsIn(src).filter((e) => !/Cannot find module '\.\/nowhere/.test(e));
  ok(errs.length === 0, `${what} (got ${JSON.stringify(errs)})`);
}

// Guard: this must not have become "accepts anything".
const notAComponent = errorsIn(
  'import { mountComponent } from "@weave-framework/runtime/dom";\n' +
    'export const m = mountComponent(42 as unknown as number, "#app");\n'
);
ok(notAComponent.length > 0, 'a value that is not callable is still refused');

// And a component with NO declared props must keep working — the shape the type was written for.
const plain = errorsIn(
  'import { mountComponent } from "@weave-framework/runtime/dom";\n' +
    'declare const Plain: (props?: Record<string, unknown>, slots?: Record<string, () => Node>) => Node;\n' +
    'export const m = mountComponent(Plain, "#app");\n'
);
ok(plain.length === 0, 'a component without declared props still mounts (got ' + JSON.stringify(plain) + ')');

if (failed) {
  console.error('\nX ' + failed + ' typed-props check(s) failed\n');
  process.exit(1);
}
console.log('\n+ every entry point that takes a component takes one with typed props\n');
process.exit(0);
