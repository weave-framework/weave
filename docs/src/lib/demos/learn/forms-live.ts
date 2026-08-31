import { field, form, validators, type Field } from '@weave-framework/forms';
import { control } from '@weave-framework/forms/dom';
import { signal, computed, type Signal } from '@weave-framework/runtime';

// `use:control` needs the action in scope.
void control;

/**
 * A real form, with every piece of its state printed beside it.
 *
 * The three rules this page states are all about TIMING, and timing is what a table of prose cannot
 * show: a sync validator runs on every keystroke, an error only DISPLAYS once the field is touched, and
 * the async check waits until the sync ones pass and then debounces.
 *
 * The status column is the same signals the form exposes — `valid`, `touched`, `dirty`, `validating`,
 * `error` — read live, so the reader watches them flip rather than reading about when they would.
 */
const TAKEN = ['ada', 'grace', 'alan'];

export function setup() {
  // `field(initial, validators, opts)` — read from the declaration, not guessed: the validators are the
  // SECOND positional argument, and the async check is `asyncValidate` in the options, singular.
  const username: Field<string> = field('', [validators.required(), validators.minLength(3)], {
    // Deliberately slow, so "it waits, then checks" is visible rather than instantaneous.
    asyncValidate: async (v: string): Promise<string | null> => {
      await new Promise((r) => setTimeout(r, 700));
      return TAKEN.includes(v.toLowerCase()) ? `"${v}" is taken — try another` : null;
    },
    debounceMs: 300,
  });

  const email: Field<string> = field('', [validators.required(), validators.email()]);

  const signup = form({ username, email });

  const submitted: Signal<string> = signal('');
  const attempts: Signal<number> = signal(0);

  const rows = computed(() => [
    { name: 'username', f: username as Field<string> },
    { name: 'email', f: email as Field<string> },
  ]);

  const onSubmit = (e: Event): void => {
    e.preventDefault();
    attempts.set((n) => n + 1);
    signup.touchAll();
    submitted.set(signup.valid() ? `sent ${JSON.stringify(signup.value())}` : 'refused — the form is not valid');
  };

  const reset = (): void => {
    signup.reset();
    submitted.set('');
    attempts.set(0);
  };

  const show = (v: unknown): string => String(v);
}
