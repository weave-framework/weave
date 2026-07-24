/**
 * `weave migrate` — the analyzer (RFC 0011, M2). It MEASURES facts about the selected unit: starting at the
 * unit's entry point, it will follow what the code DEPENDS ON (downward, branching to the leaves), stopping at
 * `@angular/*` (the source framework — translated, never recursed into) and third-party packages (noted at the
 * edge). This file is the facts side only; the plan + conversion are later (M3/M4). Zero third-party deps.
 *
 * This slice (M2.1): find the selected unit's ENTRY point — where the walk begins.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import ts from 'typescript';

/** Try `rel` under `unitDir`; if it doesn't resolve (a workspace-relative path), strip leading segments until it does. */
function resolveUnder(unitDir: string, rel: string): string | null {
  const direct: string = join(unitDir, rel);
  if (existsSync(direct)) return direct;
  const parts: string[] = rel.split(/[\\/]/).filter(Boolean);
  for (let i: number = 1; i < parts.length; i++) {
    const p: string = join(unitDir, ...parts.slice(i));
    if (existsSync(p)) return p;
  }
  return null;
}

/** The `main`/`browser` entry a build target declares (Nx `project.json` or Angular `angular.json`), if any. */
function entryFromConfig(unitDir: string): string | null {
  for (const cfg of ['project.json', 'angular.json']) {
    const f: string = join(unitDir, cfg);
    if (!existsSync(f)) continue;
    try {
      const j: unknown = JSON.parse(readFileSync(f, 'utf8'));
      // project.json: targets.*.options.{main,browser}; angular.json: projects.*.architect|targets.*.options.*
      const mains: string[] = [];
      const collect = (o: unknown): void => {
        if (!o || typeof o !== 'object') return;
        const rec: Record<string, unknown> = o as Record<string, unknown>;
        for (const key of ['main', 'browser']) {
          if (typeof rec[key] === 'string') mains.push(rec[key] as string);
        }
        for (const v of Object.values(rec)) if (v && typeof v === 'object') collect(v);
      };
      collect(j);
      for (const m of mains) {
        const resolved: string | null = resolveUnder(unitDir, m);
        if (resolved) return resolved;
      }
    } catch {
      /* malformed config — fall through to conventions */
    }
  }
  return null;
}

/** Common entry files, in priority order: an app's `main.ts`, then a library's public entry. */
const CONVENTIONAL_ENTRIES: string[] = [
  'src/main.ts',
  'src/index.ts',
  'src/public-api.ts',
  'src/public_api.ts',
  'index.ts',
  'public-api.ts',
];

/**
 * The entry point of a selected unit — where the dependency walk begins. A build target's declared `main`/
 * `browser` wins (most accurate); otherwise the conventional entry files are probed. Returns an absolute path,
 * or null when none is found (the caller records "couldn't find an entry — human, look", never guesses).
 */
export function findEntryPoint(unitDir: string): string | null {
  const fromConfig: string | null = entryFromConfig(unitDir);
  if (fromConfig) return fromConfig;
  for (const rel of CONVENTIONAL_ENTRIES) {
    const p: string = join(unitDir, rel);
    if (existsSync(p)) return p;
  }
  return null;
}

/* ──────────── M2.2 — the first tree level: what a file imports ──────────── */

/** How an import is treated by the downward walk. */
export type ImportKind =
  | 'relative' // a file in this codebase — the walk follows it
  | 'angular' // `@angular/*` — the SOURCE framework; translation input, never recursed into
  | 'third-party'; // a real external package — a tree-edge to note (keep / replace / rewrite later)

export interface ImportRef {
  /** The module specifier as written, e.g. `./user.service`, `@angular/core`, `lodash-es`. */
  spec: string;
  kind: ImportKind;
  /** For a relative import: the resolved absolute file path, or null if it could not be found. */
  resolved: string | null;
}

/** Resolve a relative import specifier to a file (`.ts`, `.tsx`, `/index.ts`, `.d.ts`), or null. */
function resolveRelative(spec: string, fromFile: string): string | null {
  const base: string = join(dirname(fromFile), spec);
  for (const cand of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), `${base}.d.ts`]) {
    if (existsSync(cand)) return cand;
  }
  return null;
}

function classifyImport(spec: string, fromFile: string): ImportRef {
  if (spec.startsWith('.')) return { spec, kind: 'relative', resolved: resolveRelative(spec, fromFile) };
  if (spec === '@angular' || spec.startsWith('@angular/')) return { spec, kind: 'angular', resolved: null };
  return { spec, kind: 'third-party', resolved: null };
}

/**
 * Parse a `.ts` file with the TypeScript AST and return everything it imports — static `import`s, re-exports
 * (`export … from`), and dynamic `import('…')` (Angular lazy routes) — each classified relative / angular /
 * third-party. This is one level of the tree; the walk (M2.3) follows the `relative` ones to the leaves.
 */
export function parseImports(filePath: string): ImportRef[] {
  const src: string = readFileSync(filePath, 'utf8');
  const sf: ts.SourceFile = ts.createSourceFile(filePath, src, ts.ScriptTarget.Latest, true);
  const out: ImportRef[] = [];
  const add = (spec: string): void => {
    out.push(classifyImport(spec, filePath));
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text); // `export … from '…'` — a re-export is a dependency too
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      add((node.arguments[0] as ts.StringLiteral).text); // dynamic import() — a lazy route
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/* ──────────── M2.3 — the downward walk: follow relative imports to the leaves ──────────── */

export interface DependencyWalk {
  /** Every reachable `.ts` file, from the entry down (the migration's file set). */
  files: string[];
  /** Distinct `@angular/*` specifiers used anywhere in the tree — the translation surface. */
  angular: string[];
  /** Distinct third-party packages at the tree edges — each needs a keep/replace/rewrite decision. */
  thirdParty: string[];
  /** Circular-import chains found — REPORTED, not resolved ("used circularly — look"). */
  cycles: string[][];
  /** Relative imports that could not be resolved to a file — recorded, never guessed. */
  unresolved: string[];
}

/**
 * Walk the dependency tree DOWNWARD from `entryFile`: follow every `relative` import to its file, recursively,
 * to the leaves. A `seen` set makes it a DAG (each file once — no re-analysis, no infinite loops). A back-edge
 * to a file on the current path is a CYCLE: recorded and not followed. `@angular/*` and third-party specifiers
 * are collected at the edges but never recursed into. This is the scoped, complete reachable set for the
 * selection — exactly what it depends on, nothing it doesn't.
 */
export function walkDependencies(entryFile: string): DependencyWalk {
  const files: Set<string> = new Set<string>();
  const angular: Set<string> = new Set<string>();
  const thirdParty: Set<string> = new Set<string>();
  const unresolved: Set<string> = new Set<string>();
  const cycles: string[][] = [];
  const path: string[] = []; // the current walk path, for cycle detection

  const visit = (file: string): void => {
    if (files.has(file)) return; // already walked (a shared dep) — visit once
    files.add(file);
    path.push(file);
    for (const imp of parseImports(file)) {
      if (imp.kind === 'angular') {
        angular.add(imp.spec);
      } else if (imp.kind === 'third-party') {
        thirdParty.add(imp.spec);
      } else if (!imp.resolved) {
        unresolved.add(imp.spec);
      } else if (path.includes(imp.resolved)) {
        cycles.push([...path.slice(path.indexOf(imp.resolved)), imp.resolved]); // a cycle — report, don't follow
      } else {
        visit(imp.resolved);
      }
    }
    path.pop();
  };
  visit(entryFile);

  return {
    files: [...files],
    angular: [...angular],
    thirdParty: [...thirdParty],
    cycles,
    unresolved: [...unresolved],
  };
}
