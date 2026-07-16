import { test, assert } from '../../../tools/harness.js';
import { signal, root, type Signal } from '@weave-framework/runtime';
import { bindTextResumable, adoptText, DYN_TEXT, blockStart, blockEndOf, clearBlock } from '@weave-framework/runtime/adopt';
import { ifBlock } from '@weave-framework/runtime/dom';

/** Node types (avoid the Node global under the test bundler). */
const TEXT = 3;
const COMMENT = 8;

test('bindTextResumable: inserts a marker-isolated text node before the anchor + updates it', () => {
  const p: HTMLParagraphElement = document.createElement('p');
  p.append(document.createTextNode('Hello, ')); // a preceding static run
  const anchor: Comment = document.createComment('');
  p.append(anchor);

  const x = signal('world');
  root(() => bindTextResumable(anchor, () => x()));

  // "Hello, ", <!--$-->, "world", <!---->
  assert.equal(p.childNodes.length, 4, 'marker + dynamic text inserted before the anchor');
  assert.equal(p.childNodes[1].nodeType, COMMENT, 'the isolation marker is a comment');
  assert.equal((p.childNodes[1] as Comment).data, DYN_TEXT, 'marker carries the dynamic-text sentinel');
  assert.equal((p.childNodes[2] as Text).data, 'world', 'dynamic text rendered');
  assert.equal((p.childNodes[0] as Text).data, 'Hello, ', 'the preceding static run is a separate node');

  x.set('there');
  assert.equal((p.childNodes[2] as Text).data, 'there', 'updates on signal change');
});

test('adoptText: re-binds the EXISTING server text node in place (no new node), static text untouched', () => {
  // The server output for `<p>Hello, {{ x }}!</p>` in the resumable target — marker isolates the dynamic text.
  const p: HTMLParagraphElement = document.createElement('p');
  p.innerHTML = `Hello, <!--${DYN_TEXT}-->world<!---->!`;
  // childNodes: "Hello, ", <!--$-->, "world", <!---->, "!"
  const anchor: Comment = [...p.childNodes].find(
    (n) => n.nodeType === COMMENT && (n as Comment).data === '',
  ) as Comment;
  const serverText: Text = anchor.previousSibling as Text;
  assert.equal(serverText.data, 'world', 'the server rendered the dynamic value isolated by its marker');

  const x = signal('world');
  root(() => adoptText(anchor, () => x()));

  assert.is(anchor.previousSibling, serverText, 'adopted the SAME text node — no re-creation');
  assert.equal(p.childNodes.length, 5, 'no extra nodes inserted on adopt');

  x.set('changed');
  assert.equal(serverText.data, 'changed', 'updates the adopted node in place');
  assert.equal((p.childNodes[0] as Text).data, 'Hello, ', 'the static prefix is untouched');
  assert.equal((p.lastChild as Text).data, '!', 'the static suffix is untouched');
});

test('adoptText: isolated interp (no adjacent static text) adopts the lone text node', () => {
  const h1: HTMLElement = document.createElement('h1');
  h1.innerHTML = 'Title<!---->';
  const anchor: Comment = h1.lastChild as Comment;
  const serverText: Text = anchor.previousSibling as Text;

  const t = signal('Title');
  root(() => adoptText(anchor, () => t()));
  assert.is(anchor.previousSibling, serverText, 'adopted the existing text node');
  t.set('Renamed');
  assert.equal(serverText.data, 'Renamed', 'updates in place');
});

test('adoptText: missing server text (mismatch) falls back to creating one rather than throwing', () => {
  const span: HTMLElement = document.createElement('span');
  const anchor: Comment = document.createComment('');
  span.append(anchor); // no text before it
  const v = signal('x');
  root(() => adoptText(anchor, () => v()));
  const t: Node | null = anchor.previousSibling;
  assert.ok(t && t.nodeType === TEXT, 'created a text node when none existed');
  assert.equal((t as Text).data, 'x', 'binds it');
  v.set('y');
  assert.equal((t as Text).data, 'y', 'updates it');
});

/* ──────────── E1.2c — block-boundary markers (cursor-walk foundation) ──────────── */

test('blockStart: inserts a [ boundary marker right before the block anchor (create side)', () => {
  const p: HTMLParagraphElement = document.createElement('p');
  const anchor: Comment = document.createComment(']'); // the block end anchor
  p.append(document.createTextNode('pre'), anchor);
  const m: Comment = blockStart(anchor);
  assert.equal(m.data, '[', 'returns the [ marker');
  assert.is(anchor.previousSibling, m, 'the [ sits directly before the end anchor — content lands between them');
  assert.equal(p.childNodes.length, 3, 'pre-text, [ marker, ] anchor');
});

test('blockEndOf: matches the balanced ] across a NESTED block (bracket depth, ignoring interp markers)', () => {
  const p: HTMLParagraphElement = document.createElement('p');
  // [ <b>x</b>  [ <i>y</i> <!--$-->t<!----> ]  tail ]  <span>after</span>
  //  outer-start  nested-start  interp inside nested   nested-end  outer-end
  p.innerHTML =
    '<!--[--><b>x</b><!--[--><i>y</i><!--$-->t<!----><!--]-->tail<!--]--><span>after</span>';
  const start: Comment = p.firstChild as Comment;
  const end: Comment = blockEndOf(start);
  assert.equal(end.data, ']', 'found a ] end anchor');
  assert.is(end.nextSibling, p.querySelector('span'), 'matched the OUTER end (before <span>), skipping the nested block + its interp markers');
});

test('blockEndOf: throws loudly on unbalanced markers (no matching ])', () => {
  const p: HTMLParagraphElement = document.createElement('p');
  p.innerHTML = '<!--[--><b>x</b>'; // a [ with no matching ]
  let threw: boolean = false;
  try {
    blockEndOf(p.firstChild as Comment);
  } catch {
    threw = true;
  }
  assert.ok(threw, 'an unbalanced marker set is a loud error, not a silent wrong match');
});

test('clearBlock: empties the region between the boundary markers, leaving markers + trailing content', () => {
  const p: HTMLParagraphElement = document.createElement('p');
  p.innerHTML = '<!--[--><b>x</b><!--[--><i>y</i><!--]-->tail<!--]--><span>after</span>';
  const start: Comment = p.firstChild as Comment;
  const end: Comment = blockEndOf(start);
  clearBlock(start, end);
  assert.is(start.nextSibling, end, 'all nodes strictly between [ and ] are gone (island cleared for replay)');
  assert.ok(!p.querySelector('b') && !p.querySelector('i'), 'nested content removed too');
  assert.ok(p.querySelector('span'), 'content AFTER the block is untouched');
});

/* ──────────── E1.10 — adopt-first blocks (the basis for resuming a router outlet) ──────────── */

/**
 * A control-flow block can ADOPT its server-rendered content instead of replaying it (clear + re-render),
 * WITHOUT a second block implementation: `ifBlock`'s first evaluation clears nothing (it owns no nodes yet)
 * and then `placeBefore`s whatever the thunk returns. So a thunk that hands back the EXISTING server nodes in
 * a fragment re-inserts them exactly where they already are — node identity survives, and `ifBlock` now tracks
 * them, so a later swap disposes + removes them normally. This is what lets `<RouterView>` resume its view in
 * place while staying reactive to navigation. Pinning it here: the trick relies on ifBlock's ordering, so a
 * change to that must fail loudly rather than silently duplicate or leak the server DOM.
 */
test('E1.10: a first thunk returning the EXISTING nodes adopts them in place; a later swap still replaces them', () => {
  const box: HTMLDivElement = document.createElement('div');
  document.body.appendChild(box);
  box.innerHTML = '<span id="srv">SERVER</span><!--b-->'; // server content, then the block anchor
  const anchor: Comment = box.lastChild as Comment;
  const serverSpan: HTMLElement = box.querySelector('#srv') as HTMLElement;

  const which: Signal<string> = signal('adopt');
  const adoptThunk = (): Node => {
    const nodes: ChildNode[] = [];
    for (let n: ChildNode | null = box.firstChild; n && n !== anchor; n = n.nextSibling) nodes.push(n);
    const frag: DocumentFragment = document.createDocumentFragment();
    frag.append(...nodes); // detach…
    return frag; // …ifBlock places them back before the anchor: same spot, now tracked
  };
  const freshThunk = (): Node => {
    const el: HTMLElement = document.createElement('b');
    el.id = 'fresh';
    return el;
  };

  root(() => {
    ifBlock(anchor, () => (which() === 'adopt' ? adoptThunk : freshThunk));
  });

  assert.equal(box.querySelector('#srv'), serverSpan, 'the SERVER node itself was adopted — not re-created');
  assert.equal(box.innerHTML, '<span id="srv">SERVER</span><!--b-->', 'and it sits exactly where it was');

  which.set('fresh');
  assert.ok(!box.querySelector('#srv'), 'a swap removes the adopted nodes — ifBlock tracked them');
  assert.ok(box.querySelector('#fresh'), 'and renders the new branch');
});
