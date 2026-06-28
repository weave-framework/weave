/** Weave template AST. */

export type TemplateNode =
  | ElementNode
  | TextNode
  | InterpNode
  | IfNode
  | ForNode
  | SwitchNode
  | LetNode
  | DeferNode;

/**
 * Source offset of an expression's first character within the template string
 * passed to {@link parseTemplate}. Populated by the parser for every template
 * expression; consumed by `@weave/check` to map type errors back to the
 * original `.weave`/`.html` line:col. Optional so codegen and existing callers
 * (which only read the expression text) are unaffected.
 */
export type Offset = number | undefined;

/** `@if (cond) {…} @else if (cond2) {…} @else {…}`; optional `@if (expr; as alias)`. */
export interface IfNode {
  type: 'if';
  branches: IfBranch[];
}
export interface IfBranch {
  /** undefined ⇒ the `@else` branch */
  cond?: string;
  /** offset of `cond` */
  condOffset?: Offset;
  /** alias from `@if (expr; as alias)` (only on the leading branch) */
  alias?: string;
  children: TemplateNode[];
}

/** `@for (item of list; track key) {…} @empty {…}` */
export interface ForNode {
  type: 'for';
  item: string;
  list: string;
  listOffset?: Offset;
  track?: string;
  trackOffset?: Offset;
  children: TemplateNode[];
  empty?: TemplateNode[];
}

/** `@switch (expr) { @case (test) {…} @default {…} }` */
export interface SwitchNode {
  type: 'switch';
  expr: string;
  exprOffset?: Offset;
  cases: SwitchCase[];
}
export interface SwitchCase {
  /** undefined ⇒ `@default` */
  test?: string;
  testOffset?: Offset;
  children: TemplateNode[];
}

/** `@let name = expr;` */
export interface LetNode {
  type: 'let';
  name: string;
  expr: string;
  exprOffset?: Offset;
}

/**
 * `@defer (trigger) {…} @placeholder {…}` — gate the content's *rendering* until a
 * trigger fires, showing the optional `@placeholder` until then. Code-splitting is
 * opt-in via a `lazy()` component inside the content.
 */
export interface DeferNode {
  type: 'defer';
  trigger: DeferTrigger;
  children: TemplateNode[];
  placeholder?: TemplateNode[];
}

/** A `@defer` trigger. `when` is reactive; the rest are one-shot DOM/timing events. */
export type DeferTrigger =
  | { kind: 'when'; expr: string; exprOffset?: Offset }
  | { kind: 'idle' }
  | { kind: 'viewport' }
  | { kind: 'timer'; ms: string; msOffset?: Offset }
  | { kind: 'interaction' }
  | { kind: 'hover' }
  | { kind: 'immediate' };

export interface ElementNode {
  type: 'element';
  tag: string;
  attrs: Attr[];
  children: TemplateNode[];
  /** true for void elements (input, br, …) — no children, no closing tag */
  selfClosing: boolean;
}

export interface TextNode {
  type: 'text';
  value: string;
}

/** `{{ expr }}` */
export interface InterpNode {
  type: 'interp';
  expr: string;
  offset?: Offset;
}

export type Attr =
  | StaticAttr
  | ExprAttr
  | PropAttr
  | EventAttr
  | ClassAttr
  | BindAttr
  | RefAttr;

/** name="value" or bare name */
export interface StaticAttr {
  type: 'static';
  name: string;
  value: string;
}
/** name={expr} */
export interface ExprAttr {
  type: 'attr';
  name: string;
  expr: string;
  offset?: Offset;
}
/** .prop={expr} */
export interface PropAttr {
  type: 'prop';
  name: string;
  expr: string;
  offset?: Offset;
}
/** on:event|mod1|mod2={expr} */
export interface EventAttr {
  type: 'event';
  name: string;
  modifiers: string[];
  expr: string;
  offset?: Offset;
}
/** class:name={expr} */
export interface ClassAttr {
  type: 'class';
  name: string;
  expr: string;
  offset?: Offset;
}
/** bind:name={expr} (two-way) */
export interface BindAttr {
  type: 'bind';
  name: string;
  expr: string;
  offset?: Offset;
}
/** ref={expr} or bind:this={expr} */
export interface RefAttr {
  type: 'ref';
  expr: string;
  offset?: Offset;
}
