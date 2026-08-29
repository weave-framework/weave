/**
 * Template lint in the editor — the mistakes that compile clean and fail silently, underlined where
 * they are, with a one-click fix.
 *
 * These rules have existed since 3.1.0 and the editor knew nothing about them: Volar surfaces the
 * TypeScript diagnostics from the embedded virtual code and the CSS ones from `<style>`, and the lint
 * ran only inside a build. So an editor showed a clean file, `weave check` showed a clean file, and the
 * page was broken. `weave check --fix` closed the terminal half of that; this closes the editor half,
 * from the same shared code (`templateOf` / `templateFindings`) so the two cannot drift apart.
 *
 * Typed structurally, like `redirect-definition.ts`: the Volar service types live in a transitive
 * dependency, and this file needs four fields of them.
 */

import { readFileSync } from 'node:fs';
import { templateFindings, declarationFor, growSetup, type ScriptEdit } from '@weave-framework/check';
import { realTsForTarget } from './redirect-definition.js';
import type { LintFinding } from '@weave-framework/compiler';

/**
 * The language id `weave-language.ts` publishes the offset-faithful template under. Volar collects
 * diagnostics from EMBEDDED documents only, never from the root, so the template has to be one.
 */
const TEMPLATE_LANGUAGE: string = 'weave-template';

interface Pos {
  line: number;
  character: number;
}
interface Range {
  start: Pos;
  end: Pos;
}
/** The slice of `TextDocument` used here. */
interface Doc {
  uri: string;
  languageId: string;
  getText(): string;
  positionAt(offset: number): Pos;
  offsetAt(position: Pos): number;
}

/** LSP DiagnosticSeverity.Warning. */
const WARNING: 2 = 2;

/** Findings for a document — empty for anything that is not the embedded template. */
function findingsFor(document: Doc): { findings: LintFinding[]; template: string } {
  if (document.languageId !== TEMPLATE_LANGUAGE) return { findings: [], template: '' };
  const template: string = document.getText();
  return { findings: templateFindings(template), template };
}

/**
 * The span to underline: the text a fix would replace, when there is one. Without a fix there is no
 * token to point at beyond where it starts, so one character is underlined rather than guessing a
 * length; a finding the AST could not place at all is anchored at the file's start, since dropping it
 * would lose a real warning to keep a cosmetic one.
 */
function rangeOf(document: Doc, f: LintFinding): Range {
  if (f.fix) return { start: document.positionAt(f.fix.start), end: document.positionAt(f.fix.end) };
  if (f.offset !== undefined) return { start: document.positionAt(f.offset), end: document.positionAt(f.offset + 1) };
  const zero: Pos = { line: 0, character: 0 };
  return { start: zero, end: zero };
}

/** Do two ranges touch? A quick-fix is offered when the cursor is anywhere in (or beside) the span. */
function overlaps(a: Range, b: Range): boolean {
  const before = (p: Pos, q: Pos): boolean => p.line < q.line || (p.line === q.line && p.character < q.character);
  return !before(a.end, b.start) && !before(b.end, a.start);
}

/**
 * Quick fixes that declare a name the template asks for into the component's `setup`.
 *
 * Same rule as `weave check --fix`, and the same code (`declarationFor` / `growSetup`), so the editor
 * and the checker cannot offer different things. The editor has no type information to hand here, so
 * the test for "is this name missing" is deliberately lexical and conservative: the action is offered
 * only when the identifier appears NOWHERE in the component's script. If it appears at all — declared,
 * imported, or merely mentioned — nothing is offered, because a duplicate declaration would be worse
 * than no offer. The checker, which does have types, catches whatever this leaves.
 *
 * The sibling-`.ts` shape only. A `.weave` keeps its script inside the same file, which needs the edit
 * shifted by the script's offset; it is not handled here and its author still gets `weave check --fix`.
 */
function declareActions(document: Doc, template: string, range: Range): unknown[] {
  const tsPath: string | undefined = realTsForTarget(document.uri);
  if (!tsPath) return [];
  let script: string;
  try {
    script = readFileSync(tsPath, 'utf8');
  } catch {
    return [];
  }
  const out: unknown[] = [];
  for (const name of handlerNames(template)) {
    const WORD: string = String.fromCharCode(92) + 'w$';
    const known: RegExp = new RegExp('(^|[^' + WORD + '])' + name + '([^' + WORD + ']|$)');  // already declared, imported, or merely mentioned
    if (known.test(script)) continue;
    const decl: { declaration: string; type: string } | null = declarationFor(template, name);
    if (!decl) continue;
    const edit: ScriptEdit | null = growSetup(script, name, decl.declaration, decl.type);
    if (!edit) continue;
    // Offered wherever the cursor is in the template: the name's own span is the natural anchor.
    const at: number = template.indexOf(name, 0);
    const span: Range = { start: document.positionAt(at), end: document.positionAt(at + name.length) };
    if (!overlaps(span, range)) continue;
    out.push({
      title: 'Declare `' + name + '` in setup()',
      kind: 'quickfix',
      edit: {
        changes: {
          [pathToUri(tsPath)]: [
            { range: { start: offsetToPos(script, edit.start), end: offsetToPos(script, edit.end) }, newText: edit.text },
          ],
        },
      },
    });
  }
  return out;
}

/** Every name bound on its own to an `on:` handler, in source order, without duplicates. */
function handlerNames(template: string): string[] {
  const BS: string = String.fromCharCode(92);
  const seen: Set<string> = new Set();
  const W: string = BS + 'w';
  const S: string = BS + 's';
  const re: RegExp = new RegExp(
    S + 'on:[A-Za-z][' + W + '|]*=' + BS + '{' + BS + '{' + S + '*([A-Za-z_$][' + W + '$]*)' + S + '*' + BS + '}' + BS + '}',
    'g'
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) seen.add(m[1]);
  return [...seen];
}

const pathToUri = (p: string): string => 'file:///' + p.split(String.fromCharCode(92)).join('/').replace(/^[/]+/, '');

/** Offset in `text` as an LSP position. */
function offsetToPos(text: string, offset: number): Pos {
  let line: number = 0;
  let last: number = 0;
  for (let i: number = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      last = i + 1;
    }
  }
  return { line, character: offset - last };
}

/** Volar service: template-lint diagnostics plus a quick fix for each rule that is certain. */
export function createTemplateLintService(): {
  name: string;
  capabilities: Record<string, unknown>;
  create(): Record<string, unknown>;
} {
  return {
    name: 'weave-template-lint',
    capabilities: {
      diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false },
      codeActionProvider: { codeActionKinds: ['quickfix'] },
    },
    create() {
      return {
        provideDiagnostics(document: Doc): unknown[] {
          return findingsFor(document).findings.map((f: LintFinding) => ({
            range: rangeOf(document, f),
            severity: WARNING,
            source: 'weave',
            message: f.message,
          }));
        },
        provideCodeActions(document: Doc, range: Range): unknown[] {
          const { findings, template } = findingsFor(document);
          const actions: unknown[] = [];
          for (const f of findings) {
            if (!f.fix) continue; // a rule with more than one plausible answer never offers an edit
            const span: Range = rangeOf(document, f);
            if (!overlaps(span, range)) continue;
            const was: string = template.slice(f.fix.start, f.fix.end);
            actions.push({
              title: 'Replace `' + was + '` with `' + f.fix.text + '`',
              kind: 'quickfix',
              diagnostics: [{ range: span, severity: WARNING, source: 'weave', message: f.message }],
              edit: { changes: { [document.uri]: [{ range: span, newText: f.fix.text }] } },
            });
          }
          return [...actions, ...declareActions(document, template, range)];
        },
      };
    },
  };
}
