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
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

/**
 * Resolve a relative import specifier to a file, or null.
 *
 * Exported because anything downstream that needs to follow a specifier must follow it the SAME way this walk
 * does. The graph originally guessed at it with its own rules and got a barrel wrong; every project spells
 * these paths differently, and the only spelling that generalises is the one TypeScript itself accepts.
 */
export function resolveRelative(spec: string, fromFile: string): string | null {
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

/**
 * Put the matched part of a specifier into a tsconfig `paths` target's `*`.
 *
 * TypeScript allows **at most one** `*` per target and rejects a second one, so substituting a
 * single occurrence is the whole substitution, not a partial one. Written as an explicit split
 * rather than `t.replace('*', rest)` because that reads as a first-occurrence-only bug (and is
 * flagged as one) exactly where the invariant that makes it correct is invisible.
 */
function substituteWildcard(target: string, rest: string): string {
  const star: number = target.indexOf('*');
  return star < 0 ? target : target.slice(0, star) + rest + target.slice(star + 1);
}

/** Resolve a bare specifier through the workspace's tsconfig paths to an internal file, or null (not internal). */
export function resolveAlias(spec: string, tsPaths: TsPaths): string | null {
  for (const pat of tsPaths.patterns) {
    if (pat.wildcard) {
      if (spec.startsWith(pat.prefix)) {
        const rest: string = spec.slice(pat.prefix.length);
        for (const t of pat.targets) {
          const hit: string | null = fileFor(resolve(tsPaths.baseUrl, substituteWildcard(t, rest)));
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
  /** The INLINE template's text when there is one — the converter needs the markup, not just the flag. */
  templateText: string | null;
  /** The external template path (`templateUrl:`), or null. */
  templateUrl: string | null;
  /** External style paths (`styleUrls` / `styleUrl`). */
  styleUrls: string[];
  /** Count of inline `styles:` entries (0 when none). */
  inlineStyles: number;
  /** The inline `styles:` entries THEMSELVES. The count alone could not be written to a sibling stylesheet, so
   *  inline styles were silently dropped — the same "recorded but not carried" gap as everything else. */
  styleTexts: string[];
  /** What it injects — constructor parameter types AND `inject(X)` calls. Components are DI graph nodes too, and
   *  a component→service edge is what makes the convert order correct (the service converts first). */
  injects: string[];
  /** EVERY member of the component class — its state and behaviour. A component's class body is the bulk of what
   *  a migration has to move; it used to be summarised as a one-line TODO and otherwise dropped. */
  members: ClassMember[];
  /** The class body verbatim — the reference for the "nothing was lost" check. */
  classBody: string;
  /** The decorator's `host: { … }` map, as written. The other half of host bindings — see `objectStringMap`. */
  hostMeta: Record<string, string>;
  /** The decorator's `imports: [ … ]` entries (a standalone component's dependencies), as written. Each one is a
   *  thing the template can use, so a converted template that still names it needs an answer for where it went. */
  declaredImports: string[];
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

/**
 * The `host: { … }` map of a `@Component`/`@Directive`, key and value as written: `{'class': 'sps-logo',
 * '[class.active]': 'isActive', '(click)': 'onClick()'}`. This is the decorator-object twin of `@HostBinding` /
 * `@HostListener` — the same host element, declared a different way — and it used to be read past entirely, so a
 * component whose class and click handler were declared here migrated to markup that did neither.
 */
function objectStringMap(obj: ts.ObjectLiteralExpression, key: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p) || !p.name || !ts.isIdentifier(p.name) || p.name.text !== key) continue;
    if (!ts.isObjectLiteralExpression(p.initializer)) continue;
    for (const entry of p.initializer.properties) {
      if (!ts.isPropertyAssignment(entry) || !entry.name) continue;
      // A host key is nearly always quoted (`'[class.x]'` is not a valid identifier), but `class: 'x'` is legal too.
      const k: string | null = ts.isStringLiteralLike(entry.name) ? entry.name.text : ts.isIdentifier(entry.name) ? entry.name.text : null;
      if (k && ts.isStringLiteralLike(entry.initializer)) out[k] = entry.initializer.text;
    }
  }
  return out;
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

/** The string entries of an array-valued property (`styles: ['a', 'b']`), or a single string (`styles: 'a'`). */
function stringEntries(obj: ts.ObjectLiteralExpression, key: string): string[] {
  const out: string[] = [];
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p) || !p.name || !ts.isIdentifier(p.name) || p.name.text !== key) continue;
    if (ts.isArrayLiteralExpression(p.initializer)) {
      for (const el of p.initializer.elements) if (ts.isStringLiteralLike(el)) out.push(el.text);
    } else if (ts.isStringLiteralLike(p.initializer)) {
      out.push(p.initializer.text);
    }
  }
  return out;
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
          // `stringProp` also reads a backtick template literal (the usual way an inline template is written).
          templateText: stringProp(cfg, 'template'),
          templateUrl: stringProp(cfg, 'templateUrl'),
          styleUrls: stringArrayProp(cfg, 'styleUrls', 'styleUrl'),
          inlineStyles: stringEntries(cfg, 'styles').length,
          styleTexts: stringEntries(cfg, 'styles'),
          injects: classInjects(node),
          members: classMembers(node, sf),
          classBody: classBodyText(node, sf),
          hostMeta: objectStringMap(cfg, 'host'),
          declaredImports: identifierArrayProp(cfg, 'imports'),
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
export function parseFile(filePath: string): ts.SourceFile | null {
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
  /** Per public method: its parameter list AS WRITTEN and its original body. Carried into the draft so the
   *  conversion is edited in place — dropping them forced the reader back to the Angular file for every method,
   *  and silently threw away a signature that was mechanical to keep. */
  methodSources: Record<string, { params: string; body: string }>;
  /** EVERY member — public and private, fields, methods and the constructor. The public-only lists above answer
   *  "what is this service's surface?"; this answers "what code is there?", which is what a migration must move. */
  members: ClassMember[];
  /** The class body verbatim. The safety net behind `members`: whatever the structured pass fails to place, this
   *  still holds, so a "nothing was lost" check has something absolute to compare against. */
  classBody: string;
  /** Public FIELD names. A service's API is often a field, not a method — counting only methods reads as "0 public
   *  API" for a service whose whole surface is an exposed signal. */
  fields: string[];
  /** The subset of `fields` that hold a signal (`signal()`/`computed()`/`toSignal()`, or a `Signal`/`WritableSignal`
   *  type). These map to Weave signals ONE-TO-ONE — the most mechanical win in the whole migration. */
  signals: string[];
  /** What it injects — constructor parameter types AND `inject(X)` calls. The raw edges for the DI graph (M2.5). */
  injects: string[];
}

/** Does this member carry a `private`/`protected` modifier (i.e. not part of the outside surface)? */
function isNonPublic(member: ts.ClassElement): boolean {
  const mods: readonly ts.ModifierLike[] = ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : [];
  return mods.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword);
}

/** True for a public FIELD — a property declaration with no `private`/`protected`. */
function isPublicField(member: ts.ClassElement): boolean {
  return ts.isPropertyDeclaration(member) && !isNonPublic(member);
}

/** The signal factories whose result is a reactive value that maps 1:1 to a Weave signal. */
const SIGNAL_FACTORIES: string[] = ['signal', 'computed', 'linkedSignal', 'toSignal', 'input', 'model', 'output'];

/** Signal-typed annotations (`x: WritableSignal<T>`) — the other way a signal field announces itself. */
const SIGNAL_TYPES: string[] = ['Signal', 'WritableSignal', 'InputSignal', 'ModelSignal', 'OutputEmitterRef'];

/** Is this property a signal — by its initializer (`signal(…)`) or by its declared type (`WritableSignal<T>`)? */
function isSignalField(member: ts.PropertyDeclaration): boolean {
  if (isSignalFactory(member.initializer, SIGNAL_FACTORIES)) return true;
  const t: string | null = typeRefName(member.type);
  return t !== null && SIGNAL_TYPES.includes(t);
}

/** Strip a block's outer braces and its common leading indentation, so it reads naturally when re-indented. */
function dedentBlock(raw: string): string {
  const inner: string = raw.replace(/^\s*\{/, '').replace(/\}\s*$/, '');
  const lines: string[] = inner.split('\n').filter((l, i, all) => !(l.trim() === '' && (i === 0 || i === all.length - 1)));
  const indents: number[] = lines.filter((l) => l.trim()).map((l) => (l.match(/^[\t ]*/)?.[0].length ?? 0));
  const strip: number = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(strip)).join('\n');
}

/**
 * One member of a converted class — field, method, or the constructor — captured whole.
 *
 * EVERY member is captured, public and private alike. An earlier version recorded only the public ones, so a
 * service whose real work lived in its constructor and a private helper analysed as having nothing at all, and
 * the draft silently dropped years of logic. A migration MOVES code and adapts it; it never discards it.
 */
export interface ClassMember {
  kind: 'field' | 'method' | 'constructor' | 'getter' | 'setter';
  /** `(constructor)` for the constructor. */
  name: string;
  /** False for `private`/`protected` — in a Weave store/context these become locals that are not returned. */
  isPublic: boolean;
  /** Methods + constructor: the parameter list as written. */
  params: string;
  /** Methods + constructor: the body, dedented. */
  body: string;
  /** Fields: the initializer as written (`inject(Router)`, `signal([])`, …) — a field's DEFAULT VALUE. */
  initializer: string;
  /** The declared type as written (`string`, `IBreadcrumb[]`), or '' when there is none. Together with
   *  `initializer` this is the whole of `@Input() color: string = 'sps-default'` — dropping either threw away
   *  data the source stated explicitly. */
  type: string;
  /** Fields: whether it already holds a signal (those map to Weave signals one-to-one). */
  isSignal: boolean;
  /** The member's ENTIRE original source, signature included. The draft carries this verbatim (commented) so the
   *  reader sees exactly what was there — and so "was anything lost?" is answerable by plain text comparison. */
  text: string;
  /** The member's decorators as written (`@HostBinding('class.sps-logo')`, `@Input()`). A host binding says the
   *  member drives the element rather than the class, which is a different translation entirely. */
  decorators: string[];
}

/** The class body verbatim (members only, braces stripped) — the absolute reference for "was anything lost?". */
function classBodyText(node: ts.ClassDeclaration, sf: ts.SourceFile): string {
  return dedentBlock(node.members.map((m) => m.getText(sf)).join('\n'));
}

/** Capture every member of a class — nothing filtered out, so nothing can be silently lost downstream. */
function classMembers(node: ts.ClassDeclaration, sf: ts.SourceFile): ClassMember[] {
  const out: ClassMember[] = [];
  // The member's own source, dedented. Wrapped in braces first so `dedentBlock` sees a block to strip.
  const own = (m: ts.ClassElement): string => dedentBlock(`{\n${m.getText(sf)}\n}`);
  for (const member of node.members) {
    const isPublic: boolean = !isNonPublic(member);
    if (ts.isConstructorDeclaration(member)) {
      out.push({
        kind: 'constructor',
        name: '(constructor)',
        isPublic: true,
        params: member.parameters.map((p) => p.getText(sf)).join(', '),
        body: member.body ? dedentBlock(member.body.getText(sf)) : '',
        initializer: '',
        type: '',
        isSignal: false,
        text: own(member),
        decorators: decoratorsOf(member).map((d) => d.getText(sf)),
      });
      continue;
    }
    const name: string | null = memberName(member);
    if (!name) continue;
    if (ts.isMethodDeclaration(member)) {
      out.push({
        kind: 'method',
        name,
        isPublic,
        params: member.parameters.map((p) => p.getText(sf)).join(', '),
        body: member.body ? dedentBlock(member.body.getText(sf)) : '',
        initializer: '',
        type: member.type ? member.type.getText(sf) : '',
        isSignal: false,
        text: own(member),
        decorators: decoratorsOf(member).map((d) => d.getText(sf)),
      });
    } else if (ts.isPropertyDeclaration(member)) {
      out.push({
        kind: 'field',
        name,
        isPublic,
        params: '',
        body: '',
        initializer: member.initializer ? member.initializer.getText(sf) : '',
        type: member.type ? member.type.getText(sf) : '',
        isSignal: isSignalField(member),
        text: own(member),
        decorators: decoratorsOf(member).map((d) => d.getText(sf)),
      });
    } else if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
      // Accessors were captured by NOTHING before: a component with five `get` members came out with all five
      // silently gone. A getter is a derived value — in Weave a `computed` — so it must survive the move.
      out.push({
        kind: ts.isGetAccessorDeclaration(member) ? 'getter' : 'setter',
        name,
        isPublic,
        params: member.parameters.map((p) => p.getText(sf)).join(', '),
        body: member.body ? dedentBlock(member.body.getText(sf)) : '',
        initializer: '',
        type: ts.isGetAccessorDeclaration(member) && member.type ? member.type.getText(sf) : '',
        isSignal: false,
        text: own(member),
        decorators: decoratorsOf(member).map((d) => d.getText(sf)),
      });
    }
  }
  return out;
}

/** True for a member the outside world can call — a method with no `private`/`protected` modifier. */
function isPublicMethod(member: ts.ClassElement): boolean {
  if (!ts.isMethodDeclaration(member)) return false;
  return !isNonPublic(member);
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

/**
 * Everything a class injects: constructor parameter types AND `inject(X)` calls. Shared by components and
 * services — both inject, and both are nodes in the DI graph. De-duplicated (one edge per dependency).
 */
function classInjects(node: ts.ClassDeclaration): string[] {
  const injects: string[] = [];
  for (const member of node.members) {
    if (ts.isConstructorDeclaration(member)) {
      for (const param of member.parameters) {
        const t: string | null = typeRefName(param.type);
        if (t) injects.push(t);
      }
    }
  }
  injects.push(...injectCalls(node)); // `inject(Foo)` in field initializers / constructor body
  return [...new Set(injects)];
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
        const methodSources: Record<string, { params: string; body: string }> = {};
        const fields: string[] = [];
        const signals: string[] = [];
        for (const member of node.members) {
          const name: string | null = memberName(member);
          if (!name) continue;
          if (isPublicMethod(member)) {
            const md: ts.MethodDeclaration = member as ts.MethodDeclaration;
            methods.push(name);
            methodSources[name] = { params: md.parameters.map((p) => p.getText(sf)).join(', '), body: md.body ? dedentBlock(md.body.getText(sf)) : '' };
          } else if (isPublicField(member)) {
            fields.push(name);
            if (ts.isPropertyDeclaration(member) && isSignalField(member)) signals.push(name);
          }
        }
        facts.push({
          file: filePath,
          className: node.name?.text ?? '(anonymous)',
          providedIn: cfg ? providedInOf(cfg) : null,
          methods,
          methodSources,
          members: classMembers(node, sf),
          classBody: classBodyText(node, sf),
          fields,
          signals,
          injects: classInjects(node),
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

/** Anything that can inject — both components and services do, and both feed the DI graph. */
export interface Injector {
  className: string;
  injects: string[];
}

/**
 * The DI graph as flat edges — who injects what. Pass BOTH services and components: a component injecting a
 * service is exactly the edge that makes the convert order correct (the service must be converted first). Kept
 * as plain edges so M3 can order bottom-up: a leaf that injects nothing converts first.
 */
export function diGraph(injectors: Injector[]): DiEdge[] {
  return injectors.flatMap((s) => s.injects.map((to) => ({ from: s.className, to })));
}

/* ──────────── NgModules + injection tokens ──────────── */

/**
 * An Angular `@NgModule`. Weave has no modules — imports are per-file — but the module still carries facts
 * nothing else does: which pieces belong together, what it PROVIDED (scoped services that must become
 * `provide`/`inject`), and what it re-exported as its public surface.
 */
export interface NgModuleFact {
  file: string;
  className: string;
  declarations: string[];
  imports: string[];
  exports: string[];
  providers: string[];
  bootstrap: string[];
}

/** An `InjectionToken` — Angular's way to inject a non-class value. In Weave that is a context. */
export interface TokenFact {
  file: string;
  /** The const it was assigned to. */
  name: string;
  /** The token's debug description, when given. */
  description: string | null;
}

/** Identifier names inside an array-valued property of an object literal, flattened one level. */
function identifierList(obj: ts.ObjectLiteralExpression, key: string): string[] {
  const out: string[] = [];
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p) || !p.name || !ts.isIdentifier(p.name) || p.name.text !== key) continue;
    if (!ts.isArrayLiteralExpression(p.initializer)) continue;
    for (const el of p.initializer.elements) {
      if (ts.isIdentifier(el)) out.push(el.text);
      else if (ts.isCallExpression(el) && ts.isPropertyAccessExpression(el.expression) && ts.isIdentifier(el.expression.expression)) {
        out.push(`${el.expression.expression.text}.${el.expression.name.text}()`); // RouterModule.forRoot(...)
      } else if (ts.isObjectLiteralExpression(el)) {
        const provide: string | null = identifierProp(el, 'provide') ?? stringProp(el, 'provide');
        out.push(provide ? `{ provide: ${provide} }` : '{ … }'); // a provider object
      }
    }
  }
  return out;
}

/** Every `@NgModule` in a file. */
export function findNgModules(filePath: string): NgModuleFact[] {
  const sf: ts.SourceFile | null = parseFile(filePath);
  if (!sf) return [];
  const out: NgModuleFact[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      const dec: ts.Decorator | undefined = decoratorsOf(node).find((d) => decoratorName(d) === 'NgModule');
      if (dec) {
        const arg: ts.Expression | undefined = ts.isCallExpression(dec.expression) ? dec.expression.arguments[0] : undefined;
        const cfg: ts.ObjectLiteralExpression | null = arg && ts.isObjectLiteralExpression(arg) ? arg : null;
        out.push({
          file: filePath,
          className: node.name?.text ?? '(anonymous)',
          declarations: cfg ? identifierList(cfg, 'declarations') : [],
          imports: cfg ? identifierList(cfg, 'imports') : [],
          exports: cfg ? identifierList(cfg, 'exports') : [],
          providers: cfg ? identifierList(cfg, 'providers') : [],
          bootstrap: cfg ? identifierList(cfg, 'bootstrap') : [],
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Every `new InjectionToken(...)` assigned to a const in a file. */
export function findTokens(filePath: string): TokenFact[] {
  const sf: ts.SourceFile | null = parseFile(filePath);
  if (!sf) return [];
  const out: TokenFact[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isNewExpression(node.initializer)) {
      const callee: ts.LeftHandSideExpression = node.initializer.expression;
      if (ts.isIdentifier(callee) && callee.text === 'InjectionToken') {
        const first: ts.Expression | undefined = node.initializer.arguments?.[0];
        out.push({ file: filePath, name: node.name.text, description: first && ts.isStringLiteralLike(first) ? first.text : null });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** NgModules across a file set. */
export function analyzeNgModules(files: string[]): NgModuleFact[] {
  return files.flatMap((f) => findNgModules(f));
}

/** Injection tokens across a file set. */
export function analyzeTokens(files: string[]): TokenFact[] {
  return files.flatMap((f) => findTokens(f));
}

/* ──────────── pipes + directives: the two decorated kinds nothing read until now ──────────── */

/** An Angular `@Pipe` — in Weave a pipe is simply a function (or a `computed`), so this maps cleanly. */
export interface PipeFact {
  file: string;
  className: string;
  /** The `name:` the template used (`{{ x | myPipe }}`). */
  pipeName: string | null;
  /** `pure: false` means it re-ran on every change detection — worth flagging, Weave has no such pass. */
  pure: boolean | null;
  /** `transform`'s parameter list and body — the whole point of the pipe. */
  transform: { params: string; body: string } | null;
  members: ClassMember[];
  classBody: string;
}

/** An Angular `@Directive` — the Weave equivalent is a `use:` action `(el, arg) => cleanup`. */
export interface DirectiveFact {
  file: string;
  className: string;
  /** The attribute selector (`[appHighlight]`). */
  selector: string | null;
  inputs: string[];
  members: ClassMember[];
  classBody: string;
  /** The decorator's `host: { … }` map — a directive is host bindings and little else. */
  hostMeta: Record<string, string>;
}

/** Every `@Pipe` class in a file. */
export function findPipes(filePath: string): PipeFact[] {
  const sf: ts.SourceFile | null = parseFile(filePath);
  if (!sf) return [];
  const out: PipeFact[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      const dec: ts.Decorator | undefined = decoratorsOf(node).find((d) => decoratorName(d) === 'Pipe');
      if (dec) {
        const arg: ts.Expression | undefined = ts.isCallExpression(dec.expression) ? dec.expression.arguments[0] : undefined;
        const cfg: ts.ObjectLiteralExpression | null = arg && ts.isObjectLiteralExpression(arg) ? arg : null;
        const members: ClassMember[] = classMembers(node, sf);
        const t: ClassMember | undefined = members.find((m) => m.name === 'transform');
        out.push({
          file: filePath,
          className: node.name?.text ?? '(anonymous)',
          pipeName: cfg ? stringProp(cfg, 'name') : null,
          pure: cfg ? boolProp(cfg, 'pure') : null,
          transform: t ? { params: t.params, body: t.body } : null,
          members,
          classBody: classBodyText(node, sf),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * An Angular ROUTE RESOLVER — a class with a `resolve(route, …)` method, fetching a route's data before it
 * renders. It usually carries no decorator, so it was classified as "plain TypeScript, carried as-is" and moved
 * unchanged: a file full of `ActivatedRouteSnapshot` that will never run in Weave, under a banner saying most of
 * it already works. Weave's counterpart is a route `loader`, read with `useLoaderData()`.
 */
export interface ResolverFact {
  file: string;
  className: string;
  /** The `resolve` method's parameter list and body, as written. */
  params: string;
  body: string;
  /** Every member, so nothing is lost when the class is more than its `resolve`. */
  members: ClassMember[];
  classBody: string;
}

/** Every route-resolver class in a file: one with a `resolve` method, decorated or not. */
export function findResolvers(filePath: string): ResolverFact[] {
  const sf: ts.SourceFile | null = parseFile(filePath);
  if (!sf) return [];
  const out: ResolverFact[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      // A `@Component`/`@Directive`/`@Pipe` is something else entirely, whatever methods it happens to have.
      const decorated: boolean = decoratorsOf(node).some((d) => ['Component', 'Directive', 'Pipe', 'NgModule'].includes(decoratorName(d) ?? ''));
      const members: ClassMember[] = classMembers(node, sf);
      const resolve: ClassMember | undefined = members.find((m) => m.kind === 'method' && m.name === 'resolve');
      // The Angular contract is `resolve(route, state?)`; a no-argument `resolve()` is somebody else's method.
      if (!decorated && resolve && resolve.params.trim()) {
        out.push({
          file: filePath,
          className: node.name?.text ?? '(anonymous)',
          params: resolve.params,
          body: resolve.body,
          members,
          classBody: classBodyText(node, sf),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Every route resolver across a set of files. */
export function analyzeResolvers(files: string[]): ResolverFact[] {
  return files.flatMap((f) => findResolvers(f));
}

/** Every `@Directive` class in a file. */
export function findDirectives(filePath: string): DirectiveFact[] {
  const sf: ts.SourceFile | null = parseFile(filePath);
  if (!sf) return [];
  const out: DirectiveFact[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      const dec: ts.Decorator | undefined = decoratorsOf(node).find((d) => decoratorName(d) === 'Directive');
      if (dec) {
        const arg: ts.Expression | undefined = ts.isCallExpression(dec.expression) ? dec.expression.arguments[0] : undefined;
        const cfg: ts.ObjectLiteralExpression | null = arg && ts.isObjectLiteralExpression(arg) ? arg : null;
        const inputs: string[] = [];
        for (const member of node.members) {
          const name: string | null = memberName(member);
          if (!name) continue;
          const init: ts.Expression | undefined = ts.isPropertyDeclaration(member) ? member.initializer : undefined;
          if (decoratorsOf(member).some((d) => decoratorName(d) === 'Input') || isSignalFactory(init, ['input', 'model'])) inputs.push(name);
        }
        out.push({
          file: filePath,
          className: node.name?.text ?? '(anonymous)',
          selector: cfg ? stringProp(cfg, 'selector') : null,
          inputs,
          members: classMembers(node, sf),
          classBody: classBodyText(node, sf),
          hostMeta: cfg ? objectStringMap(cfg, 'host') : {},
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Pipes across a file set. */
export function analyzePipes(files: string[]): PipeFact[] {
  return files.flatMap((f) => findPipes(f));
}

/** Directives across a file set. */
export function analyzeDirectives(files: string[]): DirectiveFact[] {
  return files.flatMap((f) => findDirectives(f));
}

/* ──────────── M2.6 — routes + guards: the router config (→ @weave-framework/router) ──────────── */

/** One route entry — what becomes a Weave route (guards → `beforeEach`, lazy → dynamic import). */
export interface RouteFact {
  /** The `path` segment (`''` default, `'**'` wildcard), or null when unstated. */
  path: string | null;
  /** The routed component's class name, or null (a redirect / lazy / layout-only route). */
  component: string | null;
  /** `redirectTo` target, or null. */
  redirectTo: string | null;
  /** `loadChildren` / `loadComponent` present — a lazy boundary. */
  lazy: boolean;
  /** Guard class names across `canActivate` / `canActivateChild` / `canDeactivate` / `canMatch`. */
  guards: string[];
  /**
   * Index of this route's parent in the same array, or null at the top.
   *
   * The walk always recursed into `children`; it just threw the relationship away, and a flat list of 100 routes
   * is not something anyone recognises as their own application. Kept as an index rather than nesting so the
   * shape stays serialisable and every existing reader that treats this as a flat list still works.
   */
  parent: number | null;
  /** How deep in the route tree — 0 at the top. Derived from `parent`, carried so a renderer need not walk. */
  depth: number;
  /**
   * What a lazy route loads: the module specifier inside `import('…')`, or null when it could not be read.
   *
   * `lazy` said only THAT there is a boundary. Where it leads is the more useful half — Angular drew that line
   * as a separate bundle, which makes it the most natural line to migrate along, one piece at a time.
   */
  lazyTarget: string | null;
  /** A named `<router-outlet name="x">` target, or null for the primary outlet. */
  outlet: string | null;
  /**
   * The file this route was declared in.
   *
   * Without it a route config is unattached. Real applications express their hierarchy through lazy modules far
   * more often than through `children`: this one has 49 lazy boundaries and not a single nested route, so its
   * 102 routes arrive from a dozen different files as one flat list. `lazyTarget` names a module, and only
   * `file` lets that be matched to the routes living inside it — which is the difference between a list and a
   * tree.
   */
  file: string;
  /** The same names kept per Angular guard key. The kind decides the Weave translation: an ENTRY guard checks
   *  `nav.to`, a LEAVE guard (`canDeactivate`) checks `nav.from` — flattening them would lose that. */
  guardsByKind: Record<string, string[]>;
}

const GUARD_KEYS: string[] = ['canActivate', 'canActivateChild', 'canDeactivate', 'canMatch', 'canLoad'];

/**
 * The module specifier a lazy route loads: `loadChildren: () => import('./admin/admin.module')` → `./admin/admin.module`.
 *
 * Both spellings are handled — `loadChildren` (a module or routes array) and `loadComponent` (a standalone
 * component) — and both may end in `.then(m => m.X)`, so the walk looks for the first `import()` anywhere
 * inside the property's value rather than expecting a fixed shape.
 */
function lazySpecifier(obj: ts.ObjectLiteralExpression): string | null {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p) || !p.name || !ts.isIdentifier(p.name)) continue;
    if (p.name.text !== 'loadChildren' && p.name.text !== 'loadComponent') continue;
    let found: string | null = null;
    const look = (n: ts.Node): void => {
      if (found) return;
      // `import('x')` is a CallExpression whose callee is the `import` keyword itself.
      if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg: ts.Expression | undefined = n.arguments[0];
        if (arg && ts.isStringLiteral(arg)) found = arg.text;
        return;
      }
      ts.forEachChild(n, look);
    };
    look(p.initializer);
    if (found) return found;
  }
  return null;
}

/** An identifier-valued property's name (`component: Foo` → `Foo`), or null. */
function identifierProp(obj: ts.ObjectLiteralExpression, key: string): string | null {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && p.name && ts.isIdentifier(p.name) && p.name.text === key && ts.isIdentifier(p.initializer)) {
      return p.initializer.text;
    }
  }
  return null;
}

/**
 * The entries of an array-valued property, AS WRITTEN (`canActivate: [A, B]`, `imports: [RouterModule]`). Kept as
 * source text rather than identifiers only, so an entry that is a call (`SomeModule.forRoot()`) is still recorded
 * — reading past it made the list quietly shorter than the one in the file.
 */
function identifierArrayProp(obj: ts.ObjectLiteralExpression, key: string): string[] {
  const out: string[] = [];
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && p.name && ts.isIdentifier(p.name) && p.name.text === key && ts.isArrayLiteralExpression(p.initializer)) {
      for (const el of p.initializer.elements) out.push(el.getText(el.getSourceFile()));
    }
  }
  return out;
}

/** Turn one route object literal into a fact, then recurse into its `children`, remembering who bore them. */
function routeFromObject(obj: ts.ObjectLiteralExpression, out: RouteFact[], file: string, parent: number | null = null): void {
  const guardsByKind: Record<string, string[]> = {};
  for (const k of GUARD_KEYS) {
    const found: string[] = identifierArrayProp(obj, k);
    if (found.length) guardsByKind[k] = found;
  }
  const guards: string[] = GUARD_KEYS.flatMap((k) => guardsByKind[k] ?? []);
  const self: number = out.length;
  out.push({
    guardsByKind,
    path: stringProp(obj, 'path'),
    component: identifierProp(obj, 'component'),
    redirectTo: stringProp(obj, 'redirectTo'),
    lazy: hasProp(obj, 'loadChildren') || hasProp(obj, 'loadComponent'),
    guards,
    parent,
    depth: parent === null ? 0 : (out[parent]?.depth ?? 0) + 1,
    lazyTarget: lazySpecifier(obj),
    outlet: stringProp(obj, 'outlet'),
    file,
  });
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && p.name && ts.isIdentifier(p.name) && p.name.text === 'children' && ts.isArrayLiteralExpression(p.initializer)) {
      for (const el of p.initializer.elements) if (ts.isObjectLiteralExpression(el)) routeFromObject(el, out, file, self);
    }
  }
}

/** Every route object inside a routes array literal (flattening `children`). */
function routesFromArray(arr: ts.ArrayLiteralExpression, out: RouteFact[], file: string): void {
  for (const el of arr.elements) if (ts.isObjectLiteralExpression(el)) routeFromObject(el, out, file);
}

/** Is this type node `Routes` or `Route[]` (a route-config annotation)? */
function isRoutesType(type: ts.TypeNode | undefined): boolean {
  if (!type) return false;
  if (ts.isArrayTypeNode(type)) return typeRefName(type.elementType) === 'Route';
  return typeRefName(type) === 'Routes';
}

/**
 * Parse one `.ts` file and return every route it declares. Route arrays are found at their idiomatic anchors —
 * `RouterModule.forRoot([...])` / `forChild([...])`, `provideRouter([...])`, and a `Routes`/`Route[]`-typed
 * declaration (`const routes: Routes = [...]`). Nested `children` are flattened. Guards, lazy boundaries, and
 * redirects are captured. A file with no routes yields `[]`.
 */
export function findRoutes(filePath: string): RouteFact[] {
  const sf: ts.SourceFile | null = parseFile(filePath);
  if (!sf) return [];
  const out: RouteFact[] = [];

  const visit = (node: ts.Node): void => {
    // anchor 1 & 2: RouterModule.forRoot/forChild(...) and provideRouter(...)
    if (ts.isCallExpression(node)) {
      const callee: ts.Expression = node.expression;
      const isRouterModule: boolean =
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'RouterModule' &&
        (callee.name.text === 'forRoot' || callee.name.text === 'forChild');
      const isProvideRouter: boolean = ts.isIdentifier(callee) && callee.text === 'provideRouter';
      if ((isRouterModule || isProvideRouter) && node.arguments.length && ts.isArrayLiteralExpression(node.arguments[0])) {
        routesFromArray(node.arguments[0], out, filePath);
      }
    }
    // anchor 3: a `Routes`/`Route[]`-typed declaration
    if (ts.isVariableDeclaration(node) && isRoutesType(node.type) && node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
      routesFromArray(node.initializer, out, filePath);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Every route across a set of files (the walk's `files`), flattened. Unreadable files contribute nothing. */
export function analyzeRoutes(files: string[]): RouteFact[] {
  return files.flatMap((f) => findRoutes(f));
}

/* ──────────── M2.7 — forms: reactive-forms usage (→ @weave-framework/forms) ──────────── */

/** Reactive-forms usage in one file — what becomes `@weave-framework/forms`. */
export interface FormFact {
  file: string;
  /** The first class in the file (best-effort "where"), or null. */
  className: string | null;
  /** `@angular/forms` primitives the file imports (`FormGroup`, `FormControl`, `FormBuilder`, `FormArray`, …). */
  primitives: string[];
  /** Control names discovered from `new FormGroup({...})` / `fb.group({...})` object literals. */
  controls: string[];
}

/** The named imports a source file pulls from every module whose specifier satisfies `matches`. */
function namedImports(sf: ts.SourceFile, matches: (spec: string) => boolean): string[] {
  const names: string[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier) || !matches(stmt.moduleSpecifier.text)) continue;
    const bindings: ts.NamedImportBindings | undefined = stmt.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const el of bindings.elements) names.push(el.name.text);
  }
  return names;
}

/** The named imports a file pulls from `@angular/forms` (`[]` when it imports nothing from there). */
function angularFormsImports(sf: ts.SourceFile): string[] {
  return namedImports(sf, (s) => s === '@angular/forms');
}

/**
 * A file's import statements as WRITTEN, with the specifier separated out.
 *
 * The converted code keeps using what the original used — `size` from lodash, a type from a workspace lib — so
 * those imports have to travel with it. Without them the translated body names things that do not exist, which
 * is a compile error in every migrated file that used a helper.
 */
export function sourceImports(filePath: string): Array<{ text: string; spec: string }> {
  const sf: ts.SourceFile | null = parseFile(filePath);
  if (!sf) return [];
  const out: Array<{ text: string; spec: string }> = [];
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    out.push({ text: stmt.getText(sf), spec: stmt.moduleSpecifier.text });
  }
  return out;
}

/**
 * The names a file imports from one package root (`rxjs` also covers `rxjs/operators`). Used to give a converted
 * service RxJS-specific guidance based on what it ACTUALLY uses, rather than a generic wall of advice.
 */
export function importedNamesFrom(filePath: string, packageRoot: string): string[] {
  const sf: ts.SourceFile | null = parseFile(filePath);
  if (!sf) return [];
  return namedImports(sf, (s) => s === packageRoot || s.startsWith(`${packageRoot}/`));
}

/** The keys of an object-literal argument (`new FormGroup({ name: …, email: … })` → `['name','email']`). */
function objectKeys(obj: ts.ObjectLiteralExpression): string[] {
  const keys: string[] = [];
  for (const p of obj.properties) {
    if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name) {
      if (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) keys.push(p.name.text);
    }
  }
  return keys;
}

/**
 * Parse one `.ts` file and, IF it uses `@angular/forms`, return a single fact describing its reactive-forms
 * usage: which primitives it imports and the control names it declares (from `new FormGroup({...})` and
 * `FormBuilder.group({...})` object literals). Files that don't import `@angular/forms` yield `[]` — the import
 * is the gate, so unrelated `.group(...)` calls are never mistaken for a form.
 */
export function findForms(filePath: string): FormFact[] {
  const sf: ts.SourceFile | null = parseFile(filePath);
  if (!sf) return [];
  const primitives: string[] = angularFormsImports(sf);
  if (!primitives.length) return []; // not a forms file

  const controls: string[] = [];
  let className: string | null = null;
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name && !className) className = node.name.text;
    // new FormGroup({...}) / new FormRecord({...})
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === 'FormGroup' || node.expression.text === 'FormRecord')) {
      const arg: ts.Expression | undefined = node.arguments?.[0];
      if (arg && ts.isObjectLiteralExpression(arg)) controls.push(...objectKeys(arg));
    }
    // fb.group({...}) — a FormBuilder call (the gate above guarantees this file really uses @angular/forms)
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && (node.expression.name.text === 'group' || node.expression.name.text === 'record')) {
      const arg: ts.Expression | undefined = node.arguments[0];
      if (arg && ts.isObjectLiteralExpression(arg)) controls.push(...objectKeys(arg));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return [{ file: filePath, className, primitives, controls: [...new Set(controls)] }];
}

/** Every forms-using file in a set (the walk's `files`), flattened. Unreadable files contribute nothing. */
export function analyzeForms(files: string[]): FormFact[] {
  return files.flatMap((f) => findForms(f));
}

/* ──────────── M2.9 — call graph (best-effort): who calls what, through injected fields ──────────── */

/** A static method-call edge. `dynamic` marks a call whose receiver type couldn't be resolved (human, look). */
export interface CallEdge {
  /** `ClassName.method` — the method the call is made FROM. */
  from: string;
  /** `DepType.method` (through an injected field), `ClassName.method` (a `this.x()` self-call), or `?.method`. */
  to: string;
  /** True when the receiver's type is unknown — the edge target is a guess-free `?` (never invented). */
  dynamic: boolean;
}

/** A class's field → injected-type map: constructor parameter-properties + `inject()`/typed field declarations. */
function fieldTypes(node: ts.ClassDeclaration): Map<string, string> {
  const map: Map<string, string> = new Map<string, string>();
  for (const member of node.members) {
    if (ts.isConstructorDeclaration(member)) {
      for (const param of member.parameters) {
        const hasModifier: boolean = (ts.canHaveModifiers(param) ? (ts.getModifiers(param) ?? []) : []).length > 0; // a parameter property (private/readonly/…) becomes a field
        const t: string | null = typeRefName(param.type);
        if (hasModifier && t && ts.isIdentifier(param.name)) map.set(param.name.text, t);
      }
    }
    if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name)) {
      const injected: ts.Expression | undefined =
        member.initializer && ts.isCallExpression(member.initializer) && ts.isIdentifier(member.initializer.expression) && member.initializer.expression.text === 'inject'
          ? member.initializer.arguments[0]
          : undefined;
      if (injected && ts.isIdentifier(injected)) map.set(member.name.text, injected.text); // x = inject(Foo)
      else {
        const t: string | null = typeRefName(member.type);
        if (t) map.set(member.name.text, t); // x: Foo
      }
    }
  }
  return map;
}

/** The call target of `<receiver>.<name>()`, resolved through `this.field` types; null when it's not a method call we track. */
function resolveTarget(call: ts.CallExpression, cls: string, fields: Map<string, string>): { to: string; dynamic: boolean } | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  const recv: ts.Expression = call.expression.expression;
  const method: string = call.expression.name.text;
  if (recv.kind === ts.SyntaxKind.ThisKeyword) return { to: `${cls}.${method}`, dynamic: false }; // this.method()
  if (ts.isPropertyAccessExpression(recv) && recv.expression.kind === ts.SyntaxKind.ThisKeyword) {
    const type: string | undefined = fields.get(recv.name.text); // this.field.method()
    return type ? { to: `${type}.${method}`, dynamic: false } : { to: `?.${method}`, dynamic: true };
  }
  return null; // a free function or an external chain — not part of the component/service call graph
}

/**
 * Best-effort static call graph for one file: for each method of each class, the calls it makes to `this.method()`
 * (self) and `this.injectedField.method()` (resolved through the field's declared type). A call whose receiver
 * type can't be resolved is emitted with `dynamic: true` and a `?` target — surfaced, never guessed. Free
 * functions and external chains are out of scope (this graph is about component/service wiring).
 */
export function findCalls(filePath: string): CallEdge[] {
  const sf: ts.SourceFile | null = parseFile(filePath);
  if (!sf) return [];
  const edges: CallEdge[] = [];

  const visitClass = (node: ts.ClassDeclaration): void => {
    const cls: string = node.name?.text ?? '(anonymous)';
    const fields: Map<string, string> = fieldTypes(node);
    for (const member of node.members) {
      if (!ts.isMethodDeclaration(member) || !member.body) continue;
      const from: string = `${cls}.${memberName(member) ?? '(anonymous)'}`;
      const walkBody = (n: ts.Node): void => {
        if (ts.isCallExpression(n)) {
          const t: { to: string; dynamic: boolean } | null = resolveTarget(n, cls, fields);
          if (t) edges.push({ from, to: t.to, dynamic: t.dynamic });
        }
        ts.forEachChild(n, walkBody);
      };
      walkBody(member.body);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) visitClass(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return edges;
}

/** The call graph across a set of files (the walk's `files`), flattened. Unreadable files contribute nothing. */
export function analyzeCalls(files: string[]): CallEdge[] {
  return files.flatMap((f) => findCalls(f));
}

/* ──────────── M2.10 — branch capture (best-effort): the if/else/ternary shape per method ──────────── */

/** The branching shape of one method — the "if this / if not" cases M3 must preserve. */
export interface BranchFact {
  /** `ClassName.method`. */
  method: string;
  /** `if` statements. */
  ifs: number;
  /** `else` / `else if` branches (any `if` with an else clause). */
  elses: number;
  /** `? :` conditional expressions. */
  ternaries: number;
  /** `switch` statements. */
  switches: number;
}

/**
 * For each method of each class, count its branch points — `if`, `else`, ternary, `switch`. Not a semantic model,
 * a SHAPE: enough for M3 to see which methods carry conditional logic (and how much) so their branches are
 * preserved, not flattened. Methods with no branches are omitted (nothing to preserve).
 */
export function findBranches(filePath: string): BranchFact[] {
  const sf: ts.SourceFile | null = parseFile(filePath);
  if (!sf) return [];
  const facts: BranchFact[] = [];

  const visitClass = (node: ts.ClassDeclaration): void => {
    const cls: string = node.name?.text ?? '(anonymous)';
    for (const member of node.members) {
      if (!ts.isMethodDeclaration(member) || !member.body) continue;
      let ifs: number = 0;
      let elses: number = 0;
      let ternaries: number = 0;
      let switches: number = 0;
      const count = (n: ts.Node): void => {
        if (ts.isIfStatement(n)) {
          ifs++;
          if (n.elseStatement) elses++;
        } else if (ts.isConditionalExpression(n)) ternaries++;
        else if (ts.isSwitchStatement(n)) switches++;
        ts.forEachChild(n, count);
      };
      count(member.body);
      if (ifs || elses || ternaries || switches) {
        facts.push({ method: `${cls}.${memberName(member) ?? '(anonymous)'}`, ifs, elses, ternaries, switches });
      }
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) visitClass(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return facts;
}

/** Branch shapes across a set of files (the walk's `files`), flattened. Unreadable files contribute nothing. */
export function analyzeBranches(files: string[]): BranchFact[] {
  return files.flatMap((f) => findBranches(f));
}

/* ──────────── COVERAGE — what is in the source, and what this tool actually does with it ──────────── */

/**
 * Every kind of top-level declaration a migration can meet. The point of naming them all is that the tool can
 * then report what it does NOT handle, instead of quietly producing nothing for it.
 */
export type DeclKind =
  | 'component'
  | 'service'
  | 'pipe'
  | 'directive'
  | 'resolver'
  | 'ngmodule'
  | 'class'
  | 'function'
  | 'const'
  | 'interface'
  | 'type'
  | 'enum'
  | 'reexport';

/** One declaration found in the source, and whether the pipeline produces anything for it. */
export interface Decl {
  file: string;
  name: string;
  kind: DeclKind;
  exported: boolean;
  /** True when this is genuinely CONVERTED to Weave (a component or a service becoming a store/context). */
  handled: boolean;
  /** True when the code reaches the output at all. A carried file is moved verbatim and still needs hand work —
   *  counting it as converted would be the same over-claiming that hid the earlier gaps. */
  carried: boolean;
  /** For anything not converted: what would have to happen. Never blank — silence is what caused this. */
  note: string;
}

/** What the converter can currently emit. Everything else is reported as a gap, by construction. */
const HANDLED_KINDS: Set<DeclKind> = new Set<DeclKind>(['component', 'service', 'pipe', 'directive', 'resolver']);

/** Why a given kind is not handled yet — written once, so the report is specific rather than a shrug. */
const UNHANDLED_NOTES: Record<string, string> = {
  pipe: 'an Angular @Pipe class — in Weave a pipe is just a function (or a `computed`); the class is not converted yet',
  directive: 'an Angular @Directive — the Weave equivalent is a `use:` action; not converted yet',
  // Read and written out as a wiring note, but deliberately NOT counted as converted: it becomes no Weave code,
  // because Weave has no modules. Counting a note as a conversion would be exactly the over-claiming to avoid.
  ngmodule: 'an @NgModule — Weave has no modules, so it becomes no code; a note listing its declarations, providers and exports is written beside it',
  class: 'a plain class (a resolver, a model, a helper) — copied nowhere yet; most are valid TypeScript already',
  function: 'a plain exported function — usually valid TypeScript as-is, but nothing is written for it yet',
  const: 'a plain exported constant — usually valid as-is, but nothing is written for it yet',
  interface: 'a TypeScript interface — valid as-is, but nothing is written for it yet',
  type: 'a TypeScript type alias — valid as-is, but nothing is written for it yet',
  enum: 'a TypeScript enum — valid as-is, but nothing is written for it yet',
  reexport: 'a re-export (a barrel like index.ts) — the public entry consumers import; not written yet',
};

/** The decorator kind on a class, if any: `@Component` / `@Injectable` / `@Pipe` / `@Directive` / `@NgModule`. */
function decoratedAs(node: ts.ClassDeclaration): DeclKind | null {
  for (const d of decoratorsOf(node)) {
    switch (decoratorName(d)) {
      case 'Component':
        return 'component';
      case 'Injectable':
        return 'service';
      case 'Pipe':
        return 'pipe';
      case 'Directive':
        return 'directive';
      case 'NgModule':
        return 'ngmodule';
      default:
        break;
    }
  }
  return null;
}

/** Is this statement exported? */
function isExported(node: ts.Node): boolean {
  const mods: readonly ts.ModifierLike[] = ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];
  return mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/**
 * List EVERY top-level declaration across the walked files, each marked handled or not.
 *
 * This exists because of a real failure: each milestone was gated on "does what I built work?", never on "is
 * anything left unhandled?" — so the pipeline looked finished while whole files (a barrel, a resolver, a helper
 * module, an NgModule) produced no output at all, silently. Coverage has to be measured against the SOURCE, not
 * against the feature list.
 */
export function inventory(files: string[]): Decl[] {
  const out: Decl[] = [];
  for (const file of files) {
    const sf: ts.SourceFile | null = parseFile(file);
    if (!sf) continue;
    for (const stmt of sf.statements) {
      const add = (name: string, kind: DeclKind): void => {
        const converted: boolean = HANDLED_KINDS.has(kind);
        out.push({
          file,
          name,
          kind,
          exported: isExported(stmt),
          handled: converted,
          // Everything reaches the output now — a file with no @Component/@Injectable is carried whole — but
          // carried is NOT converted, and the report keeps the two apart on purpose.
          carried: true,
          note: converted ? '' : (UNHANDLED_NOTES[kind] ?? 'not converted yet'),
        });
      };
      // A route RESOLVER carries no decorator, so it used to land in the `class` bucket and be counted as plain
      // TypeScript carried across. It is an Angular construct with a Weave counterpart, and is counted as one.
      if (ts.isClassDeclaration(stmt)) {
        const resolver: boolean =
          decoratedAs(stmt) === null &&
          stmt.members.some((m) => ts.isMethodDeclaration(m) && memberName(m) === 'resolve' && m.parameters.length > 0);
        add(stmt.name?.text ?? '(anonymous class)', decoratedAs(stmt) ?? (resolver ? 'resolver' : 'class'));
      }
      if (ts.isFunctionDeclaration(stmt)) add(stmt.name?.text ?? '(anonymous function)', 'function');
      else if (ts.isInterfaceDeclaration(stmt)) add(stmt.name.text, 'interface');
      else if (ts.isTypeAliasDeclaration(stmt)) add(stmt.name.text, 'type');
      else if (ts.isEnumDeclaration(stmt)) add(stmt.name.text, 'enum');
      else if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations) if (ts.isIdentifier(d.name)) add(d.name.text, 'const');
      } else if (ts.isExportDeclaration(stmt)) {
        add(stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : '(re-export)', 'reexport');
      }
    }
  }
  return out;
}

/** The coverage headline: how much of what was found is actually converted. */
export interface Coverage {
  total: number;
  /** Genuinely converted to Weave. */
  handled: number;
  /** Reaches the output but is still Angular code you have to port — moved, not translated. */
  carried: number;
  /** Unhandled declarations grouped by kind, most numerous first. */
  gaps: Array<{ kind: DeclKind; count: number; note: string; names: string[] }>;
  /** Files that contribute NOTHING to the output — the loudest signal that something is missing. */
  emptyFiles: string[];
}

/** Summarise an inventory into the coverage report the command and the plan both print. */
export function coverage(decls: Decl[]): Coverage {
  const byKind: Map<DeclKind, { count: number; note: string; names: string[] }> = new Map();
  const perFile: Map<string, { total: number; handled: number }> = new Map();
  for (const d of decls) {
    const f: { total: number; handled: number } = perFile.get(d.file) ?? { total: 0, handled: 0 };
    // "Empty" now means the file reaches the output in no form at all — with carrying in place that should be
    // zero, and the check stays so a future writer change cannot quietly reintroduce a dropped file.
    perFile.set(d.file, { total: f.total + 1, handled: f.handled + (d.carried ? 1 : 0) });
    if (d.handled) continue;
    const e: { count: number; note: string; names: string[] } = byKind.get(d.kind) ?? { count: 0, note: d.note, names: [] };
    byKind.set(d.kind, { count: e.count + 1, note: e.note, names: [...e.names, d.name] });
  }
  return {
    total: decls.length,
    handled: decls.filter((d) => d.handled).length,
    carried: decls.filter((d) => d.carried && !d.handled).length,
    gaps: [...byKind.entries()].map(([kind, v]) => ({ kind, ...v })).sort((a, b) => b.count - a.count),
    emptyFiles: [...perFile.entries()].filter(([, v]) => v.handled === 0).map(([f]) => f),
  };
}

/* ──────────── M2.8 (map half) + M2.11 — the package-usage map, and the whole facts map ──────────── */

/** Where a third-party package is used: the files that import it, and how many. */
export interface PackageUsage {
  name: string;
  sites: string[];
  count: number;
}

/**
 * Cross the walked files with their imports: for each third-party package (collapsed to its root), the files that
 * import it and the count. This is the "where used / how many sites" half of the package map (M2.8) — first-class,
 * because a decision to replace a package needs to know its blast radius.
 */
export function packageUsage(files: string[], tsPaths: TsPaths | null): PackageUsage[] {
  const byPkg: Map<string, Set<string>> = new Map<string, Set<string>>();
  for (const file of files) {
    for (const imp of parseImports(file, tsPaths)) {
      if (imp.kind !== 'third-party') continue;
      const root: string = rootPackage(imp.spec);
      if (!byPkg.has(root)) byPkg.set(root, new Set<string>());
      byPkg.get(root)?.add(file);
    }
  }
  return [...byPkg.entries()]
    .map(([name, sites]) => ({ name, sites: [...sites], count: sites.size }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The complete facts map for one migration unit — everything the analyzer measured (M2). Plain JSON, no logic. */
export interface MigrationFacts {
  /** The analyzed unit's directory. */
  unit: string;
  /** The entry file the walk began at, or null (recorded — never guessed). */
  entry: string | null;
  files: string[];
  angular: string[];
  internal: string[];
  packages: PackagePlan[];
  packageUsage: PackageUsage[];
  components: ComponentFact[];
  services: ServiceFact[];
  di: DiEdge[];
  routes: RouteFact[];
  forms: FormFact[];
  calls: CallEdge[];
  branches: BranchFact[];
  /** Circular-import chains — reported, not resolved. */
  cycles: string[][];
  /** Imports that could not be resolved — recorded, never guessed. */
  unresolved: string[];
  /** `@NgModule` classes — Weave has none, but they say what belonged together and what was provided. */
  ngModules: NgModuleFact[];
  /** `InjectionToken` consts — in Weave a context. */
  tokens: TokenFact[];
  /** `@Pipe` classes — in Weave a pipe is a function. */
  pipes: PipeFact[];
  /** `@Directive` classes — in Weave a `use:` action. */
  directives: DirectiveFact[];
  /** Route-resolver classes — in Weave a route `loader`. Carried as plain TypeScript before, which they are not. */
  resolvers: ResolverFact[];
  /** EVERY top-level declaration found, marked handled or not. */
  inventory: Decl[];
  /** The headline: how much of the source this tool actually converts, and exactly what it does not. */
  coverage: Coverage;
  /** Units the user opened up when asked — each one was analysed and folded in. */
  granted?: string[];
  /** What the user was asked for and declined. Recorded, because "not migrated" and "you chose not to show me
   *  this" are different answers, and only one of them is the tool's fault. */
  declined?: string[];
}

/* ──────────── what is USED but cannot be looked inside ──────────── */

/**
 * Angular's own injectables. These are not "out of reach" — they have a recorded Weave answer (or an honest note
 * saying they have none), and asking the user where `Router` lives would be nonsense.
 */
const ANGULAR_INJECTABLES: Set<string> = new Set<string>([
  'Router', 'ActivatedRoute', 'ActivatedRouteSnapshot', 'RouterStateSnapshot', 'HttpClient', 'HttpBackend', 'ElementRef',
  'Renderer2', 'ChangeDetectorRef', 'NgZone', 'ApplicationRef', 'Injector', 'ViewContainerRef', 'TemplateRef',
  'DOCUMENT', 'PLATFORM_ID', 'LOCALE_ID', 'DestroyRef', 'Location', 'Title', 'Meta', 'FormBuilder', 'TranslateService',
]);

/** One thing the migration would have to look inside, and cannot. */
export interface Reach {
  /** `lib` — a workspace library reached through a tsconfig alias. `class` — an injected type with no definition
   *  in this unit. `import` — a specifier that did not resolve at all. */
  kind: 'lib' | 'class' | 'import';
  /** The alias, class name, or specifier. */
  name: string;
  /** Where it already resolves on disk, when the workspace says so. `null` means only the user knows. */
  path: string | null;
  /** The names this unit actually uses from it — the reason to go in, and the measure of how much is at stake. */
  uses: string[];
  /** The files that need it. */
  neededBy: string[];
}

/**
 * Everything the migration can see is USED but cannot read: a workspace library (noted as an edge, deliberately
 * not expanded), an injected class defined somewhere this walk never went, and an import that did not resolve.
 *
 * This exists so the choice is the user's. Following every workspace lib by default turned one imported type into
 * 214 files; never following one means a service the app depends on is migrated as a name and nothing else. So it
 * is asked, per item, with the names at stake shown — and a refusal is recorded, not silently treated as absence.
 */
export function outOfReach(facts: MigrationFacts): Reach[] {
  const out: Reach[] = [];
  const tsPaths: TsPaths | null = readTsPaths(findWorkspaceRoot(facts.unit));

  for (const spec of facts.internal) {
    const uses: Set<string> = new Set<string>();
    const neededBy: string[] = [];
    for (const f of facts.files) {
      const names: string[] = importedNamesFrom(f, spec);
      if (!names.length) continue;
      neededBy.push(f);
      for (const n of names) uses.add(n);
    }
    out.push({ kind: 'lib', name: spec, path: tsPaths ? resolveAlias(spec, tsPaths) : null, uses: [...uses], neededBy });
  }

  // An injected type with no class in this unit. Its methods are what the bodies CALL, so without it every one of
  // those calls is a guess — which is exactly where the converter has to stop and say so.
  const known: Set<string> = new Set<string>([...facts.services.map((s) => s.className), ...facts.components.map((cf) => cf.className), ...facts.directives.map((d) => d.className), ...facts.pipes.map((p) => p.className)]);
  const byClass: Map<string, string[]> = new Map<string, string[]>();
  for (const holder of [...facts.services, ...facts.components]) {
    for (const dep of holder.injects) {
      if (known.has(dep) || ANGULAR_INJECTABLES.has(dep)) continue;
      if (!byClass.has(dep)) byClass.set(dep, []);
      byClass.get(dep)?.push(holder.file);
    }
  }
  for (const [name, files] of byClass) out.push({ kind: 'class', name, path: null, uses: [], neededBy: [...new Set(files)] });

  for (const spec of facts.unresolved) out.push({ kind: 'import', name: spec, path: null, uses: [], neededBy: [] });
  return out;
}

/**
 * Fold a granted unit's facts into the migration. Everything is concatenated and de-duplicated by the identity
 * that matters (a file path, a class name), and coverage is recomputed over the combined inventory — a merge that
 * kept the old coverage would report a percentage of a smaller source than the one actually being migrated.
 */
export function mergeFacts(base: MigrationFacts, extra: MigrationFacts): MigrationFacts {
  const uniq = <T,>(xs: T[], key: (x: T) => string): T[] => [...new Map(xs.map((x) => [key(x), x])).values()];
  const decls: Decl[] = uniq([...base.inventory, ...extra.inventory], (d) => `${d.file}:${d.name}`);
  return {
    ...base,
    files: [...new Set([...base.files, ...extra.files])],
    angular: [...new Set([...base.angular, ...extra.angular])],
    internal: [...new Set([...base.internal, ...extra.internal])],
    packages: uniq([...base.packages, ...extra.packages], (p) => p.name),
    packageUsage: [...base.packageUsage, ...extra.packageUsage],
    components: uniq([...base.components, ...extra.components], (x) => `${x.file}:${x.className}`),
    services: uniq([...base.services, ...extra.services], (x) => `${x.file}:${x.className}`),
    di: [...base.di, ...extra.di],
    routes: [...base.routes, ...extra.routes],
    forms: [...base.forms, ...extra.forms],
    calls: [...base.calls, ...extra.calls],
    branches: [...base.branches, ...extra.branches],
    cycles: [...base.cycles, ...extra.cycles],
    unresolved: [...new Set([...base.unresolved, ...extra.unresolved])],
    ngModules: uniq([...base.ngModules, ...extra.ngModules], (x) => `${x.file}:${x.className}`),
    tokens: uniq([...base.tokens, ...extra.tokens], (x) => `${x.file}:${x.name}`),
    pipes: uniq([...base.pipes, ...extra.pipes], (x) => `${x.file}:${x.className}`),
    directives: uniq([...base.directives, ...extra.directives], (x) => `${x.file}:${x.className}`),
    resolvers: uniq([...(base.resolvers ?? []), ...(extra.resolvers ?? [])], (x) => `${x.file}:${x.className}`),
    inventory: decls,
    coverage: coverage(decls),
    granted: [...(base.granted ?? []), extra.unit],
    declined: base.declined ?? [],
  };
}

/** The top-level names a file EXPORTS (`export interface X`, `export enum X`, `export const X`, `export class X`). */
export function exportedNames(filePath: string): string[] {
  const sf: ts.SourceFile | null = parseFile(filePath);
  if (!sf) return [];
  const out: string[] = [];
  for (const st of sf.statements) {
    const exported: boolean = ts.canHaveModifiers(st) && (ts.getModifiers(st) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) out.push(d.name.text);
    } else if (
      (ts.isInterfaceDeclaration(st) || ts.isEnumDeclaration(st) || ts.isClassDeclaration(st) || ts.isFunctionDeclaration(st) || ts.isTypeAliasDeclaration(st)) &&
      st.name
    ) {
      out.push(st.name.text);
    }
  }
  return out;
}

/**
 * Restrict a walk to what a given set of NAMES actually reaches. A library's entry is a barrel, and a barrel
 * re-exports everything — so walking one from its entry pulls the whole library in. Importing `IBreadcrumb` from
 * a lib of 200 interfaces has to migrate one interface, not two hundred: the files that DECLARE the wanted names
 * become the roots, and the walk runs from those.
 */
function narrowTo(walk: DependencyWalk, names: string[]): DependencyWalk {
  const roots: string[] = walk.files.filter((f) => exportedNames(f).some((n) => names.includes(n)));
  if (!roots.length) return walk; // nothing here declares them — say so by leaving the walk whole, not empty
  const merged: DependencyWalk = { files: [], angular: [], thirdParty: [], internal: [], cycles: [], unresolved: [] };
  const union = (key: 'files' | 'angular' | 'thirdParty' | 'internal' | 'unresolved', xs: string[]): void => {
    merged[key] = [...new Set([...merged[key], ...xs])];
  };
  for (const root of roots) {
    const sub: DependencyWalk = walkDependencies(root);
    union('files', sub.files);
    union('angular', sub.angular);
    union('thirdParty', sub.thirdParty);
    union('internal', sub.internal);
    union('unresolved', sub.unresolved);
    merged.cycles.push(...sub.cycles);
  }
  return merged;
}

/**
 * Run the whole M2 analysis for one unit and return the assembled facts. Single source of truth: the command
 * renders its summary from this, and `writeFacts` serialises the same object. When no entry is found, everything
 * is empty and `entry` is null (honest, not a crash).
 *
 * `only` narrows the unit to the names actually wanted from it — see `narrowTo`. Without it a library is taken
 * whole, which is right when the user pointed AT that library and wrong when they merely import one type from it.
 */
export function assembleFacts(unitDir: string, only?: string[]): MigrationFacts {
  const entry: string | null = findEntryPoint(unitDir);
  const empty: MigrationFacts = {
    unit: unitDir, entry: null, files: [], angular: [], internal: [], packages: [], packageUsage: [],
    components: [], services: [], di: [], routes: [], forms: [], calls: [], branches: [], cycles: [], unresolved: [],
    ngModules: [], tokens: [], pipes: [], directives: [], resolvers: [],
    inventory: [], coverage: { total: 0, handled: 0, carried: 0, gaps: [], emptyFiles: [] },
  };
  if (!entry) return empty;

  const walk: DependencyWalk = only?.length ? narrowTo(walkDependencies(entry), only) : walkDependencies(entry);
  const workspaceRoot: string = findWorkspaceRoot(unitDir);
  const tsPaths: TsPaths | null = readTsPaths(workspaceRoot);
  const services: ServiceFact[] = analyzeServices(walk.files);
  const components: ComponentFact[] = analyzeComponents(walk.files);
  const decls: Decl[] = inventory(walk.files);
  return {
    unit: unitDir,
    entry,
    files: walk.files,
    angular: walk.angular,
    internal: walk.internal,
    packages: classifyPackages(walk.thirdParty, workspaceRoot),
    packageUsage: packageUsage(walk.files, tsPaths),
    components,
    services,
    di: diGraph([...services, ...components]), // components inject too — that edge fixes the convert order
    routes: analyzeRoutes(walk.files),
    forms: analyzeForms(walk.files),
    calls: analyzeCalls(walk.files),
    branches: analyzeBranches(walk.files),
    cycles: walk.cycles,
    unresolved: walk.unresolved,
    ngModules: analyzeNgModules(walk.files),
    tokens: analyzeTokens(walk.files),
    pipes: analyzePipes(walk.files),
    directives: analyzeDirectives(walk.files),
    resolvers: analyzeResolvers(walk.files),
    inventory: decls,
    coverage: coverage(decls),
  };
}

/**
 * Serialise the facts map to `<targetApp>/.weave-migrate/facts.json` and return the path written. `targetApp` is
 * the WEAVE app being migrated into — the source Angular app is only ever read, never written to.
 */
export function writeFacts(targetApp: string, facts: MigrationFacts): string {
  const dir: string = join(targetApp, '.weave-migrate');
  mkdirSync(dir, { recursive: true });
  const out: string = join(dir, 'facts.json');
  writeFileSync(out, `${JSON.stringify(facts, null, 2)}\n`, 'utf8');
  return out;
}
