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
import { compileComponent, parseSfc, extractSources, classifyTemplate, classifyStyle, childImportCandidates, hashCss, ParseError } from '@weave-framework/compiler';
import type { ComponentSource, ExtractedSources, PatchOp, CompiledComponent } from '@weave-framework/compiler';
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
 * Turn a compiler {@link ParseError} into an esbuild error framed at the offending template's
 * `file:line:col` (with the source line), instead of letting it bubble up as a raw JS stack trace
 * pointing at esbuild internals. `source` is the exact text the parser saw; its offsets map to
 * `file`. For a `.weave` SFC the template is the block body, so the reported line is relative to
 * that block — good enough to jump to the bad markup.
 */
function parseErrorResult(e: ParseError, file: string, source: string): OnLoadResult {
  const offset: number = Math.min(e.offset ?? 0, source.length);
  let line: number = 1;
  let column: number = 0;
  let lineStart: number = 0;
  for (let i: number = 0; i < offset; i++) {
    if (source[i] === '\n') {
      line++;
      column = 0;
      lineStart = i + 1;
    } else {
      column++;
    }
  }
  const nl: number = source.indexOf('\n', lineStart);
  const lineText: string = source.slice(lineStart, nl === -1 ? source.length : nl);
  return { errors: [{ text: e.message, location: { file, line, column, length: 1, lineText } }] };
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

/* ───────────────── RFC 0008 `#3` — component-file extension via base-template patches ───────────────── */

/** The base identifier of a `#3` extension: `export const extend = List` → `"List"` (else null). */
function extensionBase(script: string): string | null {
  const m: RegExpMatchArray | null = stripComments(script).match(/export\s+const\s+extend\s*=\s*([A-Za-z_$][\w$]*)/);
  return m ? m[1] : null;
}

/** The module specifier a default import binds `name` to: `import List from './list'` → `"./list"`. */
function defaultImportSpec(script: string, name: string): string | null {
  const code: string = stripComments(script);
  const re: RegExp = new RegExp(`import\\s+${name}\\b[^;]*?\\bfrom\\s+['"]([^'"]+)['"]`);
  const m: RegExpMatchArray | null = code.match(re);
  return m ? m[1] : null;
}

/** Extract the balanced `[ … ]` after `export const patch =`, respecting string literals. */
function patchArrayExpr(script: string): string | null {
  const code: string = stripComments(script);
  const decl: RegExpMatchArray | null = code.match(/export\s+const\s+patch\s*=/);
  if (!decl || decl.index === undefined) return null;
  const start: number = code.indexOf('[', decl.index);
  if (start === -1) return null;
  let depth: number = 0;
  let quote: string = '';
  for (let i: number = start; i < code.length; i++) {
    const c: string = code[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return code.slice(start, i + 1);
  }
  return null;
}

/** Evaluate the (static, literal) patch array in isolation — it references no imports. */
function readPatchOps(script: string, filename: string): PatchOp[] {
  const expr: string | null = patchArrayExpr(script);
  if (!expr) throw new Error(`weave: ${filename} — could not read \`export const patch = [ … ]\` (must be a static array literal).`);
  try {
    const ops: unknown = new Function(`return (${expr});`)();
    if (!Array.isArray(ops)) throw new Error('not an array');
    return ops as PatchOp[];
  } catch (e) {
    throw new Error(
      `weave: ${filename} — \`export const patch\` must be a STATIC array literal (plain objects/strings, no identifiers or imports): ${(e as Error).message}`
    );
  }
}

/** A resolved base component's template + where it lives (for hash + child-import resolution). */
interface BaseTemplate {
  template: string;
  dir: string;
  filename: string;
  file: string;
}

/** Read a LOCAL base component's raw template (for a `#3` patch to apply to). Null if not resolvable. */
async function readBaseTemplate(spec: string, fromDir: string): Promise<BaseTemplate | null> {
  if (!spec.startsWith('.')) return null; // published packages ship no raw template — local only
  const base: string = resolve(fromDir, spec);
  const weavePath: string = base + '.weave';
  if (existsSync(weavePath)) {
    const src: ComponentSource = parseSfc(await readFile(weavePath, 'utf8'));
    return { template: src.template, dir: dirname(weavePath), filename: weavePath, file: weavePath };
  }
  const tsPath: string = base + '.ts';
  if (existsSync(tsPath)) {
    const decl: ExtractedSources = extractSources(await readFile(tsPath, 'utf8'));
    if (decl.template !== undefined && classifyTemplate(decl.template) === 'inline') {
      return { template: decl.template, dir: dirname(tsPath), filename: tsPath, file: tsPath };
    }
    const htmlPath: string = base + '.html';
    if (existsSync(htmlPath)) {
      return { template: await readFile(htmlPath, 'utf8'), dir: dirname(tsPath), filename: tsPath, file: htmlPath };
    }
    if (decl.template !== undefined) {
      const tf: string = resolve(dirname(tsPath), decl.template);
      if (existsSync(tf)) return { template: await readFile(tf, 'utf8'), dir: dirname(tsPath), filename: tsPath, file: tf };
    }
  }
  return null;
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
        try {
          const { code, css, components } = compileComponent({ ...src, styles }, { filename: args.path });
          const wired: string = injectChildImports(code, components, dirname(args.path), src.script, args.path);
          return emit(wired, css, dirname(args.path));
        } catch (e) {
          if (e instanceof ParseError) return parseErrorResult(e, args.path, src.template);
          throw e;
        }
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
        const dir: string = dirname(args.path);

        // RFC 0008 `#3` — a component-file extension that PATCHES its base's template rather than
        // writing its own (`export const extend = Base` + `export const patch = [ … ]`, no own
        // template/sibling .html). Resolve the base's raw template (local only), apply the patch ops,
        // and compile — reusing the BASE's hash so the base's scoped CSS still matches, and resolving
        // the base template's child tags relative to the BASE dir.
        const baseIdent: string | null = decl.template === undefined && !hasSiblingHtml ? extensionBase(decl.script ?? source) : null;
        if (baseIdent && /export\s+const\s+patch\s*=/.test(stripComments(decl.script ?? source))) {
          const spec: string | null = defaultImportSpec(decl.script ?? source, baseIdent);
          if (!spec) {
            throw new Error(`weave: ${args.path} — extends '${baseIdent}' but no matching \`import ${baseIdent} from '…'\` was found.`);
          }
          const base: BaseTemplate | null = await readBaseTemplate(spec, dir);
          if (!base) {
            throw new Error(
              `weave: ${args.path} — a \`#3\` (patch) extension needs a LOCAL base with a readable template; '${spec}' did not resolve. ` +
                `Published packages ship no raw template — use a local base, or \`#1\` (write your own \`template\`).`
            );
          }
          const patches: PatchOp[] = readPatchOps(decl.script ?? source, args.path);
          try {
            const compiled: CompiledComponent = compileComponent(
              { script: decl.script, template: base.template, patches },
              { filename: args.path, hash: hashCss(base.filename) }
            );
            // Base-template child tags resolve relative to the BASE dir; inserted tags the extension
            // itself imports are skipped by injectChildImports (explicit import wins).
            const wired: string = injectChildImports(compiled.code, compiled.components, base.dir, decl.script, args.path);
            return { ...emit(wired, compiled.css, dir), watchFiles: [base.file] };
          } catch (e) {
            if (e instanceof ParseError) return { ...parseErrorResult(e, base.file, base.template), watchFiles: [base.file] };
            throw e;
          }
        }

        // A `.ts` is a component iff it declares a template OR has a sibling `.html`.
        if (decl.template === undefined && !hasSiblingHtml) return undefined; // ordinary module

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

        try {
          const { code, css, components } = compileComponent(
            { script: decl.script, template: template.text, styles: styles.css },
            { filename: args.path }
          );
          const wired: string = injectChildImports(code, components, dir, decl.script, args.path);
          // Tell esbuild this module also depends on its template + style files, so a
          // template-only or style-only edit (which leaves the .ts untouched) still
          // triggers a watch-mode rebuild + live-reload.
          return { ...emit(wired, css, dir), watchFiles: [...template.files, ...styles.files] };
        } catch (e) {
          // A malformed template → a framed `file:line:col` esbuild error at the .html/template,
          // not a raw parser stack trace. Point at the template file (sibling/declared), else the .ts.
          if (e instanceof ParseError) {
            return { ...parseErrorResult(e, template.files[0] ?? args.path, template.text), watchFiles: template.files };
          }
          throw e;
        }
      });
    },
  };
}
