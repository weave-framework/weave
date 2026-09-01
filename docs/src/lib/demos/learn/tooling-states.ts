import { signal, computed, type Signal } from '@weave-framework/runtime';
import { enableDevtools, isDevtoolsEnabled, captureState, applyState, devNodeCount } from '@weave-framework/runtime';

/**
 * Save a screen's state and set it back — the mechanism behind `weave dev --state`, running here.
 *
 * These are the real functions the DevTools panel calls. The rule the page states is the one to watch:
 * **only NAMED signals are captured.** `rows` and `filter` carry a `name`; `draft` deliberately does not,
 * so it is the control — change all three, apply a saved state, and `draft` keeps whatever you left it as.
 *
 * `enableDevtools(true)` is required first: introspection is off unless asked for, which is why a
 * production build pays nothing for any of this.
 */
export function setup() {
  enableDevtools(true);

  const rows: Signal<number> = signal(0, { name: 'demo.rows' });
  const filter: Signal<string> = signal('all', { name: 'demo.filter' });
  const draft: Signal<string> = signal('', { name: undefined });

  const saved: Signal<Record<string, unknown> | null> = signal<Record<string, unknown> | null>(null);
  const lastApplied: Signal<number> = signal(-1);

  const savedText = computed((): string => (saved() ? JSON.stringify(saved()) : '(nothing saved yet)'));
  const on = (): boolean => isDevtoolsEnabled();
  const nodes = (): number => devNodeCount();

  const save = (): void => {
    // Only this demo's own names, so the page's other signals are not dragged in.
    const all = captureState();
    const mine: Record<string, unknown> = {};
    for (const k of Object.keys(all)) if (k.startsWith('demo.')) mine[k] = all[k];
    saved.set(mine);
  };

  const apply = (): void => {
    const s = saved();
    if (s) lastApplied.set(applyState(s));
  };

  const scramble = (): void => {
    rows.set(Math.floor(Math.random() * 900) + 100);
    filter.set(['all', 'open', 'done', 'archived'][Math.floor(Math.random() * 4)]);
    draft.set('half-typed note');
  };
}
