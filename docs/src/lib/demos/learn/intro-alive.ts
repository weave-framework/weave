import { signal, computed, type Signal, type Computed } from '@weave-framework/runtime';

/**
 * The first live thing a newcomer meets, and it exists to make ONE claim checkable.
 *
 * The Introduction says Weave updates "only the piece that changed". That is a sentence a reader has
 * no way to believe or disbelieve — so this demo prints the evidence. `setup` runs once and increments
 * this counter; the number on screen is that count. Type into the box and the greeting changes on every
 * keystroke while the count stays at 1, which is the claim, visible.
 *
 * The counter is module-level rather than a signal on purpose: a signal would be the component telling
 * you about itself, and this has to be a fact from outside it.
 */
let setupRuns: number = 0;

interface IntroAliveSetup {
  name: Signal<string>;
  typed: Computed<number>;
  runs: number;
  onName: (e: Event) => void;
}

export function setup(): IntroAliveSetup {
  setupRuns += 1;
  const name: Signal<string> = signal('');
  return {
    name,
    typed: computed(() => name().length),
    runs: setupRuns,
    onName: (e: Event): void => {
      name.set((e.target as HTMLInputElement).value);
    },
  };
}
