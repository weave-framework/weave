import { test, assert } from '../../../tools/harness.js';
import { signal, root } from '@weave-framework/runtime';
import { bindTextResumable, adoptText, DYN_TEXT } from '@weave-framework/runtime/adopt';

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
