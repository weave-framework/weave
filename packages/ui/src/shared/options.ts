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
