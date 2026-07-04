import { signal, type Signal } from '@weave-framework/runtime';

export function setup(): { n: Signal<number> } {
  return { n: signal(0) };
}
