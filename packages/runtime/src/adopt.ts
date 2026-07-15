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

function stringify(v: unknown): string {
  return v == null || v === false ? '' : String(v);
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
