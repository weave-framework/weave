import { signal, effect, onMount, onCleanup, onDispose, untrack, root, type Signal } from '@weave-framework/runtime';

/**
 * Four lifecycle hooks whose difference is *when* they fire, which is the one thing prose cannot show.
 *
 * A disposable `root` is created and thrown away on demand, and every hook writes a line as it runs. The
 * order on screen is the real order, not a description of it: setup, then effect, then onMount — and on
 * teardown, onCleanup before onDispose.
 *
 * The effect deliberately depends on a counter you can bump, so `onCleanup` fires repeatedly (before each
 * re-run) while `onDispose` fires exactly once, at the end. That pair is the distinction the page is about.
 */
export function setup() {
  const log: Signal<string[]> = signal<string[]>([]);
  const alive: Signal<boolean> = signal(false);
  const ticks: Signal<number> = signal(0);
  let stop: (() => void) | null = null;

  const say = (line: string): void => {
    untrack(() => log.set((l) => [...l, line]));
  };

  const start = (): void => {
    if (stop) return;
    untrack(() => log.set([]));
    stop = root((dispose) => {
      say('setup runs');
      effect(() => {
        const n = ticks();
        say(`effect runs (ticks = ${n})`);
        onCleanup(() => say(`  onCleanup — before the next run, and on teardown`));
      });
      onMount(() => say('onMount runs (the DOM is live)'));
      onDispose(() => say('onDispose runs (once, at the end)'));
      return dispose;
    });
    alive.set(true);
  };

  const bump = (): void => {
    ticks.set((n) => n + 1);
  };

  const teardown = (): void => {
    if (!stop) return;
    stop();
    stop = null;
    alive.set(false);
    say('— scope disposed —');
  };
}
