/** Weave template AST. */

export type TemplateNode =
  | ElementNode
  | TextNode
  | InterpNode
  | IfNode
  | ForNode
  | SwitchNode
  | LetNode
  | DeferNode
  | AwaitNode
  | SnippetNode
  | RenderNode;

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

/**
 * `@await (src) { pending } @then (val) { … } @catch (err) { … }` — render based on
 * the settle state of a Promise OR a `@weave/data` resource. All three parts are
 * optional; `@then`/`@catch` may bind an alias to the resolved value / error.
 */
export interface AwaitNode {
  type: 'await';
  /** the awaited source — a Promise or a resource */
  expr: string;
  exprOffset?: Offset;
  /** content shown while pending (the block right after `@await (src) { … }`) */
  pending?: TemplateNode[];
  /** `@then (alias?) { … }` — fulfilled */
  then?: AwaitBranch;
  /** `@catch (alias?) { … }` — rejected */
  catch?: AwaitBranch;
}
export interface AwaitBranch {
  /** optional alias bound to the resolved value (`@then`) or error (`@catch`) */
  alias?: string;
  children: TemplateNode[];
}

/**
 * `@snippet name(p1, p2) { … }` — a reusable, parameterized template fragment.
 * Compiles to a function `(p1, p2) => Node`; `name` is a template-local value, so
 * it can be `@render (name(args))`-ed locally or passed to a child as a prop.
 */
export interface SnippetNode {
  type: 'snippet';
  name: string;
  /** parameter names (bare locals inside the body) */
  params: string[];
  children: TemplateNode[];
}

/** `@render (expr)` — render a snippet (or any expression resolving to a Node). */
export interface RenderNode {
  type: 'render';
  expr: string;
  exprOffset?: Offset;
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
  offset?: Offset;
}

export type Attr =
  | StaticAttr
  | ExprAttr
  | PropAttr
  | EventAttr
  | ClassAttr
  | BindAttr
  | RefAttr
  | UseAttr;

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
/**
 * `use:action` or `use:action={arg}` — an attribute directive. `name` is the
 * action identifier (resolved against ctx, e.g. `tooltip` → `ctx.tooltip`);
 * `expr` is the optional argument. The action runs after the element is inserted
 * (onMount timing) and may return a cleanup fn or use `onCleanup`/`effect`.
 */
export interface UseAttr {
  type: 'use';
  name: string;
  /** offset of the action identifier `name` (for `weave check`) */
  nameOffset?: Offset;
  /** optional argument expression */
  expr?: string;
  /** offset of the argument `expr` */
  offset?: Offset;
}
