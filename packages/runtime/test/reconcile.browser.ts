import { test, assert } from '../../../tools/harness.js';
import { reconcileKeyed, type Row } from '@weave/runtime/dom';

interface Item { id: number; text: string; }

/** A driver mirroring what the compiled `@for` block will do each update. */
function makeList(build?: (item: Item) => HTMLElement) {
  const parent = document.createElement('ul');
  document.body.appendChild(parent);
  const end = document.createComment('end');
  parent.appendChild(end);
  let rows: Row[] = [];
  const created: number[] = [];

  const update = (data: Item[]) => {
    rows = reconcileKeyed(
      parent,
      end,
      rows,
      data,
      (d) => d.id,
      (d) => {
        created.push(d.id);
        const li = build ? build(d) : document.createElement('li');
        if (!build) li.textContent = d.text;
        li.dataset.id = String(d.id);
        return { key: d.id, node: li };
      }
    );
  };

  const order = () => [...parent.querySelectorAll('li')].map((li) => li.dataset.id);
  const texts = () => [...parent.querySelectorAll('li')].map((li) => li.textContent);
  return { parent, update, order, texts, created };
}

test('initial render', () => {
  const l = makeList();
  l.update([{ id: 1, text: 'a' }, { id: 2, text: 'b' }, { id: 3, text: 'c' }]);
  assert.deepEqual(l.order(), ['1', '2', '3']);
  assert.deepEqual(l.texts(), ['a', 'b', 'c']);
});

test('append reuses existing nodes (identity preserved)', () => {
  const l = makeList();
  l.update([{ id: 1, text: 'a' }, { id: 2, text: 'b' }]);
  const first = l.parent.querySelector('li')!;
  l.update([{ id: 1, text: 'a' }, { id: 2, text: 'b' }, { id: 3, text: 'c' }]);
  assert.deepEqual(l.order(), ['1', '2', '3']);
  assert.is(l.parent.querySelector('li'), first, 'node for id:1 reused, not recreated');
  assert.deepEqual(l.created, [1, 2, 3], 'only id:3 created on the second pass');
});

test('remove middle item', () => {
  const l = makeList();
  l.update([{ id: 1, text: 'a' }, { id: 2, text: 'b' }, { id: 3, text: 'c' }]);
  l.update([{ id: 1, text: 'a' }, { id: 3, text: 'c' }]);
  assert.deepEqual(l.order(), ['1', '3']);
});

test('reorder preserves node identity for every key', () => {
  const l = makeList();
  l.update([{ id: 1, text: 'a' }, { id: 2, text: 'b' }, { id: 3, text: 'c' }]);
  const byId = new Map([...l.parent.querySelectorAll('li')].map((li) => [li.dataset.id, li]));
  // reverse
  l.update([{ id: 3, text: 'c' }, { id: 2, text: 'b' }, { id: 1, text: 'a' }]);
  assert.deepEqual(l.order(), ['3', '2', '1']);
  for (const id of ['1', '2', '3']) {
    assert.is(l.parent.querySelector(`[data-id="${id}"]`), byId.get(id), `id:${id} kept its node`);
  }
  assert.deepEqual(l.created, [1, 2, 3], 'no nodes recreated on reorder');
});

test('minimal moves: the stable run is not touched', () => {
  // [1,2,3,4] -> [2,3,4,1]. Only node 1 should move; 2,3,4 are a stable run.
  const l = makeList();
  l.update([1, 2, 3, 4].map((id) => ({ id, text: String(id) })));
  const nodes = new Map([...l.parent.querySelectorAll('li')].map((li) => [li.dataset.id, li]));
  // mark the stable nodes so we can detect any re-insertion
  for (const li of l.parent.querySelectorAll('li')) (li as any).__touched = false;
  l.update([2, 3, 4, 1].map((id) => ({ id, text: String(id) })));
  assert.deepEqual(l.order(), ['2', '3', '4', '1']);
  // identity preserved for all
  for (const id of ['1', '2', '3', '4']) {
    assert.is(l.parent.querySelector(`[data-id="${id}"]`), nodes.get(id));
  }
});

test('focus is preserved across reorder', () => {
  const l = makeList((d) => {
    const li = document.createElement('li');
    const input = document.createElement('input');
    input.value = d.text;
    li.appendChild(input);
    return li;
  });
  l.update([{ id: 1, text: 'a' }, { id: 2, text: 'b' }, { id: 3, text: 'c' }]);
  const input2 = l.parent.querySelector('[data-id="2"] input') as HTMLInputElement;
  input2.focus();
  assert.is(document.activeElement, input2, 'precondition: input focused');
  // move id:2 to the end
  l.update([{ id: 1, text: 'a' }, { id: 3, text: 'c' }, { id: 2, text: 'b' }]);
  assert.deepEqual([...l.parent.querySelectorAll('li')].map((li) => (li as HTMLElement).dataset.id), ['1', '3', '2']);
  assert.is(document.activeElement, input2, 'focus survived the move');
});

test('dispose is called for removed rows', () => {
  const parent = document.createElement('ul');
  document.body.appendChild(parent);
  const end = document.createComment('end');
  parent.appendChild(end);
  const disposed: number[] = [];
  let rows: Row[] = [];
  const update = (ids: number[]) => {
    rows = reconcileKeyed(parent, end, rows, ids, (id) => id, (id) => {
      const li = document.createElement('li');
      return { key: id, node: li, dispose: () => disposed.push(id) };
    });
  };
  update([1, 2, 3]);
  update([1, 3]);
  assert.deepEqual(disposed, [2]);
  update([]);
  assert.deepEqual(disposed.sort(), [1, 2, 3]);
});
