/**
 * `weave check` core — type-check virtual modules and translate `tsc`
 * diagnostics back to the original `.weave`/`.html`/`.ts` source.
 *
 * All virtual files share one {@link ts.Program} (fast, and lets cross-component
 * imports resolve). A thin compiler-host shim serves each virtual module's text
 * from memory while delegating every other read (node_modules, libs) to disk —
 * so `@weave/runtime` and friends resolve through their normal package exports.
 */

import ts from 'typescript';
import type { Virtual } from './emit.js';

export interface Diagnostic {
  file: string;
  /** 1-based */
  line: number;
  /** 1-based */
  col: number;
  code: number;
  message: string;
  category: 'error' | 'warning' | 'suggestion' | 'message';
}

const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  types: [],
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  allowJs: false,
};

const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase();

/** Type-check the given virtual modules; returns diagnostics mapped to original source. */
export function runCheck(virtuals: Virtual[]): Diagnostic[] {
  const byPath: Map<string, Virtual> = new Map(virtuals.map((v) => [norm(v.path), v]));

  const host: ts.CompilerHost = ts.createCompilerHost(OPTIONS, true);
  const getSourceFile: ts.CompilerHost['getSourceFile'] = host.getSourceFile.bind(host);
  const readFile: ts.CompilerHost['readFile'] = host.readFile.bind(host);
  const fileExists: ts.CompilerHost['fileExists'] = host.fileExists.bind(host);

  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const v: Virtual | undefined = byPath.get(norm(fileName));
    if (v) return ts.createSourceFile(fileName, v.text, languageVersion, true);
    return getSourceFile(fileName, languageVersion, onError, shouldCreate);
  };
  host.readFile = (fileName) => byPath.get(norm(fileName))?.text ?? readFile(fileName);
  host.fileExists = (fileName) => byPath.has(norm(fileName)) || fileExists(fileName);

  const program: ts.Program = ts.createProgram(
    virtuals.map((v) => v.path),
    OPTIONS,
    host
  );

  const raw: ts.Diagnostic[] = [];
  for (const v of virtuals) {
    const sf: ts.SourceFile | undefined = program.getSourceFile(v.path);
    if (!sf) continue;
    raw.push(...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf));
  }

  return raw.map((d) => mapDiagnostic(d, byPath));
}

function mapDiagnostic(d: ts.Diagnostic, byPath: Map<string, Virtual>): Diagnostic {
  const message: string = ts.flattenDiagnosticMessageText(d.messageText, '\n');
  const category: Diagnostic['category'] = categoryName(d.category);

  if (!d.file || d.start === undefined) {
    return { file: '(global)', line: 0, col: 0, code: d.code, message, category };
  }

  const { line, character } = d.file.getLineAndCharacterOfPosition(d.start); // 0-based
  const v: Virtual | undefined = byPath.get(norm(d.file.fileName));
  if (!v) {
    // An error surfaced in a real dependency — report it as-is.
    return { file: d.file.fileName, line: line + 1, col: character + 1, code: d.code, message, category };
  }

  const vLine: number = line + 1; // 1-based virtual line

  const offset: number | undefined = v.templateMap.get(vLine);
  if (offset !== undefined) {
    const { line: l, col } = offsetToLineCol(v.templateText, offset);
    return { file: v.templateFile, line: l, col, code: d.code, message, category };
  }

  if (vLine <= v.scriptLineCount) {
    return {
      file: v.scriptFile,
      line: v.scriptLine + (vLine - 1) + 1,
      col: character + 1,
      code: d.code,
      message,
      category,
    };
  }

  // A generated scaffold line — should not carry user errors; surface it plainly.
  return { file: v.templateFile, line: 1, col: 1, code: d.code, message: `[generated] ${message}`, category };
}

function categoryName(c: ts.DiagnosticCategory): Diagnostic['category'] {
  switch (c) {
    case ts.DiagnosticCategory.Error: return 'error';
    case ts.DiagnosticCategory.Warning: return 'warning';
    case ts.DiagnosticCategory.Suggestion: return 'suggestion';
    default: return 'message';
  }
}

/** Translate a character offset into a 1-based line:col within `text`. */
export function offsetToLineCol(text: string, offset: number): { line: number; col: number } {
  let line: number = 1;
  let col: number = 1;
  const end: number = Math.min(offset, text.length);
  for (let i: number = 0; i < end; i++) {
    if (text[i] === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}
