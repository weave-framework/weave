import { signal, type Signal } from '@weave-framework/runtime';
import { fade, fly, scale, slide } from '@weave-framework/runtime';

// The template names these as `transition:` / `in:` / `out:` functions.
void fade;
void fly;
void scale;
void slide;

/**
 * The four built-ins, and the difference between the three directives — which is entirely about WHEN.
 *
 * One toggle drives four boxes. Watch them leave: the `in:`-only box vanishes instantly while the others
 * play an outro, because `in:` registers nothing for the removal to wait on. That is the sentence the
 * page states and the only way to actually see it.
 *
 * The duration is deliberately slow. At the default it is over before a reader has decided where to look.
 */
export function setup() {
  const shown: Signal<boolean> = signal(true);
  const ms: Signal<number> = signal(600);

  const toggle = (): void => {
    shown.set((v) => !v);
  };
  const setMs = (e: Event): void => {
    ms.set(Number((e.target as HTMLInputElement).value));
  };
  const params = (): { duration: number } => ({ duration: ms() });
  const flyParams = (): { duration: number; y: number } => ({ duration: ms(), y: 24 });
}
