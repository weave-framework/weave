/**
 * The wrapped root AST the `weave` parser hands to the `weave-ast` printer. Template nodes are
 * the compiler's own {@link TemplateNode}s (reused verbatim, so the formatter never drifts from
 * what compiles); this root only adds the SFC block framing and the raw source length Prettier
 * needs for its bookkeeping.
 */
import type { TemplateNode } from '@weave-framework/compiler';

/** A `<script>` / `<style>` / template block of a `.weave` SFC, in source order. */
export interface SfcBlock {
  kind: 'script' | 'style' | 'template';
  /** source offset where the block begins — used only to preserve original block order */
  at: number;
  /** raw opening tag (`<script ...>` / `<style lang="scss">`) reprinted verbatim to keep its attrs */
  open?: string;
  /** already-formatted inner body (script → typescript, style → css/scss) */
  content?: string;
}

export interface WeaveRoot {
  type: 'weave-root';
  variant: 'sfc' | 'template';
  /** the template body (for a template file, the whole thing; for an SFC, its template region) */
  nodes: TemplateNode[];
  /** SFC only: script/style/template blocks in source order */
  blocks?: SfcBlock[];
  /** the original source text (its length backs the parser's locEnd) */
  raw: string;
}
