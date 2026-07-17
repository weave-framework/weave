/**
 * `@weave-framework/runtime/server-dom` — a tiny, in-house, zero-dependency DOM for headless render
 * (Phase E, E0.4). @internal
 *
 * The headless DOM seam of RFC 0009 §4: the eager runtime (`runtime/dom`) creates DOM through the global
 * `document` and `instanceof Element` checks. On a server (Node) there is no DOM, so this module provides a
 * minimal implementation — element / text / comment / fragment / template nodes, a small compiler-HTML
 * parser (for the template strings the codegen emits), and an HTML serializer — and {@link installServerDom}
 * installs it as the globals (`document`, `Element`, `Comment`, …). The UNCHANGED `runtime/dom` then runs
 * against it and its output serializes to a string via {@link serializeNode}. Guarded: install is a no-op
 * when a real `document` already exists (the browser), so the browser path is byte-for-byte untouched (I2).
 *
 * Scope (E0.4): the structural + text/attr/class/style/event paths — enough to render a real page and the
 * `data-won-*` resumable markers to HTML. Not a full DOM: no layout/measurement, no live events (listeners
 * are recorded, never fired — a one-shot render), no `getBoundingClientRect`. It is not shipped in the SPA
 * bundle (its own entry; 0 bytes for a client app — invariant I3).
 */

const VOID_TAGS: Set<string> = new Set<string>([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const dashify = (p: string): string =>
  p.startsWith('--') ? p : p.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

const escapeText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/* ──────────────────────────── nodes ──────────────────────────── */

let ELEMENT_NODE: number = 1, TEXT_NODE: number = 3, COMMENT_NODE: number = 8, FRAGMENT_NODE: number = 11;

class SNode {
  nodeType: number = 0;
  childNodes: SNode[] = [];
  parentNode: SNode | null = null;

  get firstChild(): SNode | null {
    return this.childNodes[0] ?? null;
  }
  get nextSibling(): SNode | null {
    const p: SNode | null = this.parentNode;
    if (!p) return null;
    const i: number = p.childNodes.indexOf(this);
    return p.childNodes[i + 1] ?? null;
  }
  get firstElementChild(): SElement | null {
    for (const c of this.childNodes) if (c.nodeType === ELEMENT_NODE) return c as SElement;
    return null;
  }

  // Adopting a fragment moves its children (DOM semantics).
  private expand(node: SNode): SNode[] {
    if (node.nodeType === FRAGMENT_NODE) {
      const kids: SNode[] = node.childNodes.slice();
      node.childNodes.length = 0;
      return kids;
    }
    return [node];
  }

  appendChild<T extends SNode>(node: T): T {
    for (const n of this.expand(node)) {
      if (n.parentNode) n.parentNode.removeChild(n);
      n.parentNode = this;
      this.childNodes.push(n);
    }
    return node;
  }
  insertBefore<T extends SNode>(node: T, before: SNode | null): T {
    if (before == null) return this.appendChild(node);
    for (const n of this.expand(node)) {
      if (n.parentNode) n.parentNode.removeChild(n);
      const i: number = this.childNodes.indexOf(before);
      this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, n);
      n.parentNode = this;
    }
    return node;
  }
  removeChild<T extends SNode>(node: T): T {
    const i: number = this.childNodes.indexOf(node);
    if (i >= 0) this.childNodes.splice(i, 1);
    node.parentNode = null;
    return node;
  }
  replaceChild<T extends SNode>(next: SNode, old: T): T {
    this.insertBefore(next, old);
    this.removeChild(old);
    return old;
  }
  remove(): void {
    this.parentNode?.removeChild(this);
  }
  append(...nodes: SNode[]): void {
    for (const n of nodes) this.appendChild(n);
  }

  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(value: string) {
    this.childNodes.length = 0;
    if (value) this.appendChild(new SText(value));
  }

  cloneNode(deep: boolean = false): SNode {
    const copy: SNode = this._shallow();
    if (deep) for (const c of this.childNodes) copy.appendChild(c.cloneNode(true));
    return copy;
  }
  protected _shallow(): SNode {
    return new SNode();
  }
}

class SText extends SNode {
  nodeType: number = TEXT_NODE;
  data: string;
  constructor(data: string = '') {
    super();
    this.data = data;
  }
  get textContent(): string {
    return this.data;
  }
  set textContent(v: string) {
    this.data = v;
  }
  protected _shallow(): SNode {
    return new SText(this.data);
  }
}

class SComment extends SNode {
  nodeType: number = COMMENT_NODE;
  data: string;
  constructor(data: string = '') {
    super();
    this.data = data;
  }
  get textContent(): string {
    return '';
  }
  set textContent(_v: string) {
    /* comments hold no text content */
  }
  protected _shallow(): SNode {
    return new SComment(this.data);
  }
}

/** A tiny `CSSStyleDeclaration`. */
interface SStyle {
  cssText: string;
  setProperty(name: string, value: unknown): void;
  getPropertyValue(name: string): string;
  removeProperty(name: string): void;
  toCss(): string;
  [key: string]: unknown;
}

/** Build an {@link SStyle} — a Proxy so `el.style.color = 'red'` and `.setProperty('--x', …)` both work. */
function makeStyle(): SStyle {
  const props: Map<string, string> = new Map<string, string>();
  const api: SStyle = {
    setProperty(name: string, value: unknown): void {
      props.set(name, String(value));
    },
    getPropertyValue(name: string): string {
      return props.get(name) ?? '';
    },
    removeProperty(name: string): void {
      props.delete(name);
    },
    get cssText(): string {
      return [...props].map(([k, v]) => `${k}: ${v}`).join('; ');
    },
    set cssText(text: string) {
      props.clear();
      for (const decl of String(text).split(';')) {
        const i: number = decl.indexOf(':');
        if (i > 0) props.set(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
      }
    },
    toCss(): string {
      return this.cssText as string;
    },
  };
  return new Proxy(api, {
    get(t: SStyle, p: string | symbol): unknown {
      if (typeof p === 'string' && !(p in t)) return props.get(dashify(p)) ?? '';
      return Reflect.get(t, p);
    },
    set(t: SStyle, p: string | symbol, value: unknown): boolean {
      if (p === 'cssText') t.cssText = String(value);
      else if (typeof p === 'string') props.set(dashify(p), String(value));
      return true;
    },
  }) as SStyle;
}

class SElement extends SNode {
  nodeType: number = ELEMENT_NODE;
  tagName: string;
  namespaceURI: string | null;
  private attrs: Map<string, string> = new Map<string, string>();
  style: SStyle = makeStyle();

  constructor(tag: string, ns: string | null = null) {
    super();
    this.tagName = tag;
    this.namespaceURI = ns;
  }

  setAttribute(name: string, value: string): void {
    if (name === 'style') {
      this.style.cssText = String(value);
      return;
    }
    this.attrs.set(name, String(value));
  }
  getAttribute(name: string): string | null {
    if (name === 'style') {
      const css: string = this.style.toCss();
      return css || null;
    }
    return this.attrs.has(name) ? (this.attrs.get(name) as string) : null;
  }
  hasAttribute(name: string): boolean {
    return name === 'style' ? this.style.toCss() !== '' : this.attrs.has(name);
  }
  removeAttribute(name: string): void {
    if (name === 'style') this.style.cssText = '';
    else this.attrs.delete(name);
  }

  get className(): string {
    return this.attrs.get('class') ?? '';
  }
  set className(v: string) {
    this.attrs.set('class', v);
  }
  get classList(): {
    toggle(name: string, force?: boolean): void;
    add(name: string): void;
    remove(name: string): void;
    contains(name: string): boolean;
  } {
    const el: SElement = this;
    const read = (): Set<string> => new Set((el.attrs.get('class') ?? '').split(/\s+/).filter(Boolean));
    const write = (s: Set<string>): void => {
      const v: string = [...s].join(' ');
      if (v) el.attrs.set('class', v);
      else el.attrs.delete('class');
    };
    return {
      contains: (name) => read().has(name),
      add: (name) => { const s: Set<string> = read(); s.add(name); write(s); },
      remove: (name) => { const s: Set<string> = read(); s.delete(name); write(s); },
      toggle: (name, force) => {
        const s: Set<string> = read();
        const on: boolean = force === undefined ? !s.has(name) : force;
        if (on) s.add(name); else s.delete(name);
        write(s);
      },
    };
  }

  // On the server a render is one-shot: record listeners (so nothing throws) but never fire them.
  addEventListener(): void {}
  removeEventListener(): void {}

  set innerHTML(html: string) {
    this.childNodes.length = 0;
    for (const n of parseHtml(html, this.namespaceURI)) this.appendChild(n);
  }
  get outerHTML(): string {
    return serializeNode(this);
  }

  querySelector(sel: string): SElement | null {
    const match = (el: SElement): boolean => {
      if (sel.startsWith('#')) return el.getAttribute('id') === sel.slice(1);
      if (sel.startsWith('.')) return el.classList.contains(sel.slice(1));
      return el.tagName.toLowerCase() === sel.toLowerCase();
    };
    const walk = (node: SNode): SElement | null => {
      for (const c of node.childNodes) {
        if (c.nodeType === ELEMENT_NODE) {
          if (match(c as SElement)) return c as SElement;
          const found: SElement | null = walk(c);
          if (found) return found;
        }
      }
      return null;
    };
    return walk(this);
  }

  /** Attributes in insertion order (class first if present), as [name, value]; style folded in. */
  attrList(): [string, string][] {
    const out: [string, string][] = [...this.attrs];
    const css: string = this.style.toCss();
    if (css) out.push(['style', css]);
    return out;
  }

  protected _shallow(): SNode {
    const copy: SElement = new SElement(this.tagName, this.namespaceURI);
    copy.attrs = new Map(this.attrs);
    copy.style.cssText = this.style.toCss();
    return copy;
  }
}

class SFragment extends SNode {
  nodeType: number = FRAGMENT_NODE;
  protected _shallow(): SNode {
    return new SFragment();
  }
}

/** A `<template>`: `innerHTML` parses into `.content` (a fragment), not into the element's own children. */
class STemplate extends SElement {
  content: SFragment = new SFragment();
  constructor() {
    super('template');
  }
  set innerHTML(html: string) {
    this.content = new SFragment();
    for (const n of parseHtml(html, null)) this.content.appendChild(n);
  }
  protected _shallow(): SNode {
    const copy: STemplate = new STemplate();
    for (const c of this.content.childNodes) copy.content.appendChild(c.cloneNode(true));
    return copy;
  }
}

/* ──────────────────────────── parser (compiler-emitted HTML) ──────────────────────────── */

const SVG_NS: "http://www.w3.org/2000/svg" = 'http://www.w3.org/2000/svg';

/**
 * Parse a compiler-emitted HTML string into nodes. The input is well-formed (codegen output), so this is a
 * small tokenizer — tags, attributes (quoted / unquoted / bare), text, and `<!-- -->` comments — with void
 * elements auto-closed and `/>` honoured. Not a full HTML5 parser (no error recovery / implied tags).
 */
function parseHtml(html: string, ns: string | null): SNode[] {
  const roots: SNode[] = [];
  const stack: SElement[] = [];
  const top = (): SNode => stack[stack.length - 1] ?? { appendChild: (n: SNode) => roots.push(n) } as unknown as SNode;
  const add = (n: SNode): void => {
    const parent: SNode = stack[stack.length - 1];
    if (parent) parent.appendChild(n);
    else roots.push(n);
  };
  let i: number = 0;
  const len: number = html.length;
  while (i < len) {
    if (html[i] === '<') {
      if (html.startsWith('<!--', i)) {
        const end: number = html.indexOf('-->', i + 4);
        const stop: number = end === -1 ? len : end;
        add(new SComment(html.slice(i + 4, stop)));
        i = end === -1 ? len : end + 3;
        continue;
      }
      if (html[i + 1] === '/') {
        const end: number = html.indexOf('>', i);
        const name: string = html.slice(i + 2, end).trim().toLowerCase();
        for (let k: number = stack.length - 1; k >= 0; k--) {
          if (stack[k].tagName === name) {
            stack.length = k;
            break;
          }
        }
        i = end + 1;
        continue;
      }
      // open tag
      const end: number = html.indexOf('>', i);
      const selfClose: boolean = html[end - 1] === '/';
      const inner: string = html.slice(i + 1, selfClose ? end - 1 : end).trim();
      const sp: number = inner.search(/\s/);
      const tag: string = (sp === -1 ? inner : inner.slice(0, sp)).toLowerCase();
      const elNs: string | null = tag === 'svg' ? SVG_NS : ns;
      const el: SElement = new SElement(tag, elNs);
      if (sp !== -1) for (const [an, av] of parseAttrs(inner.slice(sp + 1))) el.setAttribute(an, av);
      add(el);
      if (!selfClose && !VOID_TAGS.has(tag)) stack.push(el);
      i = end + 1;
      continue;
    }
    const nextLt: number = html.indexOf('<', i);
    const stop: number = nextLt === -1 ? len : nextLt;
    const text: string = html.slice(i, stop);
    add(new SText(unescapeEntities(text)));
    i = stop;
  }
  void top;
  return roots;
}

function parseAttrs(s: string): [string, string][] {
  const out: [string, string][] = [];
  const re: RegExp = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (!m[1]) break;
    const value: string = m[2] ?? m[3] ?? m[4] ?? '';
    out.push([m[1], unescapeEntities(value)]);
  }
  return out;
}

function unescapeEntities(s: string): string {
  return s.indexOf('&') === -1
    ? s
    : s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/* ──────────────────────────── serializer ──────────────────────────── */

/** Serialize a headless node (element / text / comment / fragment) to an HTML string. */
export function serializeNode(node: SNode): string {
  switch (node.nodeType) {
    case TEXT_NODE:
      return escapeText((node as SText).data);
    case COMMENT_NODE:
      return `<!--${(node as SComment).data}-->`;
    case FRAGMENT_NODE:
      return node.childNodes.map(serializeNode).join('');
    case ELEMENT_NODE: {
      const el: SElement = node as SElement;
      const tag: string = el.tagName;
      const attrs: string = el
        .attrList()
        .map(([n, v]) => (v === '' ? ` ${n}` : ` ${n}="${escapeAttr(v)}"`))
        .join('');
      if (VOID_TAGS.has(tag)) return `<${tag}${attrs}>`;
      return `<${tag}${attrs}>${el.childNodes.map(serializeNode).join('')}</${tag}>`;
    }
    default:
      return node.childNodes.map(serializeNode).join('');
  }
}

/* ──────────────────────────── install ──────────────────────────── */

/** The minimal `document` surface `runtime/dom` reaches for. */
function makeDocument(): Record<string, unknown> {
  const body: SElement = new SElement('body');
  return {
    createElement: (tag: string): SElement => (tag === 'template' ? new STemplate() : new SElement(tag)),
    createElementNS: (nsUri: string, tag: string): SElement => new SElement(tag, nsUri),
    createComment: (data: string = ''): SComment => new SComment(data),
    createTextNode: (data: string = ''): SText => new SText(data),
    createDocumentFragment: (): SFragment => new SFragment(),
    querySelector: (sel: string): SElement | null => body.querySelector(sel),
    body,
    // A settable `document.title` so an app that sets it during render (e.g. a route-title effect) has a
    // place to write; the SSG render reads it back to fill the page's <title>.
    title: '',
  };
}

let installed: boolean = false;

/**
 * Install the headless DOM as globals (`document`, `Element`, `Comment`, `Text`, `DocumentFragment`, `Node`,
 * `HTMLElement`) so the unchanged `runtime/dom` runs against it. No-op when a real `document` already exists
 * (the browser) or when already installed. Idempotent. Server-only.
 */
export function installServerDom(): boolean {
  if (installed) return true;
  const g: Record<string, unknown> = globalThis as unknown as Record<string, unknown>;
  if (typeof g.document !== 'undefined') return false; // real DOM present — never clobber it (I2)
  // A mount hook has no DOM to run against here, and E1.3's settling gives the microtask queue a turn it never
  // used to get — so make the documented "onMount is inert on the server" true by construction, not by luck.
  g.__weaveHeadless = true;
  g.document = makeDocument();
  g.Node = SNode;
  g.Element = SElement;
  g.HTMLElement = SElement;
  g.Comment = SComment;
  g.Text = SText;
  g.DocumentFragment = SFragment;
  installed = true;
  return true;
}

export { SNode, SElement, SText, SComment, SFragment, STemplate };
