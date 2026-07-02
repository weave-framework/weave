import { test, assert } from '../../../tools/harness.js';
import { signal, effect, root, type Signal } from '@weave-framework/runtime';
import { ifBlock, eachBlock, defineComponent, dynElement, type ForContext } from '@weave-framework/runtime/dom';

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

test('a component does not leak its setup signal reads to an enclosing effect (M1)', () => {
  const s: Signal<number> = signal(0);
  const Comp: (props?: Record<string, unknown>, slots?: Record<string, () => Node>) => Node = defineComponent(
    () => document.createElement('div'),
    () => {
      s(); // setup reads a signal
      return {};
    },
  );
  let outerRuns: number = 0;
  root(() => {
    effect(() => {
      outerRuns++;
      Comp({}, {}); // instantiate the component inside the effect
    });
  });
  assert.equal(outerRuns, 1, 'the enclosing effect ran once');
  s.set(1);
  assert.equal(outerRuns, 1, 'a signal read only in child setup must not re-run the parent effect');
});

test("eachBlock coalesces a row's positional writes into one recompute (M2)", () => {
  interface Row {
    id: number;
    v: string;
  }
  const { anchor } = host();
  const list: Signal<Row[]> = signal<Row[]>([
    { id: 1, v: 'a' },
    { id: 2, v: 'b' },
  ]);
  let runs: number = 0;
  root(() => {
    eachBlock<Row>(
      anchor,
      () => list(),
      (r) => r.id,
      (ctx: ForContext<Row>) => {
        const el: HTMLElement = document.createElement('span');
        effect(() => {
          // reads TWO of the row's signals — both change on the reorder+edit below
          el.textContent = `${ctx.item().v}${ctx.index()}`;
          runs++;
        });
        return el;
      },
    );
  });
  const initial: number = runs; // one run per row = 2
  // reorder AND change each item's value → item signal + index signal both change per reused row
  list.set([
    { id: 2, v: 'B' },
    { id: 1, v: 'A' },
  ]);
  const delta: number = runs - initial;
  // batched: each reused row recomputes once (→ 2). unbatched: the item write and the index write
  // flush separately, so a binding reading both recomputes twice per row (→ 4).
  assert.ok(delta <= 2, `expected each reused row to recompute once (<=2), got ${delta}`);
});

test('dynElement refuses to create a <script> tag (M5 security)', () => {
  const { anchor } = host();
  let threw: boolean = false;
  try {
    root(() => {
      dynElement(anchor, () => 'script', () => {});
    });
  } catch {
    threw = true;
  }
  assert.ok(threw, 'a dynamic <script> element is rejected, not built');
});
