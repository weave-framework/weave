/**
 * The Weave esbuild plugin — the canonical loader (the inlined copy in
 * `tools/verify-build.mjs` mirrors this). Compiles two authoring forms into one
 * ES module each:
 *
 *  - `.weave` SFC (split by `parseSfc`)
 *  - separate files (Angular-style): a `.ts` with a co-located `<base>.<styleLang>`
 *    template's `<base>.html` (and optional `<base>.<styleLang>` styles).
 *
 * Styles can be authored in `.css`, `.scss`, or `.sass` — picked per project via
 * `options.styleLang` (so the loader pairs ONE extension, no filesystem probing) —
 * and are compiled to CSS before scoping.
 *
 * Two CSS delivery modes:
 *  - **build** (`dev: false`): scoped CSS is collected into `state.css` for the
 *    one-shot step to emit as a single stylesheet.
 *  - **dev** (`dev: true`): scoped CSS is appended to the component module as a
 *    tiny `<style>`-injecting IIFE, so nothing is written to disk (the dev server
 *    serves entirely from memory — `dist/` is a build-only artifact).
 *
 * A `.ts` without a sibling template is an ordinary module (the callback returns
 * `undefined`, so esbuild falls through to its default loader).
 */

import type { OnLoadArgs, OnLoadResult, Plugin, PluginBuild } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { compileComponent, parseSfc, extractSources, classifyTemplate, classifyStyle, childImportCandidates } from '@weave-framework/compiler';
import type { ComponentSource, ExtractedSources } from '@weave-framework/compiler';
import { compileStyleFileTracked, compileStyleSource, type StyleLang } from './styles.js';

export interface WeaveState {
  /** Scoped CSS collected from every component compiled this build (build mode only). */
  css: string[];
}

export interface WeaveOptions {
  /** Component style language — the sibling style file is `<base>.<styleLang>` (default `css`). */
  styleLang?: StyleLang;
  /** Dev mode: inject each component's CSS via JS instead of collecting it (default false). */
  dev?: boolean;
}

/** A stable id derived from CSS text (djb2), so a `<style>` can be deduped. */
function styleId(css: string): string {
  let h: number = 5381;
  for (let i: number = 0; i < css.length; i++) h = (Math.imul(h, 33) ^ css.charCodeAt(i)) | 0;
  return 'w-css-' + (h >>> 0).toString(36);
}

/**
 * A `<style>`-injecting IIFE appended to a component module in dev mode. Guarded by a
 * content-hash id: a component module re-evaluated on SPA navigation (or re-imported)
 * would otherwise append a *duplicate* `<style>` every time, so the head accumulates
 * hundreds of identical sheets and style recalc grinds to a halt. The guard makes
 * injection idempotent (a real style change gets a new hash → a new sheet).
 */
function cssInjector(css: string): string {
  if (!css) return '';
  const id: string = styleId(css);
  return `\n;(()=>{const id=${JSON.stringify(
    id
  )};if(document.getElementById(id))return;const s=document.createElement("style");s.id=id;s.textContent=${JSON.stringify(
    css
  )};document.head.appendChild(s);})();\n`;
}

/**
 * Resolve a component's template to its source text. Precedence: a declared
 * `template` (inline markup, or a path-shaped value read from disk) wins; otherwise
 * the sibling `<base>.html`. Fails loud on ambiguity (declared + sibling) and on a
 * declared file that does not exist.
 */
async function resolveTemplate(
  decl: ExtractedSources,
  tsPath: string,
  siblingHtml: string,
  hasSiblingHtml: boolean
): Promise<{ text: string; files: string[] }> {
  if (decl.template !== undefined) {
    if (hasSiblingHtml) {
      throw new Error(
        `weave: ${tsPath} declares \`template\` and also has a sibling .html — remove one`
      );
    }
    if (classifyTemplate(decl.template) === 'inline') return { text: decl.template, files: [] };
    const file: string = resolve(dirname(tsPath), decl.template);
    if (!existsSync(file)) throw new Error(`weave: template file not found: ${file} (from ${tsPath})`);
    return { text: await readFile(file, 'utf8'), files: [file] };
  }
  return { text: await readFile(siblingHtml, 'utf8'), files: [siblingHtml] };
}

/**
 * Resolve a component's styles to one CSS string. Precedence: declared `styles`
 * (inline CSS and/or path-shaped files, compiled and concatenated in order) win;
 * otherwise the sibling `<base>.<styleLang>`; otherwise none. Fails loud on
 * ambiguity and on a declared file that does not exist.
 */
async function resolveStyles(
  decl: ExtractedSources,
  tsPath: string,
  dir: string,
  styleLang: StyleLang
): Promise<{ css: string | undefined; files: string[] }> {
  if (decl.styles !== undefined) {
    const siblingStyle: string = tsPath.replace(/\.ts$/, '.' + styleLang);
    if (existsSync(siblingStyle)) {
      throw new Error(
        `weave: ${tsPath} declares \`styles\` and also has a sibling .${styleLang} — remove one`
      );
    }
    const parts: string[] = [];
    const files: string[] = [];
    for (const entry of decl.styles) {
      if (classifyStyle(entry) === 'inline') {
        parts.push(await compileStyleSource(entry, styleLang, dir));
      } else {
        const file: string = resolve(dir, entry);
        if (!existsSync(file)) throw new Error(`weave: style file not found: ${file} (from ${tsPath})`);
        const compiled: { css: string; files: string[] } = await compileStyleFileTracked(file);
        parts.push(compiled.css);
        files.push(...compiled.files);
      }
    }
    return { css: parts.join('\n'), files };
  }
  const siblingStyle: string = tsPath.replace(/\.ts$/, '.' + styleLang);
  if (!existsSync(siblingStyle)) return { css: undefined, files: [] };
  const compiled: { css: string; files: string[] } = await compileStyleFileTracked(siblingStyle);
  return { css: compiled.css, files: compiled.files };
}

/**
 * Blank out `//` line and block comments, preserving string/template literals so a `//`
 * or `/*` INSIDE a string (a URL, a regex-ish literal) is not mistaken for a comment. Used
 * before scanning for real `import` statements — a component's JSDoc often shows an
 * `import Child from '…'` usage example (e.g. Table's `<Checkbox>` note), which must NOT be
 * read as an actual import or the auto-resolver would skip wiring the composed child (it
 * would then mount to a swallowed ReferenceError → blank render).
 */
function stripComments(code: string): string {
  let out: string = '';
  let i: number = 0;
  const n: number = code.length;
  while (i < n) {
    const c: string = code[i];
    const d: string = code[i + 1];
    if (c === '"' || c === "'" || c === '`') {
      const quote: string = c;
      out += c;
      i++;
      while (i < n) {
        const ch: string = code[i];
        if (ch === '\\') {
          out += ch + (code[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += ch;
        i++;
        if (ch === quote) break;
      }
      continue;
    }
    if (c === '/' && d === '/') {
      while (i < n && code[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Does the component's own script already import a binding named `name`? (explicit wins).
 *  Scans comment-free code so a documented `import Child from '…'` example doesn't count. */
function importsBinding(script: string | undefined, name: string): boolean {
  if (!script) return false;
  const code: string = stripComments(script);
  const word: RegExp = new RegExp(`\\b${name}\\b`);
  const IMPORT: RegExp = /import\s+([^;]*?)\s+from\s+['"][^'"]+['"]/g;
  let m: RegExpExecArray | null;
  while ((m = IMPORT.exec(code)) !== null) {
    if (word.test(m[1])) return true; // the binding section (before `from`) names it
  }
  return false;
}

/**
 * Resolve a PascalCase child tag (`<Input>`) to a sibling component module by convention
 * and return the extension-less specifier to import (e.g. `../input/input`). Probes the
 * canonical layouts (dir-per-component, flat) for a `.ts`/`.weave` source; returns null
 * when none exists so the caller can fail loud.
 */
function resolveChildModule(tag: string, dir: string): string | null {
  for (const cand of childImportCandidates(tag)) {
    for (const ext of ['.ts', '.weave']) {
      if (existsSync(resolve(dir, cand + ext))) return cand;
    }
  }
  return null;
}

/**
 * Wire the PascalCase child tags a template composes (`<Input>`) to real imports. In
 * module mode the compiled render references each tag as a bare identifier, so it must be
 * in the emitted module's scope. If the component's own script already imports the name we
 * leave it (explicit wins); otherwise we resolve a sibling component module by convention
 * and prepend `import Tag from '…';`. An unresolvable tag fails loud — a silent miss would
 * mount to a blank node (the child call throws a swallowed ReferenceError).
 */
function injectChildImports(
  code: string,
  components: string[],
  dir: string,
  script: string | undefined,
  filename: string
): string {
  const imports: string[] = [];
  for (const tag of components) {
    if (importsBinding(script, tag)) continue;
    const cand: string | null = resolveChildModule(tag, dir);
    if (cand === null) {
      throw new Error(
        `weave: ${filename} composes <${tag}> but no import for it was found. ` +
          `Import it in the component's script, or place its module at ${childImportCandidates(tag)
            .map((c) => `${c}.ts`)
            .join(' / ')} (relative to the component).`
      );
    }
    imports.push(`import ${tag} from ${JSON.stringify(cand + '.js')};`);
  }
  return imports.length ? imports.join('\n') + '\n' + code : code;
}

export function weave(state: WeaveState, options: WeaveOptions = {}): Plugin {
  const styleLang: StyleLang = options.styleLang ?? 'css';
  const dev: boolean = options.dev ?? false;

  /** Emit a compiled component: collect its CSS (build) or inject it (dev). */
  const emit = (code: string, css: string, resolveDir: string): OnLoadResult => {
    if (dev) return { contents: code + cssInjector(css), loader: 'ts' as const, resolveDir };
    if (css) state.css.push(css);
    return { contents: code, loader: 'ts' as const, resolveDir };
  };

  return {
    name: 'weave',
    setup(build: PluginBuild): void {
      build.onStart(() => {
        state.css.length = 0; // fresh collection each (re)build
      });

      build.onLoad({ filter: /\.weave$/ }, async (args: OnLoadArgs) => {
        const source: string = await readFile(args.path, 'utf8');
        const src: ComponentSource = parseSfc(source);
        const styles: string | undefined = src.styles
          ? await compileStyleSource(src.styles, styleLang, dirname(args.path))
          : undefined;
        const { code, css, components } = compileComponent({ ...src, styles }, { filename: args.path });
        const wired: string = injectChildImports(code, components, dirname(args.path), src.script, args.path);
        return emit(wired, css, dirname(args.path));
      });

      build.onLoad({ filter: /\.ts$/ }, async (args: OnLoadArgs) => {
        if (args.path.includes('node_modules')) return undefined;
        // Generated modules (`*.gen.ts`) are never components — and one like a docs
        // `content.gen.ts` (markdown bundled as strings) can contain the literal text
        // `export const template`/`styles` inside an example, which would otherwise be
        // mis-detected as a string-SFC component and compiled. Treat as an ordinary module.
        if (args.path.endsWith('.gen.ts')) return undefined;
        const source: string = await readFile(args.path, 'utf8');
        const decl: ExtractedSources = extractSources(source);

        const siblingHtml: string = args.path.replace(/\.ts$/, '.html');
        const hasSiblingHtml: boolean = existsSync(siblingHtml);
        // A `.ts` is a component iff it declares a template OR has a sibling `.html`.
        if (decl.template === undefined && !hasSiblingHtml) return undefined; // ordinary module

        const dir: string = dirname(args.path);
        const template: { text: string; files: string[] } = await resolveTemplate(
          decl,
          args.path,
          siblingHtml,
          hasSiblingHtml
        );
        const styles: { css: string | undefined; files: string[] } = await resolveStyles(
          decl,
          args.path,
          dir,
          styleLang
        );

        const { code, css, components } = compileComponent(
          { script: decl.script, template: template.text, styles: styles.css },
          { filename: args.path }
        );
        const wired: string = injectChildImports(code, components, dir, decl.script, args.path);
        // Tell esbuild this module also depends on its template + style files, so a
        // template-only or style-only edit (which leaves the .ts untouched) still
        // triggers a watch-mode rebuild + live-reload.
        return { ...emit(wired, css, dir), watchFiles: [...template.files, ...styles.files] };
      });
    },
  };
}
