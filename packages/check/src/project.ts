/**
 * Discovery + one-shot project check. Walks a directory for both authoring forms —
 * `.weave` SFCs and `.ts` components — builds a virtual module for each, and
 * type-checks them all in a single program. A `.ts` component's template/styles are
 * resolved the same way the build plugin resolves them (see `extractSources`): a
 * declared inline/file `template`, else the sibling `name.html`.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import {
  extractSources,
  classifyTemplate,
  faithfulTemplate,
  parseSfc,
  parseSfcLoc,
  extensionBase,
  defaultImportSpec,
  hasPatchDeclaration,
  readPatchOps,
  ParseError,
  type ExtractedSources,
  type ComponentSource,
  type PatchOp,
  type LintFinding,
} from '@weave-framework/compiler';
import { templateFindings } from './template-lint.js';
import { buildVirtualSfc, buildVirtualSeparate, buildVirtualPatch, type Virtual } from './emit.js';
// A component tag with no import resolves by convention — the same rule the build loader applies, so
// the checker agrees with what actually compiles.
import { resolveChildModule } from './children-fs.js';
import { runCheck, offsetToLineCol, type Diagnostic } from './check.js';

const SKIP: Set<string> = new Set(['node_modules', 'dist', '.git', '.weave']);

/** Build virtuals for every component found under `roots`, then check them together. A template
 *  that fails to PARSE (e.g. a malformed attribute) becomes a normal `file:line:col` diagnostic
 *  rather than a thrown stack trace, so one bad template no longer aborts the whole check. */
export function checkProject(roots: string[]): Diagnostic[] {
  const virtuals: Virtual[] = [];
  const parseDiags: Diagnostic[] = [];
  const patchers: Patcher[] = [];
  // Every `.ts` under the roots that is NOT a component: services, stores, helpers, generated route
  // modules. They are checked in the same program as the components — a project whose only quality
  // script is `weave check` would otherwise have its whole non-component half unchecked.
  const plain: string[] = [];
  for (const root of roots) collect(root, virtuals, parseDiags, patchers, plain);
  // Patch extensions come LAST: each needs to know whether its base is among the checked files, because
  // that is what decides whether its context can be typed off the base or has to degrade.
  for (const p of patchers) buildPatcher(p, virtuals, parseDiags);
  const checked: Diagnostic[] = virtuals.length || plain.length ? runCheck(virtuals, plain, dependencyVirtual) : [];
  return [...parseDiags, ...checked];
}

/**
 * Build a virtual for a component that is NOT under the checked roots — one imported from a shared
 * package, a sibling library, or simply a directory the command was not pointed at.
 *
 * Without this, every such import is an error: a component's default export is SYNTHESIZED by the
 * compiler, so the raw `.ts` on disk really does not have one, and TypeScript is right to say so. The
 * effect was a wall of `has no default export` on a correct project — 396 of them on this repo's own
 * docs site — which is the fastest way to make someone stop running the checker.
 *
 * Nothing is reported FROM these files: they are dependencies, not checked files. What they contribute
 * is the export and the prop types, so a child component's props are still type-checked across a
 * package boundary. Anything that fails to build is simply not a component, and the on-disk file is
 * used as it always was.
 */
function dependencyVirtual(tsPath: string): Virtual | undefined {
  const out: Virtual[] = [];
  try {
    if (!collectTs(tsPath, out, [], [])) return undefined;
  } catch {
    return undefined; // an unreadable or unparsable dependency is not this command's business
  }
  return out[0];
}

/** A `#3` extension found during the walk, held until every other virtual exists. */
interface Patcher {
  tsPath: string;
  source: string;
  script: string;
  /** The identifier `export const extend =` names, and the specifier its default import came from. */
  spec: string;
}

/** Turn a compiler {@link ParseError} into a source-located diagnostic. `source` is the exact text
 *  the parser saw, whose offsets map 1:1 to `file` (the sibling `.html`, or the offset-faithful
 *  `.weave`/inline-template region). */
function parseDiagnostic(file: string, source: string, e: ParseError): Diagnostic {
  const { line, col }: { line: number; col: number } = offsetToLineCol(source, e.offset ?? 0);
  return { file, line, col, code: 0, message: e.message, category: 'error' };
}

/** Run a virtual builder; a `ParseError` becomes a diagnostic (any other error still throws). */
/**
 * The template lint as `weave check` diagnostics.
 *
 * These used to exist only during a build: `weave check` type-checked the template and said nothing
 * about markup that compiles clean and fails silently, so the checker and the build disagreed about
 * whether the same file was fine. They are WARNINGS — `weave check` exits non-zero on errors only, so
 * a pipeline that was green stays green — and each carries a `fix` when the rule knows the one answer.
 *
 * `template` is offset-faithful to `file` in every case: a sibling `.html` is the file, an inline
 * template is blanked into its `.ts` at the real offsets, and a `.weave` gets its script/style regions
 * blanked in place. Linting a raw `.weave` instead would read its `<script>` body as markup.
 */
function templateWarnings(file: string, template: string): Diagnostic[] {
  return templateFindings(template).map((f: LintFinding): Diagnostic => {
    const at: { line: number; col: number } =
      f.offset === undefined ? { line: 1, col: 1 } : offsetToLineCol(template, f.offset);
    return {
      file,
      line: at.line,
      col: at.col,
      code: 0,
      message: f.message,
      category: 'warning',
      ...(f.fix ? { fix: f.fix } : {}),
    };
  });
}

function tryBuild(
  build: () => Virtual,
  file: string,
  source: string,
  out: Virtual[],
  diags: Diagnostic[],
  template: string = source
): void {
  try {
    out.push(absolutize(build()));
  } catch (e) {
    if (e instanceof ParseError) {
      diags.push(parseDiagnostic(file, source, e));
      return;
    }
    throw e;
  }
  diags.push(...templateWarnings(file, template));
}

function collect(path: string, out: Virtual[], diags: Diagnostic[], patchers: Patcher[], plain: string[]): void {
  if (!existsSync(path)) return;
  const st: ReturnType<typeof statSync> = statSync(path);
  if (st.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (SKIP.has(entry)) continue;
      collect(join(path, entry), out, diags, patchers, plain);
    }
    return;
  }
  if (path.endsWith('.weave')) {
    // A `.weave` template parses `parseSfcLoc(source).template`, which blanks the script/style
    // regions in place — so offsets map 1:1 back to the raw `.weave` source.
    const source: string = readFileSync(path, 'utf8');
    tryBuild(() => buildVirtualSfc(path, source, resolveChildModule), path, source, out, diags, parseSfcLoc(source).template);
  } else if (path.endsWith('.d.ts')) {
    // A declaration file is never a component — no template, no setup — but it MUST be a root of the
    // program. An ambient `declare module 'untyped-package'` or `declare global` only takes effect when
    // its file is in the program, which is exactly what `tsconfig`'s `include` does for `tsc`.
    //
    // It was skipped outright, so the checker reported TS7016 on an untyped import and printed
    // TypeScript's own advice — "add a new declaration (.d.ts) file" — at an author who had already
    // added one. `tsc --noEmit` went green on the identical tree.
    plain.push(resolve(path));
  } else if (path.endsWith('.ts')) {
    if (!collectTs(path, out, diags, patchers)) plain.push(resolve(path));
  }
}

/**
 * Make a virtual's module path absolute so cross-component imports resolve to it.
 * TypeScript resolves a relative import specifier to an ABSOLUTE path; the host's
 * lookup table is keyed on `v.path`, so an unresolved relative key would miss and
 * fall through to the on-disk source (which lacks the synthesized default export).
 * Display paths (`scriptFile`/`templateFile`) stay as-passed, so diagnostics keep
 * their tidy relative form.
 */
function absolutize(v: Virtual): Virtual {
  v.path = resolve(v.path);
  return v;
}

/** Resolve a `.ts` component's template into a virtual; a parse failure is recorded as a diagnostic
 *  against the offending template file. Returns false when the file is an ordinary module, so the
 *  caller can hand it to the checker as a plain source file instead. */
function collectTs(tsPath: string, out: Virtual[], diags: Diagnostic[], patchers: Patcher[]): boolean {
  const source: string = readFileSync(tsPath, 'utf8');
  const decl: ExtractedSources = extractSources(source);
  const siblingHtml: string = tsPath.replace(/\.ts$/, '.html');
  const script: string = decl.script ?? source;

  if (decl.template !== undefined) {
    if (classifyTemplate(decl.template) === 'inline') {
      // Offset-faithful: template at its real `.ts` offsets, everything else blanked,
      // so diagnostics map back to the `.ts` line:col.
      const faithful: string = decl.templateRange
        ? faithfulTemplate(source, decl.templateRange)
        : decl.template;
      tryBuild(() => buildVirtualSeparate(tsPath, decl.script, tsPath, faithful, resolveChildModule), tsPath, faithful, out, diags);
      return true;
    }
    const file: string = resolve(dirname(tsPath), decl.template);
    if (!existsSync(file)) return true; // build reports the missing file; check just skips
    const html: string = readFileSync(file, 'utf8');
    tryBuild(() => buildVirtualSeparate(tsPath, decl.script, file, html, resolveChildModule), file, html, out, diags);
    return true;
  }

  if (existsSync(siblingHtml)) {
    const html: string = readFileSync(siblingHtml, 'utf8');
    tryBuild(() => buildVirtualSeparate(tsPath, decl.script, siblingHtml, html, resolveChildModule), siblingHtml, html, out, diags);
    return true;
  }

  // RFC 0008 `#3` — an extension with no template of its own, patching its base's. It looked like an
  // ordinary module here, which is why the markup inside `patch` was the one template Weave never checked.
  const baseIdent: string | null = extensionBase(script);
  if (baseIdent && hasPatchDeclaration(script)) {
    const spec: string | null = defaultImportSpec(script, baseIdent);
    // A base from a published package ships no raw template, so there is nothing to patch against and
    // nothing to check — the build says the same thing, and this is not the place to repeat it.
    if (spec?.startsWith('.')) patchers.push({ tsPath, source, script, spec });
    return true;
  }
  return false; // ordinary module → checked as a plain source file
}

/** A base component's template text, and the file its virtual lives at (for the context-type import). */
interface ResolvedBase {
  template: string;
  virtualPath: string;
}

/** Read a LOCAL base component's raw template — the same resolution order the build loader uses. */
function resolveBase(spec: string, fromDir: string): ResolvedBase | null {
  const base: string = resolve(fromDir, spec);
  const weavePath: string = base + '.weave';
  if (existsSync(weavePath)) {
    const src: ComponentSource = parseSfc(readFileSync(weavePath, 'utf8'));
    // A `.weave` virtual lives at `<file>.weave.ts` — see `buildVirtualSfc`.
    return { template: src.template, virtualPath: weavePath + '.ts' };
  }
  const tsPath: string = base + '.ts';
  if (!existsSync(tsPath)) return null;
  const decl: ExtractedSources = extractSources(readFileSync(tsPath, 'utf8'));
  if (decl.template !== undefined && classifyTemplate(decl.template) === 'inline') {
    return { template: decl.template, virtualPath: tsPath };
  }
  const htmlPath: string = base + '.html';
  if (existsSync(htmlPath)) return { template: readFileSync(htmlPath, 'utf8'), virtualPath: tsPath };
  if (decl.template !== undefined) {
    const tf: string = resolve(dirname(tsPath), decl.template);
    if (existsSync(tf)) return { template: readFileSync(tf, 'utf8'), virtualPath: tsPath };
  }
  return null;
}

/** The specifier that reaches `to` from the file at `fromFile`, extension dropped (`./list`, `../ui/list.weave`). */
function specifierTo(fromFile: string, to: string): string {
  const rel: string = relative(dirname(fromFile), to).replace(/\\/g, '/').replace(/\.ts$/, '');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

/** Build the virtual for one `#3` extension, now that every other component's virtual exists. */
function buildPatcher(p: Patcher, out: Virtual[], diags: Diagnostic[]): void {
  const base: ResolvedBase | null = resolveBase(p.spec, dirname(p.tsPath));
  if (!base) return; // the build reports an unresolvable base; check does not duplicate it
  let ops: PatchOp[];
  try {
    ops = readPatchOps(p.script, p.tsPath);
  } catch {
    return; // not a static array literal — the build says so, in one place
  }
  // Only if the base was actually checked can its context be named; otherwise the base half of the
  // context degrades, which checks less and never invents an error about a binding that does exist.
  const known: boolean = out.some((v: Virtual) => resolve(v.path) === resolve(base.virtualPath));
  const spec: string | undefined = known ? specifierTo(p.tsPath, base.virtualPath) : undefined;
  try {
    out.push(absolutize(buildVirtualPatch(p.tsPath, p.source, p.script, base.template, ops, { spec }, resolveChildModule)));
  } catch (e) {
    if (e instanceof ParseError) {
      diags.push(parseDiagnostic(p.tsPath, p.source, e));
      return;
    }
    // A selector that matches nothing throws by design — a real defect, reported where it was written.
    diags.push({ file: p.tsPath, line: 1, col: 1, code: 0, message: (e as Error).message, category: 'error' });
  }
}
