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
  AwaitNode, AwaitBranch, SnippetNode, RenderNode,
} from './ast.js';

const BLOCK_KW =
  /^@(if|else|for|empty|switch|case|default|let|defer|placeholder|await|then|catch|snippet|render)\b/;

const VOID = new Set([
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
  const p = new Parser(input);
  const nodes = p.parseChildren(null);
  return nodes;
}

class Parser {
  pos = 0;
  /** Inner start offset of the most recent {@link readParen} — for block-head expr offsets. */
  parenStart = 0;
  constructor(public src: string) {}

  /** Offset of `sub`'s first non-whitespace char within `parent` (which starts at `parentStart`). */
  exprOffset(parentStart: number, parent: string, sub: string): number {
    const at = parent.indexOf(sub);
    return parentStart + (at < 0 ? 0 : at) + (sub.length - sub.trimStart().length);
  }

  eof(): boolean {
    return this.pos >= this.src.length;
  }

  /**
   * Parse children until `</closeTag>` (element), `}` (block body when
   * `stopAtBrace`), or EOF. Does not consume the terminator.
   */
  parseChildren(closeTag: string | null, stopAtBrace = false): TemplateNode[] {
    const out: TemplateNode[] = [];
    while (!this.eof()) {
      if (stopAtBrace && this.peek() === '}') return out;
      if (this.src.startsWith('</', this.pos)) {
        if (closeTag === null) throw new ParseError(`Unexpected closing tag at ${this.pos}`);
        return out; // caller consumes the close tag
      }
      if (this.src.startsWith('{{', this.pos)) {
        const it = this.readInterp();
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
      const text = this.readText(stopAtBrace);
      if (text) out.push({ type: 'text', value: text });
    }
    if (closeTag !== null) throw new ParseError(`Unclosed <${closeTag}>`);
    return out;
  }

  /* ──────────── control-flow blocks ──────────── */

  parseBlock(): TemplateNode {
    const kw = (BLOCK_KW.exec(this.src.slice(this.pos)) as RegExpExecArray)[1];
    switch (kw) {
      case 'if': return this.parseIf();
      case 'for': return this.parseFor();
      case 'switch': return this.parseSwitch();
      case 'let': return this.parseLet();
      case 'defer': return this.parseDefer();
      case 'await': return this.parseAwait();
      case 'snippet': return this.parseSnippet();
      case 'render': return this.parseRender();
      default:
        throw new ParseError(`Unexpected @${kw} at ${this.pos} (no matching block)`);
    }
  }

  parseIf(): IfNode {
    this.pos += 3; // @if
    this.skipWs();
    const head = this.readParen();
    const headStart = this.parenStart;
    const branches: IfBranch[] = [];
    let cond = head;
    let alias: string | undefined;
    const semi = splitTopLevel(head, ';');
    if (semi.length === 2) {
      cond = semi[0].trim();
      const m = /^as\s+([A-Za-z_$][\w$]*)$/.exec(semi[1].trim());
      if (!m) throw new ParseError(`Expected 'as <name>' in @if, got '${semi[1].trim()}'`);
      alias = m[1];
    }
    const condOffset = this.exprOffset(headStart, head, cond);
    branches.push({ cond, condOffset, alias, children: this.readBlockBody() });

    // @else if / @else
    for (;;) {
      const save = this.pos;
      this.skipWs();
      if (this.src.startsWith('@else if', this.pos)) {
        this.pos += '@else if'.length;
        this.skipWs();
        const raw = this.readParen();
        const off = this.exprOffset(this.parenStart, raw, raw.trim());
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
    const head = this.readParen();
    const headStart = this.parenStart;
    const parts = splitTopLevel(head, ';').map((s) => s.trim());
    const m = /^([A-Za-z_$][\w$]*)\s+of\s+([\s\S]+)$/.exec(parts[0]);
    if (!m) throw new ParseError(`Expected '@for (item of list)', got '${parts[0]}'`);
    const item = m[1];
    const list = m[2].trim();
    let track: string | undefined;
    for (const extra of parts.slice(1)) {
      const t = /^track\s+([\s\S]+)$/.exec(extra);
      if (t) track = t[1].trim();
    }
    const listOffset = this.exprOffset(headStart, head, list);
    const trackOffset = track ? this.exprOffset(headStart, head, track) : undefined;
    const children = this.readBlockBody();

    let empty: TemplateNode[] | undefined;
    const save = this.pos;
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
    const rawExpr = this.readParen();
    const exprOffset = this.exprOffset(this.parenStart, rawExpr, rawExpr.trim());
    const expr = rawExpr.trim();
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
        const rawTest = this.readParen();
        const testOffset = this.exprOffset(this.parenStart, rawTest, rawTest.trim());
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
    const name = this.readName();
    if (!name) throw new ParseError(`Expected name after @let at ${this.pos}`);
    this.skipWs();
    if (this.peek() !== '=') throw new ParseError(`Expected '=' in @let ${name}`);
    this.pos++;
    const rawStart = this.pos;
    const raw = this.readUntilSemicolon();
    const expr = raw.trim();
    const exprOffset = rawStart + (raw.length - raw.trimStart().length);
    if (this.peek() !== ';') throw new ParseError(`Expected ';' ending @let ${name}`);
    this.pos++;
    return { type: 'let', name, expr, exprOffset };
  }

  parseDefer(): DeferNode {
    this.pos += 6; // @defer
    this.skipWs();
    const head = this.readParen();
    const trigger = this.parseDeferTrigger(head, this.parenStart);
    const children = this.readBlockBody();

    let placeholder: TemplateNode[] | undefined;
    const save = this.pos;
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
    const rawExpr = this.readParen();
    const expr = rawExpr.trim();
    const exprOffset = this.exprOffset(this.parenStart, rawExpr, expr);

    // Optional pending block: a `{` right after the source (anything else — e.g.
    // `@then` — means there is no pending content).
    let pending: TemplateNode[] | undefined;
    const save = this.pos;
    this.skipWs();
    if (this.peek() === '{') {
      this.pos = save;
      pending = this.readBlockBody();
    } else {
      this.pos = save;
    }

    const branch = (kw: string): AwaitBranch | undefined => {
      const s = this.pos;
      this.skipWs();
      if (this.src.startsWith(kw, this.pos)) {
        this.pos += kw.length;
        const alias = this.maybeAlias();
        return { alias, children: this.readBlockBody() };
      }
      this.pos = s;
      return undefined;
    };

    const thenBranch = branch('@then');
    const catchBranch = branch('@catch');
    return { type: 'await', expr, exprOffset, pending, then: thenBranch, catch: catchBranch };
  }

  parseSnippet(): SnippetNode {
    this.pos += '@snippet'.length;
    this.skipWs();
    const name = this.readIdent();
    if (!name) throw new ParseError(`Expected a snippet name after @snippet at ${this.pos}`);
    this.skipWs();
    if (this.peek() !== '(') throw new ParseError(`Expected '(' after @snippet ${name}`);
    const rawParams = this.readParen();
    const params = splitTopLevel(rawParams, ',').map((s) => s.trim()).filter(Boolean);
    for (const p of params) {
      if (!/^[A-Za-z_$][\w$]*$/.test(p)) {
        throw new ParseError(`Invalid @snippet parameter '${p}' (identifiers only)`);
      }
    }
    const children = this.readBlockBody();
    return { type: 'snippet', name, params, children };
  }

  parseRender(): RenderNode {
    this.pos += '@render'.length;
    this.skipWs();
    if (this.peek() !== '(') throw new ParseError(`Expected '(' after @render at ${this.pos}`);
    const raw = this.readParen();
    const expr = raw.trim();
    if (!expr) throw new ParseError(`@render () needs an expression`);
    return { type: 'render', expr, exprOffset: this.exprOffset(this.parenStart, raw, expr) };
  }

  /** Read a JS identifier (`[A-Za-z_$][\w$]*`); '' if none at the cursor. */
  readIdent(): string {
    const start = this.pos;
    if (this.eof() || !/[A-Za-z_$]/.test(this.peek())) return '';
    this.pos++;
    while (!this.eof() && /[\w$]/.test(this.peek())) this.pos++;
    return this.src.slice(start, this.pos);
  }

  /** Optional `(name)` alias after `@then`/`@catch`. */
  maybeAlias(): string | undefined {
    const save = this.pos;
    this.skipWs();
    if (this.peek() === '(') {
      const inner = this.readParen().trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(inner)) {
        throw new ParseError(`Expected an identifier alias in @then/@catch, got '${inner}'`);
      }
      return inner;
    }
    this.pos = save;
    return undefined;
  }

  parseDeferTrigger(head: string, headStart: number): DeferTrigger {
    const h = head.trim();
    const whenM = /^when\s+([\s\S]+)$/.exec(h);
    if (whenM) {
      const expr = whenM[1].trim();
      return { kind: 'when', expr, exprOffset: this.exprOffset(headStart, head, expr) };
    }
    if (h === 'immediate') return { kind: 'immediate' };
    const onM = /^on\s+([\s\S]+)$/.exec(h);
    if (onM) {
      const on = onM[1].trim();
      const timerM = /^timer\s*\(\s*([\s\S]+?)\s*\)$/.exec(on);
      if (timerM) {
        const ms = timerM[1].trim();
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
    const children = this.parseChildren(null, true);
    if (this.peek() !== '}') throw new ParseError(`Expected '}' closing block at ${this.pos}`);
    this.pos++;
    return children;
  }

  /** Read a balanced `( … )` and return the inner text (parens consumed). */
  readParen(): string {
    if (this.peek() !== '(') throw new ParseError(`Expected '(' at ${this.pos}`);
    this.pos++;
    const start = this.pos;
    let depth = 1;
    while (!this.eof()) {
      const c = this.peek();
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
    const inner = this.src.slice(start, this.pos);
    this.parenStart = start;
    this.pos++; // )
    return inner;
  }

  /** Read an expression up to a top-level `;` (for @let). */
  readUntilSemicolon(): string {
    const start = this.pos;
    let depth = 0;
    while (!this.eof()) {
      const c = this.peek();
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
    this.pos += 2; // {{
    const start = this.pos;
    const end = this.src.indexOf('}}', this.pos);
    if (end === -1) throw new ParseError('Unclosed {{ interpolation');
    this.pos = end + 2;
    const raw = this.src.slice(start, end);
    return { expr: raw.trim(), offset: start + (raw.length - raw.trimStart().length) };
  }

  skipComment(): void {
    const end = this.src.indexOf('-->', this.pos);
    this.pos = end === -1 ? this.src.length : end + 3;
  }

  readText(stopAtBrace: boolean): string {
    const start = this.pos;
    while (!this.eof()) {
      const c = this.peek();
      if (c === '<' || this.src.startsWith('{{', this.pos)) break;
      if (stopAtBrace && c === '}') break;
      if (c === '@' && BLOCK_KW.test(this.src.slice(this.pos))) break;
      this.pos++;
    }
    return this.src.slice(start, this.pos);
  }

  parseElement(): ElementNode {
    this.pos++; // <
    const tag = this.readName();
    if (!tag) throw new ParseError(`Expected tag name at ${this.pos}`);
    const attrs = this.parseAttrs();

    this.skipWs();
    let selfClosing = false;
    if (this.peek() === '/') {
      selfClosing = true;
      this.pos++;
    }
    if (this.peek() !== '>') throw new ParseError(`Expected '>' for <${tag}> at ${this.pos}`);
    this.pos++; // >

    const isVoid = VOID.has(tag.toLowerCase());
    if (selfClosing || isVoid) {
      return { type: 'element', tag, attrs, children: [], selfClosing: true };
    }

    const children = this.parseChildren(tag);
    // consume the matching close tag
    if (!this.src.startsWith('</', this.pos)) throw new ParseError(`Unclosed <${tag}>`);
    this.pos += 2;
    const closeName = this.readName();
    if (closeName !== tag) throw new ParseError(`Mismatched </${closeName}>, expected </${tag}>`);
    this.skipWs();
    if (this.peek() !== '>') throw new ParseError(`Expected '>' closing </${tag}>`);
    this.pos++;

    return { type: 'element', tag, attrs, children, selfClosing: false };
  }

  parseAttrs(): Attr[] {
    const attrs: Attr[] = [];
    while (!this.eof()) {
      this.skipWs();
      const c = this.peek();
      if (c === '>' || c === '/' || c === undefined) break;
      attrs.push(this.parseAttr());
    }
    return attrs;
  }

  parseAttr(): Attr {
    const nameStart = this.pos;
    const rawName = this.readAttrName();
    let value: AttrValue = null;

    if (this.peek() === '=') {
      this.pos++; // =
      value = this.readAttrValue();
    }

    const attr = this.classifyAttr(rawName, value);
    // record the action identifier's offset for `weave check` diagnostics
    if (attr.type === 'use') attr.nameOffset = nameStart + 'use:'.length;
    return attr;
  }

  classifyAttr(rawName: string, value: AttrValue): Attr {
    const exprOf = (): string => {
      if (!value) throw new ParseError(`Binding '${rawName}' requires a value`);
      if (value.kind !== 'expr') throw new ParseError(`Binding '${rawName}' needs {expr}, got a string`);
      return value.expr;
    };
    const offset = value && value.kind === 'expr' ? value.offset : undefined;

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
      const name = rawName.slice(4);
      if (!name) throw new ParseError(`'use:' requires an action name, e.g. use:tooltip`);
      const expr = value && value.kind === 'expr' ? value.expr : undefined;
      if (value && value.kind === 'static') {
        throw new ParseError(`use:${name} needs {expr}, got a string`);
      }
      return { type: 'use', name, expr, offset };
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
    const start = this.pos;
    while (!this.eof() && /[A-Za-z0-9\-]/.test(this.peek())) this.pos++;
    return this.src.slice(start, this.pos);
  }

  readAttrName(): string {
    const start = this.pos;
    while (!this.eof() && /[A-Za-z0-9_\-:.|@]/.test(this.peek())) this.pos++;
    return this.src.slice(start, this.pos);
  }

  readAttrValue(): Exclude<AttrValue, null> {
    const c = this.peek();
    if (c === '{') {
      const b = this.readBracedExpr();
      return { kind: 'expr', expr: b.expr, offset: b.offset };
    }
    if (c === '"' || c === "'") return { kind: 'static', text: this.readQuoted(c) };
    // unquoted
    const start = this.pos;
    while (!this.eof() && !/[\s>/]/.test(this.peek())) this.pos++;
    return { kind: 'static', text: this.src.slice(start, this.pos) };
  }

  readQuoted(quote: string): string {
    this.pos++; // opening quote
    const start = this.pos;
    while (!this.eof() && this.peek() !== quote) this.pos++;
    const text = this.src.slice(start, this.pos);
    this.pos++; // closing quote
    return text;
  }

  /** Read a `{ ... }` expression, balancing braces and skipping string literals. */
  readBracedExpr(): { expr: string; offset: number } {
    this.pos++; // {
    const start = this.pos;
    let depth = 1;
    while (!this.eof()) {
      const c = this.peek();
      if (c === '"' || c === "'" || c === '`') {
        this.skipString(c);
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) break;
      }
      this.pos++;
    }
    if (depth !== 0) throw new ParseError('Unclosed { expression');
    const raw = this.src.slice(start, this.pos);
    this.pos++; // }
    return { expr: raw.trim(), offset: start + (raw.length - raw.trimStart().length) };
  }

  skipString(quote: string): void {
    this.pos++; // opening
    while (!this.eof()) {
      const c = this.peek();
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
  let depth = 0;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
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
  const q = s[start];
  let i = start + 1;
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
