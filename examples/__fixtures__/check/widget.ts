import { signal } from '@weave-framework/runtime';

export function setup() {
  const title = signal('weave');
  const n = signal(2);
  return { title, n };
}
