import { test, assert } from '../../../../tools/harness.js';
import { effect, createOwner, runInOwner, disposeOwner, type Owner } from '@weave-framework/runtime';
import { portal } from '@weave-framework/ui/cdk';

function el(tag = 'div', text = ''): HTMLElement {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  return n;
}

test('portal: attaches into <body> by default and reports attached()', () => {
  const node = el('div', 'p1');
  const p = portal(node);
  assert.equal(p.container, document.body);
  assert.equal(node.parentElement, document.body, 'node landed in body');
  assert.equal(p.attached(), true);
  p.detach();
});

test('portal: attaches into a given container element', () => {
  const host = el();
  document.body.appendChild(host);
  const node = el('span', 'x');
  const p = portal(node, { container: host });
  assert.equal(node.parentElement, host);
  p.detach();
  host.remove();
});

test('portal: resolves a CSS selector container', () => {
  const host = el();
  host.id = 'portal-target';
  document.body.appendChild(host);
  const node = el();
  const p = portal(node, { container: '#portal-target' });
  assert.equal(node.parentElement, host);
  p.detach();
  host.remove();
});

test('portal: a selector matching nothing throws (no silent no-op)', () => {
  let threw = false;
  try {
    portal(el(), { container: '#does-not-exist' });
  } catch {
    threw = true;
  }
  assert.equal(threw, true);
});

test('portal: does NOT clear the container — existing children survive', () => {
  const host = el();
  const keep = el('b', 'keep');
  host.appendChild(keep);
  document.body.appendChild(host);
  const node = el('i', 'added');
  const p = portal(node, { container: host });
  assert.equal(keep.parentElement, host, 'pre-existing child untouched');
  assert.equal(host.children.length, 2);
  p.detach();
  assert.equal(host.children.length, 1, 'only the portalled node removed');
  assert.equal(keep.parentElement, host);
  host.remove();
});

test('portal: detach removes the node, flips attached(), and is idempotent', () => {
  const node = el();
  const p = portal(node);
  p.detach();
  assert.equal(node.parentElement, null, 'removed from DOM');
  assert.equal(p.attached(), false);
  p.detach(); // second call must not throw / double-act
  assert.equal(p.attached(), false);
});

test('portal: attached() is reactive', async () => {
  const seen: boolean[] = [];
  const node = el();
  const p = portal(node);
  const stop = effect(() => {
    seen.push(p.attached());
  });
  await Promise.resolve();
  p.detach();
  await Promise.resolve();
  assert.deepEqual(seen, [true, false], 'effect saw attach → detach');
  stop();
});

test('portal: owner disposal auto-detaches (no leak)', () => {
  const node = el();
  const owner: Owner = createOwner();
  const p = runInOwner(owner, () => portal(node));
  assert.equal(node.parentElement, document.body);
  disposeOwner(owner);
  assert.equal(node.parentElement, null, 'detached on owner dispose');
  assert.equal(p.attached(), false);
});

test('portal: a DocumentFragment attaches all children and detach removes them all', () => {
  const host = el();
  document.body.appendChild(host);
  const frag = document.createDocumentFragment();
  const a = el('span', 'a');
  const b = el('span', 'b');
  frag.append(a, b);
  const p = portal(frag, { container: host });
  assert.equal(host.children.length, 2, 'both fragment children attached');
  p.detach();
  assert.equal(host.children.length, 0, 'both removed on detach');
  assert.equal(a.parentElement, null);
  assert.equal(b.parentElement, null);
  host.remove();
});

test('portal: accepts a factory that produces the node', () => {
  const host = el();
  document.body.appendChild(host);
  const p = portal(() => el('u', 'made'), { container: host });
  assert.equal(host.children.length, 1);
  assert.equal(host.firstElementChild!.textContent, 'made');
  p.detach();
  host.remove();
});
