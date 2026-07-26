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
import { dirname, join, relative, resolve, sep } from 'node:path';
import { importedNamesFrom, type ClassMember, type ComponentFact, type FormFact, type MigrationFacts, type RouteFact, type ServiceFact } from './migrate-analyze.js';

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

/** `on:click="save()"` needs a FUNCTION in Weave, while Angular writes a statement — so wrap it in an arrow. */
function eventBinding(event: string, statement: string): string {
  // `$event` is a valid JS identifier, so naming the arrow's parameter `$event` makes Angular's statement work
  // unchanged, whether or not it mentions `$event`.
  return `on:${event}={{ ($event) => ${statement.trim()} }}`;
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
    if (target.startsWith('style.')) return { out: `style:${target.slice(6)}={{ ${v} }}` };
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

  // A plain attribute passes through, but any {{ }} inside it is still an Angular expression.
  if (value === null) return { out: name };
  const inAttr: ConvertedExpr = convertInterpolations(value);
  return { out: `${name}="${inAttr.expr}"`, todos: inAttr.todos };
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
  // <ng-template> has no direct equal — a @snippet is the closest, but naming/params are a human call.
  if (node.tag === 'ng-template') {
    return `${todo('<ng-template> — in Weave use a `@snippet name() { … }` and `@render (name())`')}\n${renderNodes(node.children, opts)}`;
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
  const todos: string[] = [];
  const expr: string = text.replace(/;\s*let\s+([A-Za-z_$][\w$]*)\s*=\s*(\$?\w+)/g, (_full, alias: string, local: string) => {
    const weaveLocal: string = local.startsWith('$') ? local : `$${local}`;
    todos.push(`\`let ${alias} = ${local}\` — Weave exposes \`${weaveLocal}\` directly; rename \`${alias}\` to \`${weaveLocal}\` in the block body`);
    return ''; // drop the alias clause; the loop local is used by its Weave name
  });
  return { expr, todos };
}

/** Angular built-in elements with a confident Weave equivalent (a user's own selectors come via `opts`). */
const BUILTIN_TAGS: Record<string, string> = {
  'router-outlet': 'RouterView', // @weave-framework/router renders the matched route here
};

/** Render one element (its own tag + attributes + children), without its structural wrapper. */
function renderElement(node: ElementNode, opts: ConvertOptions): string {
  const mapped: string | undefined = opts.components?.[node.tag] ?? BUILTIN_TAGS[node.tag];
  const tag: string = mapped ?? node.tag;

  // A [ngSwitch] parent groups its *ngSwitchCase children into one @switch block.
  const switchAttr: Attr | undefined = node.attrs.find((a) => a.name === '[ngSwitch]');
  const parts: string[] = [];
  const todos: string[] = [];
  for (const a of node.attrs) {
    const { out, todo: t, todos: more } = convertAttr(a, tag);
    if (out) parts.push(out);
    if (t) todos.push(todo(t));
    for (const m of more ?? []) todos.push(todo(m));
  }

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
  return renderNodes(parseTemplate(html), opts);
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
  const propLines: string[] = [
    ...fact.inputs.map((i) => `  ${i}: unknown;`),
    ...fact.outputs.map((o) => `  on${o.charAt(0).toUpperCase()}${o.slice(1)}?: (value: unknown) => void;`),
  ];
  const propsType: string = propLines.length ? `{\n${propLines.join('\n')}\n}` : 'Record<string, never>';
  const usesProps: boolean = propLines.length > 0;

  const body: string[] = [];
  body.push(`// Converted from ${fact.className} (${fact.file}).`);
  body.push('// Props are reactive getters: read `props.x` live, never destructure them.');
  if (fact.injects.length) {
    body.push(`// TODO(weave migrate): this component injected ${fact.injects.join(', ')} —`);
    body.push('// a singleton service becomes a `store()`, a scoped one `provide`/`inject` (see the plan).');
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
  body.push(...draftMembers(carried, fact.className).lines);

  // A reactive form becomes a `form({ … })` in setup(); the template binds its leaves with `use:control`.
  const imports: string[] = [];
  if (carried.some((mem) => mem.kind === 'field')) imports.push("import { signal } from '@weave-framework/runtime';");
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

  const ts: string = [
    ...(imports.length ? [...imports, ''] : []),
    `export function setup(${usesProps ? `props: ${propsType}` : ''}) {`,
    ...body.map((l) => (l ? `  ${l}` : l)),
    '}',
    '',
  ].join('\n');

  return { baseName, ts, html: convertTemplate(templateHtml, opts) };
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

function draftMembers(members: ClassMember[], className: string): { lines: string[]; publicNames: string[] } {
  const out: string[] = [];
  // The returned surface is built from what was ACTUALLY declared here, never from a separate list — otherwise
  // the generated `return { … }` can name a binding that does not exist, which the compile gate catches as
  // "No value exists in scope for the shorthand property".
  const publicNames: string[] = [];
  const commented = (text: string | undefined, pad: string = '  '): string[] => (text ?? '').split('\n').map((l) => `${pad}// ${l}`);

  for (const mem of members) {
    if (mem.kind === 'constructor') {
      if (!mem.body.trim()) continue;
      out.push('');
      out.push(tsTodo(`the constructor ran this on creation — in a store the factory body IS the constructor,`));
      out.push('//   so port it right here (an ongoing subscription becomes an `effect`/`watch`).');
      out.push(`// ── original ${className} constructor ──`);
      out.push(...commented(mem.text, ''));
      continue;
    }
    if (mem.kind === 'field') {
      const vis: string = mem.isPublic ? '' : ' // was private — a local, not returned';
      const note: string = mem.isSignal ? ' // already a signal in Angular — a 1:1 move' : '';
      out.push(`const ${mem.name} = signal<unknown>(undefined);${vis}${note}`);
      out.push(...commented(mem.text, '')); // the original declaration, verbatim — initial value and type included
      if (mem.isPublic) publicNames.push(mem.name);
      continue;
    }
    out.push('');
    const hook: string | undefined = LIFECYCLE_HOOKS[mem.name];
    if (hook) {
      // An Angular lifecycle hook has a real Weave equivalent — name it instead of leaving a nameless function.
      out.push(`${tsTodo(`\`${mem.name}\` is a lifecycle hook → ${hook}`)}`);
    }
    out.push(`const ${mem.name} = (${mem.params}): void => {${mem.isPublic ? '' : ' // was private — a local, not returned'}`);
    out.push(`  ${tsTodo('port this — fields are signals now (`x.set(v)`), and `this.` is gone.')}`);
    if ((mem.text ?? '').trim()) {
      out.push(`  // ── original ${className}.${mem.name}() ──`);
      out.push(...commented(mem.text)); // the WHOLE original member, signature included — nothing paraphrased
    }
    out.push('};');
    if (mem.isPublic) publicNames.push(mem.name);
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
export function convertService(fact: ServiceFact, rxjsNames: string[] = []): { baseName: string; ts: string } {
  const singleton: boolean = fact.providedIn === 'root';
  const lines: string[] = [];
  const imports: string[] = ["import { signal } from '@weave-framework/runtime';"];
  if (singleton) imports.push("import { store } from '@weave-framework/store';");
  else imports.push("import { createContext } from '@weave-framework/runtime';");

  const body: string[] = [];
  if (fact.injects.length) {
    body.push(tsTodo(`this service injected ${fact.injects.join(', ')} — call each one's store hook here,`));
    body.push('//   e.g. `const other = useOther();`, or `inject(OtherContext)` for a scoped one.');
  }
  const drafted: { lines: string[]; publicNames: string[] } = draftMembers(fact.members ?? [], fact.className);
  body.push(...drafted.lines);
  body.push('');
  body.push(
    drafted.publicNames.length
      ? `return { ${drafted.publicNames.join(', ')} };`
      : `return {}; ${tsTodo('nothing was public — check what callers actually used')}`,
  );

  const hints: string[] = rxjsSuggestions(rxjsNames);
  const hintBlock: string[] = hints.length ? ['', tsTodo('this service used RxJS. In Weave:'), ...hints.map((h) => `//   ${h}`)] : [];

  if (singleton) {
    lines.push(
      ...imports,
      '',
      `// Converted from ${fact.className} (${fact.file}).`,
      `// It was \`providedIn: 'root'\` — a single instance for the whole app — so it becomes a store.`,
      ...hintBlock,
      `export const ${storeHookName(fact.className)} = store(() => {`,
      ...body.map((l) => `  ${l}`),
      '});',
      '',
    );
  } else {
    const ctx: string = `${fact.className.replace(/Service$/, '')}Context`;
    lines.push(
      ...imports,
      '',
      `// Converted from ${fact.className} (${fact.file}).`,
      '// It had no `providedIn`, so it was provided per-injector — in Weave that is a CONTEXT: an ancestor calls',
      `// \`provide(${ctx}, create${fact.className}())\` and any descendant \`inject(${ctx})\`.`,
      ...hintBlock,
      `export function create${fact.className}() {`,
      ...body.map((l) => `  ${l}`),
      '}',
      '',
      `export const ${ctx} = createContext<ReturnType<typeof create${fact.className}>>();`,
      '',
    );
  }
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
function relativeUnderSrc(file: string, unitDir: string): string {
  const rel: string = relative(unitDir, file);
  const parts: string[] = rel.split(/[\\/]/);
  const srcAt: number = parts.indexOf('src');
  return (srcAt === -1 ? parts : parts.slice(srcAt + 1)).join(sep);
}

/** `breadcrumbs.component.ts` → `breadcrumbs` — the Angular suffixes a Weave file does not carry. */
function weaveBaseName(fileName: string): string {
  return fileName.replace(/\.ts$/, '').replace(/\.(component|page|view)$/, '');
}

/** A component's source file loses its `.component` suffix on the way out, so imports pointing at it must too. */
function repointSpecifier(spec: string): string {
  return spec.replace(/\.component$/, '').replace(/\.component(['"])/, '$1');
}

/**
 * Carry a file that the converter has no specific rule for — a barrel, a helper module, a plain class, a model.
 *
 * These are usually already valid TypeScript, so the file is kept WHOLE rather than summarised: the only edits
 * are repointing relative imports at renamed outputs, and a header saying what to check. Producing nothing for
 * them, as this used to, meant a migration silently dropped half a library — including the entry point its
 * consumers import. Returns null only when the file cannot be read.
 */
export function carryFile(file: string, facts: MigrationFacts): string | null {
  let src: string;
  try {
    src = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  // Repoint relative import/export specifiers whose target is a component (its `.component` suffix is dropped).
  const repointed: string = src.replace(/(from\s*['"])(\.[^'"]+)(['"])/g, (_m, head: string, spec: string, tail: string) => `${head}${repointSpecifier(spec)}${tail}`);

  const angularImports: string[] = importedNamesFrom(file, '@angular');
  const header: string[] = [
    `// Carried over from ${file} by \`weave migrate\`.`,
    '// This file had no @Component/@Injectable, so it is kept as-is — most of it is plain TypeScript that already',
    '// works. Check the imports and anything Angular-specific below.',
  ];
  if (angularImports.length) {
    header.push(tsTodo(`it imports from @angular (${[...new Set(angularImports)].slice(0, 6).join(', ')}) — replace those with their Weave equivalents (see migration-plan.md).`));
  }
  if (facts.packages.some((p) => p.decision === 'auto' && importedNamesFrom(file, p.name).length)) {
    header.push(tsTodo('it uses a package you chose to migrate — check the plan for what it becomes.'));
  }
  return `${header.join('\n')}\n\n${repointed}`;
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
export function planWrites(facts: MigrationFacts, targetDir: string): WriteItem[] {
  const items: WriteItem[] = [];
  const opts: ConvertOptions = { components: componentNameMap(facts) };
  for (const cf of facts.components) {
    const rel: string = relativeUnderSrc(cf.file, facts.unit);
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
      const path: string = join(targetDir, 'src', dir, `${base}${ext}`);
      items.push({ path, content, status: existsSync(path) ? 'skip-exists' : 'write' });
    }
  }
  // Services (M5): a `providedIn:'root'` one becomes a store, anything else a context — drafted, not guessed.
  // The file NAME mirrors the source file, not the class: deriving it from the class name made
  // `breadcrumbs.component.ts` and `BreadcrumbsService` (in `breadcrumbs.service.ts`) both want `breadcrumbs.ts`,
  // and the second silently overwrote the first.
  for (const sf of facts.services) {
    const rel: string = relativeUnderSrc(sf.file, facts.unit);
    const dir: string = dirname(rel) === '.' ? '' : dirname(rel);
    const base: string = (rel.split(/[\\/]/).pop() ?? '').replace(/\.ts$/, '');
    const draft: { baseName: string; ts: string } = convertService(sf, importedNamesFrom(sf.file, 'rxjs'));
    const path: string = join(targetDir, 'src', dir, `${base || draft.baseName}.ts`);
    items.push({ path, content: draft.ts, status: existsSync(path) ? 'skip-exists' : 'write' });
  }
  // EVERY REMAINING FILE. A file with no @Component/@Injectable — a barrel, a helper module, a resolver, a model
  // — used to produce nothing at all, silently: on a real library that was half the files, including the
  // `index.ts` its consumers import. Most such files are already valid TypeScript, so they are carried across
  // whole, with their relative imports repointed at the renamed outputs.
  const covered: Set<string> = new Set<string>([...facts.components.map((cf) => cf.file), ...facts.services.map((sf) => sf.file)]);
  for (const file of facts.files) {
    if (covered.has(file)) continue;
    const rel: string = relativeUnderSrc(file, facts.unit);
    const dir: string = dirname(rel) === '.' ? '' : dirname(rel);
    const base: string = (rel.split(/[\\/]/).pop() ?? '').replace(/\.ts$/, '');
    const carried: string | null = carryFile(file, facts);
    if (carried === null) continue;
    const path: string = join(targetDir, 'src', dir, `${base}.ts`);
    items.push({ path, content: carried, status: existsSync(path) ? 'skip-exists' : 'write' });
  }
  // Route guards (M5.5) — one module, because Weave's `beforeEach` is global rather than per-route.
  const guards: string | null = convertGuards(facts.routes);
  if (guards) {
    const path: string = join(targetDir, 'src', 'guards.ts');
    items.push({ path, content: guards, status: existsSync(path) ? 'skip-exists' : 'write' });
  }
  return items;
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
