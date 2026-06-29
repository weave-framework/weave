import { test, assert } from '../../../tools/harness.js';
import { signal, effect, root, type Signal } from '@weave/runtime';
import { ifBlock, eachBlock, type ForContext } from '@weave/runtime/dom';

function host(): { parent: HTMLElement; anchor: Comment } {
  const parent: HTMLDivElement = document.createElement('div');
  document.body.appendChild(parent);
  const anchor: Comment = document.createComment('a');
  parent.appendChild(anchor);
  return { parent, anchor };
}

test('ifBlock mounts, swaps, and clears', () => {
  const { parent, anchor } = host();
  const which: Signal<'a' | 'b' | 'none'> = signal<'a' | 'b' | 'none'>('a');
  const A = (): HTMLParagraphElement => { const p: HTMLParagraphElement = document.createElement('p'); p.textContent = 'A'; return p; };
  const B = (): HTMLParagraphElement => { const p: HTMLParagraphElement = document.createElement('p'); p.textContent = 'B'; return p; };
  ifBlock(anchor, () => (which() === 'a' ? A : which() === 'b' ? B : null));
  assert.equal(parent.querySelector('p')!.textContent, 'A');
  which.set('b');
  assert.equal(parent.querySelector('p')!.textContent, 'B');
  which.set('none');
  assert.equal(parent.querySelector('p'), null);
});

test('ifBlock disposes the branch effects on unmount (no leak)', () => {
  const { anchor } = host();
  const show: Signal<boolean> = signal(true);
  const n: Signal<number> = signal(0);
  let runs: number = 0;
  const branch = (): HTMLParagraphElement => {
    const el: HTMLParagraphElement = document.createElement('p');
    effect(() => {
      n(); // subscribe
      runs++;
    });
    return el;
  };
  let dispose!: () => void;
  root((d) => {
    dispose = d;
    ifBlock(anchor, () => (show() ? branch : null));
  });
  assert.equal(runs, 1);
  n.set(1);
  assert.equal(runs, 2, 'branch effect reacts while mounted');
  show.set(false); // unmount branch → its effect must be disposed
  const frozen: number = runs;
  n.set(2);
  assert.equal(runs, frozen, 'disposed branch effect does not run');
  dispose();
});

test('eachBlock renders keyed rows with reactive item + $index', () => {
  const { parent, anchor } = host();
  const items: Signal<{ id: number; t: string }[]> = signal([{ id: 1, t: 'a' }, { id: 2, t: 'b' }]);
  const render = (ctx: ForContext<{ id: number; t: string }>): HTMLLIElement => {
    const li: HTMLLIElement = document.createElement('li');
    effect(() => {
      li.textContent = `${ctx.index()}:${ctx.item().t}`;
    });
    return li;
  };
  eachBlock(anchor, () => items(), (it) => it.id, render);
  const order = (): (string | null)[] => [...parent.querySelectorAll('li')].map((l) => l.textContent);
  assert.deepEqual(order(), ['0:a', '1:b']);

  const firstLi: HTMLLIElement = parent.querySelector('li')!;
  items.set((xs) => [{ id: 0, t: 'z' }, ...xs]); // prepend → indices shift
  assert.deepEqual(order(), ['0:z', '1:a', '2:b']);
  // the row for id:1 was reused but its $index updated reactively
  assert.is(parent.querySelector('[data-keep]') ?? firstLi, firstLi);
  assert.equal(firstLi.textContent, '1:a', 'reused row reflects new index');
});

test('eachBlock disposes removed rows (no leak)', () => {
  const { anchor } = host();
  const items: Signal<number[]> = signal([1, 2, 3]);
  const alive: Set<number> = new Set<number>();
  const render = (ctx: ForContext<number>): HTMLLIElement => {
    const li: HTMLLIElement = document.createElement('li');
    const id: number = ctx.item();
    alive.add(id);
    effect(() => {
      ctx.item();
      return () => alive.delete(id);
    });
    return li;
  };
  let dispose!: () => void;
  root((d) => {
    dispose = d;
    eachBlock(anchor, () => items(), (n) => n, render);
  });
  assert.deepEqual([...alive].sort(), [1, 2, 3]);
  items.set([1, 3]); // remove 2
  assert.deepEqual([...alive].sort(), [1, 3], 'removed row torn down');
  dispose();
  assert.deepEqual([...alive], [], 'all rows torn down on dispose');
});
