/**
 * @weave-framework/forms — signal-native form state + validation. Zero dependencies.
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

import { signal, computed, effect, onCleanup, type Signal, type Computed } from '@weave-framework/runtime';

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

/**
 * The shared shape of every form control — a {@link Field}, a nested {@link Group},
 * or a {@link FieldArray}. Aggregation (a group's validity/values/reset) is defined
 * purely in terms of this interface, so the three compose recursively to any depth
 * (`form → group → fieldArray → group → field`), the Weave analog of Angular's
 * `AbstractControl` (`FormControl` / `FormGroup` / `FormArray`).
 */
export interface Control<T> {
  /** Current value — a field's value, a group's nested snapshot, or an array's items. Reactive. */
  value: () => T;
  /** Whether this control and every descendant is valid. Reactive. */
  valid: () => boolean;
  /** Whether an async validation is in flight here or in a descendant. Reactive. */
  validating: () => boolean;
  /** Whether this control (or any descendant) has been touched. Reactive. */
  touched: () => boolean;
  /**
   * Whether this control (or any descendant) has changed from its initial value — the
   * Weave analog of Angular's `dirty`. `touched` is about *interaction* (blurred), `dirty`
   * is about *value change*. `pristine` is simply `!dirty()`. Cleared by {@link reset}.
   */
  dirty: () => boolean;
  /** Restore initial value(s) and clear touched/errors. */
  reset: () => void;
  /** Mark this control (and every descendant) touched — e.g. on a failed submit. */
  touchAll: () => void;
}

export interface Field<T> extends Control<T> {
  /** The editable value — bind it with `bind:value={field.value}`. (A `Signal`, so also callable.) */
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
  /** Mark the field touched (Control parity; equivalent to `touched.set(true)`). */
  touchAll: () => void;
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
    dirty: computed(() => !Object.is(value(), initial)),
    validating: () => validating(),
    reset: () => {
      value.set(initial);
      touched.set(false);
      external.set(null);
      asyncError.set(null);
      validating.set(false);
    },
    touchAll: () => touched.set(true),
    _external: external,
  };
  return f;
}

/** A named bag of controls — the children of a {@link Group} (or {@link form}). */
export type Controls = Record<string, Control<unknown>>;

/** The value snapshot type of a control bag: each control's own value type, recursively. */
export type ValuesOf<C extends Controls> = { [K in keyof C]: C[K] extends Control<infer T> ? T : never };

/** Cross-field validator: returns `{ childName: msg }` (and/or a reserved `_form` key), or null. */
export type FormValidator<C extends Controls> = (values: ValuesOf<C>) => Record<string, string> | null;

/** Reserved key in a {@link FormValidator} result for a group-level (not field-bound) error. */
export const FORM_ERROR_KEY: '_form' = '_form';

export interface GroupOptions<C extends Controls> {
  /** Cross-field validation over this group's own values snapshot (e.g. password confirm). */
  validate?: FormValidator<C>;
}

/**
 * A group of named controls — the Weave analog of Angular's `FormGroup`. A `Group`
 * is itself a {@link Control}, so groups nest arbitrarily (and live inside a
 * {@link FieldArray}). `form` is just the conventional name for the top-level group.
 */
export interface Group<C extends Controls> extends Control<ValuesOf<C>> {
  /** The child controls (fields / nested groups / arrays) — `group.controls.name`. */
  controls: C;
  /** Nested `{ name: value }` snapshot of every child value (Angular's `FormGroup.value`). Reactive. */
  value: () => ValuesOf<C>;
  /** True when every child is valid AND there is no group-level cross-field error. Reactive. */
  valid: () => boolean;
  /** A group-level (`_form`) cross-field error, or null. Reactive. */
  formError: () => string | null;
  /** True while any descendant is running an async validation. Reactive. */
  validating: () => boolean;
  /** True once any descendant has been touched. Reactive. */
  touched: () => boolean;
  /** Reset every child. */
  reset: () => void;
  /** Mark every descendant touched (e.g. on a failed submit, to reveal all errors). */
  touchAll: () => void;

  /** True while a {@link submit} run is in flight. Reactive. */
  submitting: () => boolean;
  /** The last submit rejection (the value `handler` threw), or undefined. Reactive. */
  submitError: () => unknown;
  /** Settle any in-flight async validation, then resolve with the current {@link valid}. */
  validateAsync: () => Promise<boolean>;
  /**
   * Build a submit handler that owns the whole dance: `preventDefault` → reveal every
   * error (`touchAll`) → await async validation → if invalid, focus the first control a
   * `use:control` marked `aria-invalid` and stop → else run `handler(value())`, tracking
   * {@link submitting} / {@link submitError}. Wire it as `<form on:submit={form.submit(fn)}>`.
   */
  submit: (handler: (values: ValuesOf<C>) => unknown | Promise<unknown>) => (e?: Event) => void;
}

/**
 * Aggregate named controls into one group, with optional cross-field validation.
 * Children may be {@link field}s, nested {@link group}s, or {@link fieldArray}s — the
 * group's validity, value snapshot, `touched`, `reset`, and `touchAll` recurse through
 * them. Cross-field `validate` keys target this group's direct **field** children
 * (pushed into their error); the reserved `_form` key surfaces via {@link Group.formError}.
 */
export function group<C extends Controls>(controls: C, opts: GroupOptions<C> = {}): Group<C> {
  const list: Control<unknown>[] = Object.values(controls);
  const values = (): ValuesOf<C> => {
    const out: ValuesOf<C> = {} as ValuesOf<C>;
    for (const key in controls) out[key] = controls[key].value() as ValuesOf<C>[Extract<keyof C, string>];
    return out;
  };

  // Cross-field: compute the error map reactively and push each child-keyed error into
  // that child's `_external` (fields only); the `_form` key is surfaced via `formError`.
  const crossErrors: Computed<Record<string, string>> = computed<Record<string, string>>(() =>
    opts.validate ? opts.validate(values()) ?? {} : {}
  );
  if (opts.validate) {
    effect(() => {
      const errs: Record<string, string> = crossErrors();
      for (const key in controls) {
        const ext: Signal<string | null> | undefined = (controls[key] as { _external?: Signal<string | null> })._external;
        if (ext) ext.set(errs[key] ?? null);
      }
    });
  }
  const formError: Computed<string | null> = computed<string | null>(() => crossErrors()[FORM_ERROR_KEY] ?? null);

  const valid: Computed<boolean> = computed(() => list.every((c) => c.valid()) && formError() === null);
  const validating: Computed<boolean> = computed(() => list.some((c) => c.validating()));
  const touchAll = (): void => list.forEach((c) => c.touchAll());

  const submitting: Signal<boolean> = signal(false);
  const submitError: Signal<unknown> = signal<unknown>(undefined);

  // Resolve once async validation has settled (bounded poll — reactivity is sync, so
  // this only ever waits on a debounced/in-flight async validator), then report validity.
  const validateAsync = (): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      let tries: number = 0;
      const poll = (): void => {
        if (!validating() || tries++ > 66) resolve(valid());
        else setTimeout(poll, 30);
      };
      poll();
    });

  const submit =
    (handler: (values: ValuesOf<C>) => unknown | Promise<unknown>) =>
    async (e?: Event): Promise<void> => {
      // Capture the form element NOW: the browser nulls `currentTarget` once dispatch
      // ends, and we're about to `await`. Reads only off the event — no global DOM
      // access, so the core stays pure.
      const root: Element | null = (e?.currentTarget as Element | null) ?? null;
      e?.preventDefault?.();
      touchAll(); // reveal every error, not just visited fields
      const ok: boolean = await validateAsync();
      if (!ok) {
        // Focus the first control a `use:control` flagged `aria-invalid`.
        (root?.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus();
        return;
      }
      submitting.set(true);
      submitError.set(() => undefined);
      try {
        await handler(values());
      } catch (err) {
        submitError.set(() => err);
      } finally {
        submitting.set(false);
      }
    };

  return {
    controls,
    value: values,
    valid,
    formError,
    validating,
    touched: () => list.some((c) => c.touched()),
    reset: () => list.forEach((c) => c.reset()),
    touchAll,
    dirty: () => list.some((c) => c.dirty()),
    submitting: () => submitting(),
    submitError: () => submitError(),
    validateAsync,
    submit,
  };
}

/** Aggregate named controls into one form — the conventional name for a top-level {@link group}. */
export const form: typeof group = group;

/** A dynamic list of like-typed controls — the Weave analog of Angular's `FormArray`. */
export interface FieldArray<T> extends Control<T[]> {
  /** The live list of item controls — render with `@for (c of arr.controls(); …)`. Reactive. */
  controls: () => Control<T>[];
  /** Number of items. Reactive. */
  length: () => number;
  /** Append a new item, built by the factory (optionally seeded with a value). */
  push: (seed?: T) => void;
  /** Remove the item at `index`. */
  removeAt: (index: number) => void;
  /** Array of every item's value, in order. Reactive. */
  value: () => T[];
}

/**
 * A dynamic list of controls. `factory(seed?)` builds one item (a field, group, or
 * nested array); `seeds` are the initial items. `push`/`removeAt` mutate the list,
 * and validity/values/`touched` aggregate over the current items.
 *
 * ```ts
 * const tags = fieldArray(() => field('', [validators.required()]));
 * tags.push();                       // add a blank tag
 * const checklist = fieldArray(
 *   (s) => group({ text: field(s ?? ''), done: field(false) }),
 *   ['Write tests']                  // one seeded item
 * );
 * ```
 *
 * **Caveat:** items added via `push` are created outside a component owner, so an item
 * that itself registers effects (a field with `asyncValidate`, or a group with a
 * cross-field `validate`) won't auto-dispose on `removeAt` — only when the whole
 * component unmounts. Plain sync-validated items have no such effect and are unaffected.
 */
export function fieldArray<T>(factory: (seed?: T) => Control<T>, seeds: T[] = []): FieldArray<T> {
  const items: Signal<Control<T>[]> = signal<Control<T>[]>(seeds.map((s) => factory(s)));
  return {
    controls: () => items(),
    length: () => items().length,
    value: () => items().map((c) => c.value()),
    valid: () => items().every((c) => c.valid()),
    validating: () => items().some((c) => c.validating()),
    touched: () => items().some((c) => c.touched()),
    // Dirty if the item set changed (push/removeAt) or any current item is dirty.
    dirty: () => items().length !== seeds.length || items().some((c) => c.dirty()),
    reset: () => items.set(seeds.map((s) => factory(s))),
    touchAll: () => items().forEach((c) => c.touchAll()),
    push: (seed?: T) => items.set((xs) => [...xs, factory(seed)]),
    removeAt: (index: number) => items.set((xs) => xs.filter((_, j) => j !== index)),
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
  pattern: (re: RegExp, msg = 'Invalid format'): Validator<string> => {
    // A `g`/`y` regex is stateful across `.test()` (advancing `lastIndex` → alternating results).
    // Clone once without those flags so the validator is deterministic per call.
    const stable: RegExp = re.global || re.sticky ? new RegExp(re.source, re.flags.replace(/[gy]/g, '')) : re;
    return (v) => (stable.test(v ?? '') ? null : msg);
  },
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
