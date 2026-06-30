/**
 * File-based routing — turn a directory of page files into a `Route[]` tree
 * (the Next/Nuxt/SvelteKit convention). Pure + zero-dep so it is fully testable:
 * {@link fileToRoutes} maps a list of file specifiers to a manifest, and
 * {@link emitRoutesModule} serialises that manifest into an importable module.
 * The CLI supplies the actual directory scan; everything here is string work.
 *
 * Convention (per directory level):
 *  - `index.*`        → the index route (`path: ''`)
 *  - `about.*`        → `path: 'about'`
 *  - `[id].*`         → `path: ':id'` (dynamic segment)
 *  - `[...rest].*`    → `path: '*'` (catch-all; honoured at the top level)
 *  - `_layout.*`      → the folder's layout component; its folder becomes a nested
 *                       route whose `children` are that folder's routes
 *  - a folder WITHOUT a `_layout` is flattened: its routes get the folder name
 *    prefixed onto their paths (no wrapper route)
 */

/** A route in the generated manifest. `file` is the page's source specifier. */
export interface FileRoute {
  path: string;
  /** Page/layout source specifier (the emitter turns this into a component import). */
  file?: string;
  children?: FileRoute[];
}

const EXT: RegExp = /\.(weave|tsx?|jsx?)$/;

const baseName = (file: string): string => {
  const slash: number = file.lastIndexOf('/');
  return file.slice(slash + 1).replace(EXT, '');
};

/** Filename (no extension) → a route path segment. */
function segment(name: string): string {
  if (name === 'index') return '';
  const catchAll: RegExpExecArray | null = /^\[\.\.\.(.+)]$/.exec(name);
  if (catchAll) return '*';
  const dynamic: RegExpExecArray | null = /^\[(.+)]$/.exec(name);
  if (dynamic) return `:${dynamic[1]}`;
  return name;
}

interface Tree {
  files: Record<string, string>; // baseName → full specifier
  dirs: Record<string, Tree>;
}

const emptyTree = (): Tree => ({ files: {}, dirs: {} });

/** Per-segment specificity: a static segment (0) wins over `:param` (1) over `*` (2). */
function segSpecificity(seg: string): number {
  if (seg === '*' || seg.startsWith('*')) return 2;
  if (seg.startsWith(':')) return 1;
  return 0;
}

/**
 * Compare two route paths so the more specific one sorts first — segment by segment,
 * static before dynamic before catch-all. This must be segment-aware (not first-char)
 * because routes are flattened into one list with full multi-segment paths: e.g.
 * `reference/config` must precede `reference/:pkg` even though ':' < 'c' lexically.
 */
function compareRoutes(a: string, b: string): number {
  const as: string[] = a.split('/');
  const bs: string[] = b.split('/');
  const len: number = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const sa: string = as[i] ?? '';
    const sb: string = bs[i] ?? '';
    const da: number = segSpecificity(sa);
    const db: number = segSpecificity(sb);
    if (da !== db) return da - db; // more static segment wins at the first divergence
    if (sa !== sb) return sa.localeCompare(sb);
  }
  return 0;
}

function joinPath(dir: string, child: string): string {
  return child === '' ? dir : `${dir}/${child}`;
}

function convert(tree: Tree): FileRoute[] {
  const routes: FileRoute[] = [];

  for (const [name, file] of Object.entries(tree.files)) {
    if (name === '_layout') continue; // a layout is consumed by its folder, not a route here
    routes.push({ path: segment(name), file });
  }

  for (const [dir, sub] of Object.entries(tree.dirs)) {
    const childRoutes: FileRoute[] = convert(sub);
    const layout: string | undefined = sub.files['_layout'];
    if (layout) {
      routes.push({ path: dir, file: layout, children: sortRoutes(childRoutes) });
    } else {
      // no layout → flatten, prefixing the folder name onto each child path
      for (const r of childRoutes) routes.push({ ...r, path: joinPath(dir, r.path) });
    }
  }

  return sortRoutes(routes);
}

function sortRoutes(routes: FileRoute[]): FileRoute[] {
  return routes.sort((a, b) => compareRoutes(a.path, b.path));
}

/** Map a flat list of page-file specifiers to a nested {@link FileRoute} manifest. */
export function fileToRoutes(files: string[]): FileRoute[] {
  const root: Tree = emptyTree();
  for (const file of files) {
    const parts: string[] = file.split('/');
    let node: Tree = root;
    for (let i: number = 0; i < parts.length - 1; i++) {
      const dir: string = parts[i];
      node = node.dirs[dir] ??= emptyTree();
    }
    node.files[baseName(parts[parts.length - 1])] = file;
  }
  return convert(root);
}

/** Options for {@link emitRoutesModule}. */
export interface EmitRoutesOptions {
  /** Code-split every page via `lazy(() => import(...))` instead of a static import. */
  lazy?: boolean;
  /** Where `lazy` is imported from (default `@weave/runtime/dom`). */
  runtimeImport?: string;
  /** Prefix prepended to each `file` to form the import specifier (default `./`). */
  importPrefix?: string;
}

/** Serialise a manifest into an importable ES module exporting `const routes: Route[]`. */
export function emitRoutesModule(routes: FileRoute[], opts: EmitRoutesOptions = {}): string {
  const imports: string[] = [];
  let n: number = 0;
  const prefix: string = opts.importPrefix ?? './';
  const spec = (file: string): string => {
    const withPrefix: string = /^[./]/.test(file) ? file : prefix + file;
    // Drop a TS/JS extension so the import resolves under both esbuild and `tsc`
    // (importing a literal `.ts` errors without `allowImportingTsExtensions`).
    // Keep `.weave` — the SFC loader needs the explicit extension to resolve.
    return JSON.stringify(withPrefix.replace(/\.[mc]?[jt]sx?$/, ''));
  };

  const componentField = (file: string): string => {
    if (opts.lazy) return `component: lazy(() => import(${spec(file)}))`;
    const id: string = `Page${n++}`;
    imports.push(`import ${id} from ${spec(file)};`);
    return `component: ${id}`;
  };

  const serialize = (list: FileRoute[], indent: string): string => {
    const inner: string = indent + '  ';
    const items: string[] = list.map((r) => {
      const fields: string[] = [`path: ${JSON.stringify(r.path)}`];
      if (r.file) fields.push(componentField(r.file));
      if (r.children && r.children.length) {
        fields.push(`children: ${serialize(r.children, inner)}`);
      }
      return `${inner}{ ${fields.join(', ')} }`;
    });
    return `[\n${items.join(',\n')}\n${indent}]`;
  };

  const body: string = serialize(routes, '');
  const header: string = opts.lazy
    ? `import { lazy } from ${JSON.stringify(opts.runtimeImport ?? '@weave/runtime/dom')};\n`
    : '';
  return `${header}${imports.join('\n')}${imports.length ? '\n' : ''}\nexport const routes = ${body};\n`;
}
