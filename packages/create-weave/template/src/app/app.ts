import { signal } from '@weave-framework/runtime';

export function setup() {
  const count = signal(0);
  const inc = () => count.set((n) => n + 1);
  return { count, inc };
}
