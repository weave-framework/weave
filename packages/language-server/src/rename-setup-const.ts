/**
 * Rename, unified across the template and the `const` behind it.
 *
 * Renaming a template binding already works: Volar maps `{{ count() }}` to `__ctx.count` over
 * `type __WeaveCtx = ReturnType<typeof setup>`, TypeScript renames the ctx PROPERTY, and the `.html`
 * and the sibling `.ts` are edited together. What it does to the `.ts` is the defect: `return { count }`
 * is a *shorthand*, and renaming a property cannot rename the const behind it, so TypeScript takes the
 * only safe option it has and expands it to `return { total: count }`.
 *
 * That compiles and runs, and is not what anyone meant — in Weave the return is a mirror of the
 * component's own names (usually written for you by auto-expose), so the author is left with two names
 * for one thing.
 *
 * The obvious repair is a trap, and was measured to be one: collapsing the shorthand back to `{ total }`
 * WITHOUT renaming the const yields a file that does not compile. And the const cannot be renamed by
 * hand either — it is normally read elsewhere in `setup` (the scaffold's own `inc` reads `count`), and a
 * declaration renamed without its references is a silent breakage.
 *
 * So the const's rename is not hand-rolled: it is asked of TypeScript, which finds every reference
 * correctly. The semantic TS service hands out its own `ts.LanguageService` through `provide`, and the
 * component's script is embedded VERBATIM at the top of the virtual module — so an offset in the `.ts`
 * is the same offset in the virtual, and the locations come back needing no mapping of ours. Volar then
 * maps them to the real file exactly as it already maps the shorthand edit.
 *
 * Only the `<newName>: <oldName>` direction is touched — a rename STARTED from the template. Starting
 * from the const produces `{ count: total }`, which is correct as it stands (the template keeps working
 * through the unchanged property name), so it is left alone.
 *
 * Structural typing, like `redirect-definition.ts`: the Volar service types live in a transitive
 * dependency, and this file needs four fields of them.
 */

import { readFileSync } from 'node:fs';
import { setupConstFor, realTsForTarget, offsetAt, posAt, type LspRange } from './redirect-definition.js';

type Ts = typeof import('typescript');
type LanguageService = import('typescript').LanguageService;

interface TextEdit {
  range: LspRange;
  newText: string;
}
interface WorkspaceEditish {
  changes?: Record<string, TextEdit[]>;
}
interface ServiceInstance {
  provide?: Record<string, () => unknown>;
  provideRenameEdits?: (document: unknown, position: unknown, newName: string, token: unknown) => unknown;
  [k: string]: unknown;
}
type ServicePlugin = { create(context: never): unknown };

const same = (a: LspRange, b: LspRange): boolean =>
  a.start.line === b.start.line &&
  a.start.character === b.start.character &&
  a.end.line === b.end.line &&
  a.end.character === b.end.character;

/**
 * The virtual module that embeds `tsText`. Volar names these files itself, so rather than reconstruct
 * a name, the one source file whose text STARTS with the component's script is the one — that prefix is
 * the whole reason the offsets line up in the first place.
 */
function virtualFor(ls: LanguageService, tsText: string): string | undefined {
  for (const sf of ls.getProgram()?.getSourceFiles() ?? []) {
    if (sf.text.length >= tsText.length && sf.text.startsWith(tsText)) return sf.fileName;
  }
  return undefined;
}

function unify(result: unknown, newName: string, ts: Ts, getLs: (() => unknown) | undefined): unknown {
  const edit: WorkspaceEditish | null = result && typeof result === 'object' ? (result as WorkspaceEditish) : null;
  if (!edit?.changes || !getLs) return result;

  for (const uri of Object.keys(edit.changes)) {
    const tsPath: string | undefined = realTsForTarget(uri);
    if (!tsPath) continue;
    let text: string;
    try {
      text = readFileSync(tsPath, 'utf8');
    } catch {
      continue;
    }
    const sf: import('typescript').SourceFile = ts.createSourceFile(tsPath, text, ts.ScriptTarget.Latest, true);

    for (const e of edit.changes[uri]) {
      const m: RegExpExecArray | null = /^([A-Za-z_$][\w$]*): ([A-Za-z_$][\w$]*)$/.exec(e.newText);
      if (!m || m[1] !== newName) continue;
      const constName: import('typescript').Identifier | undefined = setupConstFor(sf, offsetAt(text, e.range.start), ts);
      if (!constName || constName.text !== m[2]) continue;

      const ls: LanguageService | undefined = getLs() as LanguageService | undefined;
      const virtual: string | undefined = ls ? virtualFor(ls, text) : undefined;
      if (!ls || !virtual) continue;

      const locations: readonly import('typescript').RenameLocation[] | undefined = ls.findRenameLocations(
        virtual,
        constName.getStart(sf),
        false,
        false
      );
      if (!locations?.length) continue;

      const extra: TextEdit[] = [];
      for (const loc of locations) {
        // Only the script region: its offsets are the `.ts`'s. Anything past it belongs to the generated
        // harness, and an offset there maps back through the TEMPLATE's line map — so it would land as a
        // silent edit in the author's markup.
        //
        // DEFENSIVE, and knowingly not covered: `findRenameLocations` is asked about the CONST, and the
        // harness only ever names `__ctx.x`, so today nothing comes back past the script. Removing this
        // line does not turn the gate red. It stays because the harness is generated code that changes,
        // and the failure it prevents is silent.
        if (loc.fileName !== virtual || loc.textSpan.start >= text.length) continue;
        const range: LspRange = {
          start: posAt(text, loc.textSpan.start),
          end: posAt(text, loc.textSpan.start + loc.textSpan.length),
        };
        if (same(range, e.range)) continue;
        extra.push({ range, newText: newName });
      }
      if (!extra.length) continue;

      e.newText = newName;
      const into: TextEdit[] = edit.changes[uri];
      for (const add of extra) if (!into.some((have) => same(have.range, add.range))) into.push(add);
      return edit;
    }
  }
  return edit;
}

/** Wrap each service so a rename started from a template also renames the `const` behind it. */
export function withSetupConstRename<T extends ServicePlugin>(services: T[], ts: Ts): T[] {
  return services.map(
    (svc) =>
      ({
        ...svc,
        create(context: never): ServiceInstance {
          const instance: ServiceInstance = svc.create(context) as ServiceInstance;
          const orig: ServiceInstance['provideRenameEdits'] = instance.provideRenameEdits?.bind(instance);
          if (!orig) return instance;
          const getLs: (() => unknown) | undefined = instance.provide?.['typescript/languageService'];
          instance.provideRenameEdits = async (document: unknown, position: unknown, newName: string, token: unknown): Promise<unknown> => {
            const res: unknown = await orig(document, position, newName, token);
            return unify(res, newName, ts, getLs);
          };
          return instance;
        },
      }) as unknown as T
  );
}
