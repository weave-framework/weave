/**
 * "What will this change break?" — answered from the composition graph, not from a search.
 *
 * A component's blast radius is a question every author asks before editing one, and the honest answer
 * has never been available: grep finds the tag's NAME, which is not the same as the components that
 * actually resolve to this file. The compiler already knows the difference — it resolves a PascalCase
 * tag to a module the same way the build does — so the graph can simply be read.
 *
 * Direct users first, then everything that reaches them, because the two mean different things: a
 * direct user is a file you will probably have to read; a transitive one is a screen that can change
 * under you without its own file being touched.
 */

import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve, extname, relative, dirname } from 'node:path';
import ts from 'typescript';
import { parseTemplate, parseSfcLoc, extractSources, type TemplateNode } from '@weave-framework/compiler';
import { composedTags } from './emit.js';
import { templateOf, type WeaveFileKind } from './template-lint.js';
import { resolveChildModule } from './children-fs.js';

const SKIP: ReadonlySet<string> = new Set(['node_modules', 'dist', '.git']);

/** Who composes whom: an absolute component file → the absolute files that render it. */
export type UsedBy = Map<string, string[]>;

/** The file a component is KNOWN by — its `.ts`, since that is what a tag resolves to. */
function identityOf(file: string): string {
  return extname(file).toLowerCase() === '.html' ? file.replace(/\.html$/i, '.ts') : file;
}

/**
 * The file a child specifier names. `resolveChildModule` answers with an IMPORT SPECIFIER — relative and
 * extensionless, because that is what gets written into the generated module — so it has to be resolved
 * against the importing file and given back its extension before it can key anything.
 */
function moduleFile(fromDir: string, spec: string): string | null {
  for (const ext of ['.ts', '.weave', '']) {
    const p: string = resolve(fromDir, spec + ext);
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

/**
 * Where a component's own script lives, as text. A tag is resolved from the script FIRST, because a
 * real app imports most of its children explicitly and `resolveChildModule` only knows the no-import
 * convention — reading only the convention reported almost nothing on the docs site, which is exactly
 * the kind of feature that looks like it works.
 */
function scriptOf(file: string, kind: WeaveFileKind, source: string): string {
  if (kind === 'weave') return parseSfcLoc(source).script ?? '';
  if (kind === 'ts') return extractSources(source).script ?? source;
  try {
    return readFileSync(identityOf(file), 'utf8');
  } catch {
    return '';
  }
}

/** The module specifier a script imports `name` from, or null when it does not import it. */
function importedFrom(script: string, name: string): string | null {
  if (!script) return null;
  const sf: ts.SourceFile = ts.createSourceFile('s.ts', script, ts.ScriptTarget.Latest, true);
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const clause: ts.ImportClause | undefined = st.importClause;
    if (!clause) continue;
    if (clause.name?.text === name) return st.moduleSpecifier.text;
    const named: ts.NamedImportBindings | undefined = clause.namedBindings;
    if (named && ts.isNamedImports(named) && named.elements.some((e) => e.name.text === name)) {
      return st.moduleSpecifier.text;
    }
  }
  return null;
}

function kindOf(file: string): WeaveFileKind | null {
  const ext: string = extname(file).toLowerCase();
  if (ext === '.weave') return 'weave';
  if (ext === '.ts' && !file.toLowerCase().endsWith('.d.ts')) return 'ts';
  // Only a template with a sibling component script — the same rule the editor and the build apply.
  if (ext === '.html' && existsSync(identityOf(file))) return 'html';
  return null;
}

function walk(path: string, out: string[]): void {
  if (!existsSync(path)) return;
  if (statSync(path).isDirectory()) {
    for (const e of readdirSync(path)) if (!SKIP.has(e) && !e.startsWith('.')) walk(join(path, e), out);
    return;
  }
  if (kindOf(path)) out.push(path);
}

/** Read the composition graph under `roots`, keyed by the absolute file each tag resolves to. */
export function composition(roots: string[]): UsedBy {
  const files: string[] = [];
  for (const r of roots) walk(r, files);
  const usedBy: UsedBy = new Map();

  for (const file of files) {
    const kind: WeaveFileKind | null = kindOf(file);
    if (!kind) continue;
    let template: string | null;
    try {
      template = templateOf(readFileSync(file, 'utf8'), kind);
    } catch {
      continue;
    }
    if (!template) continue;
    let nodes: TemplateNode[];
    try {
      nodes = parseTemplate(template);
    } catch {
      continue; // a template that does not parse is the build's problem to report, not this one's
    }
    const user: string = resolve(identityOf(file));
    const script: string = scriptOf(file, kind, readFileSync(file, 'utf8'));
    for (const tag of composedTags(nodes)) {
      const child: string | null = importedFrom(script, tag) ?? resolveChildModule(tag, dirname(file));
      if (!child) continue; // an imported or unresolvable tag — the checker reports that separately
      const key: string | null = moduleFile(dirname(file), child);
      if (!key) continue;
      const list: string[] = usedBy.get(key) ?? [];
      if (!list.includes(user)) list.push(user);
      usedBy.set(key, list);
    }
  }
  return usedBy;
}

/** Direct users of `target`, and everything that reaches it beyond them. */
export function impactOf(roots: string[], target: string): { direct: string[]; transitive: string[] } {
  const usedBy: UsedBy = composition(roots);
  const key: string = resolve(identityOf(target));
  const direct: string[] = [...(usedBy.get(key) ?? [])];

  const seen: Set<string> = new Set([key, ...direct]);
  const queue: string[] = [...direct];
  const transitive: string[] = [];
  while (queue.length) {
    const next: string = queue.shift() as string;
    for (const up of usedBy.get(next) ?? []) {
      if (seen.has(up)) continue;
      seen.add(up);
      transitive.push(up);
      queue.push(up);
    }
  }
  const rel = (p: string): string => relative(process.cwd(), p).split(String.fromCharCode(92)).join('/');
  return { direct: direct.map(rel).sort(), transitive: transitive.map(rel).sort() };
}
