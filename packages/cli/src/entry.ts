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

/** A JSON import specifier for `file` relative to `rootDir` (POSIX-slashed, `.ts` dropped, `./`-anchored). */
function importSpec(rootDir: string, file: string): string {
  const r: string = relative(rootDir, file).split(sep).join('/').replace(/\.ts$/, '');
  return JSON.stringify(r.startsWith('.') ? r : './' + r);
}

/** Emit the app entry module: register discovered custom elements, then mount the root. */
export function generateEntry(
  rootComponent: string,
  mount: string,
  rootDir: string,
  elements: CustomElement[]
): string {
  const spec = (file: string): string => importSpec(rootDir, file);
  const lines: string[] = [`import Root from ${spec(rootComponent)};`];
  elements.forEach((ce, i) => lines.push(`import __ce${i} from ${spec(ce.file)};`));
  lines.push('import { mountComponent, defineCustomElement } from "@weave-framework/runtime/dom";');
  // Register custom elements BEFORE mounting, so a tag is defined at first render.
  elements.forEach((ce, i) =>
    lines.push(`defineCustomElement(${JSON.stringify(ce.tag)}, __ce${i}, { props: ${JSON.stringify(ce.props)} });`)
  );
  lines.push(`mountComponent(Root, ${JSON.stringify(mount)});`);
  return lines.join('\n');
}

/**
 * Emit the SSG **server** entry (Phase E, E1.3b). Bundled for Node and executed at build time: it imports the
 * root component and renders it headlessly to a {@link PageArtifact} (component HTML + state snapshot), which
 * the build assembles into the page document. Custom elements need no registration here — the headless DOM
 * serializes an unknown tag as a plain element, and interactivity is the client entry's job (CSR mount).
 *
 * The exported `render(route)` is what the build calls per route; keeping it a function (not a top-level side
 * effect) lets the build import the bundle once and drive it route by route.
 *
 * `runtime/server` is imported FIRST, on purpose: its module body installs the headless DOM as globals, and
 * the root's compiled module creates its `<template>` at evaluation time (`document.createElement`) — so the
 * server shim must be installed before the root module is evaluated. ESM evaluates imports in source order.
 *
 * `routed` (E1.3c): when the app uses the router, also import `setServerLocation` and seed it with the route
 * before rendering, so the router resolves that path headlessly. A non-routed app must NOT import the router
 * (it may not even depend on it) — so the plain root-only form is kept for that case.
 */
export function generateServerEntry(
  rootComponent: string,
  rootDir: string,
  options: { routed?: boolean } = {}
): string {
  const lines: string[] = [`import { renderPage } from "@weave-framework/runtime/server";`];
  if (options.routed) lines.push(`import { setServerLocation } from "@weave-framework/router";`);
  lines.push(`import Root from ${importSpec(rootDir, rootComponent)};`);
  lines.push(
    options.routed
      ? `export function render(route) { setServerLocation(route ?? "/"); return renderPage(Root, {}); }`
      : `export function render() { return renderPage(Root, {}); }`
  );
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
