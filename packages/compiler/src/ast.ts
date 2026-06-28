/** Weave template AST. */

export type TemplateNode =
  | ElementNode
  | TextNode
  | InterpNode
  | IfNode
  | ForNode
  | SwitchNode
  | LetNode;

/** `@if (cond) {…} @else if (cond2) {…} @else {…}`; optional `@if (expr; as alias)`. */
export interface IfNode {
  type: 'if';
  branches: IfBranch[];
}
export interface IfBranch {
  /** undefined ⇒ the `@else` branch */
  cond?: string;
  /** alias from `@if (expr; as alias)` (only on the leading branch) */
  alias?: string;
  children: TemplateNode[];
}

/** `@for (item of list; track key) {…} @empty {…}` */
export interface ForNode {
  type: 'for';
  item: string;
  list: string;
  track?: string;
  children: TemplateNode[];
  empty?: TemplateNode[];
}

/** `@switch (expr) { @case (test) {…} @default {…} }` */
export interface SwitchNode {
  type: 'switch';
  expr: string;
  cases: SwitchCase[];
}
export interface SwitchCase {
  /** undefined ⇒ `@default` */
  test?: string;
  children: TemplateNode[];
}

/** `@let name = expr;` */
export interface LetNode {
  type: 'let';
  name: string;
  expr: string;
}

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
}
/** .prop={expr} */
export interface PropAttr {
  type: 'prop';
  name: string;
  expr: string;
}
/** on:event|mod1|mod2={expr} */
export interface EventAttr {
  type: 'event';
  name: string;
  modifiers: string[];
  expr: string;
}
/** class:name={expr} */
export interface ClassAttr {
  type: 'class';
  name: string;
  expr: string;
}
/** bind:name={expr} (two-way) */
export interface BindAttr {
  type: 'bind';
  name: string;
  expr: string;
}
/** ref={expr} or bind:this={expr} */
export interface RefAttr {
  type: 'ref';
  expr: string;
}
