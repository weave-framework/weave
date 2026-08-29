/**
 * `control={{ field }}` — the binding every `control`-taking component documents.
 *
 * The pickers declared their binding as `Signal<X | null | undefined>`, and a `Signal` is INVARIANT:
 * it is read AND written, so a `Signal<Date | null>` is not one. The consequence was that the exact
 * line each component's own documentation recommends — a `field<Date | null>(null)` handed to
 * `control` — did not type-check. Three of the docs site's demos were in that state.
 *
 * The binding now says what the components actually do: read tolerantly, write narrowly. The negative
 * case is what keeps that honest — a signal that CANNOT be given `null` must still be rejected, since
 * `null` is exactly what these components write when the value is cleared.
 *
 * Run: `node packages/ui/test/control-binding.smoke.mjs` (wired into `pnpm verify:ui-control`).
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

console.log('\npackages/ui/test/control-binding.smoke.mjs');

/** Type-check one source text as if it were a file in a real app. */
const errorsIn = (text) => {
  const dir = mkdtempSync(join(repo, 'tools', '.verify-ui-control-'));
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

// The documented binding, for all three pickers, in both field shapes people write.
const good = errorsIn(
  'import { field } from "@weave-framework/forms";\n' +
    'import type { DatepickerControl } from "@weave-framework/ui/datepicker";\n' +
    'import type { TimepickerControl, TimeValue } from "@weave-framework/ui/timepicker";\n' +
    'import type { DateRangePickerControl, DateRange } from "@weave-framework/ui/date-range-picker";\n' +
    'export const a: DatepickerControl = field<Date | null>(null);\n' +
    'export const b: DatepickerControl = field<Date | null | undefined>(null);\n' +
    'export const c: TimepickerControl = field<TimeValue | null>(null);\n' +
    'export const d: DateRangePickerControl = field<DateRange | null>(null);\n'
);
ok(good.length === 0, 'a forms field binds to control, narrow or wide (got ' + JSON.stringify(good) + ')');

// And a value that cannot be cleared is still refused: these components write `null`.
const bad = errorsIn(
  'import { signal } from "@weave-framework/runtime";\n' +
    'import type { DatepickerControl } from "@weave-framework/ui/datepicker";\n' +
    'export const nope: DatepickerControl = { value: signal(new Date()) };\n'
);
ok(bad.length > 0, 'a binding that cannot hold `null` is still an error');

if (failed) {
  console.error('\nX ' + failed + ' control-binding check(s) failed\n');
  process.exit(1);
}
console.log('\n+ control={{ field }} type-checks, and an unclearable binding does not\n');
process.exit(0);
