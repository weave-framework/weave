/**
 * `weave migrate` — the CONVERTER (RFC 0011, M4). It rewrites an Angular template into a Weave template, and an
 * `@Component` class into a Weave component pair (`foo.ts` with `setup()` + sibling `foo.html`).
 *
 * Where it sits: `migrate-analyze.ts` MEASURES → `migrate-plan.ts` PLANS → this module CONVERTS the mechanical
 * majority. It is pure (strings in, strings out), so every rule is testable without touching disk.
 *
 * The honesty rule is absolute here: anything without a faithful Weave equivalent is **not guessed**. It is left
 * in place and marked with a `<!-- TODO(weave migrate): … -->` comment (or a `// TODO(weave migrate):` line in
 * `.ts`), so a human sees exactly what still needs doing. A silent wrong rewrite is worse than an honest TODO.
 *
 * Zero third-party deps — an in-house scanner, no HTML parser pulled in (RULE #1).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { resolveImports, type WeaveSymbol } from './migrate-symbols.js';
import { asyncifyAwaiters, observableReturners, pruneRxImports, replaceTypeName, rewriteObservableTypes, rxAfterSubjects, rxToWeave, survivingRxNames, translateSubjects } from './migrate-rxjs.js';

// Re-exported so the symbol model has ONE entry point: `symbolTable` is built here, and what it says about
// collisions belongs beside it rather than a module away.
export { danglingAcrossSections, resolveImports, sections, symbolCollisions, type WeaveSymbol } from './migrate-symbols.js';
import {
  exportedNames,
  importedNamesFrom,
  sourceImports,
  type ClassMember,
  type ComponentFact,
  type DirectiveFact,
  type FormFact,
  type MigrationFacts,
  type NgModuleFact,
  type PipeFact,
  type ResolverFact,
  type TokenFact,
  type RouteFact,
  type ServiceFact,
} from './migrate-analyze.js';

/* ──────────── a minimal HTML scanner (in-house: Angular syntax is not valid HTML to most parsers) ──────────── */

/** One attribute as written: `*ngIf`, `[value]`, `(click)`, `class`, … with its raw (unquoted) value. */
export interface Attr {
  name: string;
  /** The value with its quotes stripped; null for a bare attribute (`disabled`). */
  value: string | null;
}

export type Node =
  | { kind: 'text'; text: string }
  | { kind: 'comment'; text: string }
  | ElementNode;

/** An element node — the only kind that carries a tag, attributes and children. */
export interface ElementNode {
  kind: 'element';
  tag: string;
  attrs: Attr[];
  children: Node[];
  /** Weave attribute text attached by `convertTemplate` when this is the template's single ROOT element: the
   *  component's host bindings land here, because Weave has no host element of its own. Already converted, so it
   *  bypasses `convertAttr` entirely. */
  hostAttrs?: string[];
}

/** Elements that never have children or a closing tag. */
const VOID_TAGS: Set<string> = new Set<string>(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/** Parse an attribute list from the inside of a tag (`a="1" [b]="c" (d)="e()" f`). */
function parseAttrs(raw: string): Attr[] {
  const attrs: Attr[] = [];
  // An Angular attribute name may contain [ ] ( ) * # . - : — so the class is deliberately wide.
  const re: RegExp = /([^\s=/>]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const value: string | null = m[2] === undefined ? null : (m[3] ?? m[4] ?? m[5] ?? '');
    attrs.push({ name: m[1], value });
  }
  return attrs;
}

/**
 * Parse an HTML/Angular template into a node tree. Deliberately forgiving: an unclosed or mismatched tag never
 * throws — the scanner recovers, because a migration must survive imperfect real-world markup.
 */
export function parseTemplate(html: string): Node[] {
  const root: Node[] = [];
  const stack: Array<{ tag: string; children: Node[] }> = [];
  const push = (n: Node): void => {
    (stack.length ? stack[stack.length - 1].children : root).push(n);
  };
  let i: number = 0;
  while (i < html.length) {
    const lt: number = html.indexOf('<', i);
    if (lt === -1) {
      if (i < html.length) push({ kind: 'text', text: html.slice(i) });
      break;
    }
    if (lt > i) push({ kind: 'text', text: html.slice(i, lt) });

    if (html.startsWith('<!--', lt)) {
      const end: number = html.indexOf('-->', lt);
      const stop: number = end === -1 ? html.length : end + 3;
      push({ kind: 'comment', text: html.slice(lt + 4, end === -1 ? html.length : end) });
      i = stop;
      continue;
    }
    const gt: number = html.indexOf('>', lt);
    if (gt === -1) {
      push({ kind: 'text', text: html.slice(lt) });
      break;
    }
    const inner: string = html.slice(lt + 1, gt);
    if (inner.startsWith('/')) {
      const tag: string = inner.slice(1).trim().toLowerCase();
      // Close the nearest matching open tag; ignore a stray close (recovery, never a throw).
      for (let s: number = stack.length - 1; s >= 0; s--) {
        if (stack[s].tag === tag) {
          stack.length = s;
          break;
        }
      }
      i = gt + 1;
      continue;
    }
    const selfClosing: boolean = inner.endsWith('/');
    const body: string = selfClosing ? inner.slice(0, -1) : inner;
    const sp: number = body.search(/\s/);
    const tag: string = (sp === -1 ? body : body.slice(0, sp)).trim();
    const attrs: Attr[] = sp === -1 ? [] : parseAttrs(body.slice(sp));
    const node: Node = { kind: 'element', tag, attrs, children: [] };
    push(node);
    if (!selfClosing && !VOID_TAGS.has(tag.toLowerCase())) stack.push({ tag: tag.toLowerCase(), children: node.children });
    i = gt + 1;
  }
  return root;
}

/* ──────────── the Angular → Weave attribute rules ──────────── */

/** A marker left for a human — never a silent guess. */
export function todo(what: string): string {
  return `<!-- TODO(weave migrate): ${what} -->`;
}

/* ──────────── expressions: Angular pipes have no Weave equivalent (Weave calls functions) ──────────── */

/** The result of converting one Angular expression: the Weave text, plus anything a human must still resolve. */
export interface ConvertedExpr {
  expr: string;
  todos: string[];
}

/** Split on `|` that is a PIPE, not the `||` operator (and not a `|` inside quotes). */
function splitPipes(expr: string): string[] {
  const parts: string[] = [];
  let depth: number = 0;
  let quote: string | null = null;
  let start: number = 0;
  for (let i: number = 0; i < expr.length; i++) {
    const ch: string = expr[i];
    if (quote) {
      if (ch === quote && expr[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === '|' && depth === 0) {
      if (expr[i + 1] === '|' || expr[i - 1] === '|') {
        i++; // the `||` operator — skip both characters
        continue;
      }
      parts.push(expr.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(expr.slice(start));
  return parts.map((p) => p.trim());
}

/**
 * Convert one Angular expression to Weave. Weave has **no pipes** — a pipe is a function call — so
 * `x | translate` becomes `t(x)` (the `@ngx-translate` → `@weave-framework/i18n` mapping we are confident about),
 * and every OTHER pipe is left in place with a TODO. That matters: leaving `{{ x | date }}` untouched would emit
 * a template that merely LOOKS converted while being invalid Weave.
 */
/**
 * Prefix a component's own prop names with `props.` in a template expression.
 *
 * Angular reads an `@Input` by its bare name; Weave reads it off the `props` object the setup receives. A name
 * left bare simply does not resolve, so the component renders nothing — this is what makes the difference
 * between a template that works and one that merely looks converted.
 *
 * Only whole-word identifiers are touched, and never one already preceded by a dot (`x.color` is a property of
 * `x`, not the prop) or sitting inside a string literal.
 */
export function qualifyProps(expr: string, props: string[]): string {
  if (!props.length) return expr;
  const names: string = props.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  // Split on string literals so their contents are never rewritten, then rewrite only the code between them.
  return expr
    .split(/('[^']*'|"[^"]*"|`[^`]*`)/g)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(new RegExp(`(^|[^.\\w$])(${names})\\b`, 'g'), '$1props.$2')))
    .join('');
}

export function convertExpr(expr: string): ConvertedExpr {
  const parts: string[] = splitPipes(expr);
  if (parts.length === 1) return { expr: expr.trim(), todos: [] };

  let out: string = parts[0];
  const todos: string[] = [];
  for (const raw of parts.slice(1)) {
    const [nameRaw, ...argParts]: string[] = raw.split(':');
    const name: string = nameRaw.trim();
    const args: string = argParts.join(':').trim();
    if (name === 'translate') {
      out = args ? `t(${out}, ${args})` : `t(${out})`;
      continue;
    }
    if (name === 'async') {
      todos.push(`\`| async\` on \`${out.trim()}\` — in Weave a signal is read with \`()\`, so the pipe disappears: \`${out.trim()}()\``);
      continue;
    }
    todos.push(`pipe \`| ${raw.trim()}\` — Weave has no pipes; call a function or use a \`computed\` instead`);
    out = `${out} /* | ${raw.trim()} */`;
  }
  return { expr: out.trim(), todos };
}

/** Convert every `{{ … }}` inside a chunk of template text, collecting the TODOs its pipes produce. */
export function convertInterpolations(text: string): ConvertedExpr {
  const todos: string[] = [];
  const expr: string = text.replace(/\{\{([^}]*)\}\}/g, (_full, inner: string) => {
    const r: ConvertedExpr = convertExpr(inner);
    todos.push(...r.todos);
    return `{{ ${r.expr} }}`;
  });
  return { expr, todos };
}

/**
 * An attribute value that MIXES text and interpolation — `class="logo-{{ name }}-svg"` — as one expression.
 *
 * Angular interpolates inside an attribute value; Weave does not. Its dynamic form is `attr={{ expr }}`, the
 * whole value or nothing, so a mixed value passed through unchanged rendered the braces as literal text: the
 * element came out with `class="logo-{{ svg.name }}-svg"` written on it. Visible in a browser, invisible to
 * every string assertion — which is how it survived.
 */
export function attrInterpolation(value: string): ConvertedExpr {
  const todos: string[] = [];
  const parts: string[] = [];
  let last: number = 0;
  const re: RegExp = /\{\{([\s\S]*?)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    if (m.index > last) parts.push(JSON.stringify(value.slice(last, m.index)));
    const conv: ConvertedExpr = convertExpr(m[1].trim());
    todos.push(...conv.todos);
    parts.push(`(${conv.expr})`);
    last = m.index + m[0].length;
  }
  if (last < value.length) parts.push(JSON.stringify(value.slice(last)));
  return { expr: parts.join(' + '), todos };
}

/** `on:click="save()"` needs a FUNCTION in Weave, while Angular writes a statement — so wrap it in an arrow. */
function eventBinding(event: string, statement: string): string {
  // `$event` is a valid JS identifier, so naming the arrow's parameter `$event` makes Angular's statement work
  // unchanged, whether or not it mentions `$event`.
  return `on:${event}={{ ($event) => ${statement.trim()} }}`;
}

/**
 * A CSS property name as `style.setProperty` needs it. Angular accepts `style.backgroundColor` and normalises it;
 * Weave passes the name straight to `setProperty`, which only knows `background-color` — so a camelCase name set
 * nothing at all, silently. A custom property (`--brand`) is already in the right form and is left alone.
 */
export function cssProp(name: string): string {
  return name.startsWith('--') ? name : name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** A tag is a Weave COMPONENT when it starts uppercase; on a component only props/`on:`/`use:`/`bind:` are legal. */
function isComponentTag(tag: string): boolean {
  return /^[A-Z]/.test(tag);
}

/** Convert one Angular attribute to its Weave form. Returns the attribute text, plus any TODO to emit beside it. */
export function convertAttr(attr: Attr, tag: string): { out: string | null; todo?: string; todos?: string[] } {
  const { name, value } = attr;
  // A bound value is an Angular expression — pipes in it must be converted, never passed through as invalid Weave.
  const raw: string = value ?? '';
  const isBound: boolean = /^[[(*]/.test(name);
  const conv: ConvertedExpr = isBound ? convertExpr(raw) : { expr: raw, todos: [] };
  const v: string = conv.expr;
  const exprTodos: string[] = conv.todos;
  const component: boolean = isComponentTag(tag);

  // Reactive-forms directives FIRST — each of these also matches a general rule below (`(ngSubmit)` looks like any
  // event, `[formControl]` like any property binding), so ordering is what makes them reachable at all.
  if (name === 'formControlName') {
    return { out: `use:control={{ f.controls.${raw} }}`, todo: `\`formControlName="${raw}"\` — check the form variable name; import \`control\` from \`@weave-framework/forms/dom\`` };
  }
  if (name === '[formControl]') return { out: `use:control={{ ${v} }}`, todos: exprTodos };
  if (name === '[formGroup]' || name === 'formGroupName' || name === 'formArrayName') {
    return { out: null, todo: `\`${name}\` — in Weave the group lives in setup() (\`form({ … })\`); the template binds only leaves, with \`use:control\`` };
  }
  if (name === '(ngSubmit)') {
    return { out: 'on:submit|preventDefault={{ submit }}', todo: '`(ngSubmit)` → `f.submit(handler)` in setup(); it validates, reveals every error and focuses the first invalid control' };
  }

  // (event)="statement" → on:event={{ ($event) => statement }}
  const evt: RegExpMatchArray | null = name.match(/^\((.+)\)$/);
  if (evt) return { out: eventBinding(evt[1], v) };

  // [(ngModel)]="x" → bind:value={{ x }} — but x must be a SIGNAL in Weave, which we cannot verify statically.
  if (name === '[(ngModel)]') {
    return { out: `bind:value={{ ${v} }}`, todo: `two-way binding — \`${v}\` must be a signal in Weave (bind: passes the signal itself)` };
  }
  // [(x)]="y" — a banana-in-a-box on a component
  const banana: RegExpMatchArray | null = name.match(/^\[\((.+)\)\]$/);
  if (banana) return { out: `bind:${banana[1]}={{ ${v} }}`, todo: `two-way binding — \`${v}\` must be a signal` };

  // [prop]="expr" and its dotted forms
  const bound: RegExpMatchArray | null = name.match(/^\[(.+)\]$/);
  if (bound) {
    const target: string = bound[1];
    if (target.startsWith('class.')) return { out: `class:${target.slice(6)}={{ ${v} }}` };
    if (target.startsWith('style.')) return { out: `style:${cssProp(target.slice(6))}={{ ${v} }}` };
    if (target.startsWith('attr.')) return { out: `${target.slice(5)}={{ ${v} }}` };
    if (target === 'ngClass') return { out: null, todo: `[ngClass]="${v}" — Weave toggles one class at a time: \`class:name={{ expr }}\`` };
    if (target === 'ngStyle') return { out: null, todo: `[ngStyle]="${v}" — Weave sets one property at a time: \`style:prop={{ expr }}\`` };
    if (target === 'ngSwitch') return { out: null, todos: exprTodos }; // handled structurally by the caller
    if (target === 'innerHTML') return { out: `.innerHTML={{ ${v} }}`, todos: exprTodos };
    // routerLink is a DIRECTIVE, not a property — `.routerLink` would be a silently broken invention.
    if (target === 'routerLink') {
      return { out: `href={{ ${v} }}`, todo: 'routerLink → use `<Link href={{ … }}>` from @weave-framework/router for client-side navigation', todos: exprTodos };
    }
    // A component takes props by name; a DOM element takes a property with a leading dot.
    return { out: component ? `${target}={{ ${v} }}` : `.${target}={{ ${v} }}`, todos: exprTodos };
  }

  // #ref → Weave uses ref={{ … }} with a setter/signal, which needs a name in setup() — a human decision.
  if (name.startsWith('#')) {
    return { out: null, todo: `template reference \`${name}\` — in Weave use \`ref={{ (el) => … }}\` and hold it in setup()` };
  }

  // Structural directives are handled by the caller (they wrap the element), not as attributes.
  if (name.startsWith('*')) return { out: null, todos: exprTodos };

  // A static routerLink is still a directive, not an attribute.
  if (name === 'routerLink') {
    return { out: `href="${raw}"`, todo: 'routerLink → use `<Link href="…">` from @weave-framework/router for client-side navigation' };
  }

  // A plain attribute. Weave has NO interpolation inside an attribute value, so one that contains `{{ }}` has to
  // become a single expression — leaving it as text rendered the braces onto the element.
  if (value === null) return { out: name };
  if (!value.includes('{{')) return { out: `${name}="${value}"` };
  const inAttr: ConvertedExpr = attrInterpolation(value);
  return { out: `${name}={{ ${inAttr.expr} }}`, todos: inAttr.todos };
}

/* ──────────── structural directives → Weave blocks ──────────── */

/** `let item of items` (+ optional `; trackBy: fn` / `; let i = index`) → the pieces `@for` needs. */
function parseNgFor(expr: string): { item: string; list: string; track: string; extra: string[] } {
  const parts: string[] = expr.split(';').map((s) => s.trim()).filter(Boolean);
  const head: string = parts.shift() ?? '';
  const m: RegExpMatchArray | null = head.match(/^let\s+([A-Za-z_$][\w$]*)\s+of\s+(.+)$/);
  const item: string = m ? m[1] : 'item';
  const list: string = m ? m[2].trim() : head;
  let track: string = item; // no trackBy → track the item itself; a stable id is better, so we say so
  const extra: string[] = [];
  for (const p of parts) {
    const tb: RegExpMatchArray | null = p.match(/^trackBy\s*:\s*(.+)$/);
    if (tb) track = `${item}`; // Angular's trackBy is a function (index, item); Weave tracks an expression
    if (tb) extra.push(`trackBy \`${tb[1].trim()}\` → Weave tracks an expression: use the stable id, e.g. \`track ${item}.id\``);
    else if (/^let\s/.test(p)) extra.push(`\`${p}\` → Weave loop locals are \`$index\`, \`$count\`, \`$first\`, \`$last\`, \`$even\`, \`$odd\``);
    else extra.push(`\`${p}\` — no direct Weave equivalent`);
  }
  return { item, list, track, extra };
}

/** Indent every line of a block by one level. */
function indent(s: string, pad: string = '  '): string {
  return s
    .split('\n')
    .map((l) => (l.trim() ? pad + l : l))
    .join('\n');
}

/* ──────────── rendering the converted template ──────────── */

/** Options for the conversion — chiefly the selector→component-name map, so child tags become Weave components. */
export interface ConvertOptions {
  /** Angular selector (`app-task-card`) → Weave component name (`TaskCard`). Tags found here are PascalCased. */
  components?: Record<string, string>;
  /** Filled in by `convertTemplate` from a first pass over the tree — the `<ng-template>`s and their parameters,
   *  so an `*ngTemplateOutlet` can be rendered as `@render (name(args))` with the arguments in the right order. */
  snippets?: Record<string, SnippetDef>;
  /** The component's prop names. An Angular template reads an `@Input` by its bare name; a Weave template reads
   *  it off `props`. Without this the converted template names bindings that do not exist, and the component
   *  renders nothing — so it is the difference between output that works and output that only looks right. */
  props?: string[];
  /** The class members the template reads that became SIGNALS (fields, getters). An Angular template reads them
   *  bare; a Weave template must CALL them, or `{{ label }}` renders the function instead of its value. */
  signals?: string[];
  /** Services this migration converts, so a call into one is not reported as unknown. */
  migrated?: Map<string, MigratedService>;
  /** The component's host bindings and listeners, already in Weave form. Angular applies these to the element that
   *  carries the component's selector; Weave has no such element, so its template's single root element is where
   *  they belong. */
  host?: HostWiring;
  /** Every name in the unit declared to return an `Observable<…>` — the map the RxJS fold classifies its sources
   *  against. See `observableReturners`. */
  returners?: Set<string>;
}

/** One `<ng-template #name let-a let-b="key">` turned into a Weave `@snippet name(a, b)`. */
export interface SnippetDef {
  name: string;
  /** Parameters in declaration order. `key` is the context property it came from (`$implicit` for a bare `let-x`). */
  params: Array<{ name: string; key: string }>;
}

/** Read a `<ng-template>`'s reference name and `let-` bindings into a snippet definition. */
export function snippetFromTemplate(attrs: Attr[]): SnippetDef | null {
  const ref: Attr | undefined = attrs.find((att) => att.name.startsWith('#'));
  if (!ref) return null;
  const params: Array<{ name: string; key: string }> = [];
  for (const att of attrs) {
    if (!att.name.startsWith('let-')) continue;
    const local: string = att.name.slice(4);
    // `let-crumb` binds the context's `$implicit`; `let-last="last"` binds the named key.
    params.push({ name: local, key: att.value ? att.value : '$implicit' });
  }
  return { name: ref.name.slice(1), params };
}

/** Collect every `<ng-template #ref>` in a tree, so outlets can be rendered against them. */
function collectSnippets(nodes: Node[], into: Record<string, SnippetDef>): void {
  for (const n of nodes) {
    if (n.kind !== 'element') continue;
    if (n.tag === 'ng-template') {
      const def: SnippetDef | null = snippetFromTemplate(n.attrs);
      if (def) into[def.name] = def;
    }
    collectSnippets(n.children, into);
  }
}

/** Split `tplName; context: { $implicit: a, key: b }` into the template name and its context entries. */
export function parseOutlet(expr: string): { name: string; context: Record<string, string> } {
  const semi: number = expr.indexOf(';');
  const name: string = (semi === -1 ? expr : expr.slice(0, semi)).trim();
  const context: Record<string, string> = {};
  if (semi !== -1) {
    const rest: string = expr.slice(semi + 1).trim();
    const open: number = rest.indexOf('{');
    const close: number = rest.lastIndexOf('}');
    if (open !== -1 && close > open) {
      // Split the object literal's top-level entries (a value may itself contain commas inside calls/objects).
      const inner: string = rest.slice(open + 1, close);
      let depth: number = 0;
      let start: number = 0;
      const parts: string[] = [];
      for (let i: number = 0; i < inner.length; i++) {
        const ch: string = inner[i];
        if ('([{'.includes(ch)) depth++;
        else if (')]}'.includes(ch)) depth--;
        else if (ch === ',' && depth === 0) {
          parts.push(inner.slice(start, i));
          start = i + 1;
        }
      }
      parts.push(inner.slice(start));
      for (const p of parts) {
        const colon: number = p.indexOf(':');
        if (colon === -1) continue;
        context[p.slice(0, colon).trim()] = p.slice(colon + 1).trim();
      }
    }
  }
  return { name, context };
}

/** `app-task-card` → `TaskCard` (used when a selector isn't in the supplied map but clearly names a component). */
export function pascalCase(selector: string): string {
  return selector
    .split(/[-_]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

/** Render a node list back to Weave template text. */
function renderNodes(nodes: Node[], opts: ConvertOptions): string {
  return nodes.map((n) => renderNode(n, opts)).join('');
}

/** The structural directive on an element, if any (Angular allows at most one per element). */
function structuralOf(attrs: Attr[]): Attr | undefined {
  return attrs.find((a) => a.name.startsWith('*'));
}

function renderNode(node: Node, opts: ConvertOptions): string {
  if (node.kind === 'text') {
    // Text carries interpolations too — and Angular's modern block syntax (`@if`/`@for`), which is already
    // Weave's, passes through here. Only the expressions inside need converting.
    const r: ConvertedExpr = convertInterpolations(node.text);
    const b: ConvertedExpr = convertBlockSyntax(r.expr);
    const notes: string = [...r.todos, ...b.todos].map((t) => `${todo(t)}\n`).join('');
    return notes + b.expr;
  }
  if (node.kind === 'comment') return `<!--${node.text}-->`;

  // <ng-content> → <slot>
  if (node.tag === 'ng-content') {
    const select: Attr | undefined = node.attrs.find((a) => a.name === 'select');
    if (!select?.value) return '<slot />';
    const named: RegExpMatchArray | null = select.value.match(/^\[?([\w-]+)\]?$/);
    return named ? `<slot name="${named[1]}" />` : `${todo(`<ng-content select="${select.value}"> — Weave slots are named: <slot name="…" />`)}\n<slot />`;
  }
  // <ng-template #name let-a let-b="key"> → `@snippet name(a, b) { … }`. A template with no #ref cannot become a
  // snippet (nothing could `@render` it), so it is flagged rather than given an invented name.
  if (node.tag === 'ng-template') {
    const def: SnippetDef | null = snippetFromTemplate(node.attrs);
    const body: string = renderNodes(node.children, opts);
    if (!def) return `${todo('<ng-template> with no #ref — a Weave `@snippet` needs a name to be `@render`ed')}\n${body}`;
    return `@snippet ${def.name}(${def.params.map((p) => p.name).join(', ')}) {\n${indent(body)}\n}`;
  }

  const structural: Attr | undefined = structuralOf(node.attrs);
  const inner: string = renderElement(node, opts);
  if (!structural) return inner;

  // Wrap the rendered element in the matching Weave block.
  const expr: string = structural.value ?? '';
  switch (structural.name) {
    case '*ngIf': {
      const [cond, rest]: string[] = expr.split(/;\s*else\s+/);
      const block: string = `@if (${cond.trim()}) {\n${indent(inner)}\n}`;
      return rest ? `${todo(`\`else ${rest.trim()}\` referenced an <ng-template> — add an \`@else { … }\` branch`)}\n${block}` : block;
    }
    case '*ngFor': {
      const { item, list, track, extra } = parseNgFor(expr);
      const notes: string = extra.map((e) => `${todo(e)}\n`).join('');
      return `${notes}@for (${item} of ${list}; track ${track}) {\n${indent(inner)}\n}`;
    }
    case '*ngSwitchCase':
      return `@case (${expr}) {\n${indent(inner)}\n}`;
    case '*ngSwitchDefault':
      return `@default {\n${indent(inner)}\n}`;
    case '*ngTemplateOutlet': {
      // `tpl; context: { $implicit: a, key: b }` → `@render (tpl(a, b))`, arguments ordered by the snippet's own
      // parameter list — the context is a bag of names, so only the snippet knows the order.
      const { name, context } = parseOutlet(expr);
      const def: SnippetDef | undefined = opts.snippets?.[name];
      if (!def) {
        return `${todo(`\`*ngTemplateOutlet="${expr}"\` — no <ng-template #${name}> was found in this file; render it with \`@render (${name}(…))\` once it exists`)}\n${inner}`;
      }
      const args: string = def.params.map((p) => context[p.key] ?? 'undefined').join(', ');
      const missing: string[] = def.params.filter((p) => !(p.key in context)).map((p) => p.name);
      const note: string = missing.length ? `${todo(`\`${name}\` expects ${missing.join(', ')}, which the context did not supply — passing \`undefined\``)}\n` : '';
      return `${note}@render (${name}(${args}))`;
    }
    default:
      return `${todo(`structural directive \`${structural.name}="${expr}"\` has no automatic mapping`)}\n${inner}`;
  }
}

/**
 * Angular's modern block syntax (`@if`/`@for`/`@switch`/`@empty`) is nearly identical to Weave's, so it passes
 * through as text. The one real difference is `@for`'s alias form: Angular writes `; let last = $last`, while
 * Weave exposes `$index`/`$count`/`$first`/`$last`/`$even`/`$odd` directly. Rewrite the alias to the Weave local
 * and flag it, since any use of the old name in the body still has to be renamed by a human.
 */
export function convertBlockSyntax(text: string): ConvertedExpr {
  const expr: string = text.replace(/;\s*let\s+([A-Za-z_$][\w$]*)\s*=\s*(\$?\w+)/g, (_full, alias: string, local: string) => {
    const weaveLocal: string = local.startsWith('$') ? local : `$${local}`;
    // The clause goes, and a MARKER takes its place so the whole-template pass below knows which block to rename
    // in. Reporting the rename and leaving it undone put `last` in the body of a `@for` that declares no such
    // name — the auto-return then exported it, and the component threw `last is not defined` on first render.
    return `${ALIAS_MARK}${alias}=${weaveLocal}${ALIAS_MARK}`;
  });
  return { expr, todos: [] };
}

/** Wraps an alias rename in the template text between the block pass and the whole-template pass. */
const ALIAS_MARK: string = 'weave-alias';

/**
 * Apply each `@for` alias rename inside the block it belongs to, and remove the marker.
 *
 * Scoped to the block by brace-matching, because the name is a LOOP LOCAL: `last` outside the loop is somebody
 * else's `last`, and renaming it there would break code that was already correct.
 */
export function renameLoopAliases(html: string): string {
  // Doubled backslashes: this is a TEMPLATE LITERAL, where `\w` is just `w` and `\$` is `$` — the anchor, not
  // the character. Written singly the pattern matched nothing and the marker leaked into the template.
  const mark: RegExp = new RegExp(`${ALIAS_MARK}([A-Za-z_$][\\w$]*)=(\\$[A-Za-z]+)${ALIAS_MARK}`);
  let out: string = html;
  for (;;) {
    const m: RegExpMatchArray | null = out.match(mark);
    if (!m || m.index === undefined) return out;
    const [full, alias, weaveLocal] = m;
    const open: number = out.indexOf('{', m.index + full.length);
    const close: number = open < 0 ? -1 : matchBrace(out, open);
    const head: string = out.slice(0, m.index) + out.slice(m.index + full.length, open < 0 ? undefined : open);
    if (open < 0 || close < 0) {
      out = head + (open < 0 ? '' : out.slice(open));
      continue;
    }
    // Doubled, for the same reason as above: singly written, the class read as `[w$.]` and a one-letter alias
    // matched inside ordinary words — `let i = index` rewrote the `i` of `<li>` and produced `<l$index>`.
    const body: string = out.slice(open, close + 1).replace(new RegExp(`(?<![\\w$.])${alias}(?![\\w$])`, 'g'), weaveLocal);
    out = head + body + out.slice(close + 1);
  }
}

/** The `}` closing the `{` at `open`, or -1. */
function matchBrace(text: string, open: number): number {
  let depth: number = 0;
  for (let i: number = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/** Angular built-in elements with a confident Weave equivalent (a user's own selectors come via `opts`). */
const BUILTIN_TAGS: Record<string, string> = {
  'router-outlet': 'RouterView', // @weave-framework/router renders the matched route here
};

/**
 * Angular Material tags → `@weave-framework/ui` components. Weave's UI library covers the same ground, so these
 * are real mappings rather than guesses — but the component still has to be IMPORTED, and `@weave-framework/ui`
 * is not part of the scaffold, so `uiImportsFor` reports what to add.
 *
 * Left out on purpose: anything whose Weave equivalent is a FUNCTION rather than a tag (`<mat-dialog>` →
 * `openDialog`, `<mat-snack-bar>` → `snackbar`). Renaming those to a component would be wrong, so they are
 * flagged instead.
 */
const MATERIAL_TAGS: Record<string, { tag: string; from: string }> = {
  'mat-card': { tag: 'Card', from: 'card' },
  'mat-form-field': { tag: 'FormField', from: 'form-field' },
  'mat-checkbox': { tag: 'Checkbox', from: 'checkbox' },
  'mat-select': { tag: 'Select', from: 'select' },
  'mat-icon': { tag: 'Icon', from: 'icon' },
  'mat-toolbar': { tag: 'Toolbar', from: 'toolbar' },
  'mat-tab-group': { tag: 'Tabs', from: 'tabs' },
  'mat-list': { tag: 'List', from: 'list' },
  'mat-table': { tag: 'Table', from: 'table' },
  'mat-tree': { tag: 'Tree', from: 'tree' },
  'mat-menu': { tag: 'Menu', from: 'menu' },
  'mat-paginator': { tag: 'Paginator', from: 'paginator' },
  'mat-progress-bar': { tag: 'ProgressBar', from: 'progress-bar' },
  'mat-spinner': { tag: 'ProgressSpinner', from: 'progress-spinner' },
  'mat-progress-spinner': { tag: 'ProgressSpinner', from: 'progress-spinner' },
  'mat-slide-toggle': { tag: 'SlideToggle', from: 'slide-toggle' },
  'mat-slider': { tag: 'Slider', from: 'slider' },
  'mat-chip': { tag: 'Chip', from: 'chips' },
  'mat-radio-button': { tag: 'Radio', from: 'radio' },
  'mat-button-toggle': { tag: 'ButtonToggle', from: 'button-toggle' },
  'mat-autocomplete': { tag: 'Autocomplete', from: 'autocomplete' },
  'mat-badge': { tag: 'Badge', from: 'badge' },
  'mat-datepicker': { tag: 'Datepicker', from: 'datepicker' },
  'mat-grid-list': { tag: 'GridList', from: 'grid-list' },
  'mat-sidenav': { tag: 'Sidenav', from: 'sidenav' },
  'mat-stepper': { tag: 'Stepper', from: 'stepper' },
  'mat-expansion-panel': { tag: 'Expansion', from: 'expansion' },
};

/** Material ATTRIBUTES that turn a plain element into a component (`<button mat-raised-button>` → `<Button>`). */
const MATERIAL_ATTRS: Record<string, { tag: string; from: string }> = {
  'mat-button': { tag: 'Button', from: 'button' },
  'mat-raised-button': { tag: 'Button', from: 'button' },
  'mat-flat-button': { tag: 'Button', from: 'button' },
  'mat-stroked-button': { tag: 'Button', from: 'button' },
  'mat-icon-button': { tag: 'Button', from: 'button' },
  'mat-fab': { tag: 'Button', from: 'button' },
  'mat-mini-fab': { tag: 'Button', from: 'button' },
  matInput: { tag: 'Input', from: 'input' },
};

/** Material pieces whose Weave equivalent is a FUNCTION, not a tag — renaming them would be wrong. */
const MATERIAL_FUNCTIONS: Record<string, string> = {
  matTooltip: '`tooltip` is a `use:` action — `use:tooltip={{ () => text }}` from `@weave-framework/ui/tooltip`',
  'mat-dialog': '`openDialog(...)` from `@weave-framework/ui/dialog` — a dialog is opened, not placed in markup',
  'mat-snack-bar': '`snackbar(...)` from `@weave-framework/ui/snackbar` — called, not placed in markup',
};

/** The `@weave-framework/ui` import lines a converted template needs, derived from the Material it used. */
export function uiImportsFor(templateHtml: string): string[] {
  const needed: Map<string, string> = new Map();
  for (const [matTag, def] of Object.entries(MATERIAL_TAGS)) {
    if (new RegExp(`<${matTag}[\\s>/]`).test(templateHtml)) needed.set(def.tag, def.from);
  }
  for (const [attr, def] of Object.entries(MATERIAL_ATTRS)) {
    if (new RegExp(`[\\s"']${attr}[\\s=>"']`).test(templateHtml)) needed.set(def.tag, def.from);
  }
  return [...needed.entries()].sort().map(([tag, from]) => `import ${tag} from '@weave-framework/ui/${from}';`);
}

/** Render one element (its own tag + attributes + children), without its structural wrapper. */
function renderElement(node: ElementNode, opts: ConvertOptions): string {
  // A Material ATTRIBUTE can decide the tag: `<button mat-raised-button>` is a `<Button>`, and the marker
  // attribute itself disappears (it was never a real attribute, only Angular's way of selecting a directive).
  const attrDriven: { tag: string; from: string } | undefined = node.attrs.map((a) => MATERIAL_ATTRS[a.name]).find(Boolean);
  const mapped: string | undefined = opts.components?.[node.tag] ?? BUILTIN_TAGS[node.tag] ?? MATERIAL_TAGS[node.tag]?.tag ?? attrDriven?.tag;
  const tag: string = mapped ?? node.tag;

  // A [ngSwitch] parent groups its *ngSwitchCase children into one @switch block.
  const switchAttr: Attr | undefined = node.attrs.find((a) => a.name === '[ngSwitch]');
  const parts: string[] = [];
  const todos: string[] = [];
  for (const a of node.attrs) {
    if (MATERIAL_ATTRS[a.name]) continue; // the marker that selected the component — it is the tag now
    const fn: string | undefined = MATERIAL_FUNCTIONS[a.name] ?? MATERIAL_FUNCTIONS[node.tag];
    if (fn) {
      todos.push(todo(`\`${a.name}\` → ${fn}`));
      continue;
    }
    const { out, todo: t, todos: more } = convertAttr(a, tag);
    if (out) parts.push(out);
    if (t) todos.push(todo(t));
    for (const m of more ?? []) todos.push(todo(m));
  }
  if (MATERIAL_FUNCTIONS[node.tag]) todos.push(todo(`\`<${node.tag}>\` → ${MATERIAL_FUNCTIONS[node.tag]}`));
  // The host bindings, if this is the root. Appended AFTER the element's own attributes so a host binding wins the
  // way Angular's does, and unconverted because they were built in Weave form already.
  parts.push(...(node.hostAttrs ?? []));

  let childText: string;
  if (switchAttr) {
    const cases: Node[] = node.children.filter((ch) => ch.kind === 'element' && structuralOf(ch.attrs) !== undefined);
    const others: Node[] = node.children.filter((ch) => !cases.includes(ch));
    childText = `${renderNodes(others, opts)}@switch (${switchAttr.value ?? ''}) {\n${indent(renderNodes(cases, opts))}\n}\n`;
  } else {
    childText = renderNodes(node.children, opts);
  }

  const attrText: string = parts.length ? ` ${parts.join(' ')}` : '';
  const head: string = todos.length ? `${todos.join('\n')}\n` : '';
  // ng-container is a pure grouping wrapper — Weave's blocks already group, so it disappears.
  if (node.tag === 'ng-container') return `${head}${childText}`;
  if (VOID_TAGS.has(node.tag.toLowerCase())) return `${head}<${tag}${attrText} />`;
  return `${head}<${tag}${attrText}>${childText}</${tag}>`;
}

/**
 * Convert an Angular template to a Weave template. Structural directives become `@if`/`@for`/`@switch` blocks,
 * bindings become their Weave forms, `<ng-content>` becomes `<slot>`, and anything without a faithful equivalent
 * is left with a `TODO(weave migrate)` comment rather than guessed at.
 */
export function convertTemplate(html: string, opts: ConvertOptions = {}): string {
  const tree: Node[] = parseTemplate(html);
  // First pass: find the <ng-template>s, so an outlet appearing BEFORE its template still resolves.
  const snippets: Record<string, SnippetDef> = { ...opts.snippets };
  collectSnippets(tree, snippets);
  const hostTodos: string[] = attachHost(tree, opts.host);
  const out: string = (hostTodos.length ? `${hostTodos.map((t) => todo(t)).join('\n')}\n` : '') + renderNodes(tree, { ...opts, snippets });
  // Last pass: an Angular template reads an @Input by its bare name, a Weave one reads it off `props`. Done here
  // rather than per-expression so every place a name can appear — interpolations, bindings, block headers — is
  // covered by one rule. Snippet parameters are locals, so they are excluded.
  const locals: Set<string> = new Set<string>(Object.values(snippets).flatMap((s) => s.params.map((p) => p.name)));
  const props: string[] = (opts.props ?? []).filter((p) => !locals.has(p));
  const signals: string[] = (opts.signals ?? []).filter((s) => !locals.has(s) && !props.includes(s));
  const qualified: string = props.length || signals.length ? qualifyTemplateExpressions(out, props, signals) : out;
  // The loop aliases LAST: the rename is scoped to a block, and the block is only whole once every node has been
  // rendered back to text.
  return renameLoopAliases(qualified);
}

/**
 * A bare `name` that became a signal must be CALLED: `{{ label }}` in Angular reads the field, in Weave it reads
 * the signal function itself and renders its source. Anything already being called, or reached through a dot, is
 * left alone.
 */
export function qualifySignalReads(expr: string, signals: string[]): string {
  if (!signals.length) return expr;
  const set: Set<string> = new Set<string>(signals);
  return outsideStrings(expr, (part) =>
    part.replace(/(\.)?\b([A-Za-z_$][\w$]*)\b(\s*\()?/g, (full: string, dot: string | undefined, name: string, call: string | undefined) =>
      !dot && !call && set.has(name) ? `${name}()` : full,
    ),
  );
}

/** Apply the name rules to every expression in a rendered Weave template: `{{ … }}` and `@block ( … )` headers. */
function qualifyTemplateExpressions(text: string, props: string[], signals: string[]): string {
  const fix = (inner: string): string => qualifySignalReads(qualifyProps(inner, props), signals);
  return text
    .replace(/\{\{([^}]*)\}\}/g, (_m, inner: string) => `{{ ${fix(inner.trim())} }}`)
    .replace(/^(\s*@(?:if|for|switch|case|render)\s*\()([^)]*)\)/gm, (_m, head: string, inner: string) => `${head}${fix(inner)})`);
}

/* ──────────── the host element: `@HostBinding` / `@HostListener` / `host: { … }` ──────────── */

/**
 * What a component's host declarations become. Angular applies them to the element carrying the component's
 * selector; Weave has no such element, so the template's single ROOT element is the faithful place for them.
 *
 * Before this existed, `@HostBinding('class.sps-logo') get classSpsLogo() { return true; }` converted to a
 * `computed` that nothing read — so a class that was ALWAYS on the element became one that never is. The computed
 * was right and the component was still broken, which is the worst of both.
 */
export interface HostWiring {
  /** Weave attribute texts for the root element (`class:sps-logo={{ classSpsLogo() }}`), already converted. */
  attrs: string[];
  /** Static classes from `host: {'class': 'a b'}` — merged into the root's own `class`, never a second attribute. */
  classes: string[];
  /** Lines for `setup()`: a listener whose target is `window`/`document` is not an element binding at all. */
  setupLines: string[];
  /** Runtime imports those lines need (`onMount`). */
  runtimeNeeds: string[];
  todos: string[];
}

/** A fresh empty wiring. A shared constant would be a mutable object handed to every caller. */
export function emptyHost(): HostWiring {
  return { attrs: [], classes: [], setupLines: [], runtimeNeeds: [], todos: [] };
}

/** Split an argument list on its top-level commas (`'click', ['$event', 'x']` → two entries). */
function splitTopLevel(src: string): string[] {
  const out: string[] = [];
  let depth: number = 0;
  let quote: string = '';
  let cur: string = '';
  for (const ch of src) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** `'click'` → `click`. Leaves an unquoted argument (a constant reference) alone. */
function unquote(s: string): string {
  const t: string = s.trim();
  return /^(['"`]).*\1$/s.test(t) ? t.slice(1, -1) : t;
}

/**
 * The raw arguments of `@Name(...)` on a decorator text, or null when this decorator is not the one asked for.
 * An empty array means the decorator was written bare (`@HostBinding`), which is legal and means "use the member
 * name as the target".
 */
export function decoratorArgs(text: string, name: string): string[] | null {
  const t: string = text.trim();
  if (!new RegExp(`^@${name}\\b`).test(t)) return null;
  const open: number = t.indexOf('(');
  if (open < 0) return [];
  return splitTopLevel(t.slice(open + 1, t.lastIndexOf(')')));
}

/**
 * One host binding target → the Weave attribute that expresses it. The same target grammar Angular uses on a
 * `[binding]` in a template, so it maps the same way `convertAttr` maps those.
 */
export function hostTargetToAttr(target: string, expr: string): string {
  if (target.startsWith('class.')) return `class:${target.slice(6)}={{ ${expr} }}`;
  if (target === 'class') return `class={{ ${expr} }}`;
  if (target.startsWith('style.')) {
    const rest: string = target.slice(6);
    const dot: number = rest.indexOf('.');
    // `style.width.px` — Angular appends the unit itself. Weave has no unit shorthand, so it is appended in the
    // expression; dropping it would set `width: 240`, which is not a length and does nothing.
    if (dot >= 0) return `style:${cssProp(rest.slice(0, dot))}={{ (${expr}) + '${rest.slice(dot + 1)}' }}`;
    return `style:${cssProp(rest)}={{ ${expr} }}`;
  }
  if (target.startsWith('attr.')) return `${target.slice(5)}={{ ${expr} }}`;
  return `.${target}={{ ${expr} }}`; // a DOM property (`disabled`, `id`)
}

/** Reserved words and template locals that are never class members. */
const HOST_EXPR_KEYWORDS: Set<string> = new Set<string>(['true', 'false', 'null', 'undefined', 'this', '$event', 'new', 'typeof', 'in', 'of', 'void', 'window', 'document']);

/**
 * Qualify a host-metadata expression against the class. These are written like template expressions — bare member
 * names, no `this.` — so the same reads apply: an input is `props.x`, a field or getter is the signal `x()`, and
 * anything already being CALLED is left alone (it is a method, or a signal the author already read).
 */
export function qualifyHostExpr(expr: string, ctx: TranslateCtx): string {
  return outsideStrings(expr.replace(/\bthis\./g, ''), (part) =>
    part.replace(/(\.)?\b([A-Za-z_$][\w$]*)\b(\s*\()?/g, (full: string, dot: string | undefined, name: string, call: string | undefined) => {
      if (dot || call || HOST_EXPR_KEYWORDS.has(name)) return full;
      if (ctx.inputs.has(name)) return `${ctx.propsRef ?? 'props'}.${name}`;
      if (ctx.getters.has(name) || ctx.fields.has(name) || ctx.signals.has(name)) return `${name}()`;
      return full;
    }),
  );
}

/** How a member is READ: an input off the props object, anything else as the signal it became. */
function memberRead(name: string, ctx: TranslateCtx): string {
  return ctx.inputs.has(name) ? `${ctx.propsRef ?? 'props'}.${name}` : `${name}()`;
}

/** One host declaration, before it is rendered as either a template attribute or DOM code against an element. */
export interface HostDecls {
  /** Reactive bindings: `class.x` / `style.width.px` / `attr.role` / a bare DOM property, and the expression. */
  bindings: Array<{ target: string; expr: string }>;
  /** Listeners on the element itself: the event spec as written, and the statement to run. */
  events: Array<{ spec: string; statement: string }>;
  /** Listeners on `window` / `document` / `body` — a subscription, not a binding. */
  globals: Array<{ target: string; event: string; statement: string }>;
  /** Static entries from `host: { class: 'x', role: 'img' }`. */
  statics: Array<{ key: string; value: string }>;
  todos: string[];
}

/**
 * Everything a class declares about its host element: the `@HostBinding`/`@HostListener` members AND the
 * decorator's own `host: { … }` map, which says the same things a different way. Read once, here, so a component
 * (which renders them into its template) and a directive (which applies them to an element it is handed) cannot
 * disagree about what the class said.
 */
export function hostDecls(members: ClassMember[], hostMeta: Record<string, string>, ctx: TranslateCtx): HostDecls {
  const out: HostDecls = { bindings: [], events: [], globals: [], statics: [], todos: [] };

  const addListener = (spec: string, statement: string, origin: string): void => {
    const colon: number = spec.indexOf(':');
    if (colon >= 0) {
      const target: string = spec.slice(0, colon);
      if (target === 'window' || target === 'document' || target === 'body') {
        out.globals.push({ target: target === 'body' ? 'document.body' : target, event: spec.slice(colon + 1), statement });
        return;
      }
      out.todos.push(`\`${origin}\` listens on \`${spec}\` — an unrecognised target; wire it by hand`);
      return;
    }
    // `keydown.enter` — Angular's key filter. Weave's modifiers are DOM-level (`|preventDefault`), not key names,
    // so the filter has to become a check inside the handler rather than be silently dropped.
    const dot: number = spec.indexOf('.');
    if (dot >= 0) {
      out.events.push({ spec: spec.slice(0, dot), statement });
      out.todos.push(`\`${origin}\` filtered on \`${spec}\` — Weave has no key modifier; guard inside the handler (\`if ($event.key !== 'Enter') return;\`)`);
      return;
    }
    out.events.push({ spec, statement });
  };

  for (const mem of members) {
    for (const dec of mem.decorators ?? []) {
      const bind: string[] | null = decoratorArgs(dec, 'HostBinding');
      if (bind) {
        // `@HostBinding()` bare binds the property of the same name — the member name IS the target.
        out.bindings.push({ target: bind.length ? unquote(bind[0]) : mem.name, expr: memberRead(mem.name, ctx) });
        continue;
      }
      const listen: string[] | null = decoratorArgs(dec, 'HostListener');
      if (listen && listen.length) {
        // The second argument names what Angular passes the method (`['$event']`, `['$event.target.value']`).
        const args: string[] = splitTopLevel((listen[1] ?? '').replace(/^\[|\]$/g, '')).map(unquote);
        addListener(unquote(listen[0]), `${mem.name}(${args.join(', ')})`, `@HostListener on ${mem.name}`);
      }
    }
  }

  for (const [key, value] of Object.entries(hostMeta)) {
    const evt: RegExpMatchArray | null = key.match(/^\((.+)\)$/);
    if (evt) {
      addListener(evt[1], qualifyHostExpr(value, ctx), `host: {'${key}'}`);
      continue;
    }
    const bound: RegExpMatchArray | null = key.match(/^\[(.+)\]$/);
    if (bound) out.bindings.push({ target: bound[1], expr: qualifyHostExpr(value, ctx) });
    else out.statics.push({ key, value });
  }
  return out;
}

/** The host declarations as a COMPONENT uses them: attributes for its template's root element. */
export function hostWiring(members: ClassMember[], hostMeta: Record<string, string>, ctx: TranslateCtx): HostWiring {
  const decls: HostDecls = hostDecls(members, hostMeta, ctx);
  const out: HostWiring = emptyHost();
  out.todos.push(...decls.todos);
  for (const b of decls.bindings) out.attrs.push(hostTargetToAttr(b.target, b.expr));
  for (const e of decls.events) out.attrs.push(`on:${e.spec}={{ ($event) => ${e.statement} }}`);
  for (const s of decls.statics) {
    // `class` merges into the root's own classes; anything else is a plain attribute.
    if (s.key === 'class') out.classes.push(...s.value.split(/\s+/).filter(Boolean));
    else out.attrs.push(`${s.key}="${s.value}"`);
  }
  for (const g of decls.globals) {
    // Angular scopes the subscription to the component's life; `onMount` + the returned cleanup is exactly that.
    out.setupLines.push(
      'onMount(() => {',
      `  const handler = ($event: Event): void => { ${g.statement}; };`,
      `  ${g.target}.addEventListener('${g.event}', handler);`,
      `  return () => ${g.target}.removeEventListener('${g.event}', handler);`,
      '});',
    );
    out.runtimeNeeds.push('onMount');
  }
  return out;
}

/** One reactive binding as code against an element — the DIRECTIVE form of `hostTargetToAttr`. */
function hostTargetToDom(target: string, expr: string): string {
  // Always a BLOCK body: an expression-bodied arrow returns whatever the DOM call returns, and `classList.toggle`
  // returns a boolean, which `effect` does not accept (it takes a cleanup or nothing).
  const fx = (stmt: string): string => `effect(() => { ${stmt} });`;
  if (target.startsWith('class.')) return fx(`el.classList.toggle('${target.slice(6)}', Boolean(${expr}));`);
  if (target === 'class') return fx(`el.className = String(${expr} ?? '');`);
  if (target.startsWith('style.')) {
    const rest: string = target.slice(6);
    const dot: number = rest.indexOf('.');
    if (dot >= 0) return fx(`el.style.setProperty('${cssProp(rest.slice(0, dot))}', String(${expr}) + '${rest.slice(dot + 1)}');`);
    return fx(`el.style.setProperty('${cssProp(rest)}', String(${expr} ?? ''));`);
  }
  if (target.startsWith('attr.')) return fx(`el.setAttribute('${target.slice(5)}', String(${expr} ?? ''));`);
  return fx(`(el as unknown as Record<string, unknown>)['${target}'] = ${expr};`);
}

/**
 * The host declarations as a DIRECTIVE uses them: statements against the element the action is handed. Returns
 * the body lines, the cleanups the returned `destroy` must run, and the runtime imports they need.
 */
export function hostDomCode(decls: HostDecls): { lines: string[]; cleanups: string[]; runtimeNeeds: string[] } {
  const lines: string[] = [];
  const cleanups: string[] = [];
  const runtimeNeeds: string[] = [];
  for (const s of decls.statics) {
    if (s.key === 'class') lines.push(`el.classList.add(${s.value.split(/\s+/).filter(Boolean).map((c) => `'${c}'`).join(', ')});`);
    else lines.push(`el.setAttribute('${s.key}', '${s.value}');`);
  }
  if (decls.bindings.length) runtimeNeeds.push('effect');
  for (const b of decls.bindings) lines.push(hostTargetToDom(b.target, b.expr));
  // A listener needs a NAMED handler: an inline arrow cannot be removed, which is a leak the Angular version
  // never had (Angular tore its host listeners down with the directive).
  for (const [i, e] of [...decls.events, ...decls.globals.map((g) => ({ spec: g.event, statement: g.statement, on: g.target }))].entries()) {
    const on: string = 'on' in e && typeof e.on === 'string' ? e.on : 'el';
    const handler: string = `handler${i}`;
    // Only take `$event` when the statement uses it — an unused parameter is lint noise in someone else's project.
    const param: string = /\$event\b/.test(e.statement) ? '$event: Event' : '';
    lines.push(`const ${handler} = (${param}): void => { ${e.statement}; };`);
    lines.push(`${on}.addEventListener('${e.spec}', ${handler});`);
    cleanups.push(`${on}.removeEventListener('${e.spec}', ${handler});`);
  }
  return { lines, cleanups, runtimeNeeds };
}

/**
 * Put the host wiring on the template's single root element. When there is not exactly one, there is no honest
 * place for it — Angular's host element always existed, and inventing a wrapper would change the DOM the
 * component produces — so it is reported in full instead of quietly dropped.
 */
function attachHost(tree: Node[], host: HostWiring | undefined): string[] {
  if (!host || (host.attrs.length === 0 && host.classes.length === 0)) return [];
  const roots: ElementNode[] = tree.filter((n): n is ElementNode => n.kind === 'element' && n.tag !== 'ng-template');
  const declared: string[] = [...host.classes.map((c) => `class="${c}"`), ...host.attrs];
  if (roots.length !== 1) {
    return [
      `this component's host element carried ${declared.join(', ')} —`,
      `Angular put those on its <selector> tag, but this template has ${roots.length} root elements, so there is no`,
      'single element to move them to. Wrap the template in one element and put them there.',
    ];
  }
  const root: ElementNode = roots[0];
  root.hostAttrs = [...(root.hostAttrs ?? []), ...host.attrs];
  if (host.classes.length) {
    const existing: Attr | undefined = root.attrs.find((a) => a.name === 'class');
    if (existing) existing.value = `${host.classes.join(' ')} ${existing.value ?? ''}`.trim();
    else root.attrs.unshift({ name: 'class', value: host.classes.join(' ') });
  }
  // A conditional root is not a host element: Angular's existed unconditionally, this one comes and goes with the
  // condition. The bindings still belong here, but the difference is real and has to be said.
  if (structuralOf(root.attrs)) {
    return ['the host bindings were moved onto the root element, which is CONDITIONAL here — Angular applied them to a host that always existed'];
  }
  return [];
}

/* ──────────── the component pair: `foo.ts` (setup) + `foo.html` (template) ──────────── */

/** The two files one Angular component becomes. */
export interface ConvertedComponent {
  /** Base file name without extension (`task-card`), derived from the selector or the class name. */
  baseName: string;
  /** The `setup()` module source. */
  ts: string;
  /** The Weave template source. */
  html: string;
}

/**
 * A field's default value as written — including the signal-input forms, where the default sits inside the call:
 * `name = input('')` defaults to `''`, while `input.required<T>()` has none by design. `null`/`undefined` are
 * treated as "no default", since declaring them adds nothing a missing prop does not already do.
 */
export function signalInputDefault(mem: ClassMember | undefined): string {
  const init: string = (mem?.initializer ?? '').trim();
  if (!init) return '';
  const call: RegExpMatchArray | null = init.match(/^(?:input|model)\s*(?:<[^>]*>)?\s*\((.*)\)$/s);
  if (init.startsWith('input.required')) return ''; // required by definition — no default exists
  const value: string = call ? call[1].trim() : init;
  // A signal input's second argument is its options bag, not a default — keep only the first argument.
  const first: string = call ? value.split(/,(?![^([{]*[)\]}])/)[0].trim() : value;
  return first === 'null' || first === 'undefined' || first === '' ? '' : first;
}

/**
 * The original file's imports that the converted code still needs: everything except `@angular/*`, with relative
 * specifiers repointed at where those files now land. Dropping them, as the drafts used to, left the translated
 * body calling helpers that were never imported.
 */
/**
 * Members whose name collides with something the generated file IMPORTS, and what to call them instead.
 *
 * A class field literally named `form` became `const form = signal(…)`, which SHADOWED the `form` imported from
 * `@weave-framework/forms` — so the drafted `form({ … })` two lines later called the signal. It type-checked as
 * "Expected 0 arguments, but got 1", ten lines from the cause. The member is the thing that moves, so the member
 * is what gets renamed; the import is what the file needs to keep working.
 */
export function localRenames(members: ClassMember[], importLines: string[]): Map<string, string> {
  // Everything a draft can put in scope: what it imports, and the locals it generates itself.
  const taken: Set<string> = new Set<string>(DRAFT_LOCALS);
  for (const line of importLines) {
    const braces: RegExpMatchArray | null = line.match(/\{([\s\S]*)\}/);
    for (const part of (braces?.[1] ?? '').split(',')) {
      const name: string = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim() ?? '';
      if (name) taken.add(name);
    }
    const def: RegExpMatchArray | null = line.match(/^import\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/);
    if (def) taken.add(def[1]);
  }
  const out: Map<string, string> = new Map<string, string>();
  for (const mem of members) {
    if (!taken.has(mem.name)) continue;
    out.set(mem.name, `own${mem.name.charAt(0).toUpperCase()}${mem.name.slice(1)}`);
  }
  return out;
}

/**
 * Names a draft brings into scope on its own — the Weave APIs it can import and the bindings it writes. A class
 * member with one of these names would shadow it, and the shadow shows up as a type error somewhere else.
 */
const DRAFT_LOCALS: string[] = [
  'signal', 'computed', 'effect', 'watch', 'onMount', 'onDispose', 'inject', 'provide', 'createContext',
  'store', 'field', 'form', 'validators', 'navigate', 'afterEach', 'beforeEach', 'createClient', 'resource',
  'action', 'props', 'propDefaults', 'setup', 'routerNavigate', 'client', 'defaults', 'opts', 'el', 'arg',
];

/**
 * Every Weave API a draft can name, and the package it comes from.
 *
 * Verified against what those packages actually export — a generated import of something that is not there is
 * worse than no import at all. Type-only exports are absent on purpose: this map answers "which VALUE does this
 * code call", and importing a type as a value does not compile.
 */
const WEAVE_API: Record<string, string> = {
  // @weave-framework/runtime
  signal: '@weave-framework/runtime', computed: '@weave-framework/runtime', effect: '@weave-framework/runtime',
  watch: '@weave-framework/runtime', batch: '@weave-framework/runtime', untrack: '@weave-framework/runtime',
  tick: '@weave-framework/runtime', root: '@weave-framework/runtime', debounced: '@weave-framework/runtime',
  linkedSignal: '@weave-framework/runtime', onMount: '@weave-framework/runtime', onDispose: '@weave-framework/runtime',
  onCleanup: '@weave-framework/runtime', inject: '@weave-framework/runtime', provide: '@weave-framework/runtime',
  createContext: '@weave-framework/runtime', catchError: '@weave-framework/runtime',
  // @weave-framework/store
  store: '@weave-framework/store',
  // @weave-framework/router
  navigate: '@weave-framework/router', afterEach: '@weave-framework/router', beforeEach: '@weave-framework/router',
  useLoaderData: '@weave-framework/router', useRouter: '@weave-framework/router', currentPath: '@weave-framework/router',
  currentQuery: '@weave-framework/router', back: '@weave-framework/router', prefetch: '@weave-framework/router',
  // @weave-framework/forms
  field: '@weave-framework/forms', form: '@weave-framework/forms', group: '@weave-framework/forms',
  fieldArray: '@weave-framework/forms', validators: '@weave-framework/forms',
  // @weave-framework/data
  resource: '@weave-framework/data', action: '@weave-framework/data', createClient: '@weave-framework/data',
  optimistic: '@weave-framework/data',
  // @weave-framework/i18n
  t: '@weave-framework/i18n', setLocale: '@weave-framework/i18n', locale: '@weave-framework/i18n',
};

/**
 * The Weave imports a finished draft needs, DERIVED from the names it actually contains.
 *
 * Every place that decided this by hand — "import `computed` if any member is a getter" — was a list that could
 * only be as complete as the day it was written, and each one had gone out of date: a signal field initialised
 * with `computed(…)` named it without importing it, and so did every `inject(…)` the drafts emit. Reading the
 * output instead cannot drift, because the output is the thing being asked about.
 *
 * A name the draft DECLARES is its own — a local `const form = …` is not `form` from the forms package — and a
 * name that appears only in the carried original is a comment, not a use.
 */
export function weaveImportsFor(code: string, alreadyImported: Iterable<string> = []): string[] {
  const live: string = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[\t ]*\/\/.*$/gm, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const declared: Set<string> = new Set<string>([...alreadyImported]);
  for (const m of live.matchAll(/(?:^|[;{}\n])\s*(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  const byModule: Map<string, Set<string>> = new Map<string, Set<string>>();
  for (const [name, mod] of Object.entries(WEAVE_API)) {
    if (declared.has(name)) continue;
    if (!new RegExp(`(?<![\\w$.])${name}\\s*[(<]`).test(live)) continue; // named as a CALL, not as a property
    if (!byModule.has(mod)) byModule.set(mod, new Set<string>());
    byModule.get(mod)?.add(name);
  }
  return [...byModule.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mod, names]) => `import { ${[...names].sort().join(', ')} } from '${mod}';`);
}

/**
 * The names a file imports from `@angular/*`. Those imports do not come across — Angular is what is being
 * migrated away from — so any drafted code still naming one of them would reference something that is not there.
 */
export function angularImportedNames(file: string): Set<string> {
  const out: Set<string> = new Set<string>();
  for (const imp of sourceImports(file)) {
    if (!imp.spec.startsWith('@angular')) continue;
    const braces: RegExpMatchArray | null = imp.text.match(/\{([\s\S]*)\}/);
    for (const part of (braces?.[1] ?? '').split(',')) {
      const name: string = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (name) out.add(name);
    }
  }
  return out;
}

export function carriedImportsFor(file: string, migrated?: Map<string, MigratedService>): string[] {
  return sourceImports(file)
    .filter((i) => !i.spec.startsWith('@angular/') && i.spec !== '@angular')
    .map((i) => {
      let text: string = i.spec.startsWith('.') ? i.text.replace(i.spec, repointSpecifier(i.spec)) : i.text;
      // A converted service no longer exports its class name — it exports a store hook or a context. Carrying the
      // import unchanged left the file importing something the converted file does not export.
      for (const [cls, m] of migrated ?? []) {
        text = text.replace(new RegExp(`(?<![\\w$])${cls}(?![\\w$])`), m.name);
      }
      return text;
    });
}

/** `TaskCardComponent` → `task-card`; falls back from the selector when there is one. */
export function baseNameFor(fact: ComponentFact): string {
  if (fact.selector) return fact.selector.replace(/^app-/, '');
  return fact.className
    .replace(/Component$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Convert one analysed `@Component` into a Weave component pair. The `setup()` skeleton carries the component's
 * props (its `@Input`s) and callback props (its `@Output`s, as `onX`), plus an honest TODO listing what the class
 * body still needs moved by hand — the method bodies are NOT auto-translated (that is a judgement call, and a
 * wrong silent rewrite is worse than a marked one).
 */
export function convertComponent(fact: ComponentFact, templateHtml: string, opts: ConvertOptions = {}, formFact?: FormFact): ConvertedComponent {
  const baseName: string = baseNameFor(fact);
  // An `@Input() color: string = 'sps-default'` states BOTH a type and a default. Emitting `color: unknown` threw
  // away two facts the source spelled out — so the type is carried into the props signature, and the default into
  // `propDefaults`, which is exactly the mechanism Weave provides for it.
  const inputInfo: Array<{ name: string; type: string; def: string }> = fact.inputs.map((name) => {
    const mem: ClassMember | undefined = (fact.members ?? []).find((m) => m.name === name && m.kind === 'field');
    return { name, type: mem?.type ?? '', def: signalInputDefault(mem) };
  });
  // The declared type, as written, and NOT made optional: `propDefaults` guarantees a value inside `setup`, so
  // `color?: string` would force a null check on something that is never null. Optionality is for the PARENT, and
  // `propDefaults` is what states it — `weave check` reads it and stops demanding the prop.
  const propLines: string[] = [
    ...inputInfo.map((i) => `  ${i.name}: ${i.type || 'unknown'};`),
    ...fact.outputs.map((o) => `  on${o.charAt(0).toUpperCase()}${o.slice(1)}?: (value: unknown) => void;`),
  ];
  const propsType: string = propLines.length ? `{\n${propLines.join('\n')}\n}` : 'Record<string, never>';
  const usesProps: boolean = propLines.length > 0;
  const defaults: Array<{ name: string; def: string }> = inputInfo.filter((i) => i.def).map((i) => ({ name: i.name, def: i.def }));

  const body: string[] = [];
  body.push(`// Converted from ${fact.className} (${fact.file}).`);
  body.push('// Props are reactive getters: read `props.x` live, never destructure them.');
  // Only the dependencies still UNANSWERED. Listing `Router` here as "make it a store" contradicted the
  // rewritten `routerNavigate(…)` three lines below it, and told the reader to do work already done.
  const unanswered: string[] = fact.injects.filter((dep) => !SERVICE_METHODS[dep]);
  if (unanswered.length) {
    body.push(`// TODO(weave migrate): this component injected ${unanswered.join(', ')} —`);
    body.push('// a singleton service becomes a `store()`, a scoped one `provide`/`inject` (see the plan).');
  }
  // `imports: [...]` says what the TEMPLATE was allowed to use. Weave has no such list — a file imports what it
  // uses — but reading past it silently left the reader wondering whether it had been considered at all.
  if (fact.declaredImports?.length) {
    body.push(`// Its \`imports: [${fact.declaredImports.join(', ')}]\` — Weave has no such list: the template's`);
    body.push('// tags are resolved by what THIS file imports, and Angular directives in there (RouterModule and');
    body.push("// friends) became Weave's own bindings in the template. Nothing to declare.");
  }
  // The class body is the bulk of a component — carried across member by member, never summarised away.
  const inputSet: Set<string> = new Set<string>(fact.inputs);
  const outputSet: Set<string> = new Set<string>(fact.outputs);
  const isProp = (mem: ClassMember): boolean => mem.kind === 'field' && (inputSet.has(mem.name) || outputSet.has(mem.name));
  const carried: ClassMember[] = (fact.members ?? []).filter((mem) => !isProp(mem));
  // An @Input/@Output field IS migrated — into the props type above — but its original declaration would then be
  // the one thing with no trace left, so it is shown here. Nothing from the class goes unaccounted for.
  const asProps: ClassMember[] = (fact.members ?? []).filter(isProp);
  if (asProps.length) {
    body.push('');
    body.push('// ── these became props (see the signature above) ──');
    for (const mem of asProps) for (const line of (mem.text ?? '').split('\n')) body.push(`// ${line}`);
  }
  const ctx: TranslateCtx = {
    ...translateCtx(fact.members ?? [], fact.inputs, 'props', opts.migrated),
    angularNames: angularImportedNames(fact.file),
    rename: localRenames(fact.members ?? [], carriedImportsFor(fact.file, opts.migrated)),
    returners: opts.returners,
  };
  // The shims the translated calls name. Without them the file calls functions that do not exist.
  const adapters: string[] = adaptersFor(fact.members ?? [], fact.inputs);
  if (adapters.length) {
    body.push('');
    body.push(...adapters);
  }
  body.push(...draftMembers(carried, fact.className, ctx).lines);

  // The host element. Its members were drafted above (a @HostBinding getter is a computed like any other); what
  // was missing was the other half — the template attribute that READS the computed. Without it the value was
  // correct and applied to nothing.
  const host: HostWiring = hostWiring(fact.members ?? [], fact.hostMeta ?? {}, ctx);
  if (host.setupLines.length) {
    body.push('');
    body.push('// `@HostListener` on window/document — a subscription, not a binding. It is scoped to the');
    body.push('// component: `onMount` returns the cleanup, which runs on dispose.');
    body.push(...host.setupLines);
  }
  for (const t of host.todos) body.push(tsTodo(t));

  // A reactive form becomes a `form({ … })` in setup(); the template binds its leaves with `use:control`.
  const imports: string[] = [];
  // Import exactly what the drafted body uses: fields become `signal`, getters become `computed`.
  // An INJECTED field becomes no signal — its calls were rewritten and the field itself is only a comment.
  // Counting it imported `signal` for a file that never calls it, which is a dead import in someone's lint.
  const runtimeNeeds: string[] = [
    ...new Set<string>([
      ...(carried.some((mem) => mem.kind === 'field' && !ctx.injected.has(mem.name)) ? ['signal'] : []),
      ...(carried.some((mem) => mem.kind === 'getter') ? ['computed'] : []),
      ...host.runtimeNeeds,
      // Reaching a scoped service that this migration converted is `inject(XContext)`.
      ...([...ctx.injected.values()].some((sv) => opts.migrated?.get(sv)?.kind === 'context') ? ['inject'] : []),
    ]),
  ];
  if (runtimeNeeds.length) imports.push(`import { ${runtimeNeeds.join(', ')} } from '@weave-framework/runtime';`);
  // A template that used Angular Material now names Weave UI components — which have to be imported to exist.
  imports.push(...uiImportsFor(templateHtml));
  // The translated body keeps calling what the original called — `size` from lodash, a type from a workspace lib
  // — so those imports travel with it. `@angular/*` is dropped: that is the framework being migrated away from,
  // and the plan says what each entry point becomes. Relative specifiers are repointed at the renamed outputs.
  imports.push(...carriedImportsFor(fact.file, opts.migrated));
  // A service call the translation replaced brings its own import (`Router.navigate` → `navigate`).
  imports.push(...serviceImportsFor(fact.members ?? [], fact.inputs));
  if (formFact) {
    imports.push("import { field, form } from '@weave-framework/forms';");
    body.push('');
    body.push(tsTodo(`this component built a reactive form (${formFact.primitives.join(', ')}).`));
    body.push('// Weave ships exactly seven validators — required, minLength, maxLength, pattern, email, min, max —');
    body.push("// each a factory you CALL, passed as the second, positional argument: `field('', [validators.email()])`.");
    body.push('const f = form({');
    for (const ctrl of formFact.controls) body.push(`  ${ctrl}: field(''), ${tsTodo('initial value + validators')}`);
    body.push('});');
    body.push('const submit = f.submit(async (values) => {');
    body.push(`  ${tsTodo('port the submit handler; submit() already validates and reveals errors')}`);
    body.push('});');
  }

  // `propDefaults` is Weave's own mechanism for exactly what `@Input() x = 'v'` expressed: a prop the parent may
  // omit, which then reads this value. Defaulted props also become optional for the parent, as they were.
  const defaultsBlock: string[] = defaults.length
    ? [
        `// The defaults your @Input()s declared. A prop the parent omits reads these; one it passes wins.`,
        'export const propDefaults = {',
        ...defaults.map((d) => `  ${d.name}: ${d.def},`),
        '};',
        '',
      ]
    : [];

  // The signatures follow the bodies, and they only meet here — a member that returned `Observable<T>` before
  // the chain rewrite returns a plain `T` or a `Promise<T>` after it, and the annotation has to say so.
  const typeTodos: string[] = [];
  const bodyTyped: string[] = [
    ...asyncifyAwaiters(stripAngularTypes(rewriteObservableTypes(body.join('\n'), []), angularImportedNames(fact.file), typeTodos)).split('\n'),
  ];
  bodyTyped.unshift(...typeTodos.map((t) => tsTodo(t)));

  // Everything AFTER the imports, assembled first: an import is dead only if nothing in the whole file uses it,
  // and `propDefaults` / the `setup` wrapper are part of the file too.
  const tail: string[] = [
    ...defaultsBlock,
    `export function setup(${usesProps ? `props: ${propsType}` : ''}) {`,
    // One entry per LINE: a drafted entry can be a whole multi-line block, and prefixing the ENTRY only indented
    // its first line, leaving the rest hanging outside the function's indentation. The split happens where the
    // body is assembled above, so what arrives here is already line-by-line.
    ...bodyTyped.map((l) => (l ? `  ${l}` : l)),
    '}',
    '',
  ];
  // Everything the class held that became a signal — the template has to call it now.
  const signals: string[] = [...ctx.fields, ...ctx.getters, ...ctx.signals];
  const html: string = convertTemplate(templateHtml, { ...opts, props: [...fact.inputs, ...fact.outputs], signals, host });

  // An import is dead only if NEITHER the module nor its template uses it — a `<Card>` import is named in the
  // markup and nowhere else, so pruning against the module alone would have deleted it.
  // Whatever the assembled draft NAMES, it imports — and the TEMPLATE is part of the draft. `x | translate`
  // becomes `t(x)`, which appears nowhere in the `.ts`, so deriving from that alone left the template calling a
  // name nothing brought into scope: the component threw `t is not defined` on its first render.
  imports.push(...weaveImportsFor(`${tail.join('\n')}\n${html}`));
  const kept: string[] = pruneRxImports(pruneImports(imports, `${tail.join('\n')}\n${html}`), tail.join('\n')).lines;
  const ts: string = [...(kept.length ? [...mergeImportLines(kept), ''] : []), ...tail].join('\n');
  return { baseName, ts, html };
}

/* ──────────── M5 — the hard parts, DRAFTED (never silently rewritten) ──────────── */

/** A TODO inside generated TypeScript (the `.ts` counterpart of `todo()`, which emits an HTML comment). */
export function tsTodo(what: string): string {
  return `// TODO(weave migrate): ${what}`;
}

/**
 * RxJS → Weave suggestions. Weave is signal-native, so most streams have a natural equivalent — but the rewrite
 * is a judgement call every time, so these are printed as guidance beside the drafted code, never applied.
 */
const RXJS_HINTS: Record<string, string> = {
  BehaviorSubject: 'a `signal(initial)` — it already holds a current value',
  ReplaySubject: 'a `signal` (plus history in an array if the replay really matters)',
  Subject: 'a plain callback prop or a `signal` — Weave has no multicast primitive',
  Observable: 'a `signal` for state, or a `resource` when it is an async fetch',
  combineLatest: 'a `computed(() => …)` over the source signals',
  forkJoin: '`Promise.all` inside a `resource`',
  map: 'a `computed(() => …)`',
  filter: 'a `computed` that returns the previous value (or a `watch` guard)',
  debounceTime: '`debounced(signal, ms)` from the runtime extras',
  distinctUntilChanged: 'nothing — a signal already skips equal values',
  switchMap: 'a `resource` keyed on the signal it switches over',
  mergeMap: 'a `resource` for an async call — but `mergeMap((xs) => xs)` over an array is just flattening: `xs.flat()`',
  // These four are stream operators, but in the overwhelmingly common case the "stream" is a finite collection or
  // a single async value — and then each is a plain JS one-liner. Say so: an accurate equivalent beats a shrug.
  concat: 'sequencing in order — over arrays that is `[...a, ...b]`, over async values `[...(await a), ...(await b)]`',
  distinct: 'de-duplication — `[...new Map(items.map((i) => [key(i), i])).values()]`',
  toArray: 'nothing — you already have the array; it only existed to undo a flatten',
  first: 'taking the single value — `await` the promise, or read the signal once',
  from: 'nothing — `await` a promise, or use the iterable directly',
  take: 'a `slice(0, n)` over the collection',
  startWith: "the signal's initial value",
  catchError: 'a `try`/`catch` around the await, or a `resource`\'s error branch',
  finalize: '`onDispose(() => …)`, or a `finally` block',
  // Flattening strategies — the difference between them is just how you write the loop.
  concatMap: 'sequential awaits — `for (const x of xs) await f(x)`',
  exhaustMap: 'a `busy` signal guard: ignore the call while one is already in flight',
  // Sharing/multicasting has no equivalent because a signal is ALREADY shared and cached.
  shareReplay: 'nothing — a `computed` is shared and caches its value by construction',
  share: 'nothing — a signal is already multicast to every reader',
  // Combining.
  withLatestFrom: 'nothing — just read the other signal inside the `computed`/`effect`',
  merge: 'over arrays `[...a, ...b]`; over events, point both at the same handler',
  zip: 'pairing up — `a.map((x, i) => [x, b[i]])`',
  race: '`Promise.race([...])`',
  iif: 'a plain ternary',
  // Time.
  delay: '`await new Promise((r) => setTimeout(r, ms))`',
  interval: '`setInterval` in `onMount`, cleared in `onDispose`',
  timer: '`setTimeout` in `onMount`, cleared in `onDispose`',
  throttleTime: 'Weave has `debounced(source, ms)` but no throttle — use it if debounce semantics fit, else guard on a timestamp yourself',
  auditTime: 'same as throttleTime — no built-in throttle; `debounced` if that fits, otherwise guard by hand',
  // Accumulating / windowing.
  scan: 'accumulate into a signal — `acc.set((prev) => f(prev, x))`',
  reduce: '`array.reduce(...)` — you already have the collection',
  pairwise: '`watch(source, (value, prev) => …)` — watch hands you the previous value',
  skip: '`slice(n)` over the collection, or a guard inside the effect',
  takeWhile: 'a loop with a condition, or a `computed` that stops updating',
  defaultIfEmpty: '`?? fallback`',
  // Lifecycle / plumbing that the owner scope handles for you.
  takeUntil: '`onDispose(() => …)` — the owner tears its computations down',
  Subscription: 'nothing to hold — `effect`/`watch` are disposed with their owner',
  fromEvent: '`on:event={{ … }}` in the template, or `addEventListener` in `onMount` + `onDispose`',
  lastValueFrom: 'just `await` the promise',
  throwError: 'a plain `throw`, or a rejected promise',
  retry: 'an explicit retry loop around the `await`',
  EMPTY: 'nothing — return `undefined` / an empty array',
  NEVER: 'nothing — a signal that simply never changes',
  pipe: 'plain function composition, or one `computed` that does the whole chain',
  asyncScheduler: '`queueMicrotask`/`setTimeout`; Weave batches updates itself (`batch`, `tick`)',
  // ── the rest of the RxJS surface. Most are array methods once the stream is a finite collection. ──
  // Creation.
  ajax: '`resource` (or plain `fetch`) from `@weave-framework/data`',
  defer: 'a function — build the value when it is called; a `computed` is already lazy',
  empty: 'nothing — return `undefined` / an empty array',
  range: '`Array.from({ length: n }, (_, i) => start + i)`',
  generate: 'a plain `for` loop building an array',
  bindCallback: 'wrap the callback in a `Promise` yourself, then `await` it',
  bindNodeCallback: 'the same — a `Promise` wrapper (or `node:util.promisify`)',
  fromEventPattern: '`addEventListener` in `onMount`, removed in `onDispose`',
  animationFrames: '`requestAnimationFrame` in `onMount`, cancelled in `onDispose`',
  AsyncSubject: 'a `Promise` — it emitted only the final value',
  partition: 'two filters: `[xs.filter(p), xs.filter((x) => !p(x))]`',
  // Transformation — the *To variants are the plain form with a constant.
  mapTo: 'a `computed(() => constant)`',
  concatMapTo: 'the same as concatMap with a constant target',
  mergeMapTo: 'the same as mergeMap with a constant target',
  switchMapTo: 'the same as switchMap with a constant target',
  pluck: 'a `computed(() => obj().a.b)` — just read the path',
  groupBy: '`Map` grouping — `xs.reduce((m, x) => m.set(k(x), [...(m.get(k(x)) ?? []), x]), new Map())`',
  expand: 'a recursive async function, awaited in a loop',
  mergeScan: '`scan` plus an await — accumulate into a signal across awaited calls',
  switchScan: 'the same, keeping only the latest — a `resource` keyed on the source',
  exhaust: 'a `busy` guard — ignore new work while one is in flight',
  concatAll: '`xs.flat()`, or sequential awaits when the items are async',
  mergeAll: '`xs.flat()`, or `Promise.all` when the items are async',
  exhaustAll: 'a `busy` guard around the flatten',
  combineLatestAll: 'a `computed` over the collected signals',
  // Buffering / windowing — genuinely time-based; the shape is "collect, then flush".
  buffer: 'collect into an array signal, and flush it when the trigger fires',
  bufferCount: 'collect into an array signal, flush when `length === n`',
  bufferTime: 'collect into an array signal, flush on a `setInterval`',
  bufferToggle: 'collect between two triggers — the same collect/flush by hand',
  bufferWhen: 'the same — collect, flush when the closing condition fires',
  window: 'the buffer patterns, but flushing sub-arrays instead of values',
  windowCount: 'chunking — `for (let i = 0; i < xs.length; i += n) xs.slice(i, i + n)`',
  windowTime: 'collect on a timer, like bufferTime',
  windowToggle: 'collect between triggers, like bufferToggle',
  windowWhen: 'collect until the closing condition, like bufferWhen',
  // Filtering — mostly array indexing.
  last: '`xs.at(-1)`',
  elementAt: '`xs[n]`',
  single: '`xs[0]` after asserting there is exactly one',
  skipLast: '`xs.slice(0, -n)`',
  takeLast: '`xs.slice(-n)`',
  ignoreElements: 'nothing — drop the value and keep the completion/await',
  distinctUntilKeyChanged: 'a `computed` compared by that key',
  debounce: '`debounced(source, ms)` — the ms variant covers the common case',
  throttle: 'no built-in throttle; `debounced` if that fits, otherwise guard by hand',
  audit: 'the same as throttle — guard by hand, or use `debounced`',
  sample: 'read the signal when the trigger fires — `watch(trigger, () => source())`',
  sampleTime: 'read the signal on a `setInterval`',
  skipUntil: 'a boolean signal guard — ignore values until it flips',
  skipWhile: 'the same guard, inverted',
  // Multicasting — all of these exist because Observables are cold. Signals are not.
  multicast: 'nothing — a signal is already shared by every reader',
  publish: 'nothing — same reason',
  publishBehavior: 'a `signal(initial)`',
  publishLast: 'a `Promise` for the final value',
  publishReplay: 'a `signal` (it already holds the current value)',
  connectable: 'nothing — no connect step exists; readers just read',
  // Errors + utility plumbing.
  retryWhen: 'an explicit retry loop with your own delay between attempts',
  delayWhen: '`await` whatever decides the delay, then continue',
  timeout: '`Promise.race([work, rejectAfter(ms)])`',
  timeoutWith: 'the same race, falling back to the other value',
  materialize: 'nothing — there are no notification objects to wrap',
  dematerialize: 'nothing — same reason',
  observeOn: 'nothing — Weave schedules its own updates (`batch`, `tick`)',
  subscribeOn: 'nothing — same reason',
  timeInterval: 'record `Date.now()` yourself in the `watch` callback',
  timestamp: 'the same — attach `Date.now()` where you need it',
  // Conditional + mathematical — plain array methods.
  every: '`xs.every(...)`',
  find: '`xs.find(...)`',
  findIndex: '`xs.findIndex(...)`',
  isEmpty: '`xs.length === 0`',
  sequenceEqual: 'compare the two arrays element by element',
  count: '`xs.length` (or `xs.filter(p).length`)',
  max: '`Math.max(...xs)`',
  min: '`Math.min(...xs)`',
  takeUntilDestroyed: '`onDispose(() => …)` — the owner scope handles teardown',
  subscribe: 'an `effect(() => …)`, or `watch` when you need the previous value',
  firstValueFrom: 'just `await` the promise',
  of: 'a plain value — no wrapper needed',
  tap: 'a plain statement inside the `computed`/`effect`',
};

/** Suggestions for the RxJS names a file actually uses. Unknown operators are named honestly, not invented. */
export function rxjsSuggestions(names: string[]): string[] {
  const out: string[] = [];
  for (const n of [...new Set(names)].sort()) {
    out.push(RXJS_HINTS[n] ? `\`${n}\` → ${RXJS_HINTS[n]}` : `\`${n}\` → no recorded equivalent; decide per use`);
  }
  return out;
}

/** The HTTP verbs a class body actually calls, so the guidance names them instead of listing all of them. */
function httpVerbsUsed(members: ClassMember[]): string[] {
  const body: string = members.map((m) => m.body ?? '').join('\n');
  return ['get', 'post', 'put', 'patch', 'delete', 'request'].filter((v) => new RegExp(`\\.${v}\\s*[<(]`).test(body));
}

/**
 * Guidance for a service that injected `HttpClient`. Angular returns an Observable per call; Weave splits the
 * two jobs — `resource` for reads (it tracks loading/error and refetches when its source changes) and `action`
 * for writes. `createClient` supplies the same base-URL/headers/interceptor layer `HttpClient` provided.
 */
function httpDraft(fact: ServiceFact): string[] {
  const verbs: string[] = httpVerbsUsed(fact.members ?? []);
  const reads: string[] = verbs.filter((v) => v === 'get' || v === 'request');
  const writes: string[] = verbs.filter((v) => v !== 'get' && v !== 'request');
  const out: string[] = [
    '',
    tsTodo('this service used HttpClient. In Weave that is `@weave-framework/data`:'),
    '//   `const client = createClient({ baseUrl: "/api" })` replaces the HttpClient + interceptors layer,',
    '//   and each call returns a PROMISE rather than an Observable — no `.subscribe()`, no `firstValueFrom`.',
  ];
  if (reads.length) {
    out.push(`//   reads (${reads.join(', ')}) → \`resource(() => client.get<T>(path))\`, which tracks loading/error`);
    out.push('//     and refetches when the signal it reads changes: `resource(() => id(), (v) => client.get(...))`.');
  }
  if (writes.length) {
    out.push(`//   writes (${writes.join(', ')}) → \`action(async (input) => client.${writes[0]}<T>(path, input))\`.`);
  }
  if (!verbs.length) out.push('//   no HTTP verb was called directly here — check what it passes through.');
  return out;
}

/** `BreadcrumbsPathService` → `useBreadcrumbsPath` (the store hook name Weave code reads). */
export function storeHookName(className: string): string {
  const base: string = className.replace(/Service$/, '').replace(/Store$/, '');
  return `use${base.charAt(0).toUpperCase()}${base.slice(1)}`;
}

/**
 * Draft EVERY member of a converted class — public and private, fields, methods, and the constructor.
 *
 * The rule this encodes: **a migration moves code and adapts it; it never discards it.** So each member keeps its
 * name and signature (mechanical) and carries its original body across, commented. Commented rather than live
 * because the body still says `this.` and names Angular types, and a draft that does not compile is a worse
 * starting point than one that does — but every line is THERE, in place, instead of in a file you have to open
 * alongside. Private members become plain locals: in a `store()` factory, "private" simply means "not returned".
 */
/* ──────────── translating a method body: `this.x` is a mechanical rename, not a judgement call ──────────── */

/** What the names inside a class body become, so `this.x` can be rewritten to the right thing. */
export interface TranslateCtx {
  /** `@Input` names → read as `props.x`. */
  inputs: Set<string>;
  /** Plain fields → signals, read as `x()` and written as `x.set(v)`. */
  fields: Set<string>;
  /** Getters → computeds, read as `x()`. */
  getters: Set<string>;
  /** Methods → plain functions, called as `x(…)`. */
  methods: Set<string>;
  /** Field name → the service it holds (`_Router` → `Router`). An injected service is NOT state: treating it as
   *  a signal turned `this._Router.navigate(…)` into `_Router().navigate(…)`, which is simply wrong. */
  injected: Map<string, string>;
  /** Fields that were ALREADY signals in Angular. The original code already calls them to read (`x()`) and
   *  writes with `x.set(v)`, so the name is renamed bare — adding a call would produce `x().set(v)`. */
  signals: Set<string>;
  /** What an input is read off. A component's is `props`; a directive becomes a `use:` action whose single
   *  argument carries them, so there it is `arg`. Defaults to `props`. */
  propsRef?: string;
  /** The name that IS the element, when there is one. A `use:` action is handed the element directly, which is
   *  exactly what `ElementRef` provided — so `this.el.nativeElement` is that name, not a property of it. */
  elementRef?: string;
  /** Members renamed because their name collided with something the file IMPORTS. A class field literally
   *  called `form` shadowed `form` from @weave-framework/forms, and every call through it broke. */
  rename?: Map<string, string>;
  /** Names this file imports from `@angular/*`. Those imports are DROPPED — the framework is what is being
   *  migrated away from — so anything still naming one of them cannot be emitted as live code. */
  angularNames?: Set<string>;
  /** Services THIS MIGRATION converted, by class name, and how the converted file exposes them. A call into one
   *  of these is not unknown — it is the thing being migrated alongside, so it must not be reported as having
   *  "no recorded Weave equivalent". */
  migrated?: Map<string, MigratedService>;
  /** Fields that held an RxJS Subject. They become signals, so `this.x.next(v)` is `x.set(v)` and `this.x.value`
   *  is `x()` — but a method body carries no declaration, so the names have to travel with the context. */
  subjects?: Set<string>;
  /** Every name in the UNIT declared to return an `Observable<…>`. Real chains start at a call, not at an
   *  `of(…)`, so without this map the fold gave up on the first operator of almost every real file. */
  returners?: Set<string>;
}

/** How a converted service is reached from another file. */
export interface MigratedService {
  /** `providedIn:'root'` → a `store()` hook (`useBreadcrumbs`); otherwise a context (`BreadcrumbsContext`). */
  kind: 'store' | 'context';
  /** The name the converted file exports. */
  name: string;
}

/** The services this migration converts, and what each becomes — the map `translateCtx` needs to stop guessing. */
export function migratedServices(services: ServiceFact[]): Map<string, MigratedService> {
  const out: Map<string, MigratedService> = new Map<string, MigratedService>();
  for (const s of services) {
    const singleton: boolean = s.providedIn === 'root' || s.providedIn === 'platform' || s.providedIn === 'any';
    out.set(
      s.className,
      singleton ? { kind: 'store', name: storeHookName(s.className) } : { kind: 'context', name: `${s.className.replace(/Service$/, '')}Context` },
    );
  }
  return out;
}

/**
 * A local shim the converted code needs, because the Angular API and its Weave counterpart do not have the same
 * SHAPE. Mapping them 1:1 anyway produced calls that read fine and did not compile — `Router.navigate` takes an
 * array of commands and returns a `Promise<boolean>`, while Weave's `navigate` takes a path and returns nothing.
 */
interface Adapter {
  lines: string[];
  /** By module, so a name the shim needs and a name a direct call needs merge into ONE import statement. */
  imports: Array<{ from: string; names: string[] }>;
}

const ADAPTERS: Record<string, Adapter> = {
  routerNavigate: {
    imports: [{ from: '@weave-framework/router', names: ['navigate', 'type NavigateOptions'] }],
    lines: [
      "// Angular's `Router.navigate` took an ARRAY of commands; Weave's `navigate` takes the path itself. That is",
      '// the whole difference — navigation is synchronous either way, so this returns nothing, and a `.then(…)`',
      '// that followed the call has been unwrapped into the statements after it.',
      'const routerNavigate = (commands: unknown, opts?: NavigateOptions): void => {',
      "  navigate(Array.isArray(commands) ? commands.join('/').replace(/\\/{2,}/g, '/') : String(commands ?? ''), opts);",
      '};',
    ],
  },
};

/** Angular services whose Weave replacement is a plain function, and where it comes from. */
const SERVICE_METHODS: Record<string, Record<string, { call: string; from: string; adapter?: string }>> = {
  Router: {
    // Only the COMMANDS form needs a shim. `navigateByUrl` already takes the path, so it is `navigate` outright —
    // wrapping it too would be machinery around nothing.
    navigate: { call: 'routerNavigate', from: '', adapter: 'routerNavigate' },
    navigateByUrl: { call: 'navigate', from: '@weave-framework/router' },
  },
  // The data client is emitted as a local `const client = createClient(…)`, so these need no import of their own.
  HttpClient: {
    get: { call: 'client.get', from: '' },
    post: { call: 'client.post', from: '' },
    put: { call: 'client.put', from: '' },
    patch: { call: 'client.patch', from: '' },
    delete: { call: 'client.delete', from: '' },
    request: { call: 'client.request', from: '' },
  },
};

/** Build the translation context from a class's members and its inputs. */
export function translateCtx(members: ClassMember[], inputs: string[], propsRef: string = 'props', migrated?: Map<string, MigratedService>): TranslateCtx {
  const inputSet: Set<string> = new Set<string>(inputs);
  // A field holding `inject(X)` is a dependency, not state — it must not be turned into a signal.
  const injected: Map<string, string> = new Map<string, string>();
  // A constructor PARAMETER-PROPERTY (`constructor(private http: HttpClient)`) is a field too — Angular's most
  // common injection form. Missing it left `this.http` unresolved, which the compile gate caught as an
  // undefined name in the generated file.
  // EVERY constructor parameter is a DI token — in Angular that is what a constructor is for. Both spellings
  // count: the parameter-property (`private http: HttpClient`) and the plain parameter the body assigns. Split on
  // top-level commas so a decorated or generic parameter (`@Inject(T) x: Map<string, number>`) stays one entry.
  const ctor: ClassMember | undefined = members.find((m) => m.kind === 'constructor');
  for (const p of splitTopLevel(ctor?.params ?? '')) {
    const m: RegExpMatchArray | null = p
      .trim()
      .replace(/^(?:@[A-Za-z_$][\w$]*\s*(?:\([^)]*\))?\s*)+/, '')
      .match(/^(?:(?:private|public|protected|readonly)\s+)*([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)/);
    if (m) injected.set(m[1], m[2]);
  }
  for (const m of members) {
    if (m.kind !== 'field') continue;
    // Only an explicit `inject(X)` marks a FIELD as a dependency. Treating "declared type starts uppercase, no
    // initializer" as injection swallowed ordinary state — `lastSeen: Date;` is not a service, and dropping it
    // meant a field vanished from the output with a note saying its calls had been rewritten. They had not.
    const call: RegExpMatchArray | null = (m.initializer ?? '').match(/^inject\s*(?:<[^>]*>)?\s*\(\s*([A-Za-z_$][\w$]*)/);
    if (call) injected.set(m.name, call[1]);
  }
  // A Subject field IS a signal once converted, so it belongs in `signals` rather than `fields`: the read is the
  // call the original already wrote (`x.value` → `x()`), and treating it as a plain field produced `x()().set(v)`.
  const subjects: Set<string> = new Set<string>(
    members.filter((m) => m.kind === 'field' && isSubjectField(m)).map((m) => m.name),
  );
  return {
    inputs: inputSet,
    fields: new Set<string>(members.filter((m) => m.kind === 'field' && !inputSet.has(m.name) && !injected.has(m.name) && !subjects.has(m.name)).map((m) => m.name)),
    getters: new Set<string>(members.filter((m) => m.kind === 'getter').map((m) => m.name)),
    methods: new Set<string>(members.filter((m) => m.kind === 'method').map((m) => m.name)),
    injected,
    signals: new Set<string>(members.filter((m) => m.kind === 'field' && (m.isSignal || subjects.has(m.name))).map((m) => m.name)),
    propsRef,
    migrated,
    subjects,
  };
}

/**
 * Drop `const x: T = x;` — a declaration whose initializer is the very name it declares.
 *
 * The source wrote `const _router: Router = this._router;`, a local alias for a field. Once `this._router`
 * became the bare `_router`, the alias declared a binding from itself: dead at best, and a shadow of the real
 * declaration at worst, since the field is now declared in the same scope.
 */
export function dropSelfDeclarations(code: string): string {
  return code
    .split('\n')
    // `\r` is in the trailing class on purpose: the source is read as-is, so on a CRLF file every line ends with
    // one and an anchored `$` after `[\t ]*` never matched — the statement survived on exactly the files it was
    // written for.
    .filter((line) => !/^[\t ]*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*\1\s*;?[\t \r]*$/.test(line))
    .join('\n');
}

/**
 * The stand-in for a dependency nothing provides.
 *
 * It used to be `null as unknown as Router` — but `Router` is Angular's, and `@angular` imports are DROPPED,
 * so the placeholder named a type the file no longer has. The original type is kept in a trailing comment
 * instead, where it informs without having to resolve.
 *
 * `any` and not `never`: the code around it READS this thing (`_router.url`), and every such read is an error
 * against `never` — a wall of type errors pointing at a hole the TODO above already names. `any` says the same
 * thing the TODO does, once.
 */
export function placeholderFor(type: string, ctx: TranslateCtx): string {
  const head: string = type.replace(/<[\s\S]*$/, '').trim();
  return ctx.angularNames?.has(head) || ANGULAR_OWN_TYPES.has(head) ? 'null as any' : `null as unknown as ${type}`;
}

/** Angular's own injectables, which a converted file never imports even when the source did not name them. */
const ANGULAR_OWN_TYPES: Set<string> = new Set<string>(['Router', 'ActivatedRoute', 'ActivatedRouteSnapshot', 'Injector', 'ElementRef', 'Renderer2', 'ChangeDetectorRef', 'NgZone', 'HttpClient', 'DOCUMENT', 'ViewContainerRef', 'TemplateRef']);

/**
 * Whether anything in the class reads the injected field ITSELF rather than calling a method Weave replaces.
 *
 * `this._router.navigate(…)` is rewritten, so the field can go. `const r: Router = this._router` and
 * `this._router.routerState.snapshot` are not — they need the thing, and dropping its declaration left the draft
 * naming a binding that was never there.
 */
export function readsBareInjected(members: ClassMember[], name: string, service: string): boolean {
  const rewritten: string[] = Object.keys(SERVICE_METHODS[service] ?? {});
  const body: string = members.map((m) => `${m.body ?? ''}\n${m.initializer ?? ''}`).join('\n');
  const uses: RegExp = new RegExp(`this\\.${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])\\s*(?:\\.\\s*([A-Za-z_$][\\w$]*)\\s*(\\()?)?`, 'g');
  for (const m of body.matchAll(uses)) {
    const method: string | undefined = m[1];
    const called: boolean = Boolean(m[2]);
    if (!method || !called || !rewritten.includes(method)) return true;
  }
  return false;
}

/**
 * The dependencies a draft declares as a HOLE — `const x = null as any`, because nothing in Weave provides them.
 *
 * Every branch of `draftMembers` that emits `placeholderFor(…)` is mirrored here, and nothing else is: the set has
 * to be known BEFORE the members are walked (the constructor can come first in the source), so it cannot be
 * collected while emitting.
 */
export function deadPlaceholders(members: ClassMember[], cx: TranslateCtx): Set<string> {
  const dead: Set<string> = new Set<string>();
  const fieldNames: Set<string> = new Set<string>(members.filter((m) => m.kind === 'field').map((m) => m.name));
  for (const [name, service] of cx.injected) {
    if (fieldNames.has(name) || SERVICE_METHODS[service]) continue;
    if (service === 'ElementRef' && cx.elementRef) continue;
    if (!cx.migrated?.get(service)) dead.add(name);
  }
  for (const mem of members) {
    if (mem.kind !== 'field') continue;
    const service: string | undefined = cx.injected.get(mem.name);
    if (!service || cx.migrated?.get(service)) continue;
    if (SERVICE_METHODS[service] && !readsBareInjected(members, mem.name, service)) continue;
    dead.add(mem.name);
  }
  return dead;
}

/** Which of `names` the code actually READS — comments and string literals do not count. */
export function namesRead(code: string, names: Set<string>): string[] {
  let scan: string = '';
  outsideStrings(code, (part: string): string => {
    scan += part.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    return part;
  });
  return [...names].filter((n: string) => new RegExp(`(?<![\\w$.])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`).test(scan));
}

/**
 * Angular types that survived into a SIGNATURE, replaced by `unknown` and reported.
 *
 * `@angular` imports are dropped — that is the framework being migrated away from — so a drafted signature
 * naming `ActivatedRouteSnapshot` names nothing. The value side of this was already handled; the type side was
 * not, and a type error in a generated signature reads as though the conversion misunderstood the code, when
 * really it was carrying a name it had already decided not to import.
 *
 * `any` and not `unknown`, for the same reason the value placeholder is `any`: `unknown` turns one clear message
 * into an error at every single use of the parameter, all of them pointing back at the hole the TODO above
 * already names. Once is enough.
 */
export function stripAngularTypes(code: string, angularNames: Iterable<string>, todos: string[]): string {
  let out: string = code;
  for (const name of new Set<string>([...angularNames, ...ANGULAR_OWN_TYPES])) {
    const r: { code: string; hits: number } = replaceTypeName(out, name, 'any');
    if (!r.hits) continue;
    out = r.code;
    todos.push(`\`${name}\` was Angular's, so it is not imported here — the ${r.hits === 1 ? 'signature that named it now says' : `${r.hits} signatures that named it now say`} \`any\`; give ${r.hits === 1 ? 'it' : 'them'} the shape your Weave code passes`);
  }
  return out;
}

/**
 * Angular's signal API, in Weave's spelling.
 *
 * Most of it needs nothing: a Weave `Signal` already has `set`, `update` and `peek`, and `set` already accepts
 * an updater. `asReadonly` is the one that does not exist — and its equivalent is exact rather than a judgement
 * call, because `Computed<T>` is `() => T`: a value that can be read and not written, which is the entire
 * purpose of the call being replaced. Left alone it became `x.asReadonly is not a function` at runtime, on a
 * line the type-check had already passed.
 */
export function angularSignalApi(code: string): string {
  return outsideStrings(code, (part) =>
    part.replace(/(?<![\w$])((?:[A-Za-z_$][\w$]*)(?:\.[A-Za-z_$][\w$]*)*)\.asReadonly\s*\(\s*\)/g, (_m, receiver: string) => `computed(() => ${receiver}())`),
  );
}

/**
 * Whether an initializer evaluates to a FUNCTION — an arrow, a function expression, or a bound method.
 *
 * A class field holding one of these is a method written as a field; Angular code does it constantly to keep
 * `this`. It is behaviour, and behaviour is not state, so it must not become a signal.
 */
export function isFunctionValue(init: string): boolean {
  const t: string = init.trim();
  if (/^(?:async\s+)?function\b/.test(t)) return true;
  if (/\.bind\s*\(\s*this\s*\)\s*$/.test(t)) return true;
  // An arrow: a parameter list (or a single name) followed by `=>` at the top level of the expression.
  return /^(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]*)?=>/.test(t);
}

/** A field holding some flavour of RxJS Subject — by its initializer or, when it has none, by its declared type. */
export function isSubjectField(mem: ClassMember): boolean {
  return /new\s+(?:Behavior|Replay|Async)?Subject\s*[<(]/.test(mem.initializer ?? '') || /^(?:Behavior|Replay|Async)?Subject\s*</.test((mem.type ?? '').trim());
}

/**
 * The end of the statement starting at `from`: the first `;` or newline at bracket depth 0, skipping strings.
 * A regex cannot do this — `[^;\n]+` stops at the first string literal once the text has been split on quotes,
 * which is how `this.label = on ? 'a' : 'b'` became `label.set(on ?)'a' : 'b'`.
 */
function statementEnd(code: string, from: number): number {
  let depth: number = 0;
  let quote: string = '';
  for (let i: number = from; i < code.length; i++) {
    const ch: string = code[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) {
      if (depth === 0) return i; // the enclosing block closed — the statement ended with it
      depth--;
    } else if (depth === 0 && (ch === ';' || ch === '\n')) return i;
  }
  return code.length;
}

/**
 * `this.<field> = <expr>` → `<field>.set(<expr>)`, scanning the WHOLE expression rather than matching it. The
 * right-hand side can hold anything — a ternary over two string literals, an object, a call — and it has to
 * arrive inside `.set(…)` intact.
 */
function rewriteFieldWrites(code: string, ctx: TranslateCtx, paramNames: Set<string>, todos: string[]): string {
  let out: string = '';
  let i: number = 0;
  let quote: string = '';
  while (i < code.length) {
    const ch: string = code[i];
    if (quote) {
      out += ch;
      if (ch === '\\') out += code[++i] ?? '';
      else if (ch === quote) quote = '';
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    // `=` but not `==`, `===`, `=>`, `>=`, `!=` — an assignment, not a comparison.
    const m: RegExpExecArray | null = /^this\.([A-Za-z_$][\w$]*)\s*(?<![!<>=])=(?![=>])\s*/.exec(code.slice(i));
    if (m && ctx.fields.has(m[1]) && !/[\w$.]/.test(code[i - 1] ?? '')) {
      const start: number = i + m[0].length;
      const end: number = statementEnd(code, start);
      if (paramNames.has(m[1])) todos.push(`\`${m[1]}\` is both a parameter and a signal here — rename one before this compiles`);
      out += `${ctx.rename?.get(m[1]) ?? m[1]}.set(${code.slice(start, end).trim()})`;
      i = end;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** The index of the `)` closing the `(` at `open`, skipping strings. -1 when it never closes. */
function matchParen(code: string, open: number): number {
  let depth: number = 0;
  let quote: string = '';
  for (let i: number = open; i < code.length; i++) {
    const ch: string = code[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }
  return -1;
}

/** A `.then` callback as the statements that follow the call. Null when its shape is not one to unwrap blindly. */
function inlineThenCallback(cb: string, todos: string[]): string | null {
  const arrow: RegExpMatchArray | null = cb.match(/^\(\s*([A-Za-z_$][\w$]*)?\s*(?::[^)]*)?\s*\)\s*=>\s*([\s\S]*)$/);
  if (!arrow) return null;
  const param: string | undefined = arrow[1];
  const rest: string = arrow[2].trim();
  const bodyText: string = rest.startsWith('{') ? dedent(rest.replace(/^\{/, '').replace(/\}$/, '')) : `${rest};`;
  if (!param) return bodyText.trim();
  // Angular's promise resolved TRUE on success and FALSE when a guard cancelled. Weave's navigate does not
  // report the cancellation, so the parameter is bound to what the success path saw — and says the rest.
  todos.push(`\`${param}\` was Angular's navigation result — false when a guard cancelled. Weave does not report that, so it is bound to true here`);
  return [`const ${param} = true;`, bodyText.trim()].join('\n');
}

/** Strip the smallest common indentation from a block of lines. */
function dedent(text: string): string {
  const lines: string[] = text.split('\n').filter((l, i, all) => !(l.trim() === '' && (i === 0 || i === all.length - 1)));
  const pad: number = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^[\t ]*/)?.[0].length ?? 0), Infinity);
  return lines.map((l) => l.slice(Number.isFinite(pad) ? pad : 0)).join('\n');
}

/**
 * `navigate(x).then(cb)` → `navigate(x);` followed by the callback's statements.
 *
 * Angular's navigation returned a promise; Weave's is synchronous and returns nothing. Keeping the chain meant
 * calling `.then` on `void`, and faking a promise to keep it meant wrapping a plain function call in machinery
 * that does nothing — a `Promise<boolean>` that is always `true` is not a promise, it is a disguise. Unwrapping
 * is what the code MEANS: the callback ran after the navigation, and after the navigation is the next statement.
 */
export function unwrapSyncThen(code: string, names: string[], todos: string[]): string {
  let out: string = code;
  for (const name of names) {
    for (let guard: number = 0; guard < 50; guard++) {
      const re: RegExp = new RegExp(`\\b${name}\\s*\\(`, 'g');
      let m: RegExpExecArray | null = null;
      let done: boolean = true;
      while ((m = re.exec(out)) !== null) {
        const open: number = m.index + m[0].length - 1;
        const close: number = matchParen(out, open);
        if (close < 0) break;
        const chain: RegExpMatchArray | null = out.slice(close + 1).match(/^\s*\.(then|catch|finally)\s*\(/);
        if (!chain) continue;
        if (chain[1] !== 'then') {
          todos.push(`\`.${chain[1]}()\` after a navigation — Weave's \`navigate\` is synchronous and cannot reject, so this handler has nothing to attach to`);
          continue;
        }
        // Only a statement-position call unwraps. `return navigate(x).then(…)` means something else, and
        // rewriting it to `return navigate(x);` would quietly drop the callback.
        // Line comments are carried over from the original body, so they sit between the previous statement and
        // this one. Testing the raw text made a commented line look like an expression the call belongs to.
        const before: string = out.slice(0, m.index).replace(/\/\/[^\n]*/g, '');
        if (!/(^|[;{}])\s*$/.test(before)) {
          todos.push(`a navigation's \`.then()\` is used as a VALUE here — Weave's \`navigate\` returns nothing, so this needs a decision`);
          continue;
        }
        const cbOpen: number = close + 1 + chain[0].length - 1;
        const cbClose: number = matchParen(out, cbOpen);
        if (cbClose < 0) break;
        const inlined: string | null = inlineThenCallback(out.slice(cbOpen + 1, cbClose).trim(), todos);
        if (inlined === null) {
          todos.push("this navigation's `.then()` callback is not a plain arrow — unwrap it by hand; `navigate` is synchronous");
          continue;
        }
        // The unwrapped statements take the indentation of the call they follow, or they read as if they belong
        // to a different block than the one they are actually in.
        const pad: string = out.slice(0, m.index).match(/[^\n]*$/)?.[0].match(/^[\t ]*/)?.[0] ?? '';
        const placed: string = inlined ? `\n${inlined.split('\n').map((l) => (l ? `${pad}${l}` : l)).join('\n')}` : '';
        out = `${out.slice(0, close + 1)};${placed}${out.slice(cbClose + 1).replace(/^\s*;/, '')}`;
        done = false;
        break;
      }
      if (done) break;
    }
  }
  return out;
}

/**
 * `router.events.pipe(filter(e => e instanceof NavigationEnd), takeUntilDestroyed()).subscribe(cb)`
 *   → `onDispose(afterEach(cb));`
 *
 * Weave's `afterEach` runs after every completed navigation and returns its own unsubscribe, so the two
 * operators in that chain are not dropped — they are what `afterEach` already IS: the `filter` is inherent
 * (it only fires on completion) and `takeUntilDestroyed` is the returned unsubscribe handed to `onDispose`.
 * Any other event type, any other operator, and the callback's parameter are reported instead of assumed.
 */
export function rewriteRouterEvents(code: string, ctx: TranslateCtx, todos: string[]): string {
  let out: string = code;
  for (let guard: number = 0; guard < 20; guard++) {
    const re: RegExp = /\bthis\.([A-Za-z_$][\w$]*)\.events\b/g;
    let m: RegExpExecArray | null = null;
    let changed: boolean = false;
    while ((m = re.exec(out)) !== null) {
      if (ctx.injected.get(m[1]) !== 'Router') continue;
      let i: number = m.index + m[0].length;
      let pipeArgs: string = '';
      const pipe: RegExpMatchArray | null = out.slice(i).match(/^\s*\.pipe\s*\(/);
      if (pipe) {
        const open: number = i + pipe[0].length - 1;
        const close: number = matchParen(out, open);
        if (close < 0) break;
        pipeArgs = out.slice(open + 1, close);
        i = close + 1;
      }
      const sub: RegExpMatchArray | null = out.slice(i).match(/^\s*\.subscribe\s*\(/);
      if (!sub) {
        todos.push("`Router.events` is a stream Weave has no counterpart for — its navigation hook is `afterEach(nav => …)`, which runs after every completed navigation");
        continue;
      }
      const sOpen: number = i + sub[0].length - 1;
      const sClose: number = matchParen(out, sOpen);
      if (sClose < 0) break;
      const cb: string = out.slice(sOpen + 1, sClose).trim();

      const evt: RegExpMatchArray | null = pipeArgs.match(/instanceof\s+(Navigation[A-Za-z]*)/);
      if (evt && evt[1] !== 'NavigationEnd') {
        todos.push(`this subscribed to \`${evt[1]}\`, and Weave's \`afterEach\` only runs after a navigation COMPLETES — a start/cancel/error hook has no equivalent`);
        continue;
      }
      // Everything the chain did beyond "after a completed navigation" has to be accounted for out loud.
      const leftover: string[] = splitTopLevel(pipeArgs)
        .map((op) => op.trim().replace(/\s*\([\s\S]*$/, ''))
        .filter((op) => op && op !== 'filter' && op !== 'takeUntilDestroyed' && op !== 'takeUntil');
      if (leftover.length) todos.push(`the navigation subscription also used ${leftover.join(', ')} — \`afterEach\` has no operators, so fold those into the callback`);
      if (/^\(\s*[A-Za-z_$]/.test(cb)) todos.push("the navigation callback took the EVENT; `afterEach` hands it a `nav` ({ to, from }) instead — check what the body reads off it");

      out = `${out.slice(0, m.index)}onDispose(afterEach(${cb}))${out.slice(sClose + 1)}`;
      changed = true;
      break;
    }
    if (!changed) break;
  }
  return out;
}

/** Run `fn` over the code parts of a snippet, never over its string literals. */
function outsideStrings(code: string, fn: (part: string) => string): string {
  return code
    .split(/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g)
    .map((part, i) => (i % 2 === 1 ? part : fn(part)))
    .join('');
}

/**
 * Translate a class body into its Weave form.
 *
 * `this.x` is not a judgement call — it is a rename with a known target: an `@Input` becomes `props.x`, a field
 * becomes the signal `x()`, a getter becomes the computed `x()`, and a method is called as `x(…)`. Leaving these
 * as commented-out originals, as this used to, produced a migration that renamed things and translated nothing:
 * `get hasRoute() { return size(this.routerLink) > 0 }` came out as `computed(() => undefined)`, which is not
 * incomplete but WRONG — it silently changed what the code does.
 *
 * Anything genuinely uncertain is still reported: an assignment whose target collides with a parameter name, and
 * any `this.` that could not be resolved, both come back as TODOs rather than a confident rewrite.
 */
export function translateBody(body: string, ctx: TranslateCtx, params: string = ''): { code: string; todos: string[] } {
  const todos: string[] = [];
  const paramNames: Set<string> = new Set<string>(
    params
      .split(',')
      .map((p) => p.trim().replace(/^(?:private|public|protected|readonly)\s+/, '').split(/[:=?]/)[0].trim())
      .filter(Boolean),
  );

  // The router-events chain FIRST: it reads `this._Router` without calling it, so the general rename below
  // would turn it into a bare name and the shape would no longer be recognisable.
  let code: string = rewriteRouterEvents(body, ctx, todos);

  // Subjects SECOND, while `this.` is still on them: `this.open.next(v)` is a write to what is now a signal, and
  // once the renames below have run there is no longer a Subject-shaped thing to recognise.
  code = translateSubjects(code, todos, ctx.subjects ?? []);

  code = outsideStrings(code, (part) =>
    part
      // `this.<ElementRef>.nativeElement` IS the element. An action is handed it directly, which is the whole
      // reason Angular needed `ElementRef` — leaving `.nativeElement` on it referenced a property that is gone.
      .replace(/\bthis\.([A-Za-z_$][\w$]*)\.nativeElement\b/g, (full, field: string) =>
        ctx.elementRef && ctx.injected.get(field) === 'ElementRef' ? ctx.elementRef : full,
      )
      // `this.<injected>.<method>(` → the Weave function that replaces it (`this._Router.navigate(` → `navigate(`).
      // The generic argument list is optional but must be matched: `this.http.get<T>(…)` is the usual form, and
      // skipping it sent the call down the plain-read path, leaving an undefined `http`.
      .replace(/\bthis\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*(<[^()]*>)?\s*\(/g, (full, field: string, method: string, generic: string | undefined) => {
        const service: string | undefined = ctx.injected.get(field);
        if (!service) return full;
        const mapped: { call: string; from: string } | undefined = SERVICE_METHODS[service]?.[method];
        if (mapped) return `${mapped.call}${generic ?? ''}(`;
        // A service THIS migration is converting is not unknown. Telling the reader "migrate it first" about a
        // class being migrated in the same run asked for work already happening, about a call already correct.
        if (ctx.migrated?.has(service)) return `${field}.${method}${generic ?? ''}(`;
        todos.push(`\`${service}.${method}()\` has no recorded Weave equivalent — migrate ${service} first, then call it here`);
        return `${field}.${method}${generic ?? ''}(`;
      }),
  );

  // The service calls are rewritten by now, so the promise chains that hung off them can be unwound: Weave's
  // navigation is synchronous, and "after the navigation" is simply the next statement.
  code = unwrapSyncThen(code, ['routerNavigate', 'navigate'], todos);

  // A field write is scanned, not matched — its right-hand side may contain string literals, which the
  // split-on-quotes pass above cannot see across.
  code = rewriteFieldWrites(code, ctx, paramNames, todos);

  code = outsideStrings(code, (part) =>
    part
      // `this.method(` → `method(`
      .replace(/\bthis\.([A-Za-z_$][\w$]*)\s*\(/g, (full, name: string) => (ctx.methods.has(name) ? `${ctx.rename?.get(name) ?? name}(` : full))
      // remaining reads
      .replace(/\bthis\.([A-Za-z_$][\w$]*)/g, (full, name: string) => {
        if (ctx.inputs.has(name)) return `${ctx.propsRef ?? 'props'}.${name}`;
        const local: string = ctx.rename?.get(name) ?? name;
        if (ctx.signals.has(name) || ctx.injected.has(name)) return local; // already a signal, or a dependency
        if (ctx.getters.has(name) || ctx.fields.has(name)) return `${local}()`;
        return full; // unresolved — reported below
      }),
  );

  // Angular's signal API that Weave spells differently. `update` and `peek` exist on a Weave signal already, so
  // they need nothing; `asReadonly` does not, and its exact equivalent is a `computed` over the same signal —
  // `Computed<T>` IS `() => T`, a value that can be read and not written, which is the whole point of the call.
  code = angularSignalApi(code);

  const leftovers: string[] = [...new Set((code.match(/\bthis\.[A-Za-z_$][\w$]*/g) ?? []).map((m) => m.slice(5)))];
  for (const name of leftovers) todos.push(`\`this.${name}\` has no counterpart here — it was not a field, input, getter or method of this class`);
  if (leftovers.length) code = outsideStrings(code, (p) => p.replace(/\bthis\./g, ''));

  // `const x: T = this.x;` translated to `const x: T = x;` — the field it copied is now the very name being
  // declared, so the statement declares a binding from itself: dead at best, a shadow of the real declaration at
  // worst. It carried no information in the original either; it was an alias for `this.`.
  code = dropSelfDeclarations(code);

  // RxJS LAST, when the receivers are the Weave names: Weave has no stream primitive, so a body that still holds
  // a `.pipe(…)` has not been migrated. An operator with no equivalent stops its own chain and says so; it does
  // not stop the rest of the body.
  const rx: { code: string; todos: string[] } = rxAfterSubjects(code, ctx.returners);
  code = rx.code;
  todos.push(...rx.todos);
  return { code, todos };
}

/**
 * Drop carried imports nothing in the draft uses any more. A translated body no longer calls what it replaced —
 * the RxJS chain that became `afterEach` left `import { filter } from 'rxjs/operators'` behind, an import of a
 * package the target app has no reason to depend on, for a name that is gone.
 */
export function pruneImports(lines: string[], body: string): string[] {
  // Comments do not USE anything. The original body travels beside every rewrite as a comment, so a name that
  // only survives there — `filter`, from the RxJS chain that became `afterEach` — kept its import alive.
  const code: string = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  return lines.filter((line) => {
    const named: RegExpMatchArray | null = line.match(/^import\s*(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from/);
    if (!named) return true; // a side-effect import — it is there for what it DOES, not for a name
    const names: string[] = [named[1] ?? '', ...(named[2] ?? '').split(',')]
      .map((n) => n.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim() ?? '')
      .filter(Boolean);
    if (!names.length) return true;
    return names.some((n) => new RegExp(`(?<![\\w$])${n}(?![\\w$])`).test(code));
  });
}

/**
 * Fold import lines that name the same module into one. The pieces of a draft each ask for what they need
 * without knowing what the others asked for, so `signal` and `onDispose` arrived as two separate lines from
 * `@weave-framework/runtime`. Only plain named imports are merged; anything else is passed through untouched.
 */
export function mergeImportLines(lines: string[]): string[] {
  const named: Map<string, Set<string>> = new Map<string, Set<string>>();
  const order: string[] = [];
  const other: string[] = [];
  for (const line of lines) {
    const m: RegExpMatchArray | null = line.match(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';$/);
    if (!m) {
      if (!other.includes(line)) other.push(line);
      continue;
    }
    if (!named.has(m[2])) {
      named.set(m[2], new Set<string>());
      order.push(m[2]);
    }
    for (const n of m[1].split(',').map((s) => s.trim()).filter(Boolean)) named.get(m[2])?.add(n);
  }
  return [...order.map((from) => `import { ${[...(named.get(from) ?? [])].sort().join(', ')} } from '${from}';`), ...other];
}

/** The imports for the Weave functions that replaced injected-service calls in a class's bodies. */
export function serviceImportsFor(members: ClassMember[], inputs: string[]): string[] {
  const ctx: TranslateCtx = translateCtx(members, inputs);
  // Names collected PER MODULE, not as finished import lines: a shim and a direct call can both need something
  // from `@weave-framework/router`, and two `import … from '…/router'` lines is a duplicate-identifier error.
  const needed: Map<string, Set<string>> = new Map<string, Set<string>>();
  const add = (from: string, name: string): void => {
    if (!needed.has(from)) needed.set(from, new Set<string>());
    needed.get(from)?.add(name);
  };
  for (const { mapped } of servicesUsedBy(members, ctx)) {
    // An adapter brings its OWN imports — the call site names the adapter, not the Weave function.
    for (const imp of ADAPTERS[mapped.adapter ?? '']?.imports ?? []) for (const n of imp.names) add(imp.from, n);
    if (!mapped.from) continue; // replaced by something already in scope (the local data client)
    add(mapped.from, mapped.call);
  }
  // `Router.events` is a PROPERTY, not a call, so the loop above cannot see it — and the code it turns into
  // names two functions that would otherwise be undefined.
  const bodies: string = members.map((m) => m.body ?? '').join('\n');
  for (const [field, service] of ctx.injected) {
    if (service !== 'Router' || !new RegExp(`\\bthis\\.${field}\\.events\\b`).test(bodies)) continue;
    add('@weave-framework/router', 'afterEach');
    add('@weave-framework/runtime', 'onDispose');
  }
  return [...needed.entries()].map(([from, names]) => `import { ${[...names].sort().join(', ')} } from '${from}';`);
}

/** Every mapped service method a class's bodies actually call. */
function servicesUsedBy(members: ClassMember[], ctx: TranslateCtx): Array<{ mapped: { call: string; from: string; adapter?: string } }> {
  const bodies: string = members.map((m) => `${m.body ?? ''}\n${m.initializer ?? ''}`).join('\n');
  const out: Array<{ mapped: { call: string; from: string; adapter?: string } }> = [];
  for (const [field, service] of ctx.injected) {
    for (const [method, mapped] of Object.entries(SERVICE_METHODS[service] ?? {})) {
      if (new RegExp(`\\bthis\\.${field}\\.${method}\\s*(<[^()]*>)?\\s*\\(`).test(bodies)) out.push({ mapped });
    }
  }
  return out;
}

/**
 * The local shims the converted bodies call. Emitted into the same scope as the translated code — the call sites
 * name them, so without these the file references functions that do not exist.
 */
export function adaptersFor(members: ClassMember[], inputs: string[]): string[] {
  const ctx: TranslateCtx = translateCtx(members, inputs);
  const names: string[] = [...new Set(servicesUsedBy(members, ctx).map((s) => s.mapped.adapter).filter((n): n is string => Boolean(n)))];
  return names.flatMap((n) => ADAPTERS[n]?.lines ?? []);
}

/**
 * A field becomes a signal — holding what it HELD. `signal<unknown>(undefined)` threw away both facts the
 * declaration stated: `@Input`s had this fixed already, plain fields had not, so `count = 0` started life as
 * `undefined` and every read of it was wrong from the first frame.
 */
export function signalDecl(mem: ClassMember, ctx: TranslateCtx): { code: string; todos: string[] } {
  const init: string = (mem.initializer ?? '').trim();
  // A field that was ALREADY an Angular signal is already the right call — `signal(0)` reads the same in Weave.
  // Wrapping it would produce `signal<T>(signal(0))`, a signal of a signal. This comes FIRST: `signal` is an
  // `@angular/core` import, so the check below would otherwise throw away a value that translates one-to-one.
  if (mem.isSignal && init) {
    const t: { code: string; todos: string[] } = translateBody(init, ctx);
    return { code: t.code.trim(), todos: t.todos };
  }
  // A field whose value is a FUNCTION is behaviour, not state. Wrapping it made `showLink` a signal, and the
  // template's `showLink(crumb, $last)` then called the SIGNAL — which ignores arguments and hands back the
  // function itself, so every comparison against its result silently failed and the block rendered nothing.
  // Nothing about that is visible in a type error at the call site, which is why it survived to the browser.
  if (init && isFunctionValue(init)) {
    const t: { code: string; todos: string[] } = translateBody(init, ctx);
    return { code: t.code.trim(), todos: t.todos };
  }
  // A Subject IS the signal once converted, for the same reason: `new BehaviorSubject<T>(x)` becomes `signal<T>(x)`,
  // and the generic wrap below would have produced `signal<BehaviorSubject<T>>(signal<T>(x))` — a signal holding
  // a signal, typed as the very class that does not exist in Weave.
  if (isSubjectField(mem)) {
    const todos: string[] = [];
    const code: string = translateSubjects(init || `new Subject<${mem.type?.replace(/^(?:Behavior|Replay|Async)?Subject\s*<([\s\S]*)>$/, '$1') ?? 'unknown'}>()`, todos);
    return { code: code.trim(), todos };
  }
  // An initializer that CONSTRUCTS something Angular cannot be carried as live code: `@angular/*` imports are
  // dropped (that is the framework being migrated away from), so `signal(new FormGroup({…}))` named a class
  // that is not there. The value cannot survive; the declaration and its type can.
  const angular: string[] = [...(ctx.angularNames ?? [])].filter((n) => new RegExp(`(?<![\\w$])${n}(?![\\w$])`).test(init));
  if (angular.length) {
    return {
      code: `signal<${mem.type || 'unknown'} | undefined>(undefined)`,
      todos: [`\`${mem.name}\` was built from ${angular.join(', ')}, which is Angular's and does not come across — give it its Weave value here`],
    };
  }
  if (init) {
    const t: { code: string; todos: string[] } = translateBody(init, ctx);
    const value: string = t.code.trim();
    // A translated initializer that ALREADY evaluates to a signal must not be wrapped in another one. The
    // `isSignal` check above reads the SOURCE, so it misses anything the translation turned into a signal on the
    // way — `this.count.asReadonly()` becomes `computed(() => count())`, and wrapping that produced
    // `signal(computed(…))`: a signal holding a function, and a template that renders it never reads a value.
    if (/^(?:signal|computed|linkedSignal)\s*[(<]/.test(value)) return { code: value, todos: t.todos };
    return { code: `signal${mem.type ? `<${mem.type}>` : ''}(${value})`, todos: t.todos };
  }
  // No initial value: it started `undefined`, and the declared type says what it will hold once set.
  return { code: `signal<${mem.type ? `${mem.type} | undefined` : 'unknown'}>(undefined)`, todos: [] };
}

/** A getter is a derived value: `computed(() => …)`. A single `return x;` collapses to the expression form. */
export function getterToComputed(body: string, ctx: TranslateCtx): { code: string; todos: string[] } {
  const t: { code: string; todos: string[] } = translateBody(body, ctx);
  const single: RegExpMatchArray | null = t.code.trim().match(/^return\s+([\s\S]+?);?$/);
  const inner: string = single && !/\breturn\b/.test(single[1]) ? single[1].trim() : `{\n${indent(t.code)}\n}`;
  return { code: `computed(() => ${inner})`, todos: t.todos };
}

/**
 * The return-type annotation for a drafted function. `: void` was written on every one of them, which turned a
 * method ending in `return false;` into a type error — the source said what it returned, or said nothing and let
 * TypeScript work it out, and neither of those is `void`.
 */
export function returnAnnotation(mem: ClassMember, code: string): string {
  if (mem.type) return `: ${mem.type}`; // the source declared it — carry it
  // No annotation in the source. If the body returns a VALUE, let TypeScript infer it, exactly as Angular did;
  // annotating would be inventing a type the source never stated.
  return /\breturn\s+[^;\s]/.test(code) ? '' : ': void';
}

/** Angular lifecycle hooks that have a direct Weave equivalent. Named, so they don't read as ordinary methods. */
const LIFECYCLE_HOOKS: Record<string, string> = {
  ngOnInit: '`onMount(() => …)`, or just the `setup()` body (it runs once, on creation)',
  ngAfterViewInit: '`onMount(() => …)` — the DOM exists by then',
  ngAfterContentInit: '`onMount(() => …)`',
  ngOnDestroy: '`onDispose(() => …)`',
  ngOnChanges: 'nothing — props are reactive getters; derive with `computed`, react with `watch`',
  ngDoCheck: 'nothing — Weave tracks dependencies itself; there is no change-detection pass to hook',
  ngAfterViewChecked: 'nothing — no change-detection pass exists to run after',
  ngAfterContentChecked: 'nothing — same reason',
};

function draftMembers(members: ClassMember[], className: string, ctx?: TranslateCtx): { lines: string[]; publicNames: string[] } {
  const out: string[] = [];
  const cx: TranslateCtx = ctx ?? translateCtx(members, []);
  // The returned surface is built from what was ACTUALLY declared here, never from a separate list — otherwise
  // the generated `return { … }` can name a binding that does not exist, which the compile gate catches as
  // "No value exists in scope for the shorthand property".
  const publicNames: string[] = [];
  const commented = (text: string | undefined, pad: string = '  '): string[] => (text ?? '').split('\n').map((l) => `${pad}// ${l}`);

  // A dependency declared as a CONSTRUCTOR PARAMETER-PROPERTY is not a class member, so the field branch below
  // never sees it — and the calls through it were left naming a binding nothing declared. Angular's most common
  // injection form produced code referencing a name that was never there.
  const fieldNames: Set<string> = new Set<string>(members.filter((m) => m.kind === 'field').map((m) => m.name));
  for (const [name, service] of cx.injected) {
    if (fieldNames.has(name) || SERVICE_METHODS[service]) continue; // a member, or one whose calls were rewritten
    // `ElementRef` in a directive IS the element the action was handed — declaring it again shadowed the
    // parameter with `null`, so the very thing the action exists to touch became nothing.
    if (service === 'ElementRef' && cx.elementRef) continue;
    const m: MigratedService | undefined = cx.migrated?.get(service);
    out.push('');
    if (m) {
      out.push(`// \`${service}\` is migrated alongside this file; this is how it is reached here.`);
      out.push(m.kind === 'store' ? `const ${name} = ${m.name}();` : `const ${name} = inject(${m.name});`);
    } else {
      out.push(tsTodo(`${service} was not migrated, so nothing provides this. The calls below compile and will`));
      out.push('//   throw the moment they run — wire it up, or delete them.');
      out.push(`const ${name} = ${placeholderFor(service, cx)}; // was ${service}`);
    }
  }

  const localName = (n: string): string => cx.rename?.get(n) ?? n;
  for (const mem of members) {
    if (mem.kind === 'constructor') {
      // Even an EMPTY constructor is a declaration: `constructor(private router: Router) {}` is how the class
      // states its dependencies. Skipping it on an empty body dropped that line from the output entirely.
      if (!mem.body.trim() && !mem.params.trim()) continue;
      out.push('');
      if (mem.body.trim()) {
        // The constructor's body is the ONE body that was never translated — it came out as a TODO over a
        // commented original while every other member was rewritten. It is not a different kind of code: what
        // ran on creation runs here, because this scope IS the constructor.
        out.push('// What the constructor ran on creation. This scope IS the constructor, so it runs here.');
        const ctor: { code: string; todos: string[] } = translateBody(mem.body, cx, mem.params);
        for (const t of ctor.todos) out.push(tsTodo(t));
        // A method body only runs when something calls it; THIS body runs the moment the thing is created. So a
        // dependency the draft declared as a hole (`null as any`) is not a compile error here — it is a crash on
        // startup, or on the first navigation if the body registered a callback. The hole is already reported
        // above it; the guard is what keeps the app running until it is filled, and it needs no edit once it is.
        const holes: string[] = namesRead(ctor.code, deadPlaceholders(members, cx));
        if (holes.length) {
          out.push(tsTodo(`this reads ${holes.map((h) => `\`${h}\``).join(' and ')}, which nothing provides here (see above), so it is`));
          out.push('//   GUARDED — it would throw on creation. The guard falls away on its own once that is wired up.');
          out.push(`if (${holes.join(' && ')}) {`);
          out.push(indent(ctor.code));
          out.push('}');
        } else {
          out.push(...ctor.code.split('\n'));
        }
      }
      out.push(`// ── original ${className} constructor ──`);
      out.push(...commented(mem.text, ''));
      continue;
    }
    if (mem.kind === 'field') {
      // An injected dependency is not state. Its calls were rewritten to the functions that replace them, so the
      // field itself has nothing left to hold — emitting `signal(undefined)` for it invented a variable that
      // meant nothing and read as if the service were reactive state.
      const service: string | undefined = cx.injected.get(mem.name);
      if (service) {
        out.push('');
        // A service this migration converted still has to be REACHED. Its calls were left naming this field, so
        // without a binding the field was a comment and every call through it was undefined.
        const m: MigratedService | undefined = cx.migrated?.get(service);
        if (m) {
          out.push(`// \`${service}\` is migrated alongside this file; this is how it is reached here.`);
          out.push(m.kind === 'store' ? `const ${mem.name} = ${m.name}();` : `const ${mem.name} = inject(${m.name});`);
        } else if (SERVICE_METHODS[service] && !readsBareInjected(members, mem.name, service)) {
          out.push(`// \`${mem.name}\` held ${service}. Its calls above were rewritten to Weave's equivalents, so there is`);
          out.push('// nothing to hold here; anything still calling it needs a decision.');
        } else if (SERVICE_METHODS[service]) {
          // Its CALLS were rewritten, but something reads the field itself — `const r: Router = this._router;`,
          // or a property like `this._router.routerState`. Dropping the declaration turned that into `const r =
          // r;`: a self-assignment that does not even reach the runtime, let alone the missing service.
          out.push(tsTodo(`${service}'s CALLS were rewritten, but something below reads \`${mem.name}\` directly`));
          out.push(`//   (a property, or the service itself). That read has no Weave equivalent — decide what it should be.`);
          out.push(`const ${mem.name} = ${placeholderFor(mem.type || service, cx)}; // was ${mem.type || service}`);
        } else {
          // NOT migrated and NOT one Weave replaces — usually because access to it was left closed. Its calls
          // were kept naming this field, so a bare comment left every one of them referencing nothing. The hole
          // is declared instead: it compiles, it is impossible to miss, and `null` throws the moment it is used.
          out.push(tsTodo(`${service} was not migrated, so nothing provides this. The calls below compile and will`));
          out.push('//   throw the moment they run — wire it up, or delete them.');
          out.push(`const ${mem.name} = ${placeholderFor(mem.type || service, cx)}; // was ${mem.type || service}`);
        }
        out.push(...commented(mem.text, ''));
        continue;
      }
      const vis: string = mem.isPublic ? '' : ' // was private — a local, not returned';
      const note: string = mem.isSignal ? ' // already a signal in Angular — a 1:1 move' : '';
      const decl: { code: string; todos: string[] } = signalDecl(mem, cx);
      for (const t of decl.todos) out.push(tsTodo(t));
      out.push(`const ${localName(mem.name)} = ${decl.code};${vis}${note}`);
      out.push(...commented(mem.text, '')); // the original declaration, verbatim — initial value and type included
      if (mem.isPublic) publicNames.push(localName(mem.name));
      continue;
    }
    if (mem.kind === 'getter' || mem.kind === 'setter') {
      // A getter is a DERIVED value — Weave's is `computed`. A setter has no direct equal: it is an action that
      // writes, so it becomes a plain function. Both used to vanish entirely.
      out.push('');
      const vis: string = mem.isPublic ? '' : ' // was private — a local, not returned';
      if (mem.kind === 'getter') {
        const g: { code: string; todos: string[] } = getterToComputed(mem.body, cx);
        for (const t of g.todos) out.push(tsTodo(t));
        out.push(`const ${localName(mem.name)} = ${g.code};${vis}`);
      } else {
        const s: { code: string; todos: string[] } = translateBody(mem.body, cx, mem.params);
        for (const t of s.todos) out.push(tsTodo(t));
        out.push(`const ${localName(mem.name)} = (${mem.params})${returnAnnotation(mem, s.code)} => {${vis}`);
        out.push(indent(s.code));
        out.push('};');
      }
      out.push(`// ── original ${className}.${mem.name} ──`);
      out.push(...commented(mem.text, ''));
      if (mem.isPublic) publicNames.push(localName(mem.name));
      continue;
    }
    out.push('');
    const hook: string | undefined = LIFECYCLE_HOOKS[mem.name];
    if (hook) {
      // An Angular lifecycle hook has a real Weave equivalent — name it instead of leaving a nameless function.
      out.push(`${tsTodo(`\`${mem.name}\` is a lifecycle hook → ${hook}`)}`);
    }
    const m: { code: string; todos: string[] } = translateBody(mem.body, cx, mem.params);
    for (const t of m.todos) out.push(tsTodo(t));
    out.push(`const ${localName(mem.name)} = (${mem.params})${returnAnnotation(mem, m.code)} => {${mem.isPublic ? '' : ' // was private — a local, not returned'}`);
    if (m.code.trim()) out.push(indent(m.code));
    out.push('};');
    if ((mem.text ?? '').trim()) {
      out.push(`// ── original ${className}.${mem.name}() ──`);
      out.push(...commented(mem.text, '')); // the WHOLE original, so nothing is lost and the rewrite is checkable
    }
    if (mem.isPublic) publicNames.push(localName(mem.name));
  }
  return { lines: out, publicNames };
}

/** `BreadcrumbsPathService` → `breadcrumbs-path` (its file name in the target app). */
export function serviceBaseName(className: string): string {
  return className
    .replace(/Service$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Draft a Weave module for one Angular service. A `providedIn:'root'` singleton becomes a `store()`; anything
 * else becomes a context (`createContext` + a factory to `provide`), because a scoped service is per-subtree.
 *
 * What is DRAFTED vs left alone: the shape is real — fields become signals, methods become functions, the
 * returned object is the service's surface, and injected dependencies are wired to their store hooks. The method
 * BODIES are not translated; each carries a TODO. That line is deliberate: the shape is mechanical, the logic is
 * a judgement call, and a plausible-but-wrong body is worse than an obvious hole.
 */
export function convertService(fact: ServiceFact, rxjsNames: string[] = [], migrated?: Map<string, MigratedService>, returners?: Set<string>): { baseName: string; ts: string } {
  const singleton: boolean = fact.providedIn === 'root';
  const lines: string[] = [];
  // Same rule as components: import what the drafted body actually uses (a getter becomes a `computed`).
  const svcNeeds: string[] = ['signal', ...((fact.members ?? []).some((m) => m.kind === 'getter') ? ['computed'] : [])];
  const imports: string[] = [`import { ${svcNeeds.join(', ')} } from '@weave-framework/runtime';`];
  if (singleton) imports.push("import { store } from '@weave-framework/store';");
  else imports.push("import { createContext } from '@weave-framework/runtime';");

  const body: string[] = [];
  // Only the dependencies still UNANSWERED — one whose calls were rewritten needs nothing from the reader.
  // A dependency that is MIGRATED is reached three lines below; asking for it again is asking twice.
  const unanswered: string[] = fact.injects.filter((dep) => !SERVICE_METHODS[dep] && !migrated?.has(dep));
  if (unanswered.length) {
    body.push(tsTodo(`this service injected ${unanswered.join(', ')} — call each one's store hook here,`));
    body.push('//   e.g. `const other = useOther();`, or `inject(OtherContext)` for a scoped one.');
  }
  if (fact.injects.includes('HttpClient')) {
    body.push(`const client = createClient({ baseUrl: '/api' }); ${tsTodo('set your real base URL + headers')}`);
  }
  const svcAdapters: string[] = adaptersFor(fact.members ?? [], []);
  if (svcAdapters.length) body.push(...svcAdapters);
  const drafted: { lines: string[]; publicNames: string[] } = draftMembers(fact.members ?? [], fact.className, {
    ...translateCtx(fact.members ?? [], [], 'props', migrated),
    angularNames: angularImportedNames(fact.file),
    rename: localRenames(fact.members ?? [], carriedImportsFor(fact.file, migrated)),
    returners,
  });
  body.push(...drafted.lines);
  body.push('');
  body.push(
    drafted.publicNames.length
      ? `return { ${drafted.publicNames.join(', ')} };`
      : `return {}; ${tsTodo('nothing was public — check what callers actually used')}`,
  );

  // The signatures and the bodies have to agree, so the type rewrite runs over the ASSEMBLED draft rather than
  // over each body: `load(): Observable<string[]>` is decided by what the translated `load` now returns, and the
  // annotation and the body only sit next to each other here.
  const typeTodos: string[] = [];
  const typed: string = asyncifyAwaiters(stripAngularTypes(rewriteObservableTypes(body.join('\n'), []), angularImportedNames(fact.file), typeTodos));
  body.length = 0;
  body.push(...typeTodos.map((t) => tsTodo(t)), ...typed.split('\n'));

  // Guidance ONLY for the names that survived the translation. Listing what `map` "would become" beside code
  // where `map` is already an `Array.prototype.map` is noise that reads as unfinished work.
  const surviving: string[] = survivingRxNames(typed, rxjsNames);
  const hints: string[] = rxjsSuggestions(surviving);
  const hintBlock: string[] = hints.length
    ? ['', tsTodo('these RxJS names could not be translated — Weave has no stream primitive, so each is by hand:'), ...hints.map((h) => `//   ${h}`)]
    : [];
  // A service injecting HttpClient gets the data-package mapping, named to the verbs it actually calls.
  // Only `createClient` is imported, because only it is actually used below — `resource`/`action` are named in
  // the guidance and imported by the human when they write the call. A generated dead import is not a courtesy.
  const usesHttp: boolean = fact.injects.includes('HttpClient');
  if (usesHttp) {
    imports.push("import { createClient } from '@weave-framework/data';");
    hintBlock.push(...httpDraft(fact));
  }
  // What the rewritten calls and their shims need. A component already did this; a service did not, so its
  // draft named `navigate` and `NavigateOptions` without importing either.
  imports.push(...serviceImportsFor(fact.members ?? [], []));
  // A service's own imports were never carried — only a component's were. So a draft that calls a helper, a
  // type, or a service migrated beside it named all three without importing any of them.
  imports.push(...carriedImportsFor(fact.file, migrated));

  // The tail is assembled first, then the imports pruned against it: `store` / `createContext` live in the
  // WRAPPER, not in the body, so pruning against the body alone dropped the very imports the file is built on.
  const ctxName: string = `${fact.className.replace(/Service$/, '')}Context`;
  const tail: string[] = singleton
    ? [
        `// Converted from ${fact.className} (${fact.file}).`,
        `// It was \`providedIn: 'root'\` — a single instance for the whole app — so it becomes a store.`,
        ...hintBlock,
        `export const ${storeHookName(fact.className)} = store(() => {`,
        ...body.map((l) => `  ${l}`),
        '});',
        '',
      ]
    : [
        `// Converted from ${fact.className} (${fact.file}).`,
        '// It had no `providedIn`, so it was provided per-injector — in Weave that is a CONTEXT: an ancestor calls',
        `// \`provide(${ctxName}, create${fact.className}())\` and any descendant \`inject(${ctxName})\`.`,
        ...hintBlock,
        `export function create${fact.className}() {`,
        ...body.map((l) => `  ${l}`),
        '}',
        '',
        `export const ${ctxName} = createContext<ReturnType<typeof create${fact.className}>>();`,
        '',
      ];
  // RxJS imports are pruned per BINDING, not per line: a single surviving `Observable` in an untranslated
  // signature used to keep `of`, `map` and `concat` imported alongside it, so the migrated app still declared a
  // dependency on a package it no longer calls.
  imports.push(...weaveImportsFor(tail.join('\n')));
  const pruned: string[] = pruneRxImports(pruneImports(imports, tail.join('\n')), tail.join('\n')).lines;
  lines.push(...mergeImportLines(pruned), '', ...tail);
  return { baseName: serviceBaseName(fact.className), ts: lines.join('\n') };
}

/* ──────────── M5.5 — route guards → `beforeEach` ──────────── */

/** Angular guard keys that gate ENTERING a route; `canDeactivate` gates LEAVING one. */
const ENTRY_GUARD_KEYS: string[] = ['canActivate', 'canActivateChild', 'canMatch', 'canLoad'];

/**
 * Draft a Weave guards module from the routes' guards, or null when there are none.
 *
 * The honest caveat this draft states up front: the mapping is NOT one-to-one. An Angular guard is attached to a
 * ROUTE, so it runs only for that route. Weave's `beforeEach` is GLOBAL — it runs before every navigation — so
 * each drafted guard checks `nav.to` (entry) or `nav.from` (leave) against the paths it used to protect. The
 * paths are filled in from the analysis; the decision logic stays a TODO.
 */
export function convertGuards(routes: RouteFact[]): string | null {
  // guard name → { kinds it was used as, paths it protected }
  const byGuard: Map<string, { kinds: Set<string>; paths: Set<string> }> = new Map();
  for (const r of routes) {
    for (const [kind, names] of Object.entries(r.guardsByKind ?? {})) {
      for (const n of names) {
        if (!byGuard.has(n)) byGuard.set(n, { kinds: new Set<string>(), paths: new Set<string>() });
        const e: { kinds: Set<string>; paths: Set<string> } | undefined = byGuard.get(n);
        e?.kinds.add(kind);
        e?.paths.add(r.path === '' ? '/' : `/${r.path ?? ''}`);
      }
    }
  }
  if (!byGuard.size) return null;

  const lines: string[] = [
    "import { beforeEach } from '@weave-framework/router';",
    '',
    '// Converted from the Angular route guards.',
    '//',
    '// NOT a one-to-one mapping, so read this: an Angular guard is attached to a ROUTE and runs only for that',
    "// route. Weave's `beforeEach` is GLOBAL — it runs before EVERY navigation — so each guard below checks the",
    '// paths it used to protect itself. Returning `false` cancels the navigation; the first `false` wins.',
    '//',
    '// `beforeEach` returns an unregister function — keep it and call it on cleanup so a guard lives only as long',
    '// as whatever registered it.',
    '',
    'export function registerGuards(): () => void {',
    '  const off: Array<() => void> = [',
  ];
  for (const [name, { kinds, paths }] of byGuard) {
    const leaveOnly: boolean = [...kinds].every((k) => !ENTRY_GUARD_KEYS.includes(k));
    const axis: string = leaveOnly ? 'from' : 'to';
    const pathList: string = [...paths].map((p) => `'${p}'`).join(', ');
    lines.push(
      `    // ${name} — was ${[...kinds].join(' + ')} on: ${[...paths].join(', ')}`,
      '    beforeEach((nav) => {',
      `      if (![${pathList}].some((p) => nav.${axis}.startsWith(p))) return true; // not a route ${name} guarded`,
      `      ${tsTodo(`port ${name}.${[...kinds][0]}() — return false to cancel the navigation`)}`,
      '      return true;',
      '    }),',
    );
  }
  lines.push('  ];', '  return () => off.forEach((stop) => stop());', '}', '');
  return lines.join('\n');
}

/* ──────────── pipes → functions, directives → `use:` actions ──────────── */

/**
 * An Angular `@Pipe` becomes a plain FUNCTION in Weave — there is no pipe concept, `{{ x | myPipe }}` is written
 * `{{ myPipe(x) }}`. That makes this one of the cleanest conversions available: `transform`'s signature and body
 * carry straight over. A `pure: false` pipe is flagged, because it relied on a change-detection pass Weave has no
 * equivalent of.
 */
/** The function a pipe becomes. Named once, so the symbol table and the converter cannot disagree. */
export function pipeFunctionName(fact: PipeFact): string {
  return fact.pipeName ?? fact.className.replace(/Pipe$/, '').replace(/^(.)/, (m) => m.toLowerCase());
}

/** The action a directive becomes — its attribute selector, else the de-suffixed class name. */
export function directiveFunctionName(fact: DirectiveFact): string {
  const attr: string = (fact.selector ?? '').replace(/^[|]$/g, '');
  return attr || fact.className.replace(/Directive$/, '').replace(/^(.)/, (m) => m.toLowerCase());
}

export function convertPipe(fact: PipeFact): { baseName: string; ts: string } {
  const fnName: string = pipeFunctionName(fact);
  const lines: string[] = [
    `// Converted from ${fact.className} (${fact.file}).`,
    '// Weave has no pipes — a pipe is just a function, so `{{ x | ' + (fact.pipeName ?? 'pipe') + ' }}` becomes',
    `// \`{{ ${fnName}(x) }}\`. Use a \`computed\` when the result should be cached across reads.`,
  ];
  if (fact.pure === false) {
    lines.push(tsTodo('this pipe was `pure: false` — it re-ran on every change-detection pass, which Weave has no'));
    lines.push('//   equivalent of. Make the dependency explicit: read the signals it actually depends on.');
  }
  lines.push('');
  lines.push(`export function ${fnName}(${fact.transform?.params ?? ''}): unknown {`);
  lines.push(`  ${tsTodo(`port the body — \`this.\` is gone; the transform below is the original.`)}`);
  if (fact.transform?.body.trim()) {
    lines.push(`  // ── original ${fact.className}.transform() ──`);
    for (const l of fact.transform.body.split('\n')) lines.push(`  // ${l}`);
  }
  lines.push('  return undefined;');
  lines.push('}');
  // Anything else the class held is carried too — a pipe may have helpers or injected deps.
  const rest: ClassMember[] = fact.members.filter((m) => m.name !== 'transform');
  if (rest.length) {
    lines.push('');
    lines.push(`// ── the rest of ${fact.className}, carried over ──`);
    for (const m of rest) for (const l of (m.text ?? '').split('\n')) lines.push(`// ${l}`);
  }
  lines.push('');
  return { baseName: fnName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase(), ts: lines.join('\n') };
}

/**
 * An Angular `@Directive` becomes a Weave `use:` ACTION — `(el, arg?) => cleanup | { update, destroy }`, applied
 * as `use:name={{ arg }}`. The element is handed to you directly, which is what `ElementRef` used to provide.
 */
export function convertDirective(fact: DirectiveFact): { baseName: string; ts: string } {
  const attr: string = (fact.selector ?? '').replace(/^\[|\]$/g, '');
  const fnName: string = attr || fact.className.replace(/Directive$/, '').replace(/^(.)/, (m) => m.toLowerCase());
  const lines: string[] = [
    `// Converted from ${fact.className} (${fact.file}).`,
    `// In Weave a directive is a \`use:\` ACTION: it receives the element, and returns its teardown.`,
    `// Apply it as \`<div use:${fnName}={{ arg }}>\`${attr ? ` (was \`${fact.selector}\`)` : ''}.`,
  ];
  // A directive's @Inputs arrive as the action's single argument. `arg` is what the class called `this.<input>`.
  const argType: string = fact.inputs.length
    ? `{ ${fact.inputs.map((i) => `${i}?: ${(fact.members.find((m) => m.name === i && m.kind === 'field')?.type ?? 'unknown')}`).join('; ')} }`
    : 'unknown';
  if (fact.inputs.length) {
    lines.push(`// Its @Input(s) — ${fact.inputs.join(', ')} — are the action's ONE argument: \`use:${fnName}={{ { ${fact.inputs[0]}: … } }}\`.`);
    lines.push('// `update` re-runs when that argument changes, which is where the class read a changed @Input.');
  }

  // A directive is host bindings and behaviour, and both were commented out wholesale — the same "renames things,
  // translates nothing" the components had. The members are drafted, and the host declarations become real DOM
  // work against the element the action is handed.
  //
  // The inputs are held in a SIGNAL: the action's argument is a plain value, so an effect reading `arg` directly
  // would never re-run when `update` replaced it — the binding would apply once and then stop tracking.
  const inputSet: Set<string> = new Set<string>(fact.inputs);
  const hasInputs: boolean = fact.inputs.length > 0;
  const ctx: TranslateCtx = { ...translateCtx(fact.members, fact.inputs, hasInputs ? 'opts()' : 'arg'), elementRef: 'el' };
  const carried: ClassMember[] = fact.members.filter((m) => !(m.kind === 'field' && inputSet.has(m.name)));
  const drafted: { lines: string[]; publicNames: string[] } = draftMembers(carried, fact.className, ctx);
  const dom: { lines: string[]; cleanups: string[]; runtimeNeeds: string[] } = hostDomCode(hostDecls(fact.members, fact.hostMeta ?? {}, ctx));

  const needs: string[] = [
    ...new Set<string>([
      ...(carried.some((m) => m.kind === 'field') || hasInputs ? ['signal'] : []),
      ...(carried.some((m) => m.kind === 'getter') ? ['computed'] : []),
      ...dom.runtimeNeeds,
      ...(dom.cleanups.length ? ['onDispose'] : []),
    ]),
  ];
  const body: string[] = [];
  if (hasInputs) {
    // The defaults the @Input declarations stated. Without them a defaulted input read as `undefined` until the
    // caller passed one — which is not what the Angular directive did.
    const defaults: Array<{ name: string; def: string }> = fact.inputs
      .map((i) => ({ name: i, def: signalInputDefault(fact.members.find((m) => m.name === i && m.kind === 'field')) }))
      .filter((d) => d.def);
    body.push('// ── these became the action\'s argument (see the signature above) ──');
    for (const mem of fact.members.filter((m) => m.kind === 'field' && inputSet.has(m.name))) {
      for (const l of (mem.text ?? '').split('\n')) body.push(`// ${l}`);
    }
    body.push(`const defaults = { ${defaults.map((d) => `${d.name}: ${d.def}`).join(', ')} };`);
    body.push('const opts = signal({ ...defaults, ...arg });');
    body.push('');
  }
  body.push(...drafted.lines);
  if (dom.lines.length) {
    body.push('');
    body.push('// ── the host element: what @HostBinding/@HostListener and `host: {}` applied to it ──');
    body.push(...dom.lines);
  }
  body.push('');
  const returned: string[] = [];
  // A BLOCK body: `set` returns the new value, and an expression-bodied arrow declared `: void` cannot return it.
  if (hasInputs) returned.push(`update: (next?: ${argType}): void => { opts.set({ ...defaults, ...next }); }`);
  if (dom.cleanups.length) {
    body.push('const destroy = (): void => {');
    for (const c of dom.cleanups) body.push(`  ${c}`);
    body.push('};');
    body.push('onDispose(destroy);');
    returned.push('destroy');
  }
  body.push(returned.length ? `return { ${returned.join(', ')} };` : 'return {};');

  lines.push('');
  if (needs.length) lines.splice(0, 0, `import { ${needs.join(', ')} } from '@weave-framework/runtime';`, '');
  lines.push(...carriedImportsFor(fact.file), ...serviceImportsFor(fact.members, fact.inputs));
  lines.push(`export function ${fnName}(el: HTMLElement, arg?: ${argType}): { update?: (next?: ${argType}) => void; destroy?: () => void } {`);
  lines.push(...body.flatMap((l) => l.split('\n')).map((l) => (l ? `  ${l}` : l)));
  lines.push('}');
  lines.push('');
  return { baseName: fnName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase(), ts: lines.join('\n') };
}

/* ──────────── route resolvers → a route `loader` ──────────── */

/** What a resolver class is called once it is a loader function. Named ONCE: the writer and the symbol table
 *  both need it, and two spellings of the same rule is how an import comes to name something nothing exports. */
export function resolverFunctionName(fact: ResolverFact): string {
  return `load${fact.className.replace(/Resolver$/, '')}`;
}

/**
 * An Angular route RESOLVER becomes a Weave route `loader` — data fetched when the route renders, read by the
 * component with `useLoaderData()`.
 *
 * It carries no decorator, so it used to fall through as "plain TypeScript, carried as-is": a file full of
 * `ActivatedRouteSnapshot` moved unchanged, under a banner saying most of it already works. It does not work —
 * nothing in Weave will ever call it.
 *
 * The BODY is not rewritten. Angular hands a resolver the route's snapshot (`route.data`, `routeConfig`, url
 * segments); Weave hands a loader `{ params, query, signal }`. Those are different objects, not different
 * spellings, so the shape is drafted and the original travels beside it.
 */
export function convertResolver(fact: ResolverFact): { baseName: string; ts: string } {
  const fnName: string = resolverFunctionName(fact);
  const lines: string[] = [
    `// Converted from ${fact.className} (${fact.file}).`,
    '//',
    "// An Angular route resolver is a Weave route LOADER: attach it to the route, and the component reads it",
    `// with \`useLoaderData()\`. Wire it as \`route('/path', { component: X, loader: ${fnName} })\`.`,
    '//',
    tsTodo("Angular handed `resolve` the route SNAPSHOT — `route.data`, `routeConfig`, url segments. A loader"),
    '//   gets `{ params, query, signal }` instead: different objects, not a different spelling. What the body',
    "//   read off the snapshot is the one thing only you can map. `signal` aborts a run the router supersedes.",
    '',
    `export function ${fnName}(ctx: { params: Record<string, string>; query: URLSearchParams; signal: AbortSignal }): unknown {`,
    `  ${tsTodo('port the body — the original is below, unchanged.')}`,
    '  return undefined;',
    '}',
    '',
    `// ── original ${fact.className}.resolve(${fact.params}) ──`,
    ...(fact.body || '').split('\n').map((l) => `// ${l}`),
  ];
  // Anything else the class held travels too — a resolver often has helpers beside its `resolve`.
  const rest: ClassMember[] = fact.members.filter((m) => m.name !== 'resolve');
  if (rest.length) {
    lines.push('', `// ── the rest of ${fact.className}, carried over ──`);
    for (const m of rest) for (const l of (m.text ?? '').split('\n')) lines.push(`// ${l}`);
  }
  lines.push('');
  return { baseName: fnName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase(), ts: lines.join('\n') };
}

/* ──────────── NgModules → a wiring note, InjectionTokens → contexts ──────────── */

/**
 * An `@NgModule` has no Weave counterpart — imports are per-file and there is no module graph — so it is NOT
 * turned into code. What it is turned into is the one thing it uniquely knew: what belonged together, what was
 * PROVIDED (each provider is a scoped service that now needs `provide`/`inject`), and what the module re-exported
 * as its public surface. Deleting it would throw that away; pretending to convert it would invent structure.
 */
export function convertNgModule(fact: NgModuleFact): string {
  const lines: string[] = [
    `// ${fact.className} — carried over from ${fact.file}.`,
    '//',
    '// Weave has NO modules: a file imports what it uses, and that is the whole story. So there is nothing here',
    '// to translate into code — but this module knew things nothing else records, and they are listed below.',
    '',
  ];
  const section = (title: string, items: string[], note: string): void => {
    if (!items.length) return;
    lines.push(`// ${title}`);
    for (const i of items) lines.push(`//   - ${i}`);
    lines.push(`//   ${note}`);
    lines.push('');
  };
  section('declarations — these belonged to this module:', fact.declarations, 'each is its own file now; import it where it is used.');
  section('providers — each is a SCOPED service:', fact.providers, 'in Weave: `provide(XContext, createX())` in an ancestor, `inject(XContext)` below it.');
  section('exports — this was the module\'s public surface:', fact.exports, 're-export these from your entry file instead.');
  section('imports — what this module pulled in:', fact.imports, 'a RouterModule.forRoot/forChild becomes your route config; the rest are plain imports.');
  if (fact.bootstrap.length) section('bootstrap:', fact.bootstrap, 'this is the app root — in Weave it is the `mount()` call in main.ts.');
  lines.push(tsTodo('once the pieces above are wired, this file can be deleted.'));
  lines.push('');
  return lines.join('\n');
}

/**
 * An `InjectionToken` injected a value rather than a class. Weave's equivalent is a CONTEXT — `createContext<T>()`
 * provided by an ancestor and read with `inject`. The mapping is direct, so this one really is converted.
 */
export function convertTokens(tokens: TokenFact[]): string | null {
  if (!tokens.length) return null;
  const lines: string[] = [
    "import { createContext } from '@weave-framework/runtime';",
    '',
    '// Converted from Angular InjectionToken(s).',
    '// A token injected a VALUE; Weave does that with a context: an ancestor calls `provide(X, value)` and any',
    '// descendant reads `inject(X)`. Same idea, no token registry.',
    '',
  ];
  for (const t of tokens) {
    if (t.description) lines.push(`// ${t.name} — was \`new InjectionToken('${t.description}')\` in ${t.file}`);
    else lines.push(`// ${t.name} — from ${t.file}`);
    lines.push(`${tsTodo(`give this its real type instead of \`unknown\``)}`);
    lines.push(`export const ${t.name} = createContext<unknown>();`);
    lines.push('');
  }
  return lines.join('\n');
}

/* ──────────── M4.9 — writing the converted files into the TARGET Weave app ──────────── */

/**
 * One file the conversion wants to produce. `status` is decided BEFORE anything touches disk, so the command can
 * show the user exactly what will happen and nothing is a surprise.
 */
export interface WriteItem {
  /** Absolute path in the target Weave app. */
  path: string;
  content: string;
  /** `write` — new file. `skip-exists` — something is already there, so we do NOT touch it. */
  status: 'write' | 'skip-exists';
}

/**
 * Third-party packages the WRITTEN code still imports — the dependencies this migration hands your app.
 *
 * The plan says `rxjs` is replaced by Weave's reactivity, and then the converted files import it anyway, because
 * a stream is not something to rewrite by guess. Both halves are defensible; saying only the first one is not.
 * A package the output still names is a package the app now depends on, and that has to be visible.
 */
export function carriedPackages(items: WriteItem[]): string[] {
  return [...carriedPackageKinds(items).keys()].sort();
}

/**
 * The same packages, split by whether the output needs them AT RUNTIME.
 *
 * A package reached only through `import type` never exists at runtime — TypeScript erases those imports, so
 * nothing of it reaches the bundle. That makes it a `devDependency`, and the distinction is not cosmetic in the
 * other direction either: a package that IS called at runtime and lands in `devDependencies` disappears under a
 * production install (`npm ci --omit=dev`), and the app breaks where nobody was looking.
 *
 * A package imported both ways is runtime — one value import is enough to put it in the bundle.
 */
export function carriedPackageKinds(items: WriteItem[]): Map<string, 'runtime' | 'types'> {
  const out: Map<string, 'runtime' | 'types'> = new Map<string, 'runtime' | 'types'>();
  for (const it of items) {
    if (!/\.(ts|tsx)$/.test(it.path)) continue;
    // Comments carry the ORIGINAL beside every rewrite; an import named only there is not a dependency.
    const code: string = it.content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const m of code.matchAll(/\b(import|export)\s+(type\s+)?([\s\S]*?)\bfrom\s*'([^']+)'/g)) {
      const spec: string = m[4];
      if (spec.startsWith('.') || spec.startsWith('@weave-framework/')) continue;
      const root: string = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      if (out.get(root) === 'runtime') continue; // one value import is enough
      out.set(root, erasesAtRuntime(Boolean(m[2]), m[3] ?? '') ? 'types' : 'runtime');
    }
  }
  return out;
}

/**
 * Whether an import clause leaves NOTHING behind once TypeScript has erased the types.
 *
 * Two spellings erase: the statement-level `import type { A } from 'x'`, and a braced clause whose every binding
 * carries its own `type` keyword. A default or namespace binding never erases, and one plain named binding is
 * enough to keep the whole import — and with it the package — at runtime.
 */
export function erasesAtRuntime(statementType: boolean, clause: string): boolean {
  if (statementType) return true;
  const braced: RegExpMatchArray | null = clause.match(/^\s*\{([\s\S]*)\}\s*$/);
  if (!braced) return false; // a default or `* as ns` binding is a real value
  const bindings: string[] = splitTopLevel(braced[1]).filter((b) => b.trim());
  return bindings.length > 0 && bindings.every((b) => /^type\s/.test(b.trim()));
}

/**
 * Read a component's Angular template: the inline `template:` text when it has one, else the `templateUrl` file
 * resolved beside the component. Returns null when neither can be read — the caller records that honestly rather
 * than emitting an empty template that looks like a successful conversion.
 */
export function readComponentTemplate(fact: ComponentFact): string | null {
  if (fact.templateText !== null) return fact.templateText;
  if (fact.templateUrl) {
    const p: string = resolve(dirname(fact.file), fact.templateUrl);
    try {
      return readFileSync(p, 'utf8');
    } catch {
      return null; // the file moved or is unreadable — honestly unknown
    }
  }
  return null;
}

/** The source unit's own `src/` root, so the target mirrors the layout the user already knows. */
/**
 * The unit a file belongs to. Once access has been granted to another unit, its files are NOT under `facts.unit`
 * — and mirroring them against it produced `../../../libs/x/src/index.ts`, whose `src/`-relative tail is
 * `index.ts`, landing exactly on top of the app's own `src/index.ts`. Two sources, one output, one of them lost.
 */
function unitOf(file: string, facts: MigrationFacts): { dir: string; prefix: string } {
  for (const g of facts.granted ?? []) {
    // A granted unit is a PROJECT folder — `unitRootFor` guarantees that, and is where the rule lives. Repeating
    // the `src`/`lib` guard here would be a second copy of it that nothing can reach, and so nothing can test.
    if (!relative(g, file).startsWith('..')) return { dir: g, prefix: g.split(/[\\/]/).filter(Boolean).pop() ?? 'lib' };
  }
  return { dir: facts.unit, prefix: '' };
}

/**
 * A user-typed destination folder, or null when it would land outside `src/`.
 *
 * The output otherwise mirrors the source layout straight into `src/`, which drops a whole Angular folder tree
 * into the root of an app that already has its own. So the folder can be typed — and because it is typed, it is
 * checked: an absolute path, a drive letter, or a `..` segment is refused rather than resolved, because the one
 * thing this command promises is that it writes inside the app it was pointed at.
 */
export function safeSubdir(input: string): string | null {
  const t: string = input.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!t) return ''; // nothing typed — the root, exactly as before
  if (/^[A-Za-z]:/.test(t) || input.trim().startsWith('/') || input.trim().startsWith('\\')) return null;
  const parts: string[] = t.split('/').filter((seg) => seg !== '.');
  if (!parts.length || parts.some((seg) => seg === '..' || seg === '' || /[<>:"|?*\x00-\x1f]/.test(seg))) return null;
  return parts.join('/');
}

/**
 * The absolute path a source file's conversion lands at. ONE calculation, shared by the writer and the symbol
 * table — computing it twice is how the table came to point at `./app/root` for a file written to `app/app.ts`,
 * which is exactly the class of mismatch the table exists to remove.
 *
 * `component` strips the Angular suffix (`app.component.ts` → `app.ts`); everything else keeps its file name,
 * because deriving it from the CLASS made `breadcrumbs.component.ts` and `BreadcrumbsService` both want
 * `breadcrumbs.ts`, and the second silently overwrote the first.
 */
export function outputFileFor(sourceFile: string, facts: MigrationFacts, targetDir: string, component: boolean = false, subdir: string = ''): string {
  const rel: string = outputPathFor(sourceFile, facts);
  const dir: string = dirname(rel) === '.' ? '' : dirname(rel);
  const name: string = rel.split(/[\\/]/).pop() ?? '';
  return join(targetDir, 'src', subdir, dir, `${component ? weaveBaseName(name) : name.replace(/\.ts$/, '')}.ts`);
}

/**
 * Where a file lands, mirroring its source layout — under its own folder when it came from a granted unit.
 *
 * `index.ts` at the root is special: a Weave app's HTML SHELL is `src/index.html`, and a `.ts` beside a `.html`
 * IS a component in Weave. So carrying a library's barrel to `src/index.ts` quietly turned the app's shell into
 * a component template, and `weave check` started reporting errors inside the `<!doctype html>`.
 */
function outputPathFor(file: string, facts: MigrationFacts): string {
  const { dir, prefix } = unitOf(file, facts);
  const rel: string = relativeUnderSrc(file, dir);
  const safe: string = rel === 'index.ts' ? 'index.barrel.ts' : rel;
  return prefix ? join(prefix, safe) : safe;
}

function relativeUnderSrc(file: string, unitDir: string): string {
  const rel: string = relative(unitDir, file);
  const parts: string[] = rel.split(/[\\/]/);
  const srcAt: number = parts.indexOf('src');
  const under: string[] = srcAt === -1 ? parts : parts.slice(srcAt + 1);
  // Drop a leading `lib/` too. It is not part of anyone's design: `ng-packagr` requires an Angular LIBRARY to
  // put its sources in `src/lib/`, so the folder is packaging plumbing that means nothing in a Weave app. It is
  // a wrapper around everything in the unit, so removing it keeps every relative import between these files
  // intact; `repointSpecifier` fixes the barrel that referred to it by name.
  return (under[0] === 'lib' ? under.slice(1) : under).join(sep);
}

/** `breadcrumbs.component.ts` → `breadcrumbs` — the Angular suffixes a Weave file does not carry. */
function weaveBaseName(fileName: string): string {
  return fileName.replace(/\.ts$/, '').replace(/\.(component|page|view)$/, '');
}

/**
 * The stylesheet files one component contributes.
 *
 * Weave pairs a component with a SIBLING stylesheet, so the first source stylesheet is renamed to the component's
 * base name and everything else keeps its own name plus a note (Weave takes one sibling; the rest need an
 * explicit `export const styles = [...]`). Inline `styles:` are written out as that sibling — they were only ever
 * counted before, so they vanished entirely.
 */
export function componentStyles(fact: ComponentFact, baseName: string): Array<{ name: string; content: string }> {
  const out: Array<{ name: string; content: string }> = [];
  const urls: string[] = fact.styleUrls ?? [];
  urls.forEach((rel, i) => {
    const from: string = resolve(dirname(fact.file), rel);
    let css: string;
    try {
      css = readFileSync(from, 'utf8');
    } catch {
      return; // the stylesheet moved or is unreadable — nothing to carry, and nothing invented
    }
    const ext: string = (rel.match(/\.(s?css|sass|less)$/)?.[0] ?? '.css').toLowerCase();
    const name: string = i === 0 ? `${baseName}${ext}` : (rel.split(/[\\/]/).pop() ?? `${baseName}-${i}${ext}`);
    const header: string =
      i === 0
        ? `/* Carried over from ${rel} — a Weave component's stylesheet is its sibling, so this is named after the component. */\n`
        : `/* Carried over from ${rel}. Weave takes ONE sibling stylesheet; import this one explicitly via \`export const styles = ['./${rel.split(/[\\/]/).pop()}']\`. */\n`;
    out.push({ name, content: `${header}${css}` });
  });
  // Inline styles land in the sibling too (appended when a file-based one already claimed it).
  const inline: string[] = fact.styleTexts ?? [];
  if (inline.length) {
    const body: string = `/* Inline \`styles:\` from ${fact.className}, moved to the sibling stylesheet Weave expects. */\n${inline.join('\n\n')}\n`;
    const existing: { name: string; content: string } | undefined = out.find((o) => o.name.startsWith(`${baseName}.`));
    if (existing) existing.content += `\n${body}`;
    else out.push({ name: `${baseName}.css`, content: body });
  }
  return out;
}

/**
 * Repoint a relative import at where its target actually lands. Two things move a file on the way out: a
 * component loses its `.component` suffix, and the Angular-library `lib/` wrapper is dropped — so a barrel that
 * said `./lib/logo/logo.component` has to say `./logo/logo`.
 */
function repointSpecifier(spec: string): string {
  return spec
    .replace(/^\.\/lib\//, './')
    .replace(/^\.\.\/lib\//, '../')
    .replace(/\/lib\//, '/')
    .replace(/\.component$/, '');
}

/**
 * Carry a file that the converter has no specific rule for — a barrel, a helper module, a plain class, a model.
 *
 * These are usually already valid TypeScript, so the file is kept WHOLE rather than summarised: the only edits
 * are repointing relative imports at renamed outputs, and a header saying what to check. Producing nothing for
 * them, as this used to, meant a migration silently dropped half a library — including the entry point its
 * consumers import. Returns null only when the file cannot be read.
 */
export function carryFile(file: string, facts: MigrationFacts, returners?: Set<string>): string | null {
  let src: string;
  try {
    src = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  // Repoint relative import/export specifiers whose target is a component (its `.component` suffix is dropped).
  const repointed: string = src.replace(/(from\s*['"])(\.[^'"]+)(['"])/g, (_m, head: string, spec: string, tail: string) => `${head}${repointSpecifier(spec)}${tail}`);

  // "Carried" never meant "left alone about RxJS". A helper module with no decorator is exactly where the
  // streams hide, and moving it unchanged hands the migrated app a dependency on a package Weave replaces.
  const rx: { code: string; todos: string[] } = rxToWeave(repointed, [], returners);
  const rxNames: string[] = importedNamesFrom(file, 'rxjs');
  const rxSurviving: string[] = survivingRxNames(rx.code, rxNames);
  const carried: string = pruneRxImports(rx.code.split('\n'), rx.code).lines.join('\n');

  const angularImports: string[] = importedNamesFrom(file, '@angular');
  // A carried file with `@angular` imports does NOT "already work" — it is Angular code in a Weave app, and it
  // will not run. Saying otherwise about the very framework being migrated away from is the kind of soothing
  // banner that makes a reader skip the file.
  const header: string[] = angularImports.length
    ? [
        `// Carried over from ${file} by \`weave migrate\`.`,
        '// NOT CONVERTED — this file has no @Component/@Injectable, so it was moved unchanged. It still imports',
        '// from @angular, which means it does NOT work in Weave as it stands.',
        tsTodo(`it imports from @angular (${[...new Set(angularImports)].slice(0, 6).join(', ')}) — replace those with their Weave equivalents (see migration-plan.md).`),
      ]
    : [
        `// Carried over from ${file} by \`weave migrate\`.`,
        '// This file had no @Component/@Injectable, so it is kept as-is — plain TypeScript that already works.',
        '// Check anything framework-specific below.',
      ];
  if (rxNames.length) {
    header.push(
      rxSurviving.length
        ? tsTodo(`its RxJS was translated except for ${rxSurviving.join(', ')} — those are about time or control flow, so they are by hand.`)
        : '// Its RxJS was translated to plain values and promises; this file no longer depends on rxjs.',
    );
    for (const t of rx.todos) header.push(tsTodo(t));
  }
  if (facts.packages.some((p) => p.decision === 'auto' && importedNamesFrom(file, p.name).length && p.name !== 'rxjs')) {
    header.push(tsTodo('it uses a package you chose to migrate — check the plan for what it becomes.'));
  }
  return `${header.join('\n')}\n\n${carried}`;
}

/** A source file's text, or '' when it cannot be read — the returner scan must not fail a whole migration. */
function tryReadSource(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** The selector → component-name map, so converted templates reference each other as Weave components. */
export function componentNameMap(facts: MigrationFacts): Record<string, string> {
  const map: Record<string, string> = {};
  for (const cf of facts.components) {
    if (cf.selector) map[cf.selector] = cf.className.replace(/Component$/, '');
  }
  return map;
}

/**
 * Plan every file the conversion would write into `targetDir`, WITHOUT touching disk. Each component becomes a
 * `<name>.ts` + `<name>.html` pair under the target's `src/`, mirroring the source's own layout beneath its
 * `src/`. A path that already exists is marked `skip-exists` and never overwritten — that is the whole safety
 * story for migrating into an app you already have.
 */
/**
 * What every declaration in this unit BECOMES, built before any file is finished. One place knows the whole
 * mapping, so nothing written can name something that no longer exists — see `migrate-symbols.ts` for why that
 * is a model rather than another patch.
 */
/** One converted declaration: what it was called, where it came from, and what the output calls it. */
export interface ConvertedDecl {
  className: string;
  file: string;
  to: string;
  isDefault: boolean;
  kind: WeaveSymbol['kind'];
}

/**
 * EVERY declaration this migration renames, in one place.
 *
 * The symbol table and the "already handled, do not carry" set were two hand-kept lists of kinds that had to
 * agree. They stopped agreeing: resolvers were in the skip-set but in no table, so `BreadcrumbsResolver` became
 * `loadBreadcrumbs` on disk while its importer went on naming the class — a build error the type-check could not
 * blame on anything. Derived from one list, a kind cannot be in one and missing from the other, and the next
 * kind added lands in both by construction.
 */
export function convertedDecls(facts: MigrationFacts): ConvertedDecl[] {
  const services: ConvertedDecl[] = [];
  for (const sf of facts.services) {
    const m: MigratedService | undefined = migratedServices([sf]).get(sf.className);
    if (m) services.push({ className: sf.className, file: sf.file, to: m.name, isDefault: false, kind: 'service' });
  }
  return [
    // A component is the file's DEFAULT export — which is exactly what its importers did not know.
    ...facts.components.map((cf): ConvertedDecl => ({ className: cf.className, file: cf.file, to: cf.className, isDefault: true, kind: 'component' })),
    ...services,
    ...(facts.pipes ?? []).map((pf): ConvertedDecl => ({ className: pf.className, file: pf.file, to: pipeFunctionName(pf), isDefault: false, kind: 'pipe' })),
    ...(facts.directives ?? []).map((df): ConvertedDecl => ({ className: df.className, file: df.file, to: directiveFunctionName(df), isDefault: false, kind: 'directive' })),
    ...(facts.resolvers ?? []).map((rf): ConvertedDecl => ({ className: rf.className, file: rf.file, to: resolverFunctionName(rf), isDefault: false, kind: 'resolver' })),
  ];
}

export function symbolTable(facts: MigrationFacts, targetDir: string, subdir: string = ''): Map<string, WeaveSymbol> {
  const table: Map<string, WeaveSymbol> = new Map<string, WeaveSymbol>();
  const converted: ConvertedDecl[] = convertedDecls(facts);
  for (const d of converted) {
    table.set(d.className, { from: d.className, to: d.to, isDefault: d.isDefault, file: outputFileFor(d.file, facts, targetDir, d.kind === 'component', subdir), kind: d.kind });
  }
  // Everything a CARRIED file exports belongs in the table too. Only converted classes were listed, so a type
  // imported through a workspace alias — `import { IBreadcrumb } from '@my-org/interfaces'` — was migrated into
  // the output and then still imported from the alias, which the target app does not have.
  const decorated: Set<string> = new Set<string>(converted.map((d) => d.file));
  for (const file of facts.files) {
    if (decorated.has(file)) continue;
    const out: string = outputFileFor(file, facts, targetDir, false, subdir);
    for (const name of exportedNames(file)) {
      // A decorated class wins: it is the one whose NAME changed, and the carried scan must not shadow it.
      if (!table.has(name)) table.set(name, { from: name, to: name, isDefault: false, file: out, kind: 'carried' });
    }
  }
  return table;
}

export function planWrites(facts: MigrationFacts, targetDir: string, subdir: string = ''): WriteItem[] {
  const items: WriteItem[] = [];
  // The whole-unit mapping, built FIRST: every emitted file is resolved against it at the end, so a rename that
  // landed here cannot be missed over there.
  const table: Map<string, WeaveSymbol> = symbolTable(facts, targetDir, subdir);
  // What this run converts, so a call from one converted file into another is not reported as unknown.
  const migrated: Map<string, MigratedService> = migratedServices(facts.services);
  // The whole unit's `Observable<…>` returners, gathered BEFORE any file is converted. A chain's source is
  // usually a call into this same unit, and a fold that cannot classify its source gives up on the first
  // operator — so the map has to exist before the first file is translated, not be discovered as it goes.
  const returners: Set<string> = observableReturners(facts.files.map((f) => tryReadSource(f)));
  const opts: ConvertOptions = { components: componentNameMap(facts), migrated, returners };
  for (const cf of facts.components) {
    const rel: string = outputPathFor(cf.file, facts);
    const dir: string = dirname(rel) === '.' ? '' : dirname(rel);
    const base: string = weaveBaseName(rel.split(/[\\/]/).pop() ?? cf.className);
    const html: string | null = readComponentTemplate(cf);
    // A component that also uses reactive forms gets its `form({ … })` drafted into the same setup().
    const formFact: FormFact | undefined = facts.forms.find((ff) => ff.file === cf.file);
    const pair: ConvertedComponent = convertComponent(cf, html ?? '', opts, formFact);
    const tsBody: string =
      html === null
        ? `${pair.ts}\n// TODO(weave migrate): the template could not be read (${cf.templateUrl ?? 'no template'}) — port it by hand.\n`
        : pair.ts;
    for (const [ext, content] of [
      ['.ts', tsBody],
      ['.html', html === null ? `${todo('the original template could not be read — port it by hand')}\n` : `${pair.html}\n`],
    ] as Array<[string, string]>) {
      const path: string = join(targetDir, 'src', subdir, dir, `${base}${ext}`);
      items.push({ path, content, status: existsSync(path) ? 'skip-exists' : 'write' });
    }
    // STYLES. A Weave component's stylesheet is its sibling, so the first source stylesheet becomes
    // `<base>.<ext>` and inline `styles:` are written out as that sibling too. Neither used to be carried at all:
    // styleUrls were recorded as a fact and the files left behind, and inline styles were only ever COUNTED.
    for (const item of componentStyles(cf, base)) {
      const path: string = join(targetDir, 'src', subdir, dir, item.name);
      items.push({ path, content: item.content, status: existsSync(path) ? 'skip-exists' : 'write' });
    }
  }
  // Services (M5): a `providedIn:'root'` one becomes a store, anything else a context — drafted, not guessed.
  // The file NAME mirrors the source file, not the class: deriving it from the class name made
  // `breadcrumbs.component.ts` and `BreadcrumbsService` (in `breadcrumbs.service.ts`) both want `breadcrumbs.ts`,
  // and the second silently overwrote the first.
  for (const sf of facts.services) {
    const rel: string = outputPathFor(sf.file, facts);
    const dir: string = dirname(rel) === '.' ? '' : dirname(rel);
    const base: string = (rel.split(/[\\/]/).pop() ?? '').replace(/\.ts$/, '');
    const draft: { baseName: string; ts: string } = convertService(sf, importedNamesFrom(sf.file, 'rxjs'), migrated, returners);
    const path: string = join(targetDir, 'src', subdir, dir, `${base || draft.baseName}.ts`);
    items.push({ path, content: draft.ts, status: existsSync(path) ? 'skip-exists' : 'write' });
  }
  // Pipes → functions, directives → `use:` actions. Both are real conversions, not carries.
  for (const pf of facts.pipes ?? []) {
    const rel: string = outputPathFor(pf.file, facts);
    const dir: string = dirname(rel) === '.' ? '' : dirname(rel);
    const base: string = (rel.split(/[\\/]/).pop() ?? '').replace(/\.ts$/, '');
    const path: string = join(targetDir, 'src', subdir, dir, `${base}.ts`);
    items.push({ path, content: convertPipe(pf).ts, status: existsSync(path) ? 'skip-exists' : 'write' });
  }
  for (const df of facts.directives ?? []) {
    const rel: string = outputPathFor(df.file, facts);
    const dir: string = dirname(rel) === '.' ? '' : dirname(rel);
    const base: string = (rel.split(/[\\/]/).pop() ?? '').replace(/\.ts$/, '');
    const path: string = join(targetDir, 'src', subdir, dir, `${base}.ts`);
    items.push({ path, content: convertDirective(df).ts, status: existsSync(path) ? 'skip-exists' : 'write' });
  }
  // Route resolvers → a route `loader`. They carry no decorator, so they used to be carried as plain TypeScript.
  for (const rf of facts.resolvers ?? []) {
    const path: string = outputFileFor(rf.file, facts, targetDir, false, subdir);
    items.push({ path, content: convertResolver(rf).ts, status: existsSync(path) ? 'skip-exists' : 'write' });
  }

  // NgModules: not code in Weave, but a wiring note that records what only the module knew.
  for (const nm of facts.ngModules ?? []) {
    const rel: string = outputPathFor(nm.file, facts);
    const dir: string = dirname(rel) === '.' ? '' : dirname(rel);
    const base: string = (rel.split(/[\\/]/).pop() ?? '').replace(/\.ts$/, '');
    const path: string = join(targetDir, 'src', subdir, dir, `${base}.ts`);
    items.push({ path, content: convertNgModule(nm), status: existsSync(path) ? 'skip-exists' : 'write' });
  }
  // InjectionTokens → one contexts module (a token is a value-injection, which is exactly what a context is).
  const tokensTs: string | null = convertTokens(facts.tokens ?? []);
  if (tokensTs) {
    const path: string = join(targetDir, 'src', subdir, 'contexts.ts');
    items.push({ path, content: tokensTs, status: existsSync(path) ? 'skip-exists' : 'write' });
  }

  // EVERY REMAINING FILE. A file with no @Component/@Injectable — a barrel, a helper module, a resolver, a model
  // — used to produce nothing at all, silently: on a real library that was half the files, including the
  // `index.ts` its consumers import. Most such files are already valid TypeScript, so they are carried across
  // whole, with their relative imports repointed at the renamed outputs.
  const covered: Set<string> = new Set<string>([
    ...facts.components.map((cf) => cf.file),
    ...facts.services.map((sf) => sf.file),
    ...(facts.pipes ?? []).map((pf) => pf.file),
    ...(facts.directives ?? []).map((df) => df.file),
    ...(facts.ngModules ?? []).map((nm) => nm.file),
    ...(facts.resolvers ?? []).map((rf) => rf.file),
  ]);
  for (const file of facts.files) {
    if (covered.has(file)) continue;
    const rel: string = outputPathFor(file, facts);
    const dir: string = dirname(rel) === '.' ? '' : dirname(rel);
    const base: string = (rel.split(/[\\/]/).pop() ?? '').replace(/\.ts$/, '');
    const carried: string | null = carryFile(file, facts, returners);
    if (carried === null) continue;
    const path: string = join(targetDir, 'src', subdir, dir, `${base}.ts`);
    items.push({ path, content: carried, status: existsSync(path) ? 'skip-exists' : 'write' });
  }
  // Route guards (M5.5) — one module, because Weave's `beforeEach` is global rather than per-route.
  const guards: string | null = convertGuards(facts.routes);
  if (guards) {
    const path: string = join(targetDir, 'src', subdir, 'guards.ts');
    items.push({ path, content: guards, status: existsSync(path) ? 'skip-exists' : 'write' });
  }

  // ONE resolve pass over the assembled output. Until here every file was produced in isolation and could only
  // guess what the others became; now the whole mapping exists, so each file's imports are pointed at what
  // actually landed. This is what stops "migrated here, still naming the old thing over there".
  return items.map((it) =>
    /\.tsx?$/.test(it.path) ? { ...it, content: resolveImports(it.content, it.path, table) } : it,
  );
}

/**
 * The `@weave-framework/*` packages the generated code actually imports.
 *
 * This matters because the converted code is written into an app that may not have them. The scaffold installs
 * runtime/router/store/forms/i18n/data, but NOT `@weave-framework/ui` — so a migration off Angular Material
 * writes imports the target cannot resolve. Reporting it beats a wall of "Cannot find module" at first build.
 */
export function requiredWeavePackages(items: WriteItem[]): string[] {
  const found: Set<string> = new Set<string>();
  const re: RegExp = /from\s+['"](@weave-framework\/[a-z-]+)(?:\/[a-z-]+)?['"]/g;
  for (const item of items) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(item.content)) !== null) found.add(m[1]);
  }
  return [...found].sort();
}

/** The package managers a Weave app might be using. */
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/**
 * Which package manager this app uses. Checked in order of how strongly each signal states intent:
 * `packageManager` in package.json (corepack — an explicit declaration) beats a lockfile, which beats the
 * npm default. It matters because the commands are NOT interchangeable: `pnpm i lodash` does not add a
 * dependency the way `npm i lodash` does — `pnpm add` is the equivalent — and running npm inside a pnpm
 * project rewrites node_modules into a layout pnpm did not intend.
 */
export function detectPackageManager(appDir: string): PackageManager {
  try {
    const pm: unknown = (JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')) as { packageManager?: unknown }).packageManager;
    if (typeof pm === 'string') {
      const name: string = pm.split('@')[0].trim();
      if (name === 'pnpm' || name === 'yarn' || name === 'bun' || name === 'npm') return name;
    }
  } catch {
    /* no or unreadable package.json — fall through to the lockfiles */
  }
  if (existsSync(join(appDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(appDir, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(appDir, 'bun.lockb')) || existsSync(join(appDir, 'bun.lock'))) return 'bun';
  return 'npm'; // package-lock.json, or nothing to go on
}

/** The command that adds dependencies with the given manager — each has its own verb, and its own dev flag. */
export function installCommand(pm: PackageManager, packages: string[], dev: boolean = false): string {
  return `${pm} ${installVerb(pm)}${dev ? ` ${devFlag(pm)}` : ''} ${packages.join(' ')}`;
}

/** The "this is a devDependency" flag. `bun` spells it `-d`; the rest take `-D`. */
export function devFlag(pm: PackageManager): string {
  return pm === 'bun' ? '-d' : '-D';
}

/** `npm` adds with `i`; every other manager here uses `add`. */
export function installVerb(pm: PackageManager): string {
  return pm === 'npm' ? 'i' : 'add';
}

/**
 * An npm package name with an optional version range, and nothing else.
 *
 * These specs are NOT trusted input: the names come from `import` specifiers in the code being migrated, and the
 * ranges from a `package.json` in that same tree. Migrating a repository you did not write must not be able to
 * run a command, so anything outside this grammar is refused rather than escaped — there is no legitimate
 * package spec containing a space, a quote, or a shell metacharacter.
 */
const SAFE_SPEC: RegExp = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[A-Za-z0-9.\-+^~><= |*]{1,64})?$/;

/** The specs that are safe to hand a shell. Anything else is returned separately so the caller can name it. */
export function checkSpecs(packages: string[]): { safe: string[]; refused: string[] } {
  const safe: string[] = [];
  const refused: string[] = [];
  for (const p of packages) (SAFE_SPEC.test(p) ? safe : refused).push(p);
  return { safe, refused };
}

/**
 * Actually run the install, with the app's own manager, in the app's own directory.
 *
 * A shell is unavoidable: on Windows `pnpm`/`npm`/`yarn` are `.cmd` shims, and since the BatBadBut fix Node
 * refuses to spawn those without one. So the command is built as a SINGLE string — passing an args array
 * alongside `shell: true` is what Node deprecated in DEP0190, because it concatenates them into a shell line
 * without escaping. An earlier version of this function did exactly that, under a comment claiming the opposite.
 *
 * What makes the single string safe is not quoting, it is the grammar above: every spec is checked first, and an
 * install with anything unrecognised in it does not run at all.
 */
export function runInstall(pm: PackageManager, packages: string[], appDir: string, dev: boolean = false): boolean {
  const plan: InstallPlan = installPlan(pm, packages, dev);
  if (!plan.command) return false;
  const res: { status: number | null; error?: Error } = spawnSync(plan.command, { cwd: appDir, stdio: 'inherit', shell: true });
  return !res.error && res.status === 0;
}

/** What an install WOULD do: the command, or nothing plus the specs that stopped it. */
export interface InstallPlan {
  /** The shell line to run, or null when this install must not happen. */
  command: string | null;
  /** The specs outside the grammar. Non-empty means `command` is null. */
  refused: string[];
}

/**
 * Decide the install without performing it.
 *
 * The decision is separated from the side effect so it can be TESTED without a test that spawns a shell — the
 * gate for "an unrecognised spec must not run" cannot itself be the thing that runs it.
 */
export function installPlan(pm: PackageManager, packages: string[], dev: boolean = false): InstallPlan {
  const { safe, refused } = checkSpecs(packages);
  if (refused.length || !safe.length) return { command: null, refused };
  return { command: installCommand(pm, safe, dev), refused: [] };
}

/**
 * The third-party packages the converted code still imports, each pinned to the version the SOURCE app used.
 *
 * Reporting them without an install command left the migrated app importing modules nothing provides, so the
 * first `weave check` after a migration was a wall of "cannot find module" — noise that buries the real TODOs.
 *
 * `@angular/*` is EXCLUDED on purpose: those imports come from files that were carried rather than converted,
 * and installing Angular into a Weave app to make them resolve is not a fix, it is the migration undone.
 * `@weave-framework/*` is excluded too — it has its own line, checked against what the app already has.
 */
export function carriedInstalls(items: WriteItem[], sourceDir: string, targetDir: string): Array<{ name: string; spec: string; dev: boolean }> {
  const versions: Record<string, string> = dependencyVersions(sourceDir);
  const already: Set<string> = new Set<string>(Object.keys(dependencyVersions(targetDir)));
  const kinds: Map<string, 'runtime' | 'types'> = carriedPackageKinds(items);
  return [...kinds.keys()]
    .sort()
    .filter((name) => !name.startsWith('@angular/') && !name.startsWith('@weave-framework/') && !already.has(name))
    // Runtime or types decides `dependencies` vs `devDependencies`, and both directions matter: a runtime
    // package in devDependencies vanishes under `npm ci --omit=dev`, and a types-only one in dependencies is
    // shipped to every consumer of this app for nothing.
    .map((name) => ({ name, spec: versions[name] ? `${name}@${versions[name]}` : name, dev: kinds.get(name) === 'types' }));
}

/**
 * Every dependency declared at or above `dir`, nearest wins.
 *
 * A component library inside a monorepo has its own `package.json` listing some of what it uses and inheriting
 * the rest from the workspace root — so reading only one of them loses half the versions.
 */
export function dependencyVersions(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  let current: string = resolve(dir);
  for (;;) {
    try {
      const j: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = JSON.parse(
        readFileSync(join(current, 'package.json'), 'utf8'),
      );
      for (const [name, spec] of Object.entries({ ...j.devDependencies, ...j.dependencies })) {
        if (!(name in out)) out[name] = spec; // nearest package.json wins
      }
    } catch {
      /* no package.json here, or unreadable — keep walking up */
    }
    const parent: string = dirname(current);
    if (parent === current) return out;
    current = parent;
  }
}

/** The `@weave-framework/*` packages a `package.json` already depends on. */
export function installedWeavePackages(appDir: string): string[] {
  try {
    const j: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
    return Object.keys({ ...j.dependencies, ...j.devDependencies }).filter((d) => d.startsWith('@weave-framework/'));
  } catch {
    return [];
  }
}

/** Write the planned items. Anything marked `skip-exists` is left untouched — an existing file is never clobbered. */
export function applyWrites(items: WriteItem[]): { written: string[]; skipped: string[] } {
  const written: string[] = [];
  const skipped: string[] = [];
  for (const item of items) {
    if (item.status === 'skip-exists') {
      skipped.push(item.path);
      continue;
    }
    mkdirSync(dirname(item.path), { recursive: true });
    writeFileSync(item.path, item.content, 'utf8');
    written.push(item.path);
  }
  return { written, skipped };
}
