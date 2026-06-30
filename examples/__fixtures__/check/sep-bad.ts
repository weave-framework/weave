import { signal } from '@weave-framework/runtime';

export function setup() {
  const n = signal(0);
  const bad: number = 'not a number';
  return { n, bad };
}
