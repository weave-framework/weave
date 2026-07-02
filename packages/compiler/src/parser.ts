/**
 * Weave template parser — hand-written, zero dependencies.
 *
 * Parses an HTML-like template into a {@link TemplateNode} tree. Handles
 * elements, text, `{{ expr }}` interpolation, and the binding attribute forms
 * (`name={expr}`, `.prop={expr}`, `on:evt|mod={expr}`, `class:name={expr}`,
 * `bind:name={expr}`, `ref={expr}`). Control-flow blocks (`@if`/`@for`) are
 * added in M4; this parser deliberately treats a leading `@` as an error so the
 * gap is explicit rather than silently mis-parsed.
 */

import type {
  TemplateNode, ElementNode, Attr,
  IfNode, IfBranch, ForNode, SwitchNode, SwitchCase, LetNode, DeferNode, DeferTrigger,
  AwaitNode, AwaitBranch, SnippetNode, RenderNode, KeyNode,
} from './ast.js';

const BLOCK_KW: RegExp =
  /^@(if|else|for|empty|switch|case|default|let|defer|placeholder|await|then|catch|snippet|render|key)\b/;

const VOID: Set<string> = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

export class ParseError extends Error {}

/** A parsed attribute value: a static string, a `{expr}` (with its source offset), or none. */
type AttrValue =
  | { kind: 'static'; text: string }
  | { kind: 'expr'; expr: string; offset: number }
  | null;

export function parseTemplate(input: string): TemplateNode[] {
  const p: Parser = new Parser(input);
  const nodes: TemplateNode[] = p.parseChildren(null);
  return nodes;
}

class Parser {
  pos: number = 0;
  /** Inner start offset of the most recent {@link readParen} — for block-head expr offsets. */
  parenStart: number = 0;
  constructor(public src: string) {}

  /** Offset of `sub`'s first non-whitespace char within `parent` (which starts at `parentStart`). */
  exprOffset(parentStart: number, parent: string, sub: string): number {
    const at: number = parent.indexOf(sub);
    return parentStart + (at < 0 ? 0 : at) + (sub.length - sub.trimStart().length);
  }

  eof(): boolean {
    return this.pos >= this.src.length;
  }

  /**
   * Parse children until `</closeTag>` (element), `}` (block body when
   * `stopAtBrace`), or EOF. Does not consume the terminator.
   */
  parseChildren(closeTag: string | null, stopAtBrace: boolean = false): TemplateNode[] {
    const out: TemplateNode[] = [];
    while (!this.eof()) {
      if (stopAtBrace && this.peek() === '}') return out;
      if (this.src.startsWith('</', this.pos)) {
        if (closeTag === null) throw new ParseError(`Unexpected closing tag at ${this.pos}`);
        return out; // caller consumes the close tag
      }
      if (this.src.startsWith('{{', this.pos)) {
        const it: { expr: string; offset: number } = this.readInterp();
        out.push({ type: 'interp', expr: it.expr, offset: it.offset });
        continue;
      }
      if (this.src.startsWith('<!--', this.pos)) {
        this.skipComment();
        continue;
      }
      if (this.peek() === '@' && BLOCK_KW.test(this.src.slice(this.pos))) {
        out.push(this.parseBlock());
        continue;
      }
      if (this.peek() === '<') {
        out.push(this.parseElement());
        continue;
      }
      const text: string = this.readText(stopAtBrace);
      if (text) {
        // Coalesce with a preceding text node. Two text runs become adjacent when a
        // comment between them is skipped; the browser merges them into one Text node
        // when the emitted template HTML is parsed, so the AST must too — otherwise the
        // child-index paths the codegen computes are off by one for every later sibling.
        const last: TemplateNode | undefined = out[out.length - 1];
        if (last && last.type === 'text') last.value += text;
        else out.push({ type: 'text', value: text });
      }
    }
    if (closeTag !== null) throw new ParseError(`Unclosed <${closeTag}>`);
    return out;
  }

  /* ──────────── control-flow blocks ──────────── */

  parseBlock(): TemplateNode {
    const kw: string = (BLOCK_KW.exec(this.src.slice(this.pos)) as RegExpExecArray)[1];
    switch (kw) {
      case 'if': return this.parseIf();
      case 'for': return this.parseFor();
      case 'switch': return this.parseSwitch();
      case 'let': return this.parseLet();
      case 'defer': return this.parseDefer();
      case 'await': return this.parseAwait();
      case 'snippet': return this.parseSnippet();
      case 'render': return this.parseRender();
      case 'key': return this.parseKey();
      default:
        throw new ParseError(`Unexpected @${kw} at ${this.pos} (no matching block)`);
    }
  }

  parseIf(): IfNode {
    this.pos += 3; // @if
    this.skipWs();
    const head: string = this.readParen();
    const headStart: number = this.parenStart;
    const branches: IfBranch[] = [];
    let cond: string = head;
    let alias: string | undefined;
    const semi: string[] = splitTopLevel(head, ';');
    if (semi.length === 2) {
      cond = semi[0].trim();
      const m: RegExpExecArray | null = /^as\s+([A-Za-z_$][\w$]*)$/.exec(semi[1].trim());
      if (!m) throw new ParseError(`Expected 'as <name>' in @if, got '${semi[1].trim()}'`);
      alias = m[1];
    }
    const condOffset: number = this.exprOffset(headStart, head, cond);
    branches.push({ cond, condOffset, alias, children: this.readBlockBody() });

    // @else if / @else
    for (;;) {
      const save: number = this.pos;
      this.skipWs();
      if (this.src.startsWith('@else if', this.pos)) {
        this.pos += '@else if'.length;
        this.skipWs();
        const raw: string = this.readParen();
        const off: number = this.exprOffset(this.parenStart, raw, raw.trim());
        branches.push({ cond: raw.trim(), condOffset: off, children: this.readBlockBody() });
      } else if (this.src.startsWith('@else', this.pos)) {
        this.pos += '@else'.length;
        branches.push({ children: this.readBlockBody() });
        break;
      } else {
        this.pos = save;
        break;
      }
    }
    return { type: 'if', branches };
  }

  parseFor(): ForNode {
    this.pos += 4; // @for
    this.skipWs();
    const head: string = this.readParen();
    const headStart: number = this.parenStart;
    const parts: string[] = splitTopLevel(head, ';').map((s) => s.trim());
    const m: RegExpExecArray | null = /^([A-Za-z_$][\w$]*)\s+of\s+([\s\S]+)$/.exec(parts[0]);
    if (!m) throw new ParseError(`Expected '@for (item of list)', got '${parts[0]}'`);
    const item: string = m[1];
    const list: string = m[2].trim();
    let track: string | undefined;
    for (const extra of parts.slice(1)) {
      const t: RegExpExecArray | null = /^track\s+([\s\S]+)$/.exec(extra);
      if (t) track = t[1].trim();
    }
    const listOffset: number = this.exprOffset(headStart, head, list);
    const trackOffset: number | undefined = track ? this.exprOffset(headStart, head, track) : undefined;
    const children: TemplateNode[] = this.readBlockBody();

    let empty: TemplateNode[] | undefined;
    const save: number = this.pos;
    this.skipWs();
    if (this.src.startsWith('@empty', this.pos)) {
      this.pos += '@empty'.length;
      empty = this.readBlockBody();
    } else {
      this.pos = save;
    }
    return { type: 'for', item, list, listOffset, track, trackOffset, children, empty };
  }

  parseSwitch(): SwitchNode {
    this.pos += 7; // @switch
    this.skipWs();
    const rawExpr: string = this.readParen();
    const exprOffset: number = this.exprOffset(this.parenStart, rawExpr, rawExpr.trim());
    const expr: string = rawExpr.trim();
    this.skipWs();
    if (this.peek() !== '{') throw new ParseError(`Expected '{' after @switch at ${this.pos}`);
    this.pos++;
    const cases: SwitchCase[] = [];
    for (;;) {
      this.skipWs();
      if (this.peek() === '}') {
        this.pos++;
        break;
      }
      if (this.src.startsWith('@case', this.pos)) {
        this.pos += '@case'.length;
        this.skipWs();
        const rawTest: string = this.readParen();
        const testOffset: number = this.exprOffset(this.parenStart, rawTest, rawTest.trim());
        cases.push({ test: rawTest.trim(), testOffset, children: this.readBlockBody() });
      } else if (this.src.startsWith('@default', this.pos)) {
        this.pos += '@default'.length;
        cases.push({ children: this.readBlockBody() });
      } else {
        throw new ParseError(`Expected @case/@default or '}' in @switch at ${this.pos}`);
      }
    }
    return { type: 'switch', expr, exprOffset, cases };
  }

  parseLet(): LetNode {
    this.pos += 4; // @let
    this.skipWs();
    const name: string = this.readName();
    if (!name) throw new ParseError(`Expected name after @let at ${this.pos}`);
    this.skipWs();
    if (this.peek() !== '=') throw new ParseError(`Expected '=' in @let ${name}`);
    this.pos++;
    const rawStart: number = this.pos;
    const raw: string = this.readUntilSemicolon();
    const expr: string = raw.trim();
    const exprOffset: number = rawStart + (raw.length - raw.trimStart().length);
    if (this.peek() !== ';') throw new ParseError(`Expected ';' ending @let ${name}`);
    this.pos++;
    return { type: 'let', name, expr, exprOffset };
  }

  parseDefer(): DeferNode {
    this.pos += 6; // @defer
    this.skipWs();
    const head: string = this.readParen();
    const trigger: DeferTrigger = this.parseDeferTrigger(head, this.parenStart);
    const children: TemplateNode[] = this.readBlockBody();

    let placeholder: TemplateNode[] | undefined;
    const save: number = this.pos;
    this.skipWs();
    if (this.src.startsWith('@placeholder', this.pos)) {
      this.pos += '@placeholder'.length;
      placeholder = this.readBlockBody();
    } else {
      this.pos = save;
    }
    return { type: 'defer', trigger, children, placeholder };
  }

  parseAwait(): AwaitNode {
    this.pos += 6; // @await
    this.skipWs();
    const rawExpr: string = this.readParen();
    const expr: string = rawExpr.trim();
    const exprOffset: number = this.exprOffset(this.parenStart, rawExpr, expr);

    // Optional pending block: a `{` right after the source (anything else — e.g.
    // `@then` — means there is no pending content).
    let pending: TemplateNode[] | undefined;
    const save: number = this.pos;
    this.skipWs();
    if (this.peek() === '{') {
      this.pos = save;
      pending = this.readBlockBody();
    } else {
      this.pos = save;
    }

    const branch = (kw: string): AwaitBranch | undefined => {
      const s: number = this.pos;
      this.skipWs();
      if (this.src.startsWith(kw, this.pos)) {
        this.pos += kw.length;
        const alias: string | undefined = this.maybeAlias();
        return { alias, children: this.readBlockBody() };
      }
      this.pos = s;
      return undefined;
    };

    const thenBranch: AwaitBranch | undefined = branch('@then');
    const catchBranch: AwaitBranch | undefined = branch('@catch');
    return { type: 'await', expr, exprOffset, pending, then: thenBranch, catch: catchBranch };
  }

  parseSnippet(): SnippetNode {
    this.pos += '@snippet'.length;
    this.skipWs();
    const name: string = this.readIdent();
    if (!name) throw new ParseError(`Expected a snippet name after @snippet at ${this.pos}`);
    this.skipWs();
    if (this.peek() !== '(') throw new ParseError(`Expected '(' after @snippet ${name}`);
    const rawParams: string = this.readParen();
    const params: string[] = splitTopLevel(rawParams, ',').map((s) => s.trim()).filter(Boolean);
    for (const p of params) {
      if (!/^[A-Za-z_$][\w$]*$/.test(p)) {
        throw new ParseError(`Invalid @snippet parameter '${p}' (identifiers only)`);
      }
    }
    const children: TemplateNode[] = this.readBlockBody();
    return { type: 'snippet', name, params, children };
  }

  parseKey(): KeyNode {
    this.pos += '@key'.length;
    this.skipWs();
    const raw: string = this.readParen();
    const expr: string = raw.trim();
    if (!expr) throw new ParseError(`@key () needs an expression`);
    const exprOffset: number = this.exprOffset(this.parenStart, raw, expr);
    return { type: 'key', expr, exprOffset, children: this.readBlockBody() };
  }

  parseRender(): RenderNode {
    this.pos += '@render'.length;
    this.skipWs();
    if (this.peek() !== '(') throw new ParseError(`Expected '(' after @render at ${this.pos}`);
    const raw: string = this.readParen();
    const expr: string = raw.trim();
    if (!expr) throw new ParseError(`@render () needs an expression`);
    return { type: 'render', expr, exprOffset: this.exprOffset(this.parenStart, raw, expr) };
  }

  /** Read a JS identifier (`[A-Za-z_$][\w$]*`); '' if none at the cursor. */
  readIdent(): string {
    const start: number = this.pos;
    if (this.eof() || !/[A-Za-z_$]/.test(this.peek())) return '';
    this.pos++;
    while (!this.eof() && /[\w$]/.test(this.peek())) this.pos++;
    return this.src.slice(start, this.pos);
  }

  /** Optional `(name)` alias after `@then`/`@catch`. */
  maybeAlias(): string | undefined {
    const save: number = this.pos;
    this.skipWs();
    if (this.peek() === '(') {
      const inner: string = this.readParen().trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(inner)) {
        throw new ParseError(`Expected an identifier alias in @then/@catch, got '${inner}'`);
      }
      return inner;
    }
    this.pos = save;
    return undefined;
  }

  parseDeferTrigger(head: string, headStart: number): DeferTrigger {
    const h: string = head.trim();
    const whenM: RegExpExecArray | null = /^when\s+([\s\S]+)$/.exec(h);
    if (whenM) {
      const expr: string = whenM[1].trim();
      return { kind: 'when', expr, exprOffset: this.exprOffset(headStart, head, expr) };
    }
    if (h === 'immediate') return { kind: 'immediate' };
    const onM: RegExpExecArray | null = /^on\s+([\s\S]+)$/.exec(h);
    if (onM) {
      const on: string = onM[1].trim();
      const timerM: RegExpExecArray | null = /^timer\s*\(\s*([\s\S]+?)\s*\)$/.exec(on);
      if (timerM) {
        const ms: string = timerM[1].trim();
        return { kind: 'timer', ms, msOffset: this.exprOffset(headStart, head, ms) };
      }
      if (on === 'idle') return { kind: 'idle' };
      if (on === 'viewport') return { kind: 'viewport' };
      if (on === 'interaction') return { kind: 'interaction' };
      if (on === 'hover') return { kind: 'hover' };
      throw new ParseError(`Unknown @defer trigger 'on ${on}'`);
    }
    throw new ParseError(`Invalid @defer trigger '${h}' (use 'when <expr>', 'on idle|viewport|interaction|hover', 'on timer(ms)', or 'immediate')`);
  }

  /** `{ children }` */
  readBlockBody(): TemplateNode[] {
    this.skipWs();
    if (this.peek() !== '{') throw new ParseError(`Expected '{' at ${this.pos}`);
    this.pos++;
    const children: TemplateNode[] = this.parseChildren(null, true);
    if (this.peek() !== '}') throw new ParseError(`Expected '}' closing block at ${this.pos}`);
    this.pos++;
    return children;
  }

  /** Read a balanced `( … )` and return the inner text (parens consumed). */
  readParen(): string {
    if (this.peek() !== '(') throw new ParseError(`Expected '(' at ${this.pos}`);
    this.pos++;
    const start: number = this.pos;
    let depth: number = 1;
    while (!this.eof()) {
      const c: string = this.peek();
      if (c === '"' || c === "'" || c === '`') {
        this.skipString(c);
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) break;
      }
      this.pos++;
    }
    if (depth !== 0) throw new ParseError('Unclosed ( in block head');
    const inner: string = this.src.slice(start, this.pos);
    this.parenStart = start;
    this.pos++; // )
    return inner;
  }

  /** Read an expression up to a top-level `;` (for @let). */
  readUntilSemicolon(): string {
    const start: number = this.pos;
    let depth: number = 0;
    while (!this.eof()) {
      const c: string = this.peek();
      if (c === '"' || c === "'" || c === '`') {
        this.skipString(c);
        continue;
      }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (c === ';' && depth === 0) break;
      this.pos++;
    }
    return this.src.slice(start, this.pos);
  }

  peek(): string {
    return this.src[this.pos];
  }

  readInterp(): { expr: string; offset: number } {
    // Text interpolation uses the same brace-balanced, string-aware scan as attribute `{{ }}`, so a
    // literal `}}` inside a string (`{{ fn("}}") }}`) or an inner object literal doesn't cut it short
    // at a naive `indexOf('}}')`.
    return this.readDoubleBracedExpr();
  }

  skipComment(): void {
    const end: number = this.src.indexOf('-->', this.pos);
    this.pos = end === -1 ? this.src.length : end + 3;
  }

  readText(stopAtBrace: boolean): string {
    let out: string = '';
    while (!this.eof()) {
      const c: string = this.peek();
      if (c === '<' || this.src.startsWith('{{', this.pos)) break;
      if (stopAtBrace && c === '}') break;
      if (c === '@') {
        // `@@` is the escape for a literal `@` — lets prose mention block
        // keywords (`@@for`, `@@if`) without the parser treating them as blocks.
        if (this.src[this.pos + 1] === '@') {
          out += '@';
          this.pos += 2;
          continue;
        }
        if (BLOCK_KW.test(this.src.slice(this.pos))) break;
      }
      out += c;
      this.pos++;
    }
    return out;
  }

  parseElement(): ElementNode {
    this.pos++; // <
    const tagOffset: number = this.pos;
    const tag: string = this.readName();
    if (!tag) throw new ParseError(`Expected tag name at ${this.pos}`);
    const attrs: Attr[] = this.parseAttrs();

    this.skipWs();
    let selfClosing: boolean = false;
    if (this.peek() === '/') {
      selfClosing = true;
      this.pos++;
    }
    if (this.peek() !== '>') throw new ParseError(`Expected '>' for <${tag}> at ${this.pos}`);
    this.pos++; // >

    // Only lowercase HTML tags are void. A capitalized tag is a component (e.g. the
    // router's <Link>, which would otherwise collide with the void <link> element),
    // so it always takes children + a close tag.
    const isVoid: boolean = !/^[A-Z]/.test(tag) && VOID.has(tag.toLowerCase());
    if (selfClosing || isVoid) {
      return { type: 'element', tag, tagOffset, attrs, children: [], selfClosing: true };
    }

    const children: TemplateNode[] = this.parseChildren(tag);
    // consume the matching close tag
    if (!this.src.startsWith('</', this.pos)) throw new ParseError(`Unclosed <${tag}>`);
    this.pos += 2;
    const closeName: string = this.readName();
    if (closeName !== tag) throw new ParseError(`Mismatched </${closeName}>, expected </${tag}>`);
    this.skipWs();
    if (this.peek() !== '>') throw new ParseError(`Expected '>' closing </${tag}>`);
    this.pos++;

    return { type: 'element', tag, tagOffset, attrs, children, selfClosing: false };
  }

  parseAttrs(): Attr[] {
    const attrs: Attr[] = [];
    while (!this.eof()) {
      this.skipWs();
      const c: string = this.peek();
      if (c === '>' || c === '/' || c === undefined) break;
      attrs.push(this.parseAttr());
    }
    return attrs;
  }

  parseAttr(): Attr {
    const nameStart: number = this.pos;
    const rawName: string = this.readAttrName();
    let value: AttrValue = null;

    if (this.peek() === '=') {
      this.pos++; // =
      value = this.readAttrValue();
    }

    const attr: Attr = this.classifyAttr(rawName, value);
    // record the directive identifier's offset for `weave check` diagnostics
    if (attr.type === 'use') attr.nameOffset = nameStart + 'use:'.length;
    if (attr.type === 'transition') {
      const prefix: string = attr.mode === 'both' ? 'transition:' : attr.mode === 'in' ? 'in:' : 'out:';
      attr.nameOffset = nameStart + prefix.length;
    }
    return attr;
  }

  classifyAttr(rawName: string, value: AttrValue): Attr {
    const exprOf = (): string => {
      if (!value) throw new ParseError(`Binding '${rawName}' requires a value`);
      if (value.kind !== 'expr') throw new ParseError(`Binding '${rawName}' needs {expr}, got a string`);
      return value.expr;
    };
    const offset: number | undefined = value && value.kind === 'expr' ? value.offset : undefined;

    if (rawName === 'ref' || rawName === 'bind:this') {
      return { type: 'ref', expr: exprOf(), offset };
    }
    if (rawName.startsWith('on:')) {
      const [name, ...modifiers] = rawName.slice(3).split('|');
      return { type: 'event', name, modifiers, expr: exprOf(), offset };
    }
    if (rawName.startsWith('class:')) {
      return { type: 'class', name: rawName.slice(6), expr: exprOf(), offset };
    }
    if (rawName.startsWith('bind:')) {
      return { type: 'bind', name: rawName.slice(5), expr: exprOf(), offset };
    }
    if (rawName.startsWith('use:')) {
      // `use:action` (no arg) or `use:action={arg}`. The arg is optional.
      const name: string = rawName.slice(4);
      if (!name) throw new ParseError(`'use:' requires an action name, e.g. use:tooltip`);
      const expr: string | undefined = value && value.kind === 'expr' ? value.expr : undefined;
      if (value && value.kind === 'static') {
        throw new ParseError(`use:${name} needs {expr}, got a string`);
      }
      return { type: 'use', name, expr, offset };
    }
    if (rawName === 'show') {
      return { type: 'show', expr: exprOf(), offset };
    }
    if (rawName.startsWith('transition:') || rawName.startsWith('in:') || rawName.startsWith('out:')) {
      const mode: 'both' | 'in' | 'out' = rawName.startsWith('transition:') ? 'both' : rawName.startsWith('in:') ? 'in' : 'out';
      const prefix: string = mode === 'both' ? 'transition:' : mode === 'in' ? 'in:' : 'out:';
      const name: string = rawName.slice(prefix.length);
      if (!name) throw new ParseError(`'${prefix}' requires a transition function, e.g. ${prefix}fade`);
      if (value && value.kind === 'static') throw new ParseError(`${rawName} needs {expr} params, got a string`);
      const expr: string | undefined = value && value.kind === 'expr' ? value.expr : undefined;
      return { type: 'transition', name, mode, expr, offset };
    }
    if (rawName.startsWith('.')) {
      return { type: 'prop', name: rawName.slice(1), expr: exprOf(), offset };
    }
    if (value && value.kind === 'expr') {
      return { type: 'attr', name: rawName, expr: value.expr, offset };
    }
    return { type: 'static', name: rawName, value: value ? value.text : '' };
  }

  readName(): string {
    const start: number = this.pos;
    // `:` allowed so namespaced tags parse (`<w:element>` — the dynamic element).
    while (!this.eof() && /[A-Za-z0-9\-:]/.test(this.peek())) this.pos++;
    return this.src.slice(start, this.pos);
  }

  readAttrName(): string {
    const start: number = this.pos;
    while (!this.eof() && /[A-Za-z0-9_\-:.|@]/.test(this.peek())) this.pos++;
    return this.src.slice(start, this.pos);
  }

  readAttrValue(): Exclude<AttrValue, null> {
    const c: string = this.peek();
    if (c === '{') {
      // Attribute/directive bindings use double braces — `attr={{ expr }}` — matching
      // text interpolation. One syntax everywhere; a single `{` is rejected so
      // the author can't accidentally fall back to the old form.
      if (!this.src.startsWith('{{', this.pos)) {
        throw new ParseError(`Attribute bindings use double braces: write {{ expr }}, not { expr } (at ${this.pos})`);
      }
      const b: { expr: string; offset: number } = this.readDoubleBracedExpr();
      return { kind: 'expr', expr: b.expr, offset: b.offset };
    }
    if (c === '"' || c === "'") return { kind: 'static', text: this.readQuoted(c) };
    // unquoted
    const start: number = this.pos;
    while (!this.eof() && !/[\s>/]/.test(this.peek())) this.pos++;
    return { kind: 'static', text: this.src.slice(start, this.pos) };
  }

  readQuoted(quote: string): string {
    this.pos++; // opening quote
    const start: number = this.pos;
    while (!this.eof() && this.peek() !== quote) this.pos++;
    const text: string = this.src.slice(start, this.pos);
    this.pos++; // closing quote
    return text;
  }

  /** Read a `{{ ... }}` expression, balancing inner braces and skipping string literals. */
  readDoubleBracedExpr(): { expr: string; offset: number } {
    this.pos += 2; // {{
    const start: number = this.pos;
    let depth: number = 0; // depth of inner (non-delimiting) braces
    while (!this.eof()) {
      const c: string = this.peek();
      if (c === '"' || c === "'" || c === '`') {
        this.skipString(c);
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        if (depth > 0) depth--;
        else if (this.src[this.pos + 1] === '}') break; // closing }}
      }
      this.pos++;
    }
    if (this.eof()) throw new ParseError('Unclosed {{ expression');
    const raw: string = this.src.slice(start, this.pos);
    this.pos += 2; // }}
    return { expr: raw.trim(), offset: start + (raw.length - raw.trimStart().length) };
  }

  skipString(quote: string): void {
    this.pos++; // opening
    while (!this.eof()) {
      const c: string = this.peek();
      if (c === '\\') {
        this.pos += 2;
        continue;
      }
      this.pos++;
      if (c === quote) return;
    }
  }

  skipWs(): void {
    while (!this.eof() && /\s/.test(this.peek())) this.pos++;
  }
}

/** Split `s` on top-level occurrences of `sep`, respecting (), [], {}, and strings. */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth: number = 0;
  let last: number = 0;
  for (let i: number = 0; i < s.length; i++) {
    const c: string = s[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipStr(s, i);
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === sep && depth === 0) {
      out.push(s.slice(last, i));
      last = i + 1;
    }
  }
  out.push(s.slice(last));
  return out;
}

function skipStr(s: string, start: number): number {
  const q: string = s[start];
  let i: number = start + 1;
  while (i < s.length) {
    if (s[i] === '\\') {
      i += 2;
      continue;
    }
    if (s[i] === q) return i;
    i++;
  }
  return s.length;
}
