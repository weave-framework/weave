/**
 * The Weave esbuild plugin — the canonical loader (the inlined copy in
 * `tools/verify-build.mjs` mirrors this). Compiles two authoring forms into one
 * ES module each:
 *
 *  - `.weave` SFC (split by `parseSfc`)
 *  - separate files: a `.ts` with a co-located `<base>.<styleLang>`
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
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  compileComponent,
  parseSfc,
  extractSources,
  classifyTemplate,
  classifyStyle,
  childImportCandidates,
  importsBinding,
  hashCss,
  ParseError,
  extensionBase,
  defaultImportSpec,
  hasPatchDeclaration,
  readPatchOps,
} from '@weave-framework/compiler';
// The build and `weave check` must resolve a child tag to the SAME module — one implementation,
// owned by the checker (the CLI already depends on it), rather than a private copy on each side.
import { resolveChildModule } from '@weave-framework/check';
import type { ComponentSource, ExtractedSources, PatchOp, CompiledComponent, LintFinding } from '@weave-framework/compiler';
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
  /**
   * Phase E resumable build (E1.4). Compile every component in the `resumable` target (marker-isolated text,
   * `data-won-*` events, an `adopt` variant + `$wid` state registration) so the SSG server render carries the
   * resume markers and the client can adopt in place. Default false → the eager module is byte-for-byte.
   */
  resumable?: boolean;
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
/** An offset in `source` as the 1-based line / 0-based column + that line's text esbuild frames with. */
function frame(source: string, at: number): { line: number; column: number; lineText: string } {
  const offset: number = Math.min(Math.max(at, 0), source.length);
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
  return { line, column, lineText: source.slice(lineStart, nl === -1 ? source.length : nl) };
}

function parseErrorResult(e: ParseError, file: string, source: string): OnLoadResult {
  return { errors: [{ text: e.message, location: { file, length: 1, ...frame(source, e.offset ?? 0) } }] };
}

/**
 * A component's findings as esbuild warnings.
 *
 * A template mistake belongs at the line it is on, in the FILE it is in — which is the `.html`, not the
 * `.ts` the loader happens to be compiling. Before this, every one of them was reported against the
 * component module with no position at all, so `on:clik` in a 200-line template said only "this
 * component". A finding the AST could not place — a coalesced text run, or a resume diagnostic that is
 * about the component rather than a span of markup — keeps the file-only form instead of being handed
 * an invented position.
 */
function findingWarnings(
  findings: LintFinding[] | undefined,
  templateSource: string,
  templateFile: string,
  componentFile: string
): NonNullable<OnLoadResult['warnings']> {
  return (findings ?? []).map((f: LintFinding) =>
    f.offset === undefined
      ? { text: f.message, location: { file: componentFile } }
      : { text: f.message, location: { file: templateFile, length: 1, ...frame(templateSource, f.offset) } }
  );
}

/**
 * Every other failure a compile step can raise, as a DIAGNOSTIC rather than a thrown exception.
 *
 * An exception escaping an `onLoad` callback takes esbuild's watch state with it: `weave dev` then
 * serves the last good bundle forever and silently ignores every later save, so a developer's first
 * typo of this class ends the dev loop until they restart the server. Only `ParseError` used to be
 * converted; the compiler has a dozen other `throw`s an ordinary typo reaches (an empty template, a
 * component tag that resolves to nothing, a non-static `template` declaration, a missing style file).
 *
 * Returning the error also puts the AUTHOR'S file in the message instead of a stack inside
 * node_modules. Gate: packages/cli/test/dev-compiler-error.smoke.mjs.
 */
function loadErrorResult(e: unknown, file: string, watchFiles: string[]): OnLoadResult {
  const text: string = e instanceof Error ? e.message : String(e);
  return { errors: [{ text, location: { file } }], watchFiles };
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
  const resumable: boolean = options.resumable ?? false;

  /**
   * Emit a compiled component: collect its CSS (build) or inject it (dev). A resumable build may also carry
   * non-fatal diagnostics (E1.5/E1.6 — a handler or computed that won't survive resume); surface them as real
   * esbuild warnings framed at the component file, so a silent runtime defect is visible at build time.
   */
  const emit = (code: string, css: string, resolveDir: string, warnings?: string[], file?: string): OnLoadResult => {
    const warn: Pick<OnLoadResult, 'warnings'> = warnings?.length
      ? { warnings: warnings.map((text) => ({ text, location: file ? { file } : undefined })) }
      : {};
    if (dev) return { contents: code + cssInjector(css), loader: 'ts' as const, resolveDir, ...warn };
    if (css) state.css.push(css);
    return { contents: code, loader: 'ts' as const, resolveDir, ...warn };
  };

  return {
    name: 'weave',
    setup(build: PluginBuild): void {
      build.onStart(() => {
        state.css.length = 0; // fresh collection each (re)build
      });

      build.onLoad({ filter: /\.weave$/ }, async (args: OnLoadArgs) => {
        let template: string = '';
        try {
          const source: string = await readFile(args.path, 'utf8');
          const src: ComponentSource = parseSfc(source);
          template = src.template;
          const styles: string | undefined = src.styles
            ? await compileStyleSource(src.styles, styleLang, dirname(args.path))
            : undefined;
          const { code, css, components, warnings } = compileComponent({ ...src, styles }, { filename: args.path, resumable, ts });
          const wired: string = injectChildImports(code, components, dirname(args.path), src.script, args.path);
          return emit(wired, css, dirname(args.path), warnings, args.path);
        } catch (e) {
          if (e instanceof ParseError) return parseErrorResult(e, args.path, template);
          return loadErrorResult(e, args.path, []);
        }
      });

      build.onLoad({ filter: /\.ts$/ }, async (args: OnLoadArgs) => {
        // Files this module depends on besides the `.ts` itself (its template, its stylesheets, a
        // patched base). They are reported even on FAILURE so the save that repairs the error still
        // triggers a rebuild — without them esbuild stops watching the file the author is editing.
        const watched: string[] = [];
        // The file a failure should be blamed on once it is known: the template, not the script.
        let templateFile: string | undefined;
        try {
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
          if (baseIdent && hasPatchDeclaration(decl.script ?? source)) {
            const spec: string | null = defaultImportSpec(decl.script ?? source, baseIdent);
            if (!spec) {
              throw new Error(`weave: ${args.path} — extends '${baseIdent}' but no matching \`import ${baseIdent} from '…'\` was found.`);
            }
            const base: BaseTemplate | null = await readBaseTemplate(spec, dir);
            if (base) {
              watched.push(base.file);
              templateFile = base.file;
            }
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
                { filename: args.path, hash: hashCss(base.filename), resumable, ts }
              );
              // Base-template child tags resolve relative to the BASE dir; inserted tags the extension
              // itself imports are skipped by injectChildImports (explicit import wins).
              const wired: string = injectChildImports(compiled.code, compiled.components, base.dir, decl.script, args.path);
              return { ...emit(wired, compiled.css, dir, compiled.warnings, args.path), watchFiles: [base.file] };
            } catch (e) {
              if (e instanceof ParseError) return { ...parseErrorResult(e, base.file, base.template), watchFiles: [base.file] };
              throw e;
            }
          }

          // A `.ts` is a component iff it declares a template OR has a sibling `.html`.
          if (decl.template === undefined && !hasSiblingHtml) return undefined; // ordinary module

          // Watch the sibling template from HERE, not only after a successful compile: an empty or
          // malformed template must still rebuild once the author fixes it.
          if (hasSiblingHtml) {
            watched.push(siblingHtml);
            templateFile = siblingHtml;
          }
          const template: { text: string; files: string[] } = await resolveTemplate(
            decl,
            args.path,
            siblingHtml,
            hasSiblingHtml
          );
          watched.push(...template.files);
          templateFile = template.files[0] ?? templateFile;
          const styles: { css: string | undefined; files: string[] } = await resolveStyles(
            decl,
            args.path,
            dir,
            styleLang
          );
          watched.push(...styles.files);

          try {
            const { code, css, components, findings } = compileComponent(
              { script: decl.script, template: template.text, styles: styles.css },
              { filename: args.path, resumable, ts }
            );
            const wired: string = injectChildImports(code, components, dir, decl.script, args.path);
            // Tell esbuild this module also depends on its template + style files, so a
            // template-only or style-only edit (which leaves the .ts untouched) still
            // triggers a watch-mode rebuild + live-reload.
            return {
              ...emit(wired, css, dir, undefined, args.path),
              warnings: findingWarnings(findings, template.text, templateFile ?? args.path, args.path),
              watchFiles: [...template.files, ...styles.files],
            };
          } catch (e) {
            // A malformed template → a framed `file:line:col` esbuild error at the .html/template,
            // not a raw parser stack trace. Point at the template file (sibling/declared), else the .ts.
            if (e instanceof ParseError) {
              return { ...parseErrorResult(e, template.files[0] ?? args.path, template.text), watchFiles: watched };
            }
            throw e;
          }
        } catch (e) {
          // Everything else the compile path can raise: an empty template, a component tag that
          // resolves to nothing, a non-static `template`/`styles` declaration, a style file that does
          // not exist. Reported as a diagnostic, so the dev server survives it and keeps watching.
          if (e instanceof ParseError) return { ...parseErrorResult(e, templateFile ?? args.path, ''), watchFiles: watched };
          return loadErrorResult(e, templateFile ?? args.path, watched);
        }
      });
    },
  };
}
