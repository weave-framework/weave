/**
 * `weave migrate` — the analyzer (RFC 0011, M2). It MEASURES facts about the selected unit: starting at the
 * unit's entry point, it will follow what the code DEPENDS ON (downward, branching to the leaves), stopping at
 * `@angular/*` (the source framework — translated, never recursed into) and third-party packages (noted at the
 * edge). This file is the facts side only; the plan + conversion are later (M3/M4). Zero third-party deps.
 *
 * Facts gathered so far, entry-first: `findEntryPoint` (M2.1) → `parseImports` (M2.2) → `walkDependencies`
 * (M2.3) → `classifyPackages` (M2.8) → `findComponents`/`analyzeComponents` (M2.4). Everything is STATIC and
 * honest: a fact it can't read is absent or recorded, never guessed. Uses the injected TypeScript AST (`ts`).
 *
 * For a NEW source framework (React/Vue): the import walk is language-level and reused as-is; the parts that are
 * framework-specific are the `angular` `ImportKind` (its translation surface) + the `AUTO_MAP` package list, and
 * the `@Component`-shaped extraction here (a React module writes its own component reader). See RFC 0011.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
  | 'internal' // a workspace-internal library via a tsconfig path alias (`@myorg/foo`) — NOTED as a dependency edge, not followed (it's its own migration unit)
  | 'angular' // `@angular/*` — the SOURCE framework; translation input, never recursed into
  | 'third-party'; // a real external package — a tree-edge to note (keep / replace / rewrite later)

export interface ImportRef {
  /** The module specifier as written, e.g. `./user.service`, `@angular/core`, `lodash-es`. */
  spec: string;
  kind: ImportKind;
  /** For a relative import: the resolved absolute file path, or null if it could not be found. */
  resolved: string | null;
}

/** Try a base path as a file (`.ts`, `.tsx`, `/index.ts`, `.d.ts`, or exactly), returning the first that exists. */
function fileFor(base: string): string | null {
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), `${base}.d.ts`]) {
    try {
      if (existsSync(cand) && statSync(cand).isFile()) return cand;
    } catch {
      /* skip */
    }
  }
  return null;
}

/** Resolve a relative import specifier to a file, or null. */
function resolveRelative(spec: string, fromFile: string): string | null {
  return fileFor(join(dirname(fromFile), spec));
}

/** A workspace's tsconfig path aliases — how a monorepo maps `@myorg/foo` to its own `libs/…` source. */
export interface TsPaths {
  baseUrl: string; // absolute
  patterns: Array<{ prefix: string; wildcard: boolean; targets: string[] }>;
}

/** Walk up from `fromDir` to the workspace root (tsconfig.base.json / nx.json / angular.json). */
export function findWorkspaceRoot(fromDir: string): string {
  let dir: string = fromDir;
  for (let i: number = 0; i < 25; i++) {
    if (['tsconfig.base.json', 'nx.json', 'angular.json'].some((f) => existsSync(join(dir, f)))) return dir;
    const parent: string = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return fromDir;
}

/** Read a workspace's tsconfig path aliases (via the TS config reader, which tolerates JSONC comments). */
export function readTsPaths(root: string): TsPaths | null {
  for (const f of ['tsconfig.base.json', 'tsconfig.json']) {
    const p: string = join(root, f);
    if (!existsSync(p)) continue;
    const parsed: { config?: { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } } } = ts.readConfigFile(
      p,
      (fp) => {
        try {
          return readFileSync(fp, 'utf8');
        } catch {
          return undefined;
        }
      },
    );
    const co: { baseUrl?: string; paths?: Record<string, string[]> } = parsed.config?.compilerOptions ?? {};
    const paths: Record<string, string[]> = co.paths ?? {};
    const patterns: TsPaths['patterns'] = Object.entries(paths).map(([key, targets]) => ({
      prefix: key.replace(/\*$/, ''),
      wildcard: key.endsWith('*'),
      targets,
    }));
    if (patterns.length) return { baseUrl: resolve(root, co.baseUrl ?? '.'), patterns };
  }
  return null;
}

/** Resolve a bare specifier through the workspace's tsconfig paths to an internal file, or null (not internal). */
function resolveAlias(spec: string, tsPaths: TsPaths): string | null {
  for (const pat of tsPaths.patterns) {
    if (pat.wildcard) {
      if (spec.startsWith(pat.prefix)) {
        const rest: string = spec.slice(pat.prefix.length);
        for (const t of pat.targets) {
          const hit: string | null = fileFor(resolve(tsPaths.baseUrl, t.replace('*', rest)));
          if (hit) return hit;
        }
      }
    } else if (spec === pat.prefix) {
      for (const t of pat.targets) {
        const hit: string | null = fileFor(resolve(tsPaths.baseUrl, t));
        if (hit) return hit;
      }
    }
  }
  return null;
}

function classifyImport(spec: string, fromFile: string, tsPaths: TsPaths | null): ImportRef {
  if (spec.startsWith('.')) return { spec, kind: 'relative', resolved: resolveRelative(spec, fromFile) };
  if (tsPaths) {
    const internal: string | null = resolveAlias(spec, tsPaths);
    if (internal) return { spec, kind: 'internal', resolved: internal }; // a workspace lib — the code's own, noted as an edge (not followed)
  }
  if (spec === '@angular' || spec.startsWith('@angular/')) return { spec, kind: 'angular', resolved: null };
  return { spec, kind: 'third-party', resolved: null };
}

/**
 * Parse a `.ts` file with the TypeScript AST and return everything it imports — static `import`s, re-exports
 * (`export … from`), and dynamic `import('…')` (Angular lazy routes) — each classified relative / angular /
 * third-party. This is one level of the tree; the walk (M2.3) follows the `relative` ones to the leaves.
 */
export function parseImports(filePath: string, tsPaths: TsPaths | null = null): ImportRef[] {
  const src: string = readFileSync(filePath, 'utf8');
  const sf: ts.SourceFile = ts.createSourceFile(filePath, src, ts.ScriptTarget.Latest, true);
  const out: ImportRef[] = [];
  const add = (spec: string): void => {
    out.push(classifyImport(spec, filePath, tsPaths));
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
  /** The selected unit's OWN `.ts` files, from the entry down its relative imports — what gets migrated here. */
  files: string[];
  /** Distinct `@angular/*` specifiers used anywhere in the tree — the translation surface. */
  angular: string[];
  /** Distinct third-party packages at the tree edges — each needs a keep/replace/rewrite decision. */
  thirdParty: string[];
  /** Distinct workspace-internal libs it DEPENDS ON (via tsconfig aliases) — noted, not expanded here (each is
   *  its own migration unit; following them would drag a barrel's whole `export *` in). */
  internal: string[];
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
  const internal: Set<string> = new Set<string>();
  const unresolved: Set<string> = new Set<string>();
  const cycles: string[][] = [];
  const path: string[] = []; // the current walk path, for cycle detection

  // The workspace's tsconfig aliases — so `@myorg/foo` resolves to the code's own libs and is FOLLOWED, not
  // mistaken for an external package.
  const tsPaths: TsPaths | null = readTsPaths(findWorkspaceRoot(dirname(entryFile)));

  const visit = (file: string): void => {
    if (files.has(file)) return; // already walked (a shared dep) — visit once
    files.add(file);
    path.push(file);
    for (const imp of parseImports(file, tsPaths)) {
      if (imp.kind === 'internal') {
        internal.add(imp.spec); // a workspace lib is a DEPENDENCY EDGE — noted, not expanded (it's its own unit
        continue; //             to migrate separately). Following it dragged a barrel's whole `export *` in.
      }
      if (imp.kind === 'angular') {
        angular.add(imp.spec);
      } else if (imp.kind === 'third-party') {
        thirdParty.add(imp.spec);
      } else if (!imp.resolved) {
        unresolved.add(imp.spec);
      } else if (path.includes(imp.resolved)) {
        cycles.push([...path.slice(path.indexOf(imp.resolved)), imp.resolved]); // a cycle — report, don't follow
      } else {
        visit(imp.resolved); // only RELATIVE imports (the selected unit's own files) are followed
      }
    }
    path.pop();
  };
  visit(entryFile);

  return {
    files: [...files],
    internal: [...internal],
    angular: [...angular],
    thirdParty: [...thirdParty],
    cycles,
    unresolved: [...unresolved],
  };
}

/* ──────────── M2.8 — classify third-party packages: what can migrate, what stays ──────────── */

/**
 * What we advise for a third-party package the code depends on:
 * - `auto`  — Weave has a first-party equivalent we're confident about (rxjs → reactivity). Pre-selected, but
 *             the user still confirms; nothing is silently rewritten.
 * - `try`   — no confident mapping, but it MIGHT translate — the user decides whether to attempt it (a checkbox).
 * - `keep`  — a pure library with no Weave role (d3, lodash): migrating it makes no sense, so it is kept as-is
 *             (shown for information, never a checkbox — ticking it would do nothing).
 */
export type PackageDecision = 'auto' | 'try' | 'keep';

export interface PackagePlan {
  /** The package root (a subpath like `rxjs/operators` collapses to `rxjs`). */
  name: string;
  decision: PackageDecision;
  /** `auto`: what it becomes. `keep`: why it stays. `try`: an honest "not sure". */
  note: string;
}

/** Collapse a specifier to its installable package root: `rxjs/operators` → `rxjs`, `@ngx/a/b` → `@ngx/a`. */
export function rootPackage(spec: string): string {
  const parts: string[] = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** The small, CONFIDENT list: a third-party package Weave replaces first-party. Kept deliberately short + honest. */
const AUTO_MAP: Array<{ test: (p: string) => boolean; becomes: string }> = [
  { test: (p) => p === 'rxjs', becomes: 'Weave reactivity — signal / computed / effect' },
  { test: (p) => p.startsWith('@ngx-translate'), becomes: '@weave-framework/i18n' },
];

/** Pure libraries with NO Weave equivalent — migrating them is pointless, so they are KEPT (no checkbox). */
const KEEP_NAMES: Set<string> = new Set<string>([
  'lodash', 'lodash-es', 'underscore', 'ramda', 'immer', 'immutable',
  'd3', 'three', 'chart.js', 'echarts', 'plotly.js', 'konva', 'pixi.js', 'cytoscape',
  'moment', 'moment-timezone', 'dayjs', 'date-fns', 'luxon',
  'uuid', 'nanoid', 'crypto-js', 'bignumber.js', 'decimal.js', 'mathjs',
  'marked', 'dompurify', 'highlight.js', 'prismjs', 'pdfjs-dist', 'xlsx', 'papaparse', 'jszip', 'file-saver',
]);

/** Keyword signals (from a package's own `package.json`) that it is a pure library → keep. */
const KEEP_KEYWORDS: string[] = [
  'visualization', 'dataviz', 'chart', 'charting', 'graph', 'plot', 'svg', 'canvas', 'webgl', '3d',
  'animation', 'easing', 'geometry', 'math', 'matrix', 'date', 'time', 'calendar', 'uuid', 'hash',
  'crypto', 'encryption', 'utility', 'utilities', 'functional', 'immutable', 'parser', 'markdown',
  'pdf', 'spreadsheet', 'excel', 'csv', 'zip', 'compression', 'sanitize', 'sanitizer',
];

/** Keyword signals that a package plays a framework role (state/http/forms/…) → it might migrate → `try`. */
const FRAMEWORKY_KEYWORDS: string[] = [
  'angular', 'react', 'vue', 'state', 'store', 'reactive', 'rxjs', 'observable', 'http', 'fetch',
  'ajax', 'rest', 'graphql', 'form', 'forms', 'validation', 'router', 'routing', 'i18n',
  'translation', 'localization', 'component', 'components', 'directive',
];

/**
 * Classify ONE package by its name and (optionally) its own `package.json` keywords. Honest by construction:
 * only the short confident list is `auto`; only clearly-pure libraries are `keep`; everything else is `try` — the
 * user's call. Framework-role keywords pull a package OUT of keep (it might translate), so e.g. an "http-utility"
 * lands in `try`, not `keep`.
 */
export function classifyPackage(name: string, keywords: string[] = []): PackagePlan {
  const root: string = rootPackage(name);
  for (const a of AUTO_MAP) if (a.test(root)) return { name: root, decision: 'auto', note: `→ ${a.becomes}` };
  const kw: string[] = keywords.map((k) => k.toLowerCase());
  const frameworky: boolean = kw.some((k) => FRAMEWORKY_KEYWORDS.includes(k));
  if (!frameworky) {
    if (KEEP_NAMES.has(root) || root.startsWith('d3-') || kw.some((k) => KEEP_KEYWORDS.includes(k))) {
      return { name: root, decision: 'keep', note: 'no Weave equivalent — kept as-is' };
    }
  }
  return { name: root, decision: 'try', note: 'not sure — you decide whether to attempt it' };
}

/** Best-effort: a package's own `keywords` from `<workspaceRoot>/node_modules/<name>/package.json` ([] if absent). */
function packageKeywords(root: string, name: string): string[] {
  const pkg: string = join(root, 'node_modules', ...name.split('/'), 'package.json');
  try {
    const j: { keywords?: unknown } = JSON.parse(readFileSync(pkg, 'utf8'));
    return Array.isArray(j.keywords) ? j.keywords.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return []; // not installed / unreadable — name heuristics still apply
  }
}

/**
 * Classify every third-party specifier, collapsing subpaths to their package root and de-duplicating (so
 * `rxjs` + `rxjs/operators` is ONE decision). `workspaceRoot`, when given, lets each package's own keywords
 * sharpen the guess. Returns one plan per distinct package, stable-sorted by name.
 */
export function classifyPackages(specs: string[], workspaceRoot?: string): PackagePlan[] {
  const byRoot: Map<string, PackagePlan> = new Map<string, PackagePlan>();
  for (const spec of specs) {
    const root: string = rootPackage(spec);
    if (byRoot.has(root)) continue;
    const kw: string[] = workspaceRoot ? packageKeywords(workspaceRoot, root) : [];
    byRoot.set(root, classifyPackage(root, kw));
  }
  return [...byRoot.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/* ──────────── M2.4 — components: what an `@Component` declares (the shape M3/M4 translate) ──────────── */

/** The facts one Angular component declares — the surface that becomes a Weave component. */
export interface ComponentFact {
  /** Absolute path of the file it lives in. */
  file: string;
  /** The class name (`AppComponent`). */
  className: string;
  /** The CSS selector (`app-root`), or null if none is declared. */
  selector: string | null;
  /** `true`/`false` if the decorator states `standalone`; null when UNSTATED (the default shifted across Angular
   *  versions — recorded honestly, never guessed). */
  standalone: boolean | null;
  /** Input names — `@Input()` properties AND signal inputs (`input()`, `input.required()`, `model()`). */
  inputs: string[];
  /** Output names — `@Output()` properties AND signal outputs (`output()`). */
  outputs: string[];
  /** True when the template is inline (`template:`); mutually exclusive with `templateUrl`. */
  templateInline: boolean;
  /** The external template path (`templateUrl:`), or null. */
  templateUrl: string | null;
  /** External style paths (`styleUrls` / `styleUrl`). */
  styleUrls: string[];
  /** Count of inline `styles:` entries (0 when none). */
  inlineStyles: number;
}

/** The name of a decorator, whether written `@Foo` or `@Foo(...)`. Null if it isn't a plain named decorator. */
function decoratorName(dec: ts.Decorator): string | null {
  const e: ts.Expression = ts.isCallExpression(dec.expression) ? dec.expression.expression : dec.expression;
  return ts.isIdentifier(e) ? e.text : null;
}

/** The decorators on a node, tolerant of the TS API (empty when the node can't carry any). */
function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}

/** A member's property name as plain text (`foo`, or `'foo'`), or null for computed/unnamed members. */
function memberName(node: ts.ClassElement): string | null {
  const n: ts.PropertyName | undefined = node.name;
  if (!n) return null;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n)) return n.text;
  return null;
}

/** Is this initializer a call to one of the given signal factories (`input`, `input.required`, `output`, `model`)? */
function isSignalFactory(init: ts.Expression | undefined, names: string[]): boolean {
  if (!init || !ts.isCallExpression(init)) return false;
  const callee: ts.Expression = init.expression;
  const head: ts.Expression = ts.isPropertyAccessExpression(callee) ? callee.expression : callee; // `input.required` → `input`
  return ts.isIdentifier(head) && names.includes(head.text);
}

/** Read a string-valued property from a decorator's object literal (`selector`, `templateUrl`), or null. */
function stringProp(obj: ts.ObjectLiteralExpression, key: string): string | null {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && p.name && ts.isIdentifier(p.name) && p.name.text === key) {
      const v: ts.Expression = p.initializer;
      if (ts.isStringLiteralLike(v)) return v.text;
    }
  }
  return null;
}

/** Does the object literal have this property at all (for `template:` presence)? */
function hasProp(obj: ts.ObjectLiteralExpression, key: string): boolean {
  return obj.properties.some((p) => p.name !== undefined && ts.isIdentifier(p.name) && p.name.text === key);
}

/** Read a boolean-valued property (`standalone`), or null when it isn't a literal true/false. */
function boolProp(obj: ts.ObjectLiteralExpression, key: string): boolean | null {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && p.name && ts.isIdentifier(p.name) && p.name.text === key) {
      if (p.initializer.kind === ts.SyntaxKind.TrueKeyword) return true;
      if (p.initializer.kind === ts.SyntaxKind.FalseKeyword) return false;
    }
  }
  return null;
}

/** Read a string-array property (`styleUrls: [...]`), or a single-string one (`styleUrl: '...'`). */
function stringArrayProp(obj: ts.ObjectLiteralExpression, arrayKey: string, singleKey: string): string[] {
  const out: string[] = [];
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p) || !p.name || !ts.isIdentifier(p.name)) continue;
    if (p.name.text === arrayKey && ts.isArrayLiteralExpression(p.initializer)) {
      for (const el of p.initializer.elements) if (ts.isStringLiteralLike(el)) out.push(el.text);
    } else if (p.name.text === singleKey && ts.isStringLiteralLike(p.initializer)) {
      out.push(p.initializer.text);
    }
  }
  return out;
}

/** Count entries of an array-valued property (`styles: ['...', '...']`), 0 if absent/not an array. */
function arrayLen(obj: ts.ObjectLiteralExpression, key: string): number {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && p.name && ts.isIdentifier(p.name) && p.name.text === key && ts.isArrayLiteralExpression(p.initializer)) {
      return p.initializer.elements.length;
    }
  }
  return 0;
}

/**
 * Parse one `.ts` file and return a fact record for every `@Component` class in it (a file may hold more than
 * one). Reads the decorator's config object (selector / template / templateUrl / styles / standalone) and the
 * class members for inputs & outputs — both the decorator form (`@Input()`/`@Output()`) and the signal form
 * (`input()`, `input.required()`, `model()`, `output()`). Anything it cannot read is simply absent, never
 * guessed. A file with no component yields `[]`.
 */
export function findComponents(filePath: string): ComponentFact[] {
  let src: string;
  try {
    src = readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  const sf: ts.SourceFile = ts.createSourceFile(filePath, src, ts.ScriptTarget.Latest, true);
  const facts: ComponentFact[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      const dec: ts.Decorator | undefined = decoratorsOf(node).find((d) => decoratorName(d) === 'Component');
      if (dec && ts.isCallExpression(dec.expression) && dec.expression.arguments.length && ts.isObjectLiteralExpression(dec.expression.arguments[0])) {
        const cfg: ts.ObjectLiteralExpression = dec.expression.arguments[0];
        const inputs: string[] = [];
        const outputs: string[] = [];
        for (const member of node.members) {
          const name: string | null = memberName(member);
          if (!name) continue;
          const decs: readonly ts.Decorator[] = decoratorsOf(member);
          const init: ts.Expression | undefined = ts.isPropertyDeclaration(member) ? member.initializer : undefined;
          if (decs.some((d) => decoratorName(d) === 'Input') || isSignalFactory(init, ['input', 'model'])) inputs.push(name);
          if (decs.some((d) => decoratorName(d) === 'Output') || isSignalFactory(init, ['output'])) outputs.push(name);
        }
        facts.push({
          file: filePath,
          className: node.name?.text ?? '(anonymous)',
          selector: stringProp(cfg, 'selector'),
          standalone: boolProp(cfg, 'standalone'),
          inputs,
          outputs,
          templateInline: hasProp(cfg, 'template'),
          templateUrl: stringProp(cfg, 'templateUrl'),
          styleUrls: stringArrayProp(cfg, 'styleUrls', 'styleUrl'),
          inlineStyles: arrayLen(cfg, 'styles'),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return facts;
}

/** Every component across a set of files (the walk's `files`), flattened. Unreadable files contribute nothing. */
export function analyzeComponents(files: string[]): ComponentFact[] {
  return files.flatMap((f) => findComponents(f));
}

/** Read + parse a `.ts` file to a SourceFile (parents set, for `getText`), or null when unreadable. */
function parseFile(filePath: string): ts.SourceFile | null {
  try {
    return ts.createSourceFile(filePath, readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true);
  } catch {
    return null;
  }
}

/* ──────────── M2.5 — services + injection: what an `@Injectable` provides and depends on ──────────── */

/** The facts one Angular service declares — what becomes a Weave `store()` / `provide`. */
export interface ServiceFact {
  file: string;
  className: string;
  /** `providedIn` value: `'root'` / `'platform'` / `'any'`, a module identifier's name, or null (needs a provider). */
  providedIn: string | null;
  /** Public method names (constructor and private/protected members excluded). */
  methods: string[];
  /** What it injects — constructor parameter types AND `inject(X)` calls. The raw edges for the DI graph (M2.5). */
  injects: string[];
}

/** True for a member the outside world can call — a method with no `private`/`protected` modifier. */
function isPublicMethod(member: ts.ClassElement): boolean {
  if (!ts.isMethodDeclaration(member)) return false;
  const mods: readonly ts.ModifierLike[] = ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : [];
  return !mods.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword);
}

/** The rightmost name of a type reference (`a.b.Foo` → `Foo`), or null when the type isn't a plain reference. */
function typeRefName(type: ts.TypeNode | undefined): string | null {
  if (!type || !ts.isTypeReferenceNode(type)) return null;
  const n: ts.EntityName = type.typeName;
  return ts.isQualifiedName(n) ? n.right.text : n.text;
}

/** The `providedIn` of an `@Injectable({...})`: a string literal's text, or an identifier's name, or null. */
function providedInOf(cfg: ts.ObjectLiteralExpression): string | null {
  for (const p of cfg.properties) {
    if (ts.isPropertyAssignment(p) && p.name && ts.isIdentifier(p.name) && p.name.text === 'providedIn') {
      if (ts.isStringLiteralLike(p.initializer)) return p.initializer.text;
      if (ts.isIdentifier(p.initializer)) return p.initializer.text;
    }
  }
  return null;
}

/** Every `inject(X)` call inside a node subtree → the injected identifier names (signal-era DI). */
function injectCalls(root: ts.Node): string[] {
  const found: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'inject' && n.arguments.length && ts.isIdentifier(n.arguments[0])) {
      found.push((n.arguments[0] as ts.Identifier).text);
    }
    ts.forEachChild(n, visit);
  };
  visit(root);
  return found;
}

/**
 * Parse one `.ts` file and return a fact record for every `@Injectable` class in it: its `providedIn`, its public
 * methods, and what it injects (constructor parameter types + `inject()` calls — the DI edges). A file with no
 * service yields `[]`; an unreadable file yields `[]`.
 */
export function findServices(filePath: string): ServiceFact[] {
  const sf: ts.SourceFile | null = parseFile(filePath);
  if (!sf) return [];
  const facts: ServiceFact[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      const dec: ts.Decorator | undefined = decoratorsOf(node).find((d) => decoratorName(d) === 'Injectable');
      if (dec) {
        const arg: ts.Expression | undefined = ts.isCallExpression(dec.expression) ? dec.expression.arguments[0] : undefined;
        const cfg: ts.ObjectLiteralExpression | null = arg && ts.isObjectLiteralExpression(arg) ? arg : null;
        const methods: string[] = [];
        const injects: string[] = [];
        for (const member of node.members) {
          if (isPublicMethod(member)) {
            const name: string | null = memberName(member);
            if (name) methods.push(name);
          }
          if (ts.isConstructorDeclaration(member)) {
            for (const param of member.parameters) {
              const t: string | null = typeRefName(param.type);
              if (t) injects.push(t);
            }
          }
        }
        injects.push(...injectCalls(node)); // `inject(Foo)` in field initializers / constructor body
        facts.push({
          file: filePath,
          className: node.name?.text ?? '(anonymous)',
          providedIn: cfg ? providedInOf(cfg) : null,
          methods,
          injects: [...new Set(injects)], // one edge per distinct dependency
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return facts;
}

/** Every service across a set of files (the walk's `files`), flattened. Unreadable files contribute nothing. */
export function analyzeServices(files: string[]): ServiceFact[] {
  return files.flatMap((f) => findServices(f));
}

/** A DI edge: `from` (a component/service class) injects `to` (a dependency type name). */
export interface DiEdge {
  from: string;
  to: string;
}

/**
 * The DI graph as flat edges — who injects what — built from the services' `injects`. (Components inject too;
 * their edges join here once component injection is read. Kept as plain edges so M3 can order the conversion
 * bottom-up: a leaf that injects nothing converts first.)
 */
export function diGraph(services: ServiceFact[]): DiEdge[] {
  return services.flatMap((s) => s.injects.map((to) => ({ from: s.className, to })));
}
