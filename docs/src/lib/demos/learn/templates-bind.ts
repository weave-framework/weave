import { signal, computed } from '@weave-framework/runtime';

/**
 * Every `bind:` shape at once, with the signal's value AND its JavaScript type printed beside it.
 *
 * The type is the part prose keeps having to promise: a number input holds a `number`, not the string
 * the DOM would give you; a multi-select holds an array; a checkbox holds a boolean. Here that promise
 * is a `typeof` on screen, so it can be checked rather than believed.
 *
 * The signal is the source of truth in both directions — the reset button writes the signals, and every
 * control follows without touching the DOM.
 */
export function setup() {
  const name = signal('Ada');
  const age = signal(30);
  const volume = signal(50);
  const agreed = signal(false);
  const size = signal('M');
  const choice = signal('b');
  const picks = signal<string[]>(['x']);

  const shape = (v: unknown): string => (Array.isArray(v) ? `string[] (${v.length})` : typeof v);
  // `{{ false }}` renders as the empty string — the rule this page states two sections up — so the
  // checkbox row printed "· boolean" with nothing before it. Stringify deliberately.
  const show = (v: unknown): string => String(v);

  const summary = computed((): string => JSON.stringify({ name: name(), age: age(), agreed: agreed(), size: size(), choice: choice(), picks: picks() }));

  const reset = (): void => {
    name.set('Ada');
    age.set(30);
    volume.set(50);
    agreed.set(false);
    size.set('M');
    choice.set('b');
    picks.set(['x']);
  };
}
