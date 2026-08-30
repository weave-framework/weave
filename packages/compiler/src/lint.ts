/**
 * Template lint — the mistakes that used to compile clean and fail silently.
 *
 * Everything here is a WARNING, and every rule is deliberately narrow: it fires only on markup that
 * cannot plausibly be anything but a mistake. A rule that also fires on correct code is worse than no
 * rule, because the next real warning is read as noise. So:
 *
 *  - `onclick={{ fn }}` warns (it sets an attribute to the function's source text); `onclick="alert(1)"`
 *    does not, because that is ordinary HTML.
 *  - `xyz:abc={{ x }}` warns; `xlink:href` does not, because that is a real XML namespace.
 *  - `on:clik` warns *because* `click` is one edit away; `on:cart-updated` does not, because nothing
 *    suggests it was meant to be something else.
 *  - `@fro (…) { … }` warns for the same reason; prose containing `@media (…) { … }` does not, because
 *    `media` is nobody's misspelling of a Weave block.
 */

import type { Attr, ElementNode, TemplateNode } from './ast.js';

/** DOM events common enough that a near-miss is a typo rather than a custom event. */
const DOM_EVENTS: readonly string[] = [
  'click', 'dblclick', 'mousedown', 'mouseup', 'mouseenter', 'mouseleave', 'mousemove', 'mouseover', 'mouseout',
  'contextmenu', 'wheel', 'scroll', 'scrollend',
  'keydown', 'keyup', 'keypress',
  'input', 'change', 'submit', 'reset', 'invalid', 'select', 'search',
  'focus', 'blur', 'focusin', 'focusout',
  'pointerdown', 'pointerup', 'pointermove', 'pointerenter', 'pointerleave', 'pointercancel', 'pointerover', 'pointerout',
  'touchstart', 'touchend', 'touchmove', 'touchcancel',
  'drag', 'dragstart', 'dragend', 'dragenter', 'dragleave', 'dragover', 'drop',
  'copy', 'cut', 'paste',
  'load', 'error', 'abort', 'beforeinput', 'toggle', 'close', 'cancel',
  'animationstart', 'animationend', 'animationiteration', 'transitionstart', 'transitionend', 'transitioncancel',
  'play', 'pause', 'ended', 'timeupdate', 'volumechange', 'canplay', 'loadeddata', 'loadedmetadata',
];

/** The block keywords the parser recognises — anything one edit away from one of these is a typo. */
const BLOCKS: readonly string[] = [
  'if', 'else', 'for', 'empty', 'switch', 'case', 'default', 'let', 'defer', 'placeholder', 'await', 'then',
  'catch', 'snippet', 'render', 'key',
];

/** XML namespace prefixes that are attribute names, not Weave bindings. */
const NAMESPACES: ReadonlySet<string> = new Set(['xlink', 'xml', 'xmlns']);

/** Weave's own binding prefixes — the parser has already turned these into typed attrs. */
const WEAVE_PREFIXES: ReadonlySet<string> = new Set(['on', 'class', 'style', 'bind', 'use', 'transition', 'in', 'out']);

/**
 * Is `a` reachable from `b` by ONE edit — insertion, deletion, substitution, or a swap of two adjacent
 * characters? The swap is not a nicety: `@fro` for `@for` and `teh` for `the` are transpositions, two
 * substitutions away under plain Levenshtein and therefore invisible to a ≤1 rule without it.
 */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return false; // an exact match is not a typo
  const la: number = a.length;
  const lb: number = b.length;
  if (la === lb) {
    for (let k: number = 0; k + 1 < la; k++) {
      if (a[k] === b[k + 1] && a[k + 1] === b[k] && a.slice(0, k) === b.slice(0, k) && a.slice(k + 2) === b.slice(k + 2)) {
        return true;
      }
    }
  }
  if (Math.abs(la - lb) > 1) return false;
  let i: number = 0;
  let j: number = 0;
  let edits: number = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (la > lb) i++;
    else if (lb > la) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (la - i) + (lb - j) <= 1;
}

/** The closest DOM event / block keyword one edit away, or null. */
function nearest(name: string, candidates: readonly string[]): string | null {
  return candidates.find((c) => withinOneEdit(name.toLowerCase(), c)) ?? null;
}

/** A replacement that is certainly correct — offered only where exactly one right answer exists. */
export interface LintFix {
  /** Offsets into the template source passed to `parseTemplate`. */
  start: number;
  end: number;
  /** Text to put in place of `[start, end)`. */
  text: string;
}

/**
 * One warning, with a position when the AST carries one and a `fix` when the rule already KNOWS the
 * answer. A rule that merely explains ("this prefix is not a Weave binding") has no `fix`: guessing
 * one would be worse than none. Applying several fixes to one file must go BACK TO FRONT, or an
 * earlier edit shifts every later offset.
 */
export interface LintFinding {
  message: string;
  /** Offset of what the message is about, when known. `undefined` means "no position", never 0. */
  offset?: number;
  fix?: LintFix;
}

/**
 * Walk a parsed template and collect warnings WITH their positions and fixes.
 *
 * Added alongside `lintTemplate` rather than changing it: that function is a published export of
 * `@weave-framework/compiler`, so widening its return type would be a breaking change for a purely
 * additive capability.
 */
export function lintTemplateFindings(nodes: TemplateNode[]): LintFinding[] {
  const out: LintFinding[] = [];
  walk(nodes, out);
  return out;
}

/**
 * The message-only projection — the original signature, unchanged. Pure: it reads the AST and returns
 * strings, so both the build loader and any other caller can decide how to surface them.
 */
export function lintTemplate(nodes: TemplateNode[]): string[] {
  return lintTemplateFindings(nodes).map((f) => f.message);
}

function walk(nodes: TemplateNode[] | undefined, out: LintFinding[]): void {
  if (!nodes) return;
  for (const node of nodes) {
    switch (node.type) {
      case 'element':
        for (const attr of (node as ElementNode).attrs) lintAttr(attr, out);
        walk((node as ElementNode).children, out);
        break;
      case 'text':
        lintText(node.value, node.offset, out);
        break;
      default:
        // Every block kind carries its children under one of these names; walking them all keeps this
        // pass working when a new block lands, instead of silently skipping its body.
        for (const key of ['children', 'branches', 'cases', 'empty', 'placeholder', 'pending', 'then', 'catch'] as const) {
          const child: unknown = (node as unknown as Record<string, unknown>)[key];
          if (Array.isArray(child)) {
            if (child.length && typeof child[0] === 'object' && child[0] !== null && !('type' in (child[0] as object))) {
              // A branch/case list: each entry holds its own children.
              for (const b of child as Array<{ children?: TemplateNode[] }>) walk(b.children, out);
            } else {
              walk(child as TemplateNode[], out);
            }
          }
        }
    }
  }
}

function lintAttr(attr: Attr, out: LintFinding[]): void {
  if (attr.type === 'event') {
    const name: string = attr.name;
    const near: string | null = DOM_EVENTS.includes(name.toLowerCase()) ? null : nearest(name, DOM_EVENTS);
    if (near) {
      out.push({
        message: `\`on:${name}\` — no such DOM event. Did you mean \`on:${near}\`? (A listener for an event nothing fires is silent at runtime.)`,
        offset: attr.nameOffset,
        fix: attr.nameOffset === undefined ? undefined : { start: attr.nameOffset, end: attr.nameOffset + name.length, text: near },
      });
    }
    return;
  }
  if (attr.type !== 'attr') return; // static / typed bindings are already understood

  const name: string = attr.name;
  // `onclick={{ fn }}` — the binding is emitted as an ATTRIBUTE whose value is the function's source
  // text. The element renders, the handler never runs, and nothing complains.
  const asEvent: RegExpExecArray | null = /^on([a-z]{3,})$/.exec(name);
  if (asEvent && DOM_EVENTS.includes(asEvent[1])) {
    out.push({
      message:
        `\`${name}={{ … }}\` sets an ATTRIBUTE, not a listener — the handler never runs. Weave binds events ` +
        `with \`on:\`: write \`on:${asEvent[1]}={{ … }}\`.`,
      offset: attr.nameOffset,
      fix:
        attr.nameOffset === undefined
          ? undefined
          : { start: attr.nameOffset, end: attr.nameOffset + name.length, text: `on:${asEvent[1]}` },
    });
    return;
  }

  const colon: number = name.indexOf(':');
  if (colon > 0) {
    const prefix: string = name.slice(0, colon);
    if (!NAMESPACES.has(prefix) && !WEAVE_PREFIXES.has(prefix)) {
      // No `fix`: several prefixes could have been meant, and a wrong auto-fix is worse than none.
      out.push({
        message:
          `\`${name}\` — \`${prefix}:\` is not a Weave binding prefix, so this is emitted as a plain attribute. ` +
          `The prefixes are \`on:\`, \`bind:\`, \`use:\`, \`class:\`, \`style:\`, \`transition:\`/\`in:\`/\`out:\`.`,
        offset: attr.nameOffset,
      });
    }
  }
}

/** An unrecognised `@word (…) {` left in the text — a misspelled block, which renders as literal text. */
function lintText(text: string, offset: number | undefined, out: LintFinding[]): void {
  // `[^{}]` rather than `[^)]`: a block head holds calls of its own — `@for (t of todos())` — so the
  // scan has to run to the LAST `)` before the brace, not the first one.
  //
  // Two details are load-bearing against backtracking (CodeQL js/polynomial-redos). The whitespace
  // before `(` sits INSIDE the optional group: written as `\s*(…)?\s*`, one run of spaces could be
  // split between the two `\s*` in every possible way, and 120 KB of text took 5.7 seconds. And the
  // head is bounded, so a text full of `@A(` with no closing paren cannot rescan to the end from every
  // one of them. A block head longer than the bound simply goes unremarked — this rule only offers a
  // spelling hint, so silence there is the right failure.
  const RE: RegExp = /@([A-Za-z]+)(?:\s*(\([^{}]{0,512}\)))?\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(text)) !== null) {
    const word: string = m[1];
    if (BLOCKS.includes(word)) continue; // the parser would have taken it; a leftover is inside a snippet
    const near: string | null = nearest(word, BLOCKS);
    if (near) {
      // `m.index + 1` skips the `@`; the word itself is what gets replaced.
      const at: number | undefined = offset === undefined ? undefined : offset + m.index + 1;
      out.push({
        message: `\`@${word}\` is not a Weave block and was left in the page as text. Did you mean \`@${near}\`?`,
        offset: at,
        fix: at === undefined ? undefined : { start: at, end: at + word.length, text: near },
      });
    }
  }
}
