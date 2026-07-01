import { test, assert } from '../../../../tools/harness.js';
import { effect, createOwner, runInOwner, disposeOwner, type Owner } from '@weave-framework/runtime';
import { portal, type PortalHandle } from '@weave-framework/ui/cdk';

function el(tag: string = 'div', text: string = ''): HTMLElement {
  const n: HTMLElement = document.createElement(tag);
  if (text) n.textContent = text;
  return n;
}

test('portal: attaches into <body> by default and reports attached()', () => {
  const node: HTMLElement = el('div', 'p1');
  const p: PortalHandle = portal(node);
  assert.equal(p.container, document.body);
  assert.equal(node.parentElement, document.body, 'node landed in body');
  assert.equal(p.attached(), true);
  p.detach();
});

test('portal: attaches into a given container element', () => {
  const host: HTMLElement = el();
  document.body.appendChild(host);
  const node: HTMLElement = el('span', 'x');
  const p: PortalHandle = portal(node, { container: host });
  assert.equal(node.parentElement, host);
  p.detach();
  host.remove();
});

test('portal: resolves a CSS selector container', () => {
  const host: HTMLElement = el();
  host.id = 'portal-target';
  document.body.appendChild(host);
  const node: HTMLElement = el();
  const p: PortalHandle = portal(node, { container: '#portal-target' });
  assert.equal(node.parentElement, host);
  p.detach();
  host.remove();
});

test('portal: a selector matching nothing throws (no silent no-op)', () => {
  let threw: boolean = false;
  try {
    portal(el(), { container: '#does-not-exist' });
  } catch {
    threw = true;
  }
  assert.equal(threw, true);
});

test('portal: does NOT clear the container — existing children survive', () => {
  const host: HTMLElement = el();
  const keep: HTMLElement = el('b', 'keep');
  host.appendChild(keep);
  document.body.appendChild(host);
  const node: HTMLElement = el('i', 'added');
  const p: PortalHandle = portal(node, { container: host });
  assert.equal(keep.parentElement, host, 'pre-existing child untouched');
  assert.equal(host.children.length, 2);
  p.detach();
  assert.equal(host.children.length, 1, 'only the portalled node removed');
  assert.equal(keep.parentElement, host);
  host.remove();
});

test('portal: detach removes the node, flips attached(), and is idempotent', () => {
  const node: HTMLElement = el();
  const p: PortalHandle = portal(node);
  p.detach();
  assert.equal(node.parentElement, null, 'removed from DOM');
  assert.equal(p.attached(), false);
  p.detach(); // second call must not throw / double-act
  assert.equal(p.attached(), false);
});

test('portal: attached() is reactive', async () => {
  const seen: boolean[] = [];
  const node: HTMLElement = el();
  const p: PortalHandle = portal(node);
  const stop: () => void = effect(() => {
    seen.push(p.attached());
  });
  await Promise.resolve();
  p.detach();
  await Promise.resolve();
  assert.deepEqual(seen, [true, false], 'effect saw attach → detach');
  stop();
});

test('portal: owner disposal auto-detaches (no leak)', () => {
  const node: HTMLElement = el();
  const owner: Owner = createOwner();
  const p: PortalHandle = runInOwner(owner, () => portal(node));
  assert.equal(node.parentElement, document.body);
  disposeOwner(owner);
  assert.equal(node.parentElement, null, 'detached on owner dispose');
  assert.equal(p.attached(), false);
});

test('portal: a DocumentFragment attaches all children and detach removes them all', () => {
  const host: HTMLElement = el();
  document.body.appendChild(host);
  const frag: DocumentFragment = document.createDocumentFragment();
  const a: HTMLElement = el('span', 'a');
  const b: HTMLElement = el('span', 'b');
  frag.append(a, b);
  const p: PortalHandle = portal(frag, { container: host });
  assert.equal(host.children.length, 2, 'both fragment children attached');
  p.detach();
  assert.equal(host.children.length, 0, 'both removed on detach');
  assert.equal(a.parentElement, null);
  assert.equal(b.parentElement, null);
  host.remove();
});

test('portal: accepts a factory that produces the node', () => {
  const host: HTMLElement = el();
  document.body.appendChild(host);
  const p: PortalHandle = portal(() => el('u', 'made'), { container: host });
  assert.equal(host.children.length, 1);
  assert.equal(host.firstElementChild!.textContent, 'made');
  p.detach();
  host.remove();
});
