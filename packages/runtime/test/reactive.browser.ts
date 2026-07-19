import { test, assert } from '../../../tools/harness.js';
import { signal, computed, effect, batch, untrack, onCleanup, onMount, tick, root } from '@weave-framework/runtime';
import type { Signal, Computed } from '@weave-framework/runtime';

test('signal read/write', () => {
  const n: Signal<number> = signal(1);
  assert.equal(n(), 1);
  n.set(2);
  assert.equal(n(), 2);
  n.set((v) => v + 10);
  assert.equal(n(), 12);
  assert.equal(n.peek(), 12);
});

test('computed derives and caches', () => {
  const a: Signal<number> = signal(2);
  const b: Signal<number> = signal(3);
  let runs: number = 0;
  const sum: Computed<number> = computed(() => {
    runs++;
    return a() + b();
  });
  assert.equal(sum(), 5);
  assert.equal(sum(), 5);
  assert.equal(runs, 1);
  a.set(10);
  assert.equal(sum(), 13);
  assert.equal(runs, 2);
});

test('effect runs on create and on change', () => {
  const n: Signal<number> = signal(0);
  const seen: number[] = [];
  effect(() => seen.push(n()));
  assert.deepEqual(seen, [0]);
  n.set(1);
  n.set(2);
  assert.deepEqual(seen, [0, 1, 2]);
});

test('effect does not fire when value is equal', () => {
  const n: Signal<number> = signal(1);
  let runs: number = 0;
  effect(() => {
    n();
    runs++;
  });
  n.set(1);
  assert.equal(runs, 1);
});

test('diamond graph is glitch-free (no double compute)', () => {
  const a: Signal<number> = signal(1);
  const b: Computed<number> = computed(() => a() + 1);
  const c: Computed<number> = computed(() => a() + 1);
  let effectRuns: number = 0;
  let sum: number = 0;
  effect(() => {
    sum = b() + c();
    effectRuns++;
  });
  assert.equal(sum, 4);
  assert.equal(effectRuns, 1);
  a.set(2);
  assert.equal(sum, 6);
  assert.equal(effectRuns, 2);
});

test('deep chain recomputes lazily', () => {
  const a: Signal<number> = signal(1);
  let cRuns: number = 0;
  const b: Computed<number> = computed(() => a() * 2);
  const c: Computed<number> = computed(() => {
    cRuns++;
    return b() + 1;
  });
  assert.equal(c(), 3);
  assert.equal(cRuns, 1);
  a.set(1);
  assert.equal(c(), 3);
  assert.equal(cRuns, 1);
});

test('unchanged memo blocks downstream recompute', () => {
  const a: Signal<number> = signal(4);
  const even: Computed<boolean> = computed(() => a() % 2 === 0);
  let runs: number = 0;
  const label: Computed<string> = computed(() => {
    runs++;
    return even() ? 'even' : 'odd';
  });
  assert.equal(label(), 'even');
  assert.equal(runs, 1);
  a.set(6);
  assert.equal(label(), 'even');
  assert.equal(runs, 1);
  a.set(7);
  assert.equal(label(), 'odd');
  assert.equal(runs, 2);
});

test('batch coalesces effect runs', () => {
  const a: Signal<number> = signal(1);
  const b: Signal<number> = signal(2);
  let runs: number = 0;
  effect(() => {
    a();
    b();
    runs++;
  });
  assert.equal(runs, 1);
  batch(() => {
    a.set(10);
    b.set(20);
  });
  assert.equal(runs, 2);
});

test('untrack reads without subscribing', () => {
  const a: Signal<number> = signal(1);
  const b: Signal<number> = signal(1);
  let runs: number = 0;
  effect(() => {
    a();
    untrack(() => b());
    runs++;
  });
  assert.equal(runs, 1);
  b.set(99);
  assert.equal(runs, 1);
  a.set(2);
  assert.equal(runs, 2);
});

test('effect cleanup runs before re-run and on dispose', () => {
  const n: Signal<number> = signal(0);
  const log: string[] = [];
  const stop: () => void = effect(() => {
    const v: number = n();
    log.push(`run:${v}`);
    onCleanup(() => log.push(`cleanup:${v}`));
  });
  n.set(1);
  assert.deepEqual(log, ['run:0', 'cleanup:0', 'run:1']);
  stop();
  assert.deepEqual(log, ['run:0', 'cleanup:0', 'run:1', 'cleanup:1']);
  n.set(2);
  assert.deepEqual(log, ['run:0', 'cleanup:0', 'run:1', 'cleanup:1']);
});

test('returned cleanup function works too', () => {
  const n: Signal<number> = signal(0);
  const log: string[] = [];
  effect(() => {
    const v: number = n();
    return () => log.push(`tear:${v}`);
  });
  n.set(1);
  assert.deepEqual(log, ['tear:0']);
});

test('dynamic dependencies: stale sources are dropped', () => {
  const cond: Signal<boolean> = signal(true);
  const a: Signal<string> = signal('A');
  const b: Signal<string> = signal('B');
  let out: string = '';
  let runs: number = 0;
  effect(() => {
    out = cond() ? a() : b();
    runs++;
  });
  assert.equal(out, 'A');
  assert.equal(runs, 1);
  b.set('B2');
  assert.equal(runs, 1);
  cond.set(false);
  assert.equal(out, 'B2');
  assert.equal(runs, 2);
  a.set('A2');
  assert.equal(runs, 2);
});

/* ──────────── tick ──────────── */

test('tick resolves on a microtask (after earlier-queued microtasks)', async () => {
  const order: string[] = [];
  queueMicrotask(() => order.push('earlier'));
  await tick();
  order.push('after-tick');
  assert.deepEqual(order, ['earlier', 'after-tick']);
});

test('await tick flushes a pending onMount callback', async () => {
  let mounted: boolean = false;
  root((d) => {
    onMount(() => {
      mounted = true;
    });
    return d;
  });
  assert.equal(mounted, false, 'onMount is deferred, not synchronous');
  await tick();
  assert.equal(mounted, true, 'onMount ran before tick resolved');
});

test('synchronous reactive updates are already applied before tick', async () => {
  const n: Signal<number> = signal(0);
  let seen: number = -1;
  effect(() => {
    seen = n();
  });
  n.set(3);
  assert.equal(seen, 3, 'effect already ran synchronously on set');
  await tick(); // nothing pending — still resolves
  assert.equal(seen, 3);
});

// ── A1 — reactive-core hardening (H1 leak · H2 fail-loud · M8 runaway guard) ──

test('computed disposes with its owner — no leaked subscription', () => {
  const src: Signal<number> = signal(0); // long-lived, outlives the owner below
  let cleaned: number = 0;
  let disposeRoot: () => void = () => {};
  root((d) => {
    disposeRoot = d;
    const m: Computed<number> = computed(() => {
      onCleanup(() => cleaned++);
      return src();
    });
    m(); // read to activate: links `m` into `src.observers` and registers the cleanup
    return d;
  });
  assert.equal(cleaned, 0, 'cleanup has not run yet');
  disposeRoot();
  // Without the fix, computed() never registered an owner-disposer, so disposing the owner runs no
  // cleanup and leaves `m` in `src.observers` forever. The cleanup firing proves the memo is torn down.
  assert.equal(cleaned, 1, 'disposing the owner tore the memo down');
});

test('a throwing memo does not cache a stale value (H2 — fail-loud)', () => {
  const boom: Signal<boolean> = signal(true);
  const m: Computed<number> = computed(() => {
    if (boom()) throw new Error('boom');
    return 42;
  });
  let threw: number = 0;
  try {
    m();
  } catch {
    threw++;
  }
  assert.equal(threw, 1, 'first read throws');
  // Second read must recompute and throw again — NOT silently return a stale (undefined) value.
  try {
    m();
  } catch {
    threw++;
  }
  assert.equal(threw, 2, 'second read re-throws instead of returning stale');
  boom.set(false); // fix the cause → next read recomputes cleanly
  assert.equal(m(), 42, 'recomputes once the cause is resolved');
});

test('an effect invalidated WHILE it runs re-runs, and ends up with the current value', () => {
  // A running effect is DIRTY for its whole execution, and `markDirty` early-returns on an already-DIRTY
  // node. So an invalidation arriving mid-run was DISCARDED: the effect finished holding a value that was
  // already stale, went CLEAN, and left the queue. Nothing threw and nothing looped — it was simply one
  // update behind, permanently, and every later run landed one behind again.
  //
  // The shape: B runs, and while it runs a nested flush runs A, which writes the signal B just read.
  root(() => {
    const x: Signal<number> = signal(0);
    const t: Signal<number> = signal(0);
    const trigger: Signal<number> = signal(0);
    const seen: number[] = [];

    // A: reads x, writes t. Does NOT read `trigger`, so it is not queued by the write below.
    effect(() => {
      t.set(x() + 1);
    });
    // B: reads trigger and t, writes x. `trigger.set` queues ONLY B, so B is the effect that is RUNNING
    // when its own write to x flushes A, and A's write to t invalidates B mid-run. B's write is
    // IDEMPOTENT, so the pair converges — the point here is that the update is not lost, not that a
    // divergent pair can be made to settle (see the two tests below for that).
    effect(() => {
      const round: number = trigger();
      seen.push(t());
      x.set(100 + round); // changes on each round, then is stable within the round → converges
    });

    seen.length = 0;
    trigger.set(1);
    assert.equal(seen.at(-1), t(), `the effect ended on the CURRENT value (saw ${seen.join(',')}, t=${t()})`);
    assert.ok(seen.length > 1, 'it genuinely re-ran rather than never being invalidated');
  });
});

test('a genuinely non-converging effect cycle fails loudly instead of silently', () => {
  // The counterpart to the above: if re-running an effect can never settle, that must be reported. A
  // silent drop and an infinite loop are both wrong; the third option is to bound it and say so.
  let threw: unknown = null;
  root(() => {
    const n: Signal<number> = signal(0);
    try {
      effect(() => {
        n.set(n() + 1); // reads and writes the same signal — cannot converge
      });
    } catch (e) {
      threw = e;
    }
  });
  assert.ok(threw, 'a non-converging effect throws rather than hanging or going quiet');
  assert.ok(String(threw).includes('effect'), `the message names the problem (got: ${String(threw)})`);
});

test('mutual effects terminate: a convergent pair settles, a divergent one reports', () => {
  // CONTRACT CHANGE, recorded deliberately. This test used to assert that `y = x + 1` / `x = y + 1`
  // "settles synchronously without hanging", and it did — because `markDirty` DROPPED the invalidation
  // aimed at the running effect. But that pair has no fixed point: settling meant stopping at whatever
  // value the dropped update happened to leave behind. Termination by losing data is not termination.
  //
  // Now: a pair that CAN converge does, and a pair that cannot is reported instead of quietly producing
  // an arbitrary answer. Both halves are asserted here so neither can regress into the other.
  let settled: boolean = false;
  root(() => {
    const a: Signal<number> = signal(0);
    const b: Signal<number> = signal(0);
    // Idempotent writes → a fixed point exists, and the pair reaches it.
    effect(() => b.set(Math.min(a(), 3)));
    effect(() => a.set(Math.min(b(), 3)));
    a.set(5);
    settled = true;
  });
  assert.ok(settled, 'a convergent mutual pair settles instead of looping forever');

  let threw: unknown = null;
  root(() => {
    const x: Signal<number> = signal(0);
    const y: Signal<number> = signal(0);
    try {
      effect(() => y.set(x() + 1));
      effect(() => x.set(y() + 1)); // no fixed point — grows without bound
      x.set(5);
    } catch (e) {
      threw = e;
    }
  });
  assert.ok(threw, 'a divergent mutual pair is reported rather than settling on an arbitrary value');
});
