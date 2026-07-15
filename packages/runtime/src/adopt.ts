/**
 * `@weave-framework/runtime/adopt` — Phase E (E1.2a) DOM-adoption primitives.
 *
 * The client counterpart to the resumable server render: re-attach reactive bindings to the DOM the server
 * already produced, IN PLACE (no re-creation), so a resumed page becomes interactive without a client
 * re-render — the point of resumability over hydration (RFC 0009 §3). This module is the atom layer: the
 * text-binding primitive for both sides of the boundary. The compiler's adopt-mode render (E1.2b) and the
 * cursor walk that navigates the marked DOM build on it.
 *
 * Its own entry — 0 bytes for a plain client SPA (invariant I3); never imported by the eager path.
 *
 * ## The dynamic-text marker
 *
 * A reactive `{{ x }}` renders as a text node before its `<!---->` anchor. In plain HTML a run of adjacent
 * text collapses into ONE node when the browser parses it — so `Hello, {{ x }}!` would come back as a single
 * `"Hello, value"` text node, and there'd be no way to re-bind just the dynamic part without clobbering the
 * static `"Hello, "`. {@link bindTextResumable} therefore emits a leading marker comment (`<!--$-->`) so the
 * dynamic text stays a SEPARATE node in the serialized HTML; {@link adoptText} then re-binds exactly that
 * node (the anchor's previous sibling) on the client.
 */
import { effect } from './reactive.js';

/** Marker-comment data that isolates a dynamic text node from a preceding static run. @internal */
export const DYN_TEXT: string = '$';

/**
 * Block-boundary markers (E1.2c). A control-flow block (`@if`/`@for`/component/…) inserts a runtime-VARIABLE
 * number of nodes before its `<!---->` anchor, so build-time child indices can't reach the block's extent or
 * anything after it. The resumable render brackets each block's content with a leading `[` marker ({@link
 * blockStart}) and an `]` end anchor (its comment data), so a client cursor can find a block's boundaries and
 * skip past it by bracket-matching ({@link blockEndOf}) — nested blocks nest their own `[`…`]` pairs.
 * @internal
 */
export const BLOCK_START: string = '[';
/** The block end-anchor's comment data — the resumable target emits `<!--]-->` where eager emits `<!---->`. @internal */
export const BLOCK_END: string = ']';

function stringify(v: unknown): string {
  return v == null || v === false ? '' : String(v);
}

/**
 * CREATE side (the resumable server render): insert a `[` boundary marker immediately before a block's `]`
 * end anchor, BEFORE the block helper (`ifBlock`/`eachBlock`) fills content in front of that anchor — so the
 * block's rendered nodes land between `[` and `]` and the client can bound the region. Returns the marker.
 */
export function blockStart(anchor: Comment): Comment {
  const m: Comment = document.createComment(BLOCK_START);
  anchor.parentNode!.insertBefore(m, anchor);
  return m;
}

/**
 * ADOPT side: given a block's `[` start marker, return its matching `]` end anchor by bracket-depth matching
 * (each nested `[` +1, each `]` −1; the `]` that returns to depth 0 is this block's end). Interp `$` markers
 * and plain interp anchors are ignored. Throws on unbalanced markers (a corrupt / non-resumable render).
 */
export function blockEndOf(start: Comment): Comment {
  let depth: number = 1;
  let n: Node | null = start.nextSibling;
  while (n) {
    if (n.nodeType === 8 /* Comment */) {
      const d: string = (n as Comment).data;
      if (d === BLOCK_START) depth++;
      else if (d === BLOCK_END && --depth === 0) return n as Comment;
    }
    n = n.nextSibling;
  }
  throw new Error('adopt: unbalanced block markers — no matching "]" for a "[" start.');
}

/**
 * ADOPT side: remove the server-rendered nodes strictly between a block's `[` start and `]` end (its markers
 * kept). Used to clear a block's server DOM before re-running its live helper — the island-replay path
 * (E1.2c): statics/text around a block adopt in place while the block itself re-renders reactively.
 */
export function clearBlock(start: Comment, end: Comment): void {
  let n: ChildNode | null = start.nextSibling as ChildNode | null;
  while (n && n !== end) {
    const next: ChildNode | null = n.nextSibling as ChildNode | null;
    n.remove();
    n = next;
  }
}

/**
 * ADOPT side (E1.2c-2): the island-replay entry for a control-flow block. Given the block's `[` start marker
 * (the adopt render navigates to it by computed index — `[` sits at the block anchor's template position),
 * clear the server-rendered content and return the `]` end anchor so the caller can re-run the block's normal
 * helper (`ifBlock`) against it — a fresh, fully REACTIVE branch. The static/text nodes AROUND the block stay
 * adopted in place; only the block subtree re-renders. After the clear, `]` is `start.nextSibling`.
 */
export function adoptIsland(start: Comment): Comment {
  const end: Comment = blockEndOf(start);
  clearBlock(start, end);
  return end;
}

/**
 * CREATE side (the resumable server render): insert an isolated dynamic text node before `anchor` and keep
 * it updated. The leading `<!--$-->` marker keeps the text a distinct node in the serialized HTML so the
 * client can {@link adoptText} exactly it — even when a static run precedes it in the same element.
 */
export function bindTextResumable(anchor: Comment, fn: () => unknown): void {
  const parent: Node = anchor.parentNode!;
  parent.insertBefore(document.createComment(DYN_TEXT), anchor); // isolation marker
  const t: Text = document.createTextNode('');
  parent.insertBefore(t, anchor);
  effect(() => {
    t.data = stringify(fn());
  });
}

/**
 * ADOPT side (the client): re-bind the dynamic text the server rendered before `anchor` — the existing text
 * node, reused in place (no node created, `setup` never re-run). The node is the anchor's previous sibling,
 * kept separate by its marker. If it is somehow absent (a non-resumable/mismatched render), one is created
 * so the binding still works rather than throwing.
 */
export function adoptText(anchor: Comment, fn: () => unknown): void {
  let t: Node | null = anchor.previousSibling;
  if (!t || t.nodeType !== 3 /* Text */) {
    t = document.createTextNode('');
    anchor.parentNode!.insertBefore(t, anchor);
  }
  const text: Text = t as Text;
  effect(() => {
    text.data = stringify(fn());
  });
}
