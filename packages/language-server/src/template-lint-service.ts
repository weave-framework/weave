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

import { templateFindings } from '@weave-framework/check';
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
          return actions;
        },
      };
    },
  };
}
