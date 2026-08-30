/**
 * `component(X, props)` — the documented way to put a component into a dialog or a sheet.
 *
 * It took a {@link Component}, which is `(props?: Record<string, unknown>, …) => Node`. A component
 * compiled from a template that declares typed props is `(props: TheseProps, …) => Node`, and that is
 * NOT assignable: parameters are contravariant, so a function requiring `TheseProps` cannot stand in
 * where one accepting `undefined` is expected. In other words the normal case — a dialog header, a
 * form, an editor, anything that takes props — did not type-check at the exact call the documentation
 * shows. A real app hit it 57 times in one run.
 *
 * `never` in the props position is the same fix `lazy()` already carries for routed pages that declare
 * required props (`LoadedComponent` in `runtime/dom.ts`): it accepts any props shape, and is honest
 * here because this helper only forwards what it is handed and never reads it.
 *
 * The negative case is what keeps that from being "accept everything": a value that is not callable
 * must still be refused.
 *
 * Run: `node packages/ui/test/overlay-component.smoke.mjs` (wired into `pnpm verify:ui-overlay`).
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

console.log('\npackages/ui/test/overlay-component.smoke.mjs');

/** Type-check one source text as if it were a file in a real app. */
const errorsIn = (text) => {
  const dir = mkdtempSync(join(repo, 'tools', '.verify-ui-overlay-'));
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

const TYPED_COMPONENT =
  'interface HeaderProps { title: () => string; onClose: () => void }\n' +
  'declare const DialogHeader: (props: HeaderProps, slots?: Record<string, () => Node>) => Node;\n';

// The call the documentation shows, with the component shape the compiler actually emits.
const typed = errorsIn(
  'import { component } from "@weave-framework/ui/dialog";\n' +
    TYPED_COMPONENT +
    'export const used = component(DialogHeader, { title: () => "x", onClose: () => {} });\n'
);
ok(typed.length === 0, 'a component with typed props goes into a dialog (got ' + JSON.stringify(typed) + ')');

// A component with no declared props must keep working — it is the shape the type was written for.
const untyped = errorsIn(
  'import { component } from "@weave-framework/ui/dialog";\n' +
    'declare const Plain: (props?: Record<string, unknown>, slots?: Record<string, () => Node>) => Node;\n' +
    'export const used = component(Plain, { a: 1 });\n'
);
ok(untyped.length === 0, 'and so does one without (got ' + JSON.stringify(untyped) + ')');

// Without this, "accepts a typed component" is satisfied by a parameter that accepts anything at all.
const notAComponent = errorsIn(
  'import { component } from "@weave-framework/ui/dialog";\n' + 'export const nope = component(42 as unknown as number);\n'
);
ok(notAComponent.length > 0, 'a value that is not callable is still refused');

// The same shape reaches `openDialog` through its config, which is where a real app writes it.
const inConfig = errorsIn(
  'import { openDialog, component } from "@weave-framework/ui/dialog";\n' +
    TYPED_COMPONENT +
    'export const d = openDialog({ content: component(DialogHeader, { title: () => "x", onClose: () => {} }) });\n'
);
ok(inConfig.length === 0, 'and it type-checks inside an openDialog config (got ' + JSON.stringify(inConfig) + ')');

// A real app passed `class` to `<Icon>` — 30 of the library's 45 components take one, and this did not.
const iconClass = errorsIn(
  'import type { IconProps } from "@weave-framework/ui/icon";\n' +
    'export const p: IconProps = { name: "check", class: "mine" };\n'
);
ok(iconClass.length === 0, 'an Icon takes a per-instance class (got ' + JSON.stringify(iconClass) + ')');

if (failed) {
  console.error('\nX ' + failed + ' overlay-component check(s) failed\n');
  process.exit(1);
}
console.log('\n+ a component with typed props goes into an overlay, and a non-component does not\n');
process.exit(0);
