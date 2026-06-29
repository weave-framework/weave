/**
 * @weave/forms — signal-native form state + validation. Zero dependencies.
 *
 * A `field` is a writable signal plus derived `error`/`valid`/`touched`, so a
 * template binds the value with `bind:value={f.value}` and reads errors with
 * `{{ f.error() }}` — all surgically reactive, no form library, no boilerplate.
 * A `form` aggregates fields into one `valid`/`values`/`reset` and can run a
 * cross-field `validate` over the whole snapshot.
 *
 * Validation layers, in precedence order, all surfaced through `field.error()`:
 *   1. the field's own ordered sync `validators` (first failure wins),
 *   2. a cross-field error pushed down by the parent `form` (B.3),
 *   3. an async (`asyncValidate`) result — debounced + abortable (B.3).
 */

import { signal, computed, effect, onCleanup, type Signal, type Computed } from '@weave/runtime';

/** Return an error message for an invalid value, or `null` when valid. */
export type Validator<T> = (value: T) => string | null;

/** An async validator — e.g. a "username taken?" server check. Abortable via `signal`. */
export type AsyncValidator<T> = (
  value: T,
  ctx: { signal: AbortSignal }
) => Promise<string | null>;

/** Extra per-field options (B.3 async validation). */
export interface FieldOptions<T> {
  /** Server-side / async check. Runs only when the sync validators pass. */
  asyncValidate?: AsyncValidator<T>;
  /** Quiet window before the async check fires (ms). Default 300. */
  debounceMs?: number;
}

export interface Field<T> {
  /** The editable value — bind it with `bind:value={field.value}`. */
  value: Signal<T>;
  /** First error across sync validators → cross-field → async. Reactive. */
  error: () => string | null;
  /** Whether the field currently has no error. Reactive. */
  valid: () => boolean;
  /** Set by the app on blur (`on:blur={() => field.touched.set(true)}`); gates error display. */
  touched: Signal<boolean>;
  /** True while an async validation is in flight. Reactive. */
  validating: () => boolean;
  /** Restore the initial value and clear `touched`. */
  reset: () => void;
}

/** Internal shape — `form` writes cross-field errors into `_external`. */
interface FieldInternal<T> extends Field<T> {
  _external: Signal<string | null>;
}

/** Create a validated field from an initial value and an ordered validator list. */
export function field<T>(
  initial: T,
  validators: Validator<T>[] = [],
  opts: FieldOptions<T> = {}
): Field<T> {
  const value: Signal<T> = signal(initial);
  const touched: Signal<boolean> = signal(false);
  const external: Signal<string | null> = signal<string | null>(null); // cross-field error from the parent form
  const asyncError: Signal<string | null> = signal<string | null>(null);
  const validating: Signal<boolean> = signal(false);

  // Sync layer, shared by `error()` and the async gate (no server call on a format error).
  const syncError: Computed<string | null> = computed<string | null>(() => {
    for (const v of validators) {
      const msg: string | null = v(value());
      if (msg) return msg;
    }
    return null;
  });

  // Async layer: debounced + abortable, only when the sync layer is clean.
  if (opts.asyncValidate) {
    const debounceMs: number = opts.debounceMs ?? 300;
    effect(() => {
      const val: T = value(); // track edits
      if (syncError()) {
        // format-invalid → don't hit the server; drop any stale async state
        asyncError.set(null);
        validating.set(false);
        return;
      }
      asyncError.set(null); // optimistic: clear while (re)checking
      validating.set(true);
      let cancelled: boolean = false;
      const ctrl: AbortController = new AbortController();
      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        opts
          .asyncValidate!(val, { signal: ctrl.signal })
          .then((msg) => {
            if (!cancelled) {
              asyncError.set(msg);
              validating.set(false);
            }
          })
          .catch(() => {
            // an abort is expected on a newer edit; any other failure just clears
            if (!cancelled) validating.set(false);
          });
      }, debounceMs);
      // a newer edit (or unmount) cancels the pending/in-flight check
      onCleanup(() => {
        cancelled = true;
        ctrl.abort();
        clearTimeout(timer);
      });
    });
  }

  const error: Computed<string | null> = computed<string | null>(() => syncError() ?? external() ?? asyncError());

  const f: FieldInternal<T> = {
    value,
    error,
    valid: computed(() => error() === null),
    touched,
    validating: () => validating(),
    reset: () => {
      value.set(initial);
      touched.set(false);
      external.set(null);
      asyncError.set(null);
      validating.set(false);
    },
    _external: external,
  };
  return f;
}

type FieldsOf<F> = { [K in keyof F]: F[K] extends Field<infer T> ? T : never };

/** Cross-field validator: returns `{ fieldName: msg }` (and/or a reserved `_form` key), or null. */
export type FormValidator<F extends Record<string, Field<unknown>>> = (
  values: FieldsOf<F>
) => Record<string, string> | null;

/** Reserved key in a {@link FormValidator} result for a form-level (not field-bound) error. */
export const FORM_ERROR_KEY: '_form' = '_form';

export interface FormOptions<F extends Record<string, Field<unknown>>> {
  /** Cross-field validation over the whole values snapshot (e.g. password confirm). */
  validate?: FormValidator<F>;
}

export interface Form<F extends Record<string, Field<unknown>>> {
  fields: F;
  /** True when every field is valid AND there is no form-level cross-field error. Reactive. */
  valid: () => boolean;
  /** A form-level (`_form`) cross-field error, or null. Reactive. */
  formError: () => string | null;
  /** True while any field is running an async validation. Reactive. */
  validating: () => boolean;
  /** Plain `{ name: value }` snapshot of all field values. Reactive. */
  values: () => FieldsOf<F>;
  /** Reset every field. */
  reset: () => void;
  /** Mark every field touched (e.g. on a failed submit, to reveal all errors). */
  touchAll: () => void;
}

/** Aggregate named fields into one form, with optional cross-field validation. */
export function form<F extends Record<string, Field<unknown>>>(
  fields: F,
  opts: FormOptions<F> = {}
): Form<F> {
  const list: Field<unknown>[] = Object.values(fields);
  const values = (): FieldsOf<F> => {
    const out: FieldsOf<F> = {} as FieldsOf<F>;
    for (const key in fields) out[key] = fields[key].value() as FieldsOf<F>[Extract<keyof F, string>];
    return out;
  };

  // Cross-field: compute the error map reactively and push each field-keyed error
  // into that field's `_external`; the `_form` key is surfaced via `formError`.
  const crossErrors: Computed<Record<string, string>> = computed<Record<string, string>>(() =>
    opts.validate ? opts.validate(values()) ?? {} : {}
  );
  if (opts.validate) {
    effect(() => {
      const errs: Record<string, string> = crossErrors();
      for (const key in fields) {
        (fields[key] as unknown as FieldInternal<unknown>)._external.set(errs[key] ?? null);
      }
    });
  }
  const formError: Computed<string | null> = computed<string | null>(() => crossErrors()[FORM_ERROR_KEY] ?? null);

  return {
    fields,
    valid: computed(() => list.every((f) => f.valid()) && formError() === null),
    formError,
    validating: computed(() => list.some((f) => f.validating())),
    values,
    reset: () => list.forEach((f) => f.reset()),
    touchAll: () => list.forEach((f) => f.touched.set(true)),
  };
}

/** A small set of ready-made validators (compose freely; first failure wins). */
export const validators: {
  required: (msg?: string) => Validator<unknown>;
  minLength: (n: number, msg?: string) => Validator<string>;
  maxLength: (n: number, msg?: string) => Validator<string>;
  pattern: (re: RegExp, msg?: string) => Validator<string>;
  email: (msg?: string) => Validator<string>;
  min: (n: number, msg?: string) => Validator<number>;
  max: (n: number, msg?: string) => Validator<number>;
} = {
  required:
    (msg = 'Required'): Validator<unknown> =>
    (v) =>
      v == null || v === '' || (Array.isArray(v) && v.length === 0) || v === false ? msg : null,
  minLength:
    (n: number, msg?: string): Validator<string> =>
    (v) =>
      (v ?? '').length < n ? msg ?? `Must be at least ${n} characters` : null,
  maxLength:
    (n: number, msg?: string): Validator<string> =>
    (v) =>
      (v ?? '').length > n ? msg ?? `Must be at most ${n} characters` : null,
  pattern:
    (re: RegExp, msg = 'Invalid format'): Validator<string> =>
    (v) =>
      re.test(v ?? '') ? null : msg,
  email:
    (msg = 'Enter a valid email'): Validator<string> =>
    (v) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v ?? '') ? null : msg,
  min:
    (n: number, msg?: string): Validator<number> =>
    (v) =>
      v < n ? msg ?? `Must be ≥ ${n}` : null,
  max:
    (n: number, msg?: string): Validator<number> =>
    (v) =>
      v > n ? msg ?? `Must be ≤ ${n}` : null,
};
