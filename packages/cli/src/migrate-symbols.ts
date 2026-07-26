/**
 * `weave migrate` — the SYMBOL TABLE: what every declaration in the source became, for the whole unit at once.
 *
 * The converter walks declarations one at a time and each conversion knows only itself. That is why a component
 * became a default export while the files importing it went on naming `AppComponent`, why a service became
 * `useBreadcrumbs` while its importer still asked for `BreadcrumbsService`, and why a pipe became a function
 * that its own consumer was told did not exist. Each of those got its own patch; they are one problem.
 *
 * So the mapping is built ONCE, for the whole unit, before any file is finished — and then every emitted file's
 * imports are resolved against it in a single pass. After that no written file can name something that no longer
 * exists, because there is one place that knows what everything became.
 *
 * What this deliberately does NOT model: intent. It knows `ShortenPipe` is now the function `shorten` in
 * `pipes/shorten.ts`. It does not know what an `Observable` in that file ought to become. Structure is knowable
 * and is modelled exhaustively; meaning is a decision and is left to the reader.
 */
import { dirname, relative } from 'node:path';

/** One source declaration and what the converted output calls it. */
export interface WeaveSymbol {
  /** The name in the Angular source — `AppComponent`, `ShortenPipe`, `BreadcrumbsService`. */
  from: string;
  /** The name the converted file exports — `AppComponent` (as default), `shorten`, `useBreadcrumbs`. */
  to: string;
  /** True when the converted file exports it as `default` (every component does). */
  isDefault: boolean;
  /** Absolute path of the file that now holds it. */
  file: string;
  kind: 'component' | 'service' | 'pipe' | 'directive' | 'token';
}

/** An import statement as written, taken apart. */
interface ParsedImport {
  /** The whole statement, so it can be replaced verbatim. */
  text: string;
  /** The default binding (`import X from …`), or ''. */
  def: string;
  /** Named bindings, each `{ name, alias }` where alias is what the file calls it. */
  named: Array<{ name: string; alias: string }>;
  spec: string;
  /** True for `import type { … }` — a type-only import stays type-only. */
  typeOnly: boolean;
}

/** Every `import … from '…'` in a file, taken apart. Namespace and side-effect imports are left alone. */
function parseImports(source: string): ParsedImport[] {
  const out: ParsedImport[] = [];
  const re: RegExp = /import\s+(type\s+)?([^;'"]*?)\s*from\s*'([^']+)';?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const clause: string = m[2].trim();
    if (clause.startsWith('*')) continue; // a namespace import binds no individual name to rewrite
    const braces: RegExpMatchArray | null = clause.match(/\{([\s\S]*)\}/);
    const def: string = clause.replace(/\{[\s\S]*\}/, '').replace(/,\s*$/, '').trim();
    const named: Array<{ name: string; alias: string }> = (braces?.[1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const parts: string[] = s.split(/\s+as\s+/);
        const name: string = parts[0].replace(/^type\s+/, '').trim();
        return { name, alias: (parts[1] ?? name).trim() };
      });
    out.push({ text: m[0], def, named, spec: m[3], typeOnly: Boolean(m[1]) });
  }
  return out;
}

/** `./a/b.ts` relative to `./a/c.ts` → `./b`. Always posix, always extensionless — a specifier, not a path. */
function specifierFrom(fromFile: string, toFile: string): string {
  const rel: string = relative(dirname(fromFile), toFile).replace(/\\/g, '/').replace(/\.tsx?$/, '');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

/**
 * Resolve one emitted file's imports against the table: rename what was renamed, point it at where the thing
 * actually landed, and turn a named import of a default-exported symbol into a default import.
 *
 * Only names the table KNOWS are touched. Everything else — a type from a workspace lib, a helper from lodash,
 * a Weave package — passes through exactly as written, because the table is the list of things this migration
 * moved and nothing else is any of its business.
 */
export function resolveImports(content: string, file: string, table: Map<string, WeaveSymbol>): string {
  let out: string = content;
  for (const imp of parseImports(content)) {
    const matched: Array<{ binding: { name: string; alias: string }; sym: WeaveSymbol }> = imp.named
      .map((binding) => ({ binding, sym: table.get(binding.name) }))
      .filter((x): x is { binding: { name: string; alias: string }; sym: WeaveSymbol } => x.sym !== undefined);
    // A symbol that now lives in THIS file needs no import at all — it is right here. Left in place it is a
    // self-import: legal to write, resolved to the file itself, and a circular reference at runtime.
    const known: Array<{ binding: { name: string; alias: string }; sym: WeaveSymbol }> = matched.filter((x) => x.sym.file !== file);
    const self: Array<{ binding: { name: string; alias: string }; sym: WeaveSymbol }> = matched.filter((x) => x.sym.file === file);
    if (!known.length && !self.length) continue;

    const untouched: Array<{ name: string; alias: string }> = imp.named.filter((b) => !matched.some((k) => k.binding.name === b.name));
    const lines: string[] = [];
    // What stays where it was: the same statement, minus the names that moved.
    if (imp.def || untouched.length) {
      const clause: string = [imp.def, untouched.length ? `{ ${untouched.map((b) => (b.name === b.alias ? b.name : `${b.name} as ${b.alias}`)).join(', ')} }` : '']
        .filter(Boolean)
        .join(', ');
      lines.push(`import ${imp.typeOnly ? 'type ' : ''}${clause} from '${imp.spec}';`);
    }
    // One statement per destination, because two symbols can have moved to two different files.
    const byFile: Map<string, Array<{ binding: { name: string; alias: string }; sym: WeaveSymbol }>> = new Map();
    for (const k of known) {
      if (!byFile.has(k.sym.file)) byFile.set(k.sym.file, []);
      byFile.get(k.sym.file)?.push(k);
    }
    for (const [target, group] of byFile) {
      const spec: string = specifierFrom(file, target);
      // A default export is imported as a default. The file goes on CALLING it by the name it already used, so
      // the local name is kept: `import AppComponent from './app/app'` leaves every use site untouched.
      for (const k of group.filter((g) => g.sym.isDefault)) lines.push(`import ${k.binding.alias} from '${spec}';`);
      const plain: Array<{ binding: { name: string; alias: string }; sym: WeaveSymbol }> = group.filter((g) => !g.sym.isDefault);
      if (plain.length) {
        const names: string = plain.map((k) => (k.sym.to === k.binding.alias ? k.sym.to : `${k.sym.to} as ${k.binding.alias}`)).join(', ');
        lines.push(`import ${imp.typeOnly ? 'type ' : ''}{ ${names} } from '${spec}';`);
      }
    }
    out = out.replace(imp.text, lines.join('\n'));
  }
  return out;
}

/**
 * Two source declarations that would land on the same exported name in the same file. `applyWrites` cannot see
 * it and the compiler would only say "duplicate identifier" after the fact — this says which two, by source
 * name, before anything is written.
 */
export function symbolCollisions(table: Map<string, WeaveSymbol>): Array<{ file: string; name: string; from: string[] }> {
  const byTarget: Map<string, string[]> = new Map<string, string[]>();
  for (const sym of table.values()) {
    const key: string = `${sym.file}::${sym.isDefault ? 'default' : sym.to}`;
    if (!byTarget.has(key)) byTarget.set(key, []);
    byTarget.get(key)?.push(sym.from);
  }
  return [...byTarget.entries()]
    .filter(([, froms]) => froms.length > 1)
    .map(([key, froms]) => ({ file: key.split('::')[0], name: key.split('::')[1], from: froms }));
}
