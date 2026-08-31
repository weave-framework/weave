import { signal, computed } from '@weave-framework/runtime';

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
 *
 * There is no `return` here, and that is deliberate — the page prints this file verbatim, so it has to
 * be the thing it teaches. The compiler writes `return { name, typed, runs, onName }` from the names the
 * template reads. (A return-type annotation would switch that off, which is why this one has none.)
 */
let setupRuns: number = 0;

export function setup() {
  setupRuns += 1;

  const name = signal('');
  const typed = computed((): number => name().length);
  const runs = setupRuns;
  const onName = (e: Event): void => {
    name.set((e.target as HTMLInputElement).value);
  };
}
