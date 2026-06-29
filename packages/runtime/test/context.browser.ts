import { test, assert } from '../../../tools/harness.js';
import {
  createContext,
  provide,
  inject,
  signal,
  effect,
  root,
  createOwner,
  runInOwner,
  type Signal,
  type Context,
  type Owner,
} from '@weave/runtime';
import { defineComponent, ifBlock } from '@weave/runtime/dom';
import type { Component } from '@weave/runtime/dom';

test('inject reads the nearest provided value', () => {
  const Theme: Context<string> = createContext('light');
  root(() => {
    provide(Theme, 'dark');
    const child: Owner = createOwner();
    runInOwner(child, () => {
      assert.equal(inject(Theme), 'dark');
    });
  });
});

test('inject falls back to the context default when no ancestor provided', () => {
  const Count: Context<number> = createContext(42);
  root(() => {
    assert.equal(inject(Count), 42);
  });
});

test('inject returns undefined when there is no default and no provider', () => {
  const C: Context<string> = createContext<string>();
  root(() => {
    assert.equal(inject(C), undefined);
  });
});

test('a nested provide shadows an outer one for its subtree only', () => {
  const C: Context<string> = createContext('a');
  root(() => {
    provide(C, 'b');
    const inner: Owner = createOwner();
    runInOwner(inner, () => {
      provide(C, 'c');
      assert.equal(inject(C), 'c');
    });
    // back in the outer scope the inner override is invisible
    assert.equal(inject(C), 'b');
  });
});

test('context carries a reactive signal that stays live across the boundary', () => {
  const Count: Context<Signal<number>> = createContext<Signal<number>>();
  root(() => {
    const n: Signal<number> = signal(1);
    provide(Count, n);
    const child: Owner = createOwner();
    const seen: number[] = [];
    runInOwner(child, () => {
      const c: Signal<number> = inject(Count)!;
      effect(() => seen.push(c()));
    });
    assert.deepEqual(seen, [1]);
    n.set(2);
    assert.deepEqual(seen, [1, 2]);
  });
});

test('inject works inside an effect, not just synchronous setup (owner-tree, not a render stack)', () => {
  const C: Context<string> = createContext('x');
  root(() => {
    provide(C, 'y');
    const child: Owner = createOwner();
    let got: string = '';
    runInOwner(child, () => {
      effect(() => {
        got = inject(C);
      });
    });
    assert.equal(got, 'y');
  });
});

test('provide outside any owner scope throws', () => {
  const C: Context<number> = createContext(0);
  let threw: boolean = false;
  try {
    provide(C, 1);
  } catch {
    threw = true;
  }
  assert.ok(threw, 'expected provide() to throw outside an owner');
});

test('context survives a control-flow re-render driven from outside the owner', () => {
  const C: Context<string> = createContext('default');
  const seen: string[] = [];
  const toggle: Signal<boolean> = signal(true);
  const branchA = (): Text => {
    seen.push('A:' + inject(C));
    return document.createTextNode('A');
  };
  const branchB = (): Text => {
    seen.push('B:' + inject(C));
    return document.createTextNode('B');
  };

  let dispose!: () => void;
  root((d) => {
    dispose = d;
    provide(C, 'provided');
    const anchor: Comment = document.createComment('if');
    const wrap: HTMLDivElement = document.createElement('div');
    wrap.appendChild(anchor);
    ifBlock(anchor, () => (toggle() ? branchA : branchB));
  });

  // Re-render from OUTSIDE the owner (currentOwner is null here) — the regression:
  // branch owners must parent to the construction-time owner, not the ambient one.
  toggle.set(false);
  toggle.set(true);

  assert.deepEqual(seen, ['A:provided', 'B:provided', 'A:provided']);
  dispose();
});

test('defineComponent: a descendant injects the provider, a sibling sees only the default', () => {
  const Ctx: Context<string> = createContext('default');
  const log: string[] = [];

  // Leaf injects the context during setup and records it under a label prop.
  const Leaf: Component = defineComponent(
    () => document.createComment('leaf'),
    (props) => {
      log.push(`${props.label}:${inject(Ctx)}`);
    }
  );

  // Provider provides a value in setup, then mounts a Leaf inside its own scope.
  const Provider: Component = defineComponent(
    () => {
      Leaf({ label: 'inside' }, {});
      return document.createComment('provider');
    },
    () => {
      provide(Ctx, 'provided');
    }
  );

  root(() => {
    Provider({}, {});
    // a sibling of Provider — outside its context frame
    Leaf({ label: 'sibling' }, {});
  });

  assert.deepEqual(log, ['inside:provided', 'sibling:default']);
});
