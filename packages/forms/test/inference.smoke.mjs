/**
 * `field()` takes its type from the VALUE, and from nothing else.
 *
 * `field('')` widened to `Field<string>`, but `field('', [validators.required()])` — the same line with
 * the most ordinary validator on it — froze into `Field<''>`: a field that could never hold any other
 * string. The cause is that the ready-made validators are typed for what they ACCEPT (`required` takes
 * `unknown`), so the validator array was a second, contradictory inference site for the value type.
 *
 * This is a type-level property, so it is checked by running the type checker over a fixture. The
 * NEGATIVE case is what keeps the gate honest: a genuinely wrong assignment must still be an error, or
 * a fixture that silently stopped being type-checked would pass forever.
 *
 * Run: `node packages/forms/test/inference.smoke.mjs` (wired into `pnpm verify:forms-inference`).
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

console.log('\npackages/forms/test/inference.smoke.mjs');

/** Type-check one source text as if it were a file in a real app, and return its error messages. */
const errorsIn = (text) => {
  const dir = mkdtempSync(join(repo, 'tools', '.verify-forms-inference-'));
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

const HEAD = 'import { field, validators, type Field } from "@weave-framework/forms";\n';

// A validator does not get a vote on the value type — in any of the shapes people actually write.
const good = errorsIn(
  HEAD +
    'export const a: Field<string> = field("");\n' +
    'export const b: Field<string> = field("", [validators.required("Required")]);\n' +
    'export const c: Field<boolean> = field(false, [validators.required()]);\n' +
    'export const d: Field<number> = field(0, [validators.min(1)]);\n' +
    'b.value.set("something else");\n'
);
ok(good.length === 0, 'a field is typed by its value, validators or not (got ' + JSON.stringify(good) + ')');

// And the checker really is looking: a value that genuinely does not fit must still be an error.
const bad = errorsIn(HEAD + 'export const wrong: Field<number> = field("");\n');
ok(bad.length > 0, 'a field really assigned to the wrong type is still caught');

if (failed) {
  console.error('\nX ' + failed + ' inference check(s) failed\n');
  process.exit(1);
}
console.log('\n+ field() takes its type from the value\n');
process.exit(0);
