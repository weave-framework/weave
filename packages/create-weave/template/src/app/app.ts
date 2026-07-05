import { signal, type Signal } from '@weave-framework/runtime';

export function setup(): { count: Signal<number>; inc: () => void } {
  const count: Signal<number> = signal(0);
  const inc = (): void => { count.set((n) => n + 1); };
  return { count, inc };
}
