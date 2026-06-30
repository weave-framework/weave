/**
 * Framework-owned bootstrap (Level C). When `weave.config` declares a `root`
 * component, the CLI generates the app entry instead of the author hand-writing a
 * `main.ts` + `mountComponent` + a `register-elements` file:
 *
 *  1. {@link discoverCustomElements} scans the project for components that declare
 *     `export const tag = '…'` (a custom-element name) and collects their props —
 *     so custom elements register themselves; nothing is imported by hand and
 *     nothing is forgotten. (A `<weave-badge>` in a template is a string tag, not an
 *     import, so the import graph can't find it — a filesystem scan is required.)
 *  2. {@link generateEntry} emits the entry module: import the root, register every
 *     discovered custom element (before first render), mount the root at the
 *     configured selector.
 *  3. {@link entryPlugin} serves that generated module to esbuild as a virtual entry.
 *
 * Fail loud: a tag declared twice, or a tag without the spec-required hyphen, aborts
 * the build with a clear message.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin, PluginBuild, OnResolveArgs } from 'esbuild';

/** A component that opted in as a native custom element via `export const tag`. */
export interface CustomElement {
  /** The hyphenated custom-element tag (e.g. `weave-badge`). */
  tag: string;
  /** Absolute path to the component `.ts`. */
  file: string;
  /** Prop names exposed as observed attributes + JS properties. */
  props: string[];
}

/** The sentinel specifier esbuild resolves to the generated entry module. */
export const VIRTUAL_ENTRY: string = 'weave-virtual-entry';

const SKIP: Set<string> = new Set(['node_modules', 'dist', '.git', '.weave']);
const TAG_RE: RegExp = /export\s+const\s+tag\s*(?::[^=]+)?=\s*(['"`])([^'"`]*)\1/;
const PROPS_RE: RegExp = /export\s+const\s+props\s*(?::[^=]+)?=\s*\[([^\]]*)\]/;
const STR_RE: RegExp = /(['"`])([^'"`]*)\1/g;

/** Scan `rootDir` for components declaring a custom-element `tag`. Fails loud on dupes / bad names. */
export function discoverCustomElements(rootDir: string): CustomElement[] {
  const found: CustomElement[] = [];
  walk(rootDir, found);
  const seen: Map<string, string> = new Map<string, string>();
  for (const ce of found) {
    const prev: string | undefined = seen.get(ce.tag);
    if (prev) {
      throw new Error(`weave: custom element tag "${ce.tag}" declared twice — ${prev} and ${ce.file}`);
    }
    seen.set(ce.tag, ce.file);
  }
  return found;
}

function walk(path: string, out: CustomElement[]): void {
  if (!existsSync(path)) return;
  const st: ReturnType<typeof statSync> = statSync(path);
  if (st.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (!SKIP.has(entry)) walk(join(path, entry), out);
    }
    return;
  }
  // Skip generated artifacts (`*.gen.ts`, `*.d.ts`): they are build outputs, not
  // authored components — and a `content.gen.ts` (docs markdown bundled as strings)
  // can legitimately contain the literal text `export const tag = '…'` inside an
  // example, which would otherwise be mis-discovered as a real custom element. The
  // file-based route discovery skips `.gen.` for the same reason.
  if (!path.endsWith('.ts') || path.endsWith('.d.ts') || path.endsWith('.gen.ts')) return;
  const src: string = readFileSync(path, 'utf8');
  const m: RegExpMatchArray | null = src.match(TAG_RE);
  if (!m) return;
  const tag: string = m[2];
  if (!tag.includes('-')) {
    throw new Error(
      `weave: custom element tag "${tag}" in ${path} must contain a hyphen (Custom Elements spec)`
    );
  }
  out.push({ tag, file: path, props: extractProps(src) });
}

function extractProps(src: string): string[] {
  const m: RegExpMatchArray | null = src.match(PROPS_RE);
  if (!m) return [];
  const props: string[] = [];
  let s: RegExpExecArray | null;
  STR_RE.lastIndex = 0;
  while ((s = STR_RE.exec(m[1])) !== null) props.push(s[2]);
  return props;
}

/** Emit the app entry module: register discovered custom elements, then mount the root. */
export function generateEntry(
  rootComponent: string,
  mount: string,
  rootDir: string,
  elements: CustomElement[]
): string {
  const spec = (file: string): string => {
    const r: string = relative(rootDir, file).split(sep).join('/').replace(/\.ts$/, '');
    return JSON.stringify(r.startsWith('.') ? r : './' + r);
  };
  const lines: string[] = [`import Root from ${spec(rootComponent)};`];
  elements.forEach((ce, i) => lines.push(`import __ce${i} from ${spec(ce.file)};`));
  lines.push('import { mountComponent, defineCustomElement } from "@weave/runtime/dom";');
  // Register custom elements BEFORE mounting, so a tag is defined at first render.
  elements.forEach((ce, i) =>
    lines.push(`defineCustomElement(${JSON.stringify(ce.tag)}, __ce${i}, { props: ${JSON.stringify(ce.props)} });`)
  );
  lines.push(`mountComponent(Root, ${JSON.stringify(mount)});`);
  return lines.join('\n');
}

/** esbuild plugin that serves the generated entry `code` for the {@link VIRTUAL_ENTRY} specifier. */
export function entryPlugin(code: string, resolveDir: string): Plugin {
  return {
    name: 'weave:entry',
    setup(build: PluginBuild): void {
      build.onResolve({ filter: new RegExp(`^${VIRTUAL_ENTRY}$`) }, (args: OnResolveArgs) => ({
        path: args.path,
        namespace: 'weave-entry',
      }));
      build.onLoad({ filter: /.*/, namespace: 'weave-entry' }, () => ({
        contents: code,
        loader: 'ts' as const,
        resolveDir,
      }));
    },
  };
}
