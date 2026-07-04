/**
 * ListKeyManager — the keyboard-navigation engine under listbox / menu / select /
 * tabs / radio-group. Tracks an "active" item over a (reactive) list and moves it with
 * Arrow / Home / End plus **typeahead**. Headless: it exposes `activeIndex`/`activeItem`
 * signals and an `onKeydown` — the consumer decides whether to render that as roving
 * `tabindex` or `aria-activedescendant`. WAI-ARIA APG list navigation, zero-dep.
 */

import { signal, type Signal } from '@weave-framework/runtime';
import { activeDirection } from './bidi.js';

export type Orientation = 'vertical' | 'horizontal' | 'both';

export interface ListKeyManagerOptions<T> {
  /** Which arrows navigate. Default 'vertical'. */
  orientation?: Orientation;
  /** Wrap from last→first / first→last. Default false. */
  wrap?: boolean;
  /** Skip items reported disabled. Default true. */
  skipDisabled?: boolean;
  /** Report an item as disabled (skipped in navigation + typeahead). */
  isDisabled?: (item: T) => boolean;
  /** Enable type-to-select. Requires `getLabel`. Default false. */
  typeahead?: boolean;
  /** The text used for typeahead matching. */
  getLabel?: (item: T) => string;
  /** ms of inactivity before the typeahead buffer resets. Default 500. */
  typeaheadDebounce?: number;
  /**
   * For `horizontal`/`both` orientation, whether ArrowLeft/ArrowRight are flipped so
   * ArrowLeft advances (RTL). Defaults to reading the active CDK direction
   * ({@link activeDirection}), so a global `<html dir="rtl">` just works; pass a getter
   * to override (e.g. a subtree that provides its own direction).
   */
  rtl?: () => boolean;
}

export interface ListKeyManager<T> {
  /** Active item index, or -1 if none. Reactive. */
  activeIndex(): number;
  /** The active item, or null. Reactive. */
  activeItem(): T | null;
  /** Set the active item by index or identity (clamped/validated). */
  setActiveItem(indexOrItem: number | T): void;
  next(): void;
  previous(): void;
  first(): void;
  last(): void;
  /** Handle a keydown. Returns true if it drove navigation (caller should `preventDefault`). */
  onKeydown(event: KeyboardEvent): boolean;
}

/** Create a key manager over `items` (a getter, so a reactive list stays live). */
export function listKeyManager<T>(items: () => T[], options: ListKeyManagerOptions<T> = {}): ListKeyManager<T> {
  const orientation: Orientation = options.orientation ?? 'vertical';
  const wrap: boolean = options.wrap ?? false;
  const skipDisabled: boolean = options.skipDisabled ?? true;
  const isDisabled: (item: T) => boolean = options.isDisabled ?? (() => false);
  const getLabel: (item: T) => string = options.getLabel ?? ((i) => String(i));
  const debounce: number = options.typeaheadDebounce ?? 500;
  const isRtl: () => boolean = options.rtl ?? (() => activeDirection() === 'rtl');

  const _index: Signal<number> = signal<number>(-1);
  let buffer: string = '';
  let bufferTimer: ReturnType<typeof setTimeout> | null = null;

  const disabledAt = (i: number): boolean => skipDisabled && isDisabled(items()[i]);

  function seek(from: number, step: number): number {
    const arr: T[] = items();
    const n: number = arr.length;
    if (n === 0) return -1;
    let i: number = from;
    for (let count: number = 0; count < n; count++) {
      i += step;
      if (i < 0 || i >= n) {
        if (!wrap) return -1;
        i = ((i % n) + n) % n;
      }
      if (!disabledAt(i)) return i;
    }
    return -1;
  }

  function commit(i: number): void {
    if (i !== -1) _index.set(i);
  }

  function edge(forward: boolean): void {
    const arr: T[] = items();
    commit(forward ? seek(-1, 1) : seek(arr.length, -1));
  }

  function setActiveItem(indexOrItem: number | T): void {
    const arr: T[] = items();
    const i: number = typeof indexOrItem === 'number' ? indexOrItem : arr.indexOf(indexOrItem);
    if (i >= 0 && i < arr.length) _index.set(i);
  }

  function runTypeahead(char: string): boolean {
    if (bufferTimer) clearTimeout(bufferTimer);
    buffer += char.toLowerCase();
    bufferTimer = setTimeout(() => {
      buffer = '';
    }, debounce);

    // APG rule: a buffer of one repeated character cycles among same-initial items
    // (search from the NEXT item); a distinct multi-char buffer refines from the current.
    const allSame: boolean = [...buffer].every((c) => c === buffer[0]);
    const search: string = allSame ? buffer[0] : buffer;
    const startOffset: number = allSame ? 1 : 0;

    const arr: T[] = items();
    const n: number = arr.length;
    if (n === 0) return false;
    const base: number = _index();
    for (let k: number = startOffset; k < startOffset + n; k++) {
      const idx: number = (((base + k) % n) + n) % n;
      if (disabledAt(idx)) continue;
      if (getLabel(arr[idx]).toLowerCase().startsWith(search)) {
        _index.set(idx);
        return true;
      }
    }
    return false;
  }

  function onKeydown(event: KeyboardEvent): boolean {
    const key: string = event.key;
    const vertical: boolean = orientation === 'vertical' || orientation === 'both';
    const horizontal: boolean = orientation === 'horizontal' || orientation === 'both';
    // In RTL, horizontal nav flips: ArrowLeft advances, ArrowRight goes back.
    const rtl: boolean = horizontal && isRtl();
    const fwdKey: string = rtl ? 'ArrowLeft' : 'ArrowRight';
    const backKey: string = rtl ? 'ArrowRight' : 'ArrowLeft';

    if ((vertical && key === 'ArrowDown') || (horizontal && key === fwdKey)) {
      commit(seek(_index(), 1));
      return true;
    }
    if ((vertical && key === 'ArrowUp') || (horizontal && key === backKey)) {
      commit(seek(_index(), -1));
      return true;
    }
    if (key === 'Home') {
      edge(true);
      return true;
    }
    if (key === 'End') {
      edge(false);
      return true;
    }
    if (
      options.typeahead &&
      key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      key !== ' '
    ) {
      return runTypeahead(key);
    }
    return false;
  }

  return {
    activeIndex: () => _index(),
    activeItem: () => {
      const arr: T[] = items();
      const i: number = _index();
      return i >= 0 && i < arr.length ? arr[i] : null;
    },
    setActiveItem,
    next: () => commit(seek(_index(), 1)),
    previous: () => commit(seek(_index(), -1)),
    first: () => edge(true),
    last: () => edge(false),
    onKeydown,
  };
}
