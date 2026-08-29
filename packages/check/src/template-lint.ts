/**
 * The template lint, shared by `weave check` and the language server.
 *
 * Both must say the same thing about the same file. They used to have no way to: the lint ran only
 * inside a build, so the checker was silent and the editor knew nothing at all. Putting the two steps
 * — "find this file's template" and "lint it" — in one place is what keeps them from drifting apart.
 *
 * Every path here yields an OFFSET-FAITHFUL template: one whose offsets index the original file, so a
 * finding can be reported at the author's line without a second mapping. A `.weave` gets its script and
 * style regions blanked in place rather than removed (linting the raw file would read its `<script>`
 * body as markup); an inline template is blanked into its `.ts` at the real offsets; a sibling `.html`
 * simply is the template.
 */

import {
  parseTemplate,
  parseSfcLoc,
  extractSources,
  classifyTemplate,
  faithfulTemplate,
  lintTemplateFindings,
  type TemplateNode,
  type LintFinding,
  type ExtractedSources,
} from '@weave-framework/compiler';

/** Which of the three shapes a Weave component can take. */
export type WeaveFileKind = 'weave' | 'html' | 'ts';

/**
 * The offset-faithful template for a component source, or `null` when the file has none — a `.ts`
 * whose template is a sibling file (the caller lints that file directly), or one that is not a
 * component at all.
 */
export function templateOf(source: string, kind: WeaveFileKind): string | null {
  if (kind === 'html') return source;
  if (kind === 'weave') return parseSfcLoc(source).template;
  const decl: ExtractedSources = extractSources(source);
  if (decl.template === undefined || classifyTemplate(decl.template) !== 'inline') return null;
  return decl.templateRange ? faithfulTemplate(source, decl.templateRange) : decl.template;
}

/**
 * Lint findings for an offset-faithful template. Offsets index `template` as given, so they index the
 * original file too. An unparseable template yields nothing: the parse error is reported on its own,
 * and there is no AST to walk.
 */
export function templateFindings(template: string): LintFinding[] {
  let nodes: TemplateNode[];
  try {
    nodes = parseTemplate(template);
  } catch {
    return [];
  }
  return lintTemplateFindings(nodes);
}
