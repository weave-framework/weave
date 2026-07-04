import { test, assert } from '../../../tools/harness.js';
import {
  signal,
  enableDevtools,
  inspectTree,
  createOwner,
  runInOwner,
  disposeOwner,
  type Owner,
  type DevOwnerNode,
} from '@weave-framework/runtime';
import { mountComponent, type Component } from '@weave-framework/runtime/dom';

const find = (roots: DevOwnerNode[], pred: (n: DevOwnerNode) => boolean): DevOwnerNode | undefined => {
  for (const r of roots) {
    if (pred(r)) return r;
    const hit: DevOwnerNode | undefined = find(r.children, pred);
    if (hit) return hit;
  }
  return undefined;
};
const hasNode = (n: DevOwnerNode, name: string): boolean => n.nodes.some((s) => s.name === name);

test('inspectTree: a scope groups the nodes created in it', () => {
  enableDevtools(true);
  const owner: Owner = createOwner();
  runInOwner(owner, () => {
    signal(1, { name: 'tree-a' });
    signal(2, { name: 'tree-b' });
    const roots: DevOwnerNode[] = inspectTree();
    const scope: DevOwnerNode | undefined = find(roots, (n) => hasNode(n, 'tree-a'));
    assert.ok(scope, 'a scope owns tree-a');
    assert.ok(hasNode(scope!, 'tree-b'), 'and tree-b — same scope');
  });
  disposeOwner(owner);
  enableDevtools(false);
});

test('inspectTree: nested owners nest in the tree', () => {
  enableDevtools(true);
  const outer: Owner = createOwner();
  runInOwner(outer, () => {
    signal(1, { name: 'nt-outer' });
    const inner: Owner = createOwner(); // _parent = outer (ambient)
    runInOwner(inner, () => {
      signal(2, { name: 'nt-inner' });
    });
    const roots: DevOwnerNode[] = inspectTree();
    const outerScope: DevOwnerNode | undefined = find(roots, (n) => hasNode(n, 'nt-outer'));
    assert.ok(outerScope, 'outer scope present');
    const innerScope: DevOwnerNode | undefined = find(outerScope!.children, (n) => hasNode(n, 'nt-inner'));
    assert.ok(innerScope, 'inner scope nests under outer');
  });
  disposeOwner(outer);
  enableDevtools(false);
});

test('inspectTree: mountComponent names its scope after the component', () => {
  enableDevtools(true);
  const container: HTMLElement = document.createElement('div');
  const Counter: Component = (): Node => {
    signal(0, { name: 'mc-sig' });
    return document.createElement('span');
  };
  // Name the fn so `component.name` resolves (an arrow assigned to a const carries its name).
  const dispose: () => void = mountComponent(Counter, container);
  const roots: DevOwnerNode[] = inspectTree();
  const scope: DevOwnerNode | undefined = find(roots, (n) => n.name === 'Counter');
  assert.ok(scope, 'a scope named after the component');
  assert.ok(hasNode(scope!, 'mc-sig'), 'holds the signal it created');
  dispose();
  assert.equal(
    find(inspectTree(), (n) => n.name === 'Counter'),
    undefined,
    'scope + its nodes gone after unmount (no leak)'
  );
  enableDevtools(false);
});
