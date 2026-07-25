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
import { importedNamesFrom, type ComponentFact, type MigrationFacts, type ServiceFact } from './migrate-analyze.js';

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
export function convertComponent(fact: ComponentFact, templateHtml: string, opts: ConvertOptions = {}): ConvertedComponent {
  const baseName: string = baseNameFor(fact);
  const propLines: string[] = [
    ...fact.inputs.map((i) => `  ${i}: unknown;`),
    ...fact.outputs.map((o) => `  on${o.charAt(0).toUpperCase()}${o.slice(1)}?: (value: unknown) => void;`),
  ];
  const propsType: string = propLines.length ? `{\n${propLines.join('\n')}\n}` : 'Record<string, never>';
  const usesProps: boolean = propLines.length > 0;

  const body: string[] = [];
  body.push(`// Converted from ${fact.className} (${fact.file}).`);
  body.push('// TODO(weave migrate): move the class body here — fields become signals, methods become plain');
  body.push('// functions. Props are reactive getters: read `props.x` live, never destructure them.');
  if (fact.injects.length) {
    body.push(`// TODO(weave migrate): this component injected ${fact.injects.join(', ')} —`);
    body.push('// a singleton service becomes a `store()`, a scoped one `provide`/`inject` (see the plan).');
  }

  const ts: string = [
    ...(usesProps ? [] : []),
    `export function setup(${usesProps ? `props: ${propsType}` : ''}) {`,
    ...body.map((l) => `  ${l}`),
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
  for (const f of fact.fields) {
    const wasSignal: boolean = fact.signals.includes(f);
    body.push(`const ${f} = signal<unknown>(undefined);${wasSignal ? ' // already a signal in Angular — a 1:1 move' : ` ${tsTodo(`was a plain field; set its real initial value`)}`}`);
  }
  for (const m of fact.methods) {
    body.push(`const ${m} = (): void => {`);
    body.push(`  ${tsTodo(`port the body of ${fact.className}.${m}()`)}`);
    body.push('};');
  }
  const surface: string[] = [...fact.fields, ...fact.methods];
  body.push(`return { ${surface.join(', ')} };`);

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
    const pair: ConvertedComponent = convertComponent(cf, html ?? '', opts);
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
  for (const sf of facts.services) {
    const rel: string = relativeUnderSrc(sf.file, facts.unit);
    const dir: string = dirname(rel) === '.' ? '' : dirname(rel);
    const draft: { baseName: string; ts: string } = convertService(sf, importedNamesFrom(sf.file, 'rxjs'));
    const path: string = join(targetDir, 'src', dir, `${draft.baseName}.ts`);
    items.push({ path, content: draft.ts, status: existsSync(path) ? 'skip-exists' : 'write' });
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
