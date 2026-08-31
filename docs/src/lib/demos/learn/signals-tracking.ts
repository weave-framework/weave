import { signal, effect, untrack } from '@weave-framework/runtime';

/**
 * "Calling the signal is what subscribes you" is the sentence the whole page rests on, and prose cannot
 * settle it. Three watchers sit side by side over the SAME signal and differ only in how they touch it:
 * one calls it, one peeks at it, one never mentions it. Each counts its own runs.
 *
 * Press the button and the answer is on screen: the caller re-runs, the other two do not. That is the
 * parenthesis rule, and `.peek()`, demonstrated by the same click.
 *
 * Every counter is written inside `untrack`. Without it each effect would read the counter it writes and
 * subscribe to itself — an infinite loop, and the exact mistake this page warns about two sections down.
 */
export function setup() {
  const count = signal(0);
  const label = signal('hits');

  const callerRuns = signal(0);
  const peekerRuns = signal(0);
  const otherRuns = signal(0);
  const lastSeen = signal(0);

  // Reads it — so it is subscribed.
  effect(() => {
    const n = count();
    untrack(() => {
      lastSeen.set(n);
      callerRuns.set((r) => r + 1);
    });
  });

  // Peeks at it — sees the value, subscribes to nothing.
  effect(() => {
    count.peek();
    untrack(() => peekerRuns.set((r) => r + 1));
  });

  // Never mentions it.
  effect(() => {
    label();
    untrack(() => otherRuns.set((r) => r + 1));
  });

  const bump = (): void => {
    count.set((n) => n + 1);
  };
  const rename = (): void => {
    label.set((l) => (l === 'hits' ? 'clicks' : 'hits'));
  };
}
