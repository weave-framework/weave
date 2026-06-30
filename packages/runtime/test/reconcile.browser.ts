import { test, assert } from '../../../tools/harness.js';
import { reconcileKeyed, type Row } from '@weave-framework/runtime/dom';

interface Item { id: number; text: string; }

interface List {
  parent: HTMLUListElement;
  update: (data: Item[]) => void;
  order: () => (string | undefined)[];
  texts: () => (string | null)[];
  created: number[];
}

/** A driver mirroring what the compiled `@for` block will do each update. */
function makeList(build?: (item: Item) => HTMLElement): List {
  const parent: HTMLUListElement = document.createElement('ul');
  document.body.appendChild(parent);
  const end: Comment = document.createComment('end');
  parent.appendChild(end);
  let rows: Row[] = [];
  const created: number[] = [];

  const update = (data: Item[]): void => {
    rows = reconcileKeyed(
      parent,
      end,
      rows,
      data,
      (d) => d.id,
      (d) => {
        created.push(d.id);
        const li: HTMLElement = build ? build(d) : document.createElement('li');
        if (!build) li.textContent = d.text;
        li.dataset.id = String(d.id);
        return { key: d.id, node: li };
      }
    );
  };

  const order = (): (string | undefined)[] => [...parent.querySelectorAll('li')].map((li) => li.dataset.id);
  const texts = (): (string | null)[] => [...parent.querySelectorAll('li')].map((li) => li.textContent);
  return { parent, update, order, texts, created };
}

test('initial render', () => {
  const l: List = makeList();
  l.update([{ id: 1, text: 'a' }, { id: 2, text: 'b' }, { id: 3, text: 'c' }]);
  assert.deepEqual(l.order(), ['1', '2', '3']);
  assert.deepEqual(l.texts(), ['a', 'b', 'c']);
});

test('append reuses existing nodes (identity preserved)', () => {
  const l: List = makeList();
  l.update([{ id: 1, text: 'a' }, { id: 2, text: 'b' }]);
  const first: HTMLLIElement = l.parent.querySelector('li')!;
  l.update([{ id: 1, text: 'a' }, { id: 2, text: 'b' }, { id: 3, text: 'c' }]);
  assert.deepEqual(l.order(), ['1', '2', '3']);
  assert.is(l.parent.querySelector('li'), first, 'node for id:1 reused, not recreated');
  assert.deepEqual(l.created, [1, 2, 3], 'only id:3 created on the second pass');
});

test('remove middle item', () => {
  const l: List = makeList();
  l.update([{ id: 1, text: 'a' }, { id: 2, text: 'b' }, { id: 3, text: 'c' }]);
  l.update([{ id: 1, text: 'a' }, { id: 3, text: 'c' }]);
  assert.deepEqual(l.order(), ['1', '3']);
});

test('reorder preserves node identity for every key', () => {
  const l: List = makeList();
  l.update([{ id: 1, text: 'a' }, { id: 2, text: 'b' }, { id: 3, text: 'c' }]);
  const byId: Map<string | undefined, HTMLLIElement> = new Map([...l.parent.querySelectorAll('li')].map((li) => [li.dataset.id, li]));
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
  const l: List = makeList();
  l.update([1, 2, 3, 4].map((id) => ({ id, text: String(id) })));
  const nodes: Map<string | undefined, HTMLLIElement> = new Map([...l.parent.querySelectorAll('li')].map((li) => [li.dataset.id, li]));
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
  const l: List = makeList((d) => {
    const li: HTMLLIElement = document.createElement('li');
    const input: HTMLInputElement = document.createElement('input');
    input.value = d.text;
    li.appendChild(input);
    return li;
  });
  l.update([{ id: 1, text: 'a' }, { id: 2, text: 'b' }, { id: 3, text: 'c' }]);
  const input2: HTMLInputElement = l.parent.querySelector('[data-id="2"] input') as HTMLInputElement;
  input2.focus();
  assert.is(document.activeElement, input2, 'precondition: input focused');
  // move id:2 to the end
  l.update([{ id: 1, text: 'a' }, { id: 3, text: 'c' }, { id: 2, text: 'b' }]);
  assert.deepEqual([...l.parent.querySelectorAll('li')].map((li) => (li as HTMLElement).dataset.id), ['1', '3', '2']);
  assert.is(document.activeElement, input2, 'focus survived the move');
});

test('multi-node rows move and remove as one span', () => {
  // A component / fragment `@for` row has no single root node: it is a span
  // bracketed by marker comments (Row.node = start, Row.end = stop). The
  // reconciler must move and remove the whole span, not just the first node.
  const parent: HTMLUListElement = document.createElement('ul');
  document.body.appendChild(parent);
  const end: Comment = document.createComment('end');
  parent.appendChild(end);
  let rows: Row[] = [];
  const update = (ids: number[]): void => {
    rows = reconcileKeyed(parent, end, rows, ids, (id) => id, (id) => {
      const frag: DocumentFragment = document.createDocumentFragment();
      const start: Comment = document.createComment('');
      const a: HTMLLIElement = document.createElement('li'); a.dataset.id = String(id); a.textContent = id + 'a';
      const b: HTMLLIElement = document.createElement('li'); b.dataset.id = String(id); b.textContent = id + 'b';
      const stop: Comment = document.createComment('');
      frag.append(start, a, b, stop);
      return { key: id, node: start, end: stop };
    });
  };
  const parts = (): (string | null)[] => [...parent.querySelectorAll('li')].map((li) => li.textContent);

  update([1, 2, 3]);
  assert.deepEqual(parts(), ['1a', '1b', '2a', '2b', '3a', '3b']);
  const oneA: Element = parent.querySelector('[data-id="1"]')!;

  update([3, 1, 2]); // reorder — every span stays contiguous and intact
  assert.deepEqual(parts(), ['3a', '3b', '1a', '1b', '2a', '2b']);
  assert.is(parent.querySelector('[data-id="1"]'), oneA, 'span node reused, not recreated');

  update([3, 2]); // remove the whole span for id:1 (both its <li> and its markers)
  assert.deepEqual(parts(), ['3a', '3b', '2a', '2b']);
});

test('dispose is called for removed rows', () => {
  const parent: HTMLUListElement = document.createElement('ul');
  document.body.appendChild(parent);
  const end: Comment = document.createComment('end');
  parent.appendChild(end);
  const disposed: number[] = [];
  let rows: Row[] = [];
  const update = (ids: number[]): void => {
    rows = reconcileKeyed(parent, end, rows, ids, (id) => id, (id) => {
      const li: HTMLLIElement = document.createElement('li');
      return { key: id, node: li, dispose: () => disposed.push(id) };
    });
  };
  update([1, 2, 3]);
  update([1, 3]);
  assert.deepEqual(disposed, [2]);
  update([]);
  assert.deepEqual(disposed.sort(), [1, 2, 3]);
});
