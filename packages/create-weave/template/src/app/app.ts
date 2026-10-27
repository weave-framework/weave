import { signal } from '@weave-framework/runtime';

export function setup() {
  const count = signal(0);
  const inc = (): void => {
    count.set((n) => n + 1);
  };
}
