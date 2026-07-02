/**
 * SelectionModel — the signal-native selection engine under Table rows, Tree nodes and
 * List/Select multi-select. Tracks a set of selected values (insertion-ordered) with
 * `select`/`deselect`/`toggle`/`clear`, `single` vs `multiple` modes, an optional identity
 * comparator (so object copies match by key), and a `changed` callback carrying the
 * added/removed delta. Headless: no DOM, no ARIA — a component maps `selected()` /
 * `isSelected()` onto `aria-selected`/checkboxes itself. Zero-dep.
 */

import { signal, type Signal } from '@weave-framework/runtime';

/** The delta emitted after a selection change. */
export interface SelectionChange<T> {
  /** Values added to the selection by this change. */
  added: T[];
  /** Values removed from the selection by this change. */
  removed: T[];
}

export interface SelectionModelOptions<T> {
  /** Allow more than one selected value. Default false (single-select). */
  multiple?: boolean;
  /** Values selected up-front (deduped, and truncated to one in single mode). */
  initial?: T[];
  /** Identity comparator (default `===`) — lets distinct object copies match by key. */
  compareWith?: (a: T, b: T) => boolean;
  /** Called after every actual change with the added/removed delta. */
  onChange?: (change: SelectionChange<T>) => void;
}

export interface SelectionModel<T> {
  /** The selected values, insertion-ordered. Reactive (stable ref until it changes). */
  selected(): T[];
  /** Whether nothing is selected. Reactive. */
  isEmpty(): boolean;
  /** How many values are selected. Reactive. */
  count(): number;
  /** Whether `value` is currently selected. Reactive. */
  isSelected(value: T): boolean;
  /** Add value(s) to the selection (single mode keeps only the last given). */
  select(...values: T[]): void;
  /** Remove value(s) from the selection. */
  deselect(...values: T[]): void;
  /** Flip a single value's selected state. */
  toggle(value: T): void;
  /** Replace the whole selection with exactly these value(s). */
  setSelection(...values: T[]): void;
  /** Clear the selection. */
  clear(): void;
  /** True when this model allows multiple selected values. */
  readonly multiple: boolean;
}

/** Create a selection model. */
export function selectionModel<T>(options: SelectionModelOptions<T> = {}): SelectionModel<T> {
  const multiple: boolean = options.multiple ?? false;
  const compareWith: (a: T, b: T) => boolean = options.compareWith ?? ((a, b) => a === b);
  const onChange: ((change: SelectionChange<T>) => void) | undefined = options.onChange;

  const has = (arr: T[], v: T): boolean => arr.some((x) => compareWith(x, v));
  /** Dedupe with the comparator, preserving first-seen order. */
  const dedupe = (arr: T[]): T[] => {
    const out: T[] = [];
    for (const v of arr) if (!has(out, v)) out.push(v);
    return out;
  };

  const seedAll: T[] = dedupe(options.initial ?? []);
  const seed: T[] = multiple ? seedAll : seedAll.slice(-1);
  const _selected: Signal<T[]> = signal<T[]>(seed);

  /** Commit `next` if it differs from the current set, emitting the delta. */
  const commit = (next: T[]): void => {
    const cur: T[] = _selected();
    const added: T[] = next.filter((v) => !has(cur, v));
    const removed: T[] = cur.filter((v) => !has(next, v));
    if (added.length === 0 && removed.length === 0) return;
    _selected.set(next);
    onChange?.({ added, removed });
  };

  return {
    multiple,
    selected: (): T[] => _selected(),
    isEmpty: (): boolean => _selected().length === 0,
    count: (): number => _selected().length,
    isSelected: (value: T): boolean => has(_selected(), value),

    select: (...values: T[]): void => {
      const add: T[] = dedupe(values);
      if (add.length === 0) return;
      if (multiple) {
        const cur: T[] = _selected();
        commit([...cur, ...add.filter((v) => !has(cur, v))]);
      } else {
        commit([add[add.length - 1]]);
      }
    },

    deselect: (...values: T[]): void => {
      if (values.length === 0) return;
      const cur: T[] = _selected();
      commit(cur.filter((x) => !has(values, x)));
    },

    toggle: (value: T): void => {
      const cur: T[] = _selected();
      if (has(cur, value)) commit(cur.filter((x) => !compareWith(x, value)));
      else if (multiple) commit([...cur, value]);
      else commit([value]);
    },

    setSelection: (...values: T[]): void => {
      const next: T[] = dedupe(values);
      commit(multiple ? next : next.slice(-1));
    },

    clear: (): void => commit([]),
  };
}
