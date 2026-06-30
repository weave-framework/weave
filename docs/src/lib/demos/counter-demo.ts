import { signal } from '@weave/runtime';

interface CounterSetup {
  count: () => number;
  inc: () => void;
  reset: () => void;
}

/** The canonical first example, running live in the docs. */
export function setup(): CounterSetup {
  const count = signal(0);
  const inc = (): void => count.set((n) => n + 1);
  const reset = (): void => count.set(0);
  return { count, inc, reset };
}
