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
} from '@weave/runtime';
import { defineComponent } from '@weave/runtime/dom';

test('inject reads the nearest provided value', () => {
  const Theme = createContext('light');
  root(() => {
    provide(Theme, 'dark');
    const child = createOwner();
    runInOwner(child, () => {
      assert.equal(inject(Theme), 'dark');
    });
  });
});

test('inject falls back to the context default when no ancestor provided', () => {
  const Count = createContext(42);
  root(() => {
    assert.equal(inject(Count), 42);
  });
});

test('inject returns undefined when there is no default and no provider', () => {
  const C = createContext<string>();
  root(() => {
    assert.equal(inject(C), undefined);
  });
});

test('a nested provide shadows an outer one for its subtree only', () => {
  const C = createContext('a');
  root(() => {
    provide(C, 'b');
    const inner = createOwner();
    runInOwner(inner, () => {
      provide(C, 'c');
      assert.equal(inject(C), 'c');
    });
    // back in the outer scope the inner override is invisible
    assert.equal(inject(C), 'b');
  });
});

test('context carries a reactive signal that stays live across the boundary', () => {
  const Count = createContext<Signal<number>>();
  root(() => {
    const n = signal(1);
    provide(Count, n);
    const child = createOwner();
    const seen: number[] = [];
    runInOwner(child, () => {
      const c = inject(Count)!;
      effect(() => seen.push(c()));
    });
    assert.deepEqual(seen, [1]);
    n.set(2);
    assert.deepEqual(seen, [1, 2]);
  });
});

test('inject works inside an effect, not just synchronous setup (owner-tree, not a render stack)', () => {
  const C = createContext('x');
  root(() => {
    provide(C, 'y');
    const child = createOwner();
    let got = '';
    runInOwner(child, () => {
      effect(() => {
        got = inject(C);
      });
    });
    assert.equal(got, 'y');
  });
});

test('provide outside any owner scope throws', () => {
  const C = createContext(0);
  let threw = false;
  try {
    provide(C, 1);
  } catch {
    threw = true;
  }
  assert.ok(threw, 'expected provide() to throw outside an owner');
});

test('defineComponent: a descendant injects the provider, a sibling sees only the default', () => {
  const Ctx = createContext('default');
  const log: string[] = [];

  // Leaf injects the context during setup and records it under a label prop.
  const Leaf = defineComponent(
    () => document.createComment('leaf'),
    (props) => {
      log.push(`${props.label}:${inject(Ctx)}`);
    }
  );

  // Provider provides a value in setup, then mounts a Leaf inside its own scope.
  const Provider = defineComponent(
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
