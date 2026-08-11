/**
 * Shared option model for every drop-list component (Menu, Select, Autocomplete). Options
 * can be **any shape** — plain strings, the default `{value,label,description?,disabled?}`,
 * or arbitrary data objects (e.g. an API row) — because the caller supplies **accessors**
 * mapping each option to its value / label / description / disabled. Selection can **emit**
 * either the value string or the whole option object. Zero-dep.
 */

/** The canonical fields every drop-list row needs, after accessor resolution. */
export interface NormalizedOption<T> {
  item: T;
  value: string;
  label: string;
  description: string | undefined;
  disabled: boolean;
}

/** Per-component accessors — omit to use the defaults (`.value`/`.label`/… or a string). */
export interface OptionAccessors<T> {
  /** Which field is the value. Default: the string itself, or `item.value`. */
  optionValue?: (item: T) => string;
  /** Which field to display. Default: the string itself, or `item.label` (falls back to value). */
  optionLabel?: (item: T) => string;
  /** Optional subtext under the label. Default: `item.description` (none for a string). */
  optionDescription?: (item: T) => string | undefined;
  /** Whether the option is disabled. Default: `item.disabled` (false for a string). */
  optionDisabled?: (item: T) => boolean;
  /**
   * What a selection carries: `'value'` (the value string, default) or `'object'` (the whole
   * option `T`). Drives the `onSelect`/`onChange` argument + the stored value.
   */
  emit?: 'value' | 'object';
}

/**
 * An option the defaults can read without help: a plain string, or an object carrying `value`.
 *
 * These are exactly the shapes {@link optValue} and {@link optLabel} handle on their own — the string
 * itself, or `.value` with `.label` falling back to it.
 */
export type SelfDescribingOption = string | { value: string | number };

/**
 * The accessors a component REQUIRES when its option type is one the defaults cannot read.
 *
 * Without this the type said "accessors are optional" while the runtime said "then I will read `.value`
 * and `.label`" — so passing a domain object (or, as an audit found, an array of numbers and nulls) type-
 * checked clean and rendered `undefined` in every row. Nothing reported it, in a template least of all:
 * the props were being checked against an uninstantiated generic, so the option type was `unknown` and
 * anything at all satisfied it.
 *
 * `[T] extends [ … ]` deliberately, not the distributive form: a UNION of option shapes is self-describing
 * only if all of it is, and distributing would ask the question of each member separately and accept a
 * union where one arm is readable and the rest are not. It also keeps `T = never` (an empty `options={{ [] }}`)
 * on the optional side rather than collapsing the whole props type to `never`.
 *
 * `unknown` on the satisfied branch because `X & unknown` is `X` — the props type is untouched for every
 * option shape that already worked.
 */
export type RequiredAccessors<T> = [T] extends [SelfDescribingOption]
  ? unknown
  : {
      /** Required: this option type has no `value` for the default to read. */
      optionValue: (item: T) => string;
      /** Required: this option type has no `label` (and no `value` to fall back to). */
      optionLabel: (item: T) => string;
    };

interface AnyOption {
  value?: unknown;
  label?: unknown;
  description?: unknown;
  disabled?: unknown;
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

/** Resolve an option's value using the accessor (or the default: string self / `.value`). */
export function optValue<T>(item: T, acc: OptionAccessors<T>): string {
  if (acc.optionValue) return acc.optionValue(item);
  if (isString(item)) return item;
  return String((item as AnyOption).value);
}

/** Resolve an option's display label (default: string self / `.label` → `.value`). */
export function optLabel<T>(item: T, acc: OptionAccessors<T>): string {
  if (acc.optionLabel) return acc.optionLabel(item);
  if (isString(item)) return item;
  const o: AnyOption = item as AnyOption;
  return String(o.label ?? o.value);
}

/** Resolve an option's subtext (default: `.description`, none for a string). */
export function optDescription<T>(item: T, acc: OptionAccessors<T>): string | undefined {
  if (acc.optionDescription) return acc.optionDescription(item);
  if (isString(item)) return undefined;
  const d: unknown = (item as AnyOption).description;
  return d == null ? undefined : String(d);
}

/** Resolve an option's disabled flag (default: `.disabled`, false for a string). */
export function optDisabled<T>(item: T, acc: OptionAccessors<T>): boolean {
  if (acc.optionDisabled) return acc.optionDisabled(item);
  if (isString(item)) return false;
  return Boolean((item as AnyOption).disabled);
}

/** Normalize an option into its canonical fields. */
export function normalize<T>(item: T, acc: OptionAccessors<T>): NormalizedOption<T> {
  return {
    item,
    value: optValue(item, acc),
    label: optLabel(item, acc),
    description: optDescription(item, acc),
    disabled: optDisabled(item, acc),
  };
}

/** What a selection of `item` emits, per the `emit` mode (default `'value'`). */
export function emitSelection<T>(item: T, acc: OptionAccessors<T>): string | T {
  return acc.emit === 'object' ? item : optValue(item, acc);
}
