import { signal, effect, untrack } from '@weave-framework/runtime';

/**
 * Two rules that sound like details until they cost an afternoon: an equal write announces nothing, and
 * "equal" means `Object.is`, which compares objects by identity rather than contents.
 *
 * The number column is the whole demo. Writing 3 over 3 does not move it. Mutating an object and setting
 * the SAME reference back does not move it either — the contents changed and the identity did not, so
 * nothing was told. A fresh object always does.
 *
 * The mutate button deliberately does the wrong thing, because that bug is invisible in code review and
 * obvious here.
 */
export function setup() {
  const n = signal(3);
  const user = signal<{ name: string }>({ name: 'Ada' });

  const numberRuns = signal(0);
  const userRuns = signal(0);

  effect(() => {
    n();
    untrack(() => numberRuns.set((r) => r + 1));
  });
  effect(() => {
    user();
    untrack(() => userRuns.set((r) => r + 1));
  });

  const setSame = (): void => {
    n.set(3);
  };
  const setNext = (): void => {
    n.set((v) => v + 1);
  };
  // Deliberately the wrong move: change the contents, hand back the SAME object. `Object.is` sees one
  // identity, so nothing is announced and the screen keeps the old name while memory holds the new one.
  const mutateInPlace = (): void => {
    const u = user.peek();
    u.name = u.name.toUpperCase();
    user.set(u);
  };

  // A different object every time, and a different name every time, so "did anything happen" is never
  // ambiguous — which it was in the first draft, where the two buttons could land on the same name.
  const NAMES: string[] = ['Ada', 'Grace', 'Alan', 'Barbara'];
  const at = signal(0);
  const setFreshObject = (): void => {
    const next = (at.peek() + 1) % NAMES.length;
    at.set(next);
    user.set({ name: NAMES[next] });
  };
}
