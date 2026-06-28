/**
 * @weave/forms — signal-native form state + validation. Zero dependencies.
 *
 * A `field` is a writable signal plus derived `error`/`valid`/`touched`, so a
 * template binds the value with `bind:value={f.value}` and reads errors with
 * `{{ f.error() }}` — all surgically reactive, no form library, no boilerplate.
 * A `form` aggregates fields into one `valid`/`values`/`reset`.
 */

import { signal, computed, type Signal } from '@weave/runtime';

/** Return an error message for an invalid value, or `null` when valid. */
export type Validator<T> = (value: T) => string | null;

export interface Field<T> {
  /** The editable value — bind it with `bind:value={field.value}`. */
  value: Signal<T>;
  /** First failing validator's message, or null. Reactive. */
  error: () => string | null;
  /** Whether every validator passes. Reactive. */
  valid: () => boolean;
  /** Set by the app on blur (`on:blur={() => field.touched.set(true)}`); gates error display. */
  touched: Signal<boolean>;
  /** Restore the initial value and clear `touched`. */
  reset: () => void;
}

/** Create a validated field from an initial value and an ordered validator list. */
export function field<T>(initial: T, validators: Validator<T>[] = []): Field<T> {
  const value = signal(initial);
  const touched = signal(false);
  const error = computed<string | null>(() => {
    for (const v of validators) {
      const msg = v(value());
      if (msg) return msg;
    }
    return null;
  });
  return {
    value,
    error,
    valid: computed(() => error() === null),
    touched,
    reset: () => {
      value.set(initial);
      touched.set(false);
    },
  };
}

type FieldsOf<F> = { [K in keyof F]: F[K] extends Field<infer T> ? T : never };

export interface Form<F extends Record<string, Field<unknown>>> {
  fields: F;
  /** True when every field is valid. Reactive. */
  valid: () => boolean;
  /** Plain `{ name: value }` snapshot of all field values. Reactive. */
  values: () => FieldsOf<F>;
  /** Reset every field. */
  reset: () => void;
  /** Mark every field touched (e.g. on a failed submit, to reveal all errors). */
  touchAll: () => void;
}

/** Aggregate named fields into one form. */
export function form<F extends Record<string, Field<unknown>>>(fields: F): Form<F> {
  const list = Object.values(fields);
  return {
    fields,
    valid: computed(() => list.every((f) => f.valid())),
    values: () => {
      const out = {} as FieldsOf<F>;
      for (const key in fields) out[key] = fields[key].value() as FieldsOf<F>[Extract<keyof F, string>];
      return out;
    },
    reset: () => list.forEach((f) => f.reset()),
    touchAll: () => list.forEach((f) => f.touched.set(true)),
  };
}

/** A small set of ready-made validators (compose freely; first failure wins). */
export const validators = {
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
