/**
 * `weave check` core — type-check virtual modules and translate `tsc`
 * diagnostics back to the original `.weave`/`.html`/`.ts` source.
 *
 * All virtual files share one {@link ts.Program} (fast, and lets cross-component
 * imports resolve). A thin compiler-host shim serves each virtual module's text
 * from memory while delegating every other read (node_modules, libs) to disk —
 * so `@weave-framework/runtime` and friends resolve through their normal package exports.
 */

import ts from 'typescript';
import { dirname, relative, isAbsolute } from 'node:path';
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
  // Match how a real app's tsconfig resolves deps: default-import interop (so
  // `import Button from '@weave-framework/ui/button'` is well-typed) and JSON imports
  // (i18n message bundles are `.json`).
  esModuleInterop: true,
  resolveJsonModule: true,
};

const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase();

/** Type-check the given virtual modules; returns diagnostics mapped to original source. */
/**
 * The compiler options to check with: the project's own `tsconfig.json` where one exists, overlaid with the
 * few settings this checker requires, else {@link OPTIONS} on its own.
 *
 * Why this matters more than it looks: with hardcoded options, an app that uses `paths` aliases — the norm
 * in any real codebase, and universal in one migrating from another framework — got "Cannot find module" on
 * every aliased import. A wall of errors from the framework's own quality tool, on a correct project, is the
 * fastest way to make someone switch that tool off for good.
 *
 * Only the invariants are overlaid. `noEmit` because this never writes; the virtual-host settings because
 * the sources are synthesized in memory. Everything else — `paths`, `baseUrl`, `lib`, `strict`, `types`,
 * `jsx` — belongs to the project, and disagreeing with its tsconfig means disagreeing with the editor.
 */
function optionsFor(searchFrom: string): ts.CompilerOptions {
  const configPath: string | undefined = ts.findConfigFile(searchFrom, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) return OPTIONS;

  const read: { config?: unknown; error?: ts.Diagnostic } = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error || !read.config) return OPTIONS; // unreadable/malformed → the defaults, not a crash

  const parsed: ts.ParsedCommandLine = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(configPath));
  return {
    ...parsed.options,
    // Invariants — the checker cannot work without these, whatever the project says.
    noEmit: true,
    skipLibCheck: true,
    // A project may not have `lib` set at all; keep a DOM-capable floor so template expressions that touch
    // the DOM still resolve.
    lib: parsed.options.lib ?? OPTIONS.lib,
  };
}

/**
 * Type-check the given virtual modules, plus the project's ordinary `.ts` modules, in one program.
 *
 * `plain` is every non-component source file under the checked roots. They used to be visible to the
 * program only as dependencies, and diagnostics were requested for the components alone — so a type
 * error in a service or a store passed `weave check` while `tsc --noEmit` failed on it. Both halves of
 * a project are checked together, and by the same options.
 */
export function runCheck(virtuals: Virtual[], plain: string[] = []): Diagnostic[] {
  const byPath: Map<string, Virtual> = new Map(virtuals.map((v) => [norm(v.path), v]));
  // Search from the first checked file's directory: everything checked belongs to one project.
  const searchFrom: string | undefined = virtuals[0]?.path ?? plain[0];
  const options: ts.CompilerOptions = searchFrom ? optionsFor(dirname(searchFrom)) : OPTIONS;

  const host: ts.CompilerHost = ts.createCompilerHost(options, true);
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
    [...virtuals.map((v) => v.path), ...plain],
    options,
    host
  );

  const raw: ts.Diagnostic[] = [];
  for (const path of [...virtuals.map((v) => v.path), ...plain]) {
    const sf: ts.SourceFile | undefined = program.getSourceFile(path);
    if (!sf) continue;
    raw.push(...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf));
  }

  return raw.map((d) => mapDiagnostic(d, byPath)).filter((d): d is Diagnostic => d !== null);
}

/** Map one `tsc` diagnostic back to source. `null` when it belongs to another file that reports it itself. */
function mapDiagnostic(d: ts.Diagnostic, byPath: Map<string, Virtual>): Diagnostic | null {
  const message: string = friendly(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  const category: Diagnostic['category'] = categoryName(d.category);

  if (!d.file || d.start === undefined) {
    return { file: '(global)', line: 0, col: 0, code: d.code, message, category };
  }

  const { line, character } = d.file.getLineAndCharacterOfPosition(d.start); // 0-based
  const v: Virtual | undefined = byPath.get(norm(d.file.fileName));
  if (!v) {
    // A plain module of the project (or a real dependency). Components print their path as it was
    // passed in — relative to where the command runs — so print these the same way rather than mixing
    // one absolute path per line into an otherwise relative list.
    return { file: displayPath(d.file.fileName), line: line + 1, col: character + 1, code: d.code, message, category };
  }

  const vLine: number = line + 1; // 1-based virtual line

  const offset: number | undefined = v.templateMap.get(vLine);
  if (offset !== undefined) {
    // A `#3` patch harness carries its BASE's template too — the only way a patched expression gets the
    // scope it is written in. Those lines are the base's, they are reported when the base is checked, and
    // repeating them here would name the wrong file at a line number from another one.
    if (v.foreignFrom !== undefined && offset >= v.foreignFrom) return null;
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

/** The phrase the harness's text-interpolation guard carries in its parameter TYPE, so TypeScript's own
 *  message already contains the advice. Matching on it lets the assignability boilerplate be replaced. */
const TEXT_GUARD: string = 'a function renders as its own source text';

/**
 * Restate a diagnostic that TypeScript phrased in terms of this checker's own harness. Only the guards
 * the harness synthesizes are rewritten; a real type error from the author's code is never touched.
 */
function friendly(message: string): string {
  if (!message.includes(TEXT_GUARD)) return message;
  const type: string = /Argument of type '([^']+)'/.exec(message)?.[1] ?? 'This value';
  return (
    `${type} is a function, and a template renders a function as its own source text. ` +
    'Call it — a signal is read with `()`, as in {{ count() }}.'
  );
}

/** A file path relative to where the command runs, when it is under it; the absolute path otherwise. */
function displayPath(file: string): string {
  const rel: string = relative(process.cwd(), file);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : file;
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
