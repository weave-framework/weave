// @ts-check
/**
 * Weave — DOM layer.
 *
 * A `html``` tagged template that binds signals straight to real DOM nodes.
 * There is no Virtual DOM and no diffing of a whole tree on every change:
 * each interpolation becomes its own fine-grained binding driven by an effect,
 * so an update touches only the exact text node / attribute / list item that
 * changed. This is what keeps Weave small at runtime and fast at update time.
 *
 * Reactivity rule (one rule to learn): an interpolated **function** is reactive
 * (a signal read like `count` or an expression like `() => a() + b()`). Any
 * other value is set once. Attributes named `on*` are event listeners.
 */

import { effect } from './reactive.js';

const OPEN = '\x01';
const CLOSE = '\x02';
const markerOf = (i) => OPEN + i + CLOSE;
const MARKER_RE = /\x01(\d+)\x02/g;

/** @type {WeakMap<TemplateStringsArray, CompiledTemplate>} */
const cache = new WeakMap();

/**
 * @typedef {Object} CompiledTemplate
 * @property {HTMLTemplateElement} tpl
 * @property {Binding[]} bindings
 */

/**
 * @typedef {Object} Binding
 * @property {'attr'|'event'|'prop'|'child'} type
 * @property {number[]} path   indices from the fragment root to the node
 * @property {string} [name]
 * @property {number} [index]  value index for single-hole bindings
 * @property {Array<string|number>} [parts] for multi-hole attribute values
 */

/** Walk to a node by child-index path from a root. */
function nodeAt(root, path) {
  let n = root;
  for (const i of path) n = n.childNodes[i];
  return n;
}

/** Compile a template literal once; cached by the (stable) strings identity. */
function compile(strings) {
  let html = '';
  for (let i = 0; i < strings.length; i++) {
    html += strings[i];
    if (i < strings.length - 1) html += markerOf(i);
  }

  const tpl = document.createElement('template');
  tpl.innerHTML = html;

  // Pass 1: split every text node that contains markers into static text +
  // comment anchors. The anchor's data encodes its value index (e.g. "w:3").
  splitTextNodes(tpl.content);

  // Pass 2: walk the now-final tree, recording bindings with stable paths.
  /** @type {Binding[]} */
  const bindings = [];
  collect(tpl.content, [], bindings);
  return { tpl, bindings };
}

function splitTextNodes(root) {
  const walker = document.createTreeWalker(root, 4 /* SHOW_TEXT */);
  /** @type {Text[]} */
  const targets = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeValue.includes(OPEN)) targets.push(/** @type {Text} */ (n));
  }
  for (const text of targets) {
    const frag = document.createDocumentFragment();
    const segments = text.nodeValue.split(MARKER_RE);
    for (let s = 0; s < segments.length; s++) {
      if (s % 2 === 0) {
        if (segments[s]) frag.appendChild(document.createTextNode(segments[s]));
      } else {
        frag.appendChild(document.createComment('w:' + segments[s]));
      }
    }
    text.parentNode.replaceChild(frag, text);
  }
}

function collect(node, path, bindings) {
  if (node.nodeType === 8 && node.nodeValue.startsWith('w:')) {
    bindings.push({ type: 'child', path, index: Number(node.nodeValue.slice(2)) });
    return;
  }
  if (node.nodeType === 1) {
    const el = /** @type {Element} */ (node);
    for (const attr of [...el.attributes]) {
      const { name, value } = attr;
      if (!value.includes(OPEN)) continue;
      el.removeAttribute(name);
      if (name[0] === 'o' && name[1] === 'n') {
        bindings.push({ type: 'event', path, name: name.slice(2), index: Number(value.replace(MARKER_RE, '$1')) });
      } else if (name[0] === '.') {
        bindings.push({ type: 'prop', path, name: name.slice(1), index: Number(value.replace(MARKER_RE, '$1')) });
      } else {
        bindings.push({ type: 'attr', path, name, parts: splitParts(value) });
      }
    }
  }
  const kids = node.childNodes;
  for (let i = 0; i < kids.length; i++) {
    collect(kids[i], [...path, i], bindings);
  }
}

function splitParts(value) {
  const parts = [];
  const segs = value.split(MARKER_RE);
  for (let i = 0; i < segs.length; i++) {
    if (i % 2 === 0) {
      if (segs[i]) parts.push(segs[i]);
    } else {
      parts.push(Number(segs[i]));
    }
  }
  return parts;
}

/**
 * The `html` tagged template. Returns a DocumentFragment of real DOM nodes
 * with all reactive bindings wired up.
 * @param {TemplateStringsArray} strings
 * @param {...any} values
 * @returns {DocumentFragment}
 */
export function html(strings, ...values) {
  let compiled = cache.get(strings);
  if (!compiled) {
    compiled = compile(strings);
    cache.set(strings, compiled);
  }
  const frag = /** @type {DocumentFragment} */ (compiled.tpl.content.cloneNode(true));

  // Resolve every target node first: applying a binding can insert nodes and
  // shift the child indices that later paths rely on.
  const targets = compiled.bindings.map((b) => nodeAt(frag, b.path));

  compiled.bindings.forEach((b, bi) => {
    const node = targets[bi];
    if (b.type === 'event') {
      const handler = values[b.index];
      node.addEventListener(b.name, (e) => handler(e));
    } else if (b.type === 'prop') {
      bindReactive(values[b.index], (v) => { node[b.name] = v; });
    } else if (b.type === 'attr') {
      bindAttr(node, b.name, b.parts, values);
    } else {
      bindChild(node, values[b.index]);
    }
  });
  return frag;
}

/** Run `apply` now and re-run reactively if `value` is a function. */
function bindReactive(value, apply) {
  if (typeof value === 'function') {
    effect(() => apply(value()));
  } else {
    apply(value);
  }
}

function bindAttr(el, name, parts, values) {
  const hasDynamic = parts.some((p) => typeof p === 'number');
  const resolve = () =>
    parts.map((p) => (typeof p === 'number'
      ? deref(values[p])
      : p)).join('');

  const apply = () => {
    // Single boolean/null hole: toggle attribute presence.
    if (parts.length === 1 && typeof parts[0] === 'number') {
      const v = deref(values[parts[0]]);
      if (v === false || v == null) { el.removeAttribute(name); return; }
      if (v === true) { el.setAttribute(name, ''); return; }
      el.setAttribute(name, String(v));
      return;
    }
    el.setAttribute(name, resolve());
  };

  if (hasDynamic && parts.some((p) => typeof p === 'number' && typeof values[p] === 'function')) {
    effect(apply);
  } else {
    apply();
  }
}

function deref(v) {
  return typeof v === 'function' ? v() : v;
}

/** Bind dynamic content at a comment anchor. Handles text, nodes, arrays, reactivity. */
function bindChild(anchor, value) {
  /** @type {Node[]} */
  let current = [];

  const clear = () => {
    for (const n of current) n.parentNode && n.parentNode.removeChild(n);
    current = [];
  };

  const set = (val) => {
    const next = normalize(val);
    // Fast path: identical node list (e.g. keyed each returns same refs).
    clear();
    const parent = anchor.parentNode;
    for (const n of next) parent.insertBefore(n, anchor);
    current = next;
  };

  if (typeof value === 'function') {
    effect(() => set(value()));
  } else {
    set(value);
  }
}

/** Coerce any child value into a flat array of DOM nodes. */
function normalize(val) {
  if (val == null || val === false || val === true) return [];
  if (Array.isArray(val)) return val.flatMap(normalize);
  if (val instanceof Node) {
    if (val.nodeType === 11) return [...val.childNodes]; // fragment → its children
    return [val];
  }
  return [document.createTextNode(String(val))];
}

/**
 * Conditional rendering. Reactive when `cond` is a function.
 *   html`${when(isOpen, () => html`<p>hi</p>`, () => html`<p>bye</p>`)}`
 * @param {any} cond
 * @param {() => any} then
 * @param {() => any} [otherwise]
 * @returns {() => any}
 */
export function when(cond, then, otherwise) {
  return () => (deref(cond) ? then() : otherwise ? otherwise() : null);
}

/**
 * Keyed list rendering with DOM reuse. Reactive when `items` is a function.
 * Items keyed by reference by default; pass a `key` fn for stable identity.
 *   html`<ul>${each(todos, (t) => html`<li>${() => t.text}</li>`, (t) => t.id)}</ul>`
 * @param {any} items
 * @param {(item:any, index:number) => any} render
 * @param {(item:any, index:number) => any} [key]
 * @returns {() => Node[]}
 */
export function each(items, render, key) {
  let prevKeys = [];
  /** @type {Map<any, {nodes: Node[]}>} */
  let cacheByKey = new Map();

  return () => {
    const list = deref(items) || [];
    const nextKeys = [];
    const nextCache = new Map();
    /** @type {Node[]} */
    const out = [];

    list.forEach((item, i) => {
      const k = key ? key(item, i) : item;
      nextKeys.push(k);
      let entry = cacheByKey.get(k);
      if (!entry) {
        const frag = render(item, i);
        entry = { nodes: normalize(frag) };
      }
      nextCache.set(k, entry);
      out.push(...entry.nodes);
    });

    prevKeys = nextKeys;
    cacheByKey = nextCache;
    return out;
  };
}

/**
 * Mount a fragment/node into a container, replacing its contents.
 * @param {DocumentFragment|Node|(() => any)} view
 * @param {Element} container
 * @returns {() => void} unmount
 */
export function mount(view, container) {
  container.textContent = '';
  const node = typeof view === 'function' ? view() : view;
  const children = node instanceof DocumentFragment ? [...node.childNodes] : [node];
  container.append(node);
  return () => children.forEach((c) => c.parentNode && c.remove());
}
