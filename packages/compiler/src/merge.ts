/**
 * Three-way merge of a template by its TREE, not by its lines.
 *
 * Git merges text. A template is not text in any way git understands: an attribute added to a tag
 * and a button added under that tag are adjacent LINES, so git calls them a conflict, while they
 * touch nothing in common in the tree. This merges the parsed nodes instead — different nodes are
 * never a conflict, the same node changed two ways always is.
 *
 * The contract is deliberately narrow, because a merge driver that guesses is worse than no merge
 * driver at all:
 *
 *  - It runs ONLY where git's own line merge already failed (see the `merge` command), so it can
 *    add resolutions but can never change one git was happy with.
 *  - It merges by SPANS — the exact source text of each node — so untouched lines come out
 *    byte-for-byte unchanged and no formatting is invented.
 *  - Anything it is not sure about returns `null`, and the caller falls back to git's conflict
 *    markers. Control-flow blocks (`@if`, `@for`, …) are opaque units for that reason: two sides
 *    editing the same block are a conflict here even when a finer reading might have merged them.
 *  - The result is re-parsed before it is offered. A merge that does not parse is not a merge.
 */

import { parseTemplate, type SpanMap, type NodeSpan } from './parser.js';
import type { TemplateNode, Attr, ElementNode } from './ast.js';

/** One revision, parsed with spans. */
interface Rev {
  src: string;
  nodes: TemplateNode[];
  spans: SpanMap;
}

function parse(src: string): Rev {
  const spans: SpanMap = new WeakMap();
  // `comments: true` is load-bearing: with comments dropped the children of a node no longer tile
  // their parent's text, and every comment would be deleted by the reassembly.
  const nodes: TemplateNode[] = parseTemplate(src, { comments: true, spans });
  return { src, nodes, spans };
}

function spanOf(rev: Rev, node: object): NodeSpan {
  const s: NodeSpan | undefined = rev.spans.get(node);
  if (!s) throw new Error('missing span');
  return s;
}

function textOf(rev: Rev, node: object): string {
  const s: NodeSpan = spanOf(rev, node);
  return rev.src.slice(s.start, s.end);
}

/**
 * What makes two items "the same thing changed" rather than "one replaced by another". Only ever
 * consulted for a 1:1 replacement, to decide whether it is worth looking inside.
 */
function nodeKey(n: TemplateNode): string {
  return n.type === 'element' ? 'element:' + n.tag : n.type;
}

function attrKey(a: Attr): string {
  return a.type + ':' + ('name' in a ? a.name : '');
}

/** Whitespace-only text weighs less, so the alignment prefers to match real content. */
function nodeWeight(n: TemplateNode): number {
  return n.type === 'text' && !n.value.trim() ? 1 : 3;
}

function attrWeight(): number {
  return 1;
}

/** A run of the base replaced by a run of one side's items. */
interface Change<T> {
  /** base index the run starts at */
  from: number;
  /** base index one past the run */
  to: number;
  /** what the side has there instead (possibly empty — a deletion) */
  items: T[];
}

/** One side's edit of the base list, as replacements plus insertions between base items. */
interface Edit<T> {
  /** replacement covering base index i, or undefined when i survives untouched */
  change: (Change<T> | undefined)[];
  /** items inserted before base index i (index `base.length` = appended at the end) */
  insert: T[][];
}

/**
 * Longest common subsequence of two item lists, matched on exact source text and weighted so the
 * alignment prefers matching a real node over matching a run of indentation.
 */
function align<T>(
  base: T[],
  side: T[],
  baseText: (t: T) => string,
  sideText: (t: T) => string,
  weight: (t: T) => number,
): [number, number][] {
  const n: number = base.length;
  const m: number = side.length;
  const bt: string[] = base.map(baseText);
  const st: string[] = side.map(sideText);
  const dp: number[][] = [];
  for (let i: number = 0; i <= n; i++) dp.push(new Array<number>(m + 1).fill(0));
  for (let i: number = n - 1; i >= 0; i--) {
    for (let j: number = m - 1; j >= 0; j--) {
      dp[i][j] = bt[i] === st[j]
        ? dp[i + 1][j + 1] + weight(base[i])
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i: number = 0;
  let j: number = 0;
  while (i < n && j < m) {
    if (bt[i] === st[j] && dp[i][j] === dp[i + 1][j + 1] + weight(base[i])) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/** Turn an alignment into per-base-index replacements and between-index insertions. */
function editOf<T>(
  base: T[],
  side: T[],
  baseText: (t: T) => string,
  sideText: (t: T) => string,
  weight: (t: T) => number,
): Edit<T> {
  const pairs: [number, number][] = align(base, side, baseText, sideText, weight);
  const change: (Change<T> | undefined)[] = new Array<Change<T> | undefined>(base.length).fill(undefined);
  const insert: T[][] = [];
  for (let i: number = 0; i <= base.length; i++) insert.push([]);

  let bi: number = 0;
  let si: number = 0;
  const gap = (bEnd: number, sEnd: number): void => {
    const taken: T[] = side.slice(si, sEnd);
    if (bEnd === bi) {
      // nothing of the base is involved — a pure insertion at this position
      if (taken.length) insert[bi] = insert[bi].concat(taken);
    } else {
      const c: Change<T> = { from: bi, to: bEnd, items: taken };
      for (let k: number = bi; k < bEnd; k++) change[k] = c;
    }
    bi = bEnd;
    si = sEnd;
  };
  for (const [b, s] of pairs) {
    gap(b, s);
    bi = b + 1;
    si = s + 1;
  }
  gap(base.length, side.length);
  return { change, insert };
}

/**
 * The heart: combine two edits of the same base list. Returns null the moment the two sides
 * disagree about the same item.
 */
function mergeList<T extends object>(
  base: Rev,
  ours: Rev,
  theirs: Rev,
  bItems: T[],
  oItems: T[],
  tItems: T[],
  key: (t: T) => string,
  weight: (t: T) => number,
  /** true when the items have no meaningful order (attributes), so two additions at the same spot
   *  can simply be kept one after the other instead of being a conflict about which comes first */
  orderFree: boolean,
  recurse: ((b: T, o: T, t: T) => string | null) | undefined,
): string | null {
  const bText = (t: T): string => textOf(base, t);
  const oEdit: Edit<T> = editOf(bItems, oItems, bText, (t: T) => textOf(ours, t), weight);
  const tEdit: Edit<T> = editOf(bItems, tItems, bText, (t: T) => textOf(theirs, t), weight);
  const render = (items: T[], rev: Rev): string => items.map((t: T) => textOf(rev, t)).join('');

  let out: string = '';
  const emitInsert = (i: number): boolean => {
    const o: T[] = oEdit.insert[i];
    const t: T[] = tEdit.insert[i];
    if (o.length && t.length) {
      // Both sides put something at the very same place. For children, which one comes first is
      // unknowable, so this stays a conflict unless they added the same thing. For attributes there
      // is no order to get wrong, so both are simply kept.
      const oT: string = render(o, ours);
      const tT: string = render(t, theirs);
      if (orderFree) {
        out += oT + tT;
        return true;
      }
      if (oT !== tT) return false;
      out += oT;
      return true;
    }
    out += o.length ? render(o, ours) : render(t, theirs);
    return true;
  };

  for (let i: number = 0; i < bItems.length; i++) {
    if (!emitInsert(i)) return null;
    const oc: Change<T> | undefined = oEdit.change[i];
    const tc: Change<T> | undefined = tEdit.change[i];
    if (!oc && !tc) {
      out += bText(bItems[i]);
      continue;
    }
    if (oc && tc) {
      // Both sides rewrote this item. Only identical rewrites, or a 1:1 rewrite of the same kind of
      // node whose insides merge, can survive.
      if (oc.from !== tc.from || oc.to !== tc.to) return null;
      const oT: string = render(oc.items, ours);
      const tT: string = render(tc.items, theirs);
      if (oT === tT) {
        for (let k: number = oc.from + 1; k < oc.to; k++) {
          if (oEdit.insert[k].length || tEdit.insert[k].length) return null;
        }
        out += oT;
        i = oc.to - 1;
        continue;
      }
      if (
        recurse && oc.to - oc.from === 1 && oc.items.length === 1 && tc.items.length === 1
        && key(bItems[i]) === key(oc.items[0]) && key(bItems[i]) === key(tc.items[0])
      ) {
        const inner: string | null = recurse(bItems[i], oc.items[0], tc.items[0]);
        if (inner === null) return null;
        out += inner;
        continue;
      }
      return null;
    }
    const c: Change<T> = (oc ?? tc) as Change<T>;
    // A run one side rewrote must not be one the other side inserted INTO: the insertion would
    // land inside text that no longer exists.
    for (let k: number = c.from + 1; k < c.to; k++) {
      if (oEdit.insert[k].length || tEdit.insert[k].length) return null;
    }
    out += render(c.items, oc ? ours : theirs);
    i = c.to - 1;
  }
  if (!emitInsert(bItems.length)) return null;
  return out;
}

/** Merge one element against its two revisions: attributes and children, independently. */
function mergeElement(
  base: Rev,
  ours: Rev,
  theirs: Rev,
  b: TemplateNode,
  o: TemplateNode,
  t: TemplateNode,
): string | null {
  if (b.type !== 'element' || o.type !== 'element' || t.type !== 'element') return null;
  if (b.selfClosing !== o.selfClosing || b.selfClosing !== t.selfClosing) return null;
  const bs: NodeSpan = spanOf(base, b);

  // The open tag, attribute by attribute.
  // Two people adding the SAME attribute to the same tag is a real disagreement, and it is the one
  // thing the order-free merge below would otherwise paper over by emitting the attribute twice.
  const added = (rev: Rev, node: ElementNode): Set<string> => {
    const inBase: Set<string> = new Set(b.attrs.map(attrKey));
    return new Set(node.attrs.map(attrKey).filter((k: string) => !inBase.has(k)));
  };
  const oAdded: Set<string> = added(ours, o);
  for (const k of added(theirs, t)) if (oAdded.has(k)) return null;

  const attrs: string | null = mergeList(
    base, ours, theirs, b.attrs, o.attrs, t.attrs, attrKey, attrWeight, true, undefined,
  );
  if (attrs === null) return null;

  // Whatever follows the last attribute — the whitespace, the `/`, the `>`. The base's spelling
  // unless exactly one side changed it.
  const tail = (rev: Rev, node: ElementNode): string => {
    const span: NodeSpan = spanOf(rev, node);
    const last: Attr | undefined = node.attrs[node.attrs.length - 1];
    const from: number = last ? spanOf(rev, last).end : span.start + 1 + node.tag.length;
    return rev.src.slice(from, span.openEnd as number);
  };
  const bTail: string = tail(base, b);
  const oTail: string = tail(ours, o);
  const tTail: string = tail(theirs, t);
  const mTail: string | null =
    oTail === bTail ? tTail : tTail === bTail ? oTail : oTail === tTail ? oTail : null;
  if (mTail === null) return null;

  const open: string = '<' + b.tag + attrs + mTail;
  if (b.selfClosing) return open;

  const children: string | null = mergeList(
    base, ours, theirs, b.children, o.children, t.children, nodeKey, nodeWeight, false,
    (bb: TemplateNode, oo: TemplateNode, tt: TemplateNode) => mergeElement(base, ours, theirs, bb, oo, tt),
  );
  if (children === null) return null;

  // The close tag is `</tag …>` and has no structure worth merging, so the base's spelling wins.
  return open + children + base.src.slice(bs.closeStart as number, bs.end);
}

/**
 * Merge `ours` and `theirs` over their common `base`. Returns the merged template, or `null` when
 * the two sides changed the same node and no honest resolution exists.
 */
export function mergeTemplates(base: string, ours: string, theirs: string): string | null {
  let b: Rev;
  let o: Rev;
  let t: Rev;
  try {
    b = parse(base);
    o = parse(ours);
    t = parse(theirs);
  } catch {
    return null; // one of the three does not parse — this is not a template merge to make
  }

  let merged: string | null;
  try {
    merged = mergeList(
      b, o, t, b.nodes, o.nodes, t.nodes, nodeKey, nodeWeight, false,
      (bb: TemplateNode, oo: TemplateNode, tt: TemplateNode) => mergeElement(b, o, t, bb, oo, tt),
    );
  } catch {
    return null;
  }
  if (merged === null) return null;

  // Offering something that does not parse would turn a conflict a human could have read into a
  // broken file they have to reconstruct.
  try {
    parseTemplate(merged, { comments: true });
  } catch {
    return null;
  }
  return merged;
}
