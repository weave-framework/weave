/**
 * `<Chips>` — a removable tag list (Weave: 1px border, radius 3px, `__label` + a `×`
 * `__remove`), optionally trailed by a dashed **"+ Add"** chip. The **value is the array**
 * of chip strings; removing a chip emits the shorter array.
 *
 * Keyboard (WAI-ARIA-ish): the chips are a roving-tabindex group — Arrow/Home/End move
 * focus (CDK `listKeyManager`, horizontal), and **Backspace/Delete removes the focused
 * chip** then focuses its neighbour. Each `×` is a real button with an `aria-label`.
 *
 * Binding = the Weave form-control convention (array value):
 *  - **Signal**: `value` (a getter) + `onChange`.
 *  - **Forms**: `control` — a structural `Field<string[]>`. `control` wins; it drives the
 *    array two-way and marks `touched` when a chip is removed.
 *
 *   import Chips from '@weave-framework/ui/chips';
 *   <Chips value={{ tags() }} onChange={{ setTags }} onAdd={{ promptForTag }} />
 *   <Chips control={{ form.controls.tags }} />
 */

import { signal, type Signal } from '@weave-framework/runtime';
import { listKeyManager, type ListKeyManager } from '../cdk/key-manager.js';

/** The subset of a `@weave-framework/forms` `Field<string[]>` chips bind to. */
export interface ChipsControl {
  value: Signal<string[]>;
  touched?: Signal<boolean>;
  error?: () => string | null;
}

export interface ChipsProps {
  /** Controlled chip array (a getter). Ignored when `control` is set. */
  value?: string[];
  /** Called with the next array on remove. Ignored when `control` is set. */
  onChange?: (next: string[]) => void;
  /** A forms `Field<string[]>` — two-way value + touched-on-remove. */
  control?: ChipsControl;
  /** Show the `×` remove button on each chip. Default true. */
  removable?: boolean;
  /** Disable the whole group (no focus, no removal). */
  disabled?: boolean;
  /** Accessible name for the group. */
  label?: string;
  /** When set, render a dashed "+ Add" chip that calls this on click. */
  onAdd?: () => void;
  /** Text for the add chip. Default 'Add'. */
  addLabel?: string;
  /** aria-label for a chip's remove button. Default `Remove <chip>`. */
  removeLabel?: (chip: string) => string;
  /** Extra classes, forwarded onto the group. */
  class?: string;
}

export const template: string =
  '<div class={{ groupClass() }} ref={{ root }} role="group" aria-label={{ label() }} on:keydown={{ onKeydown }}>' +
  '@for (chip of chips(); track chip) {' +
  '<span class="weave-chips__chip" tabindex={{ tabindexFor(chip) }}>' +
  '<span class="weave-chips__label">{{ chip }}</span>' +
  '@if (removable()) {' +
  '<button type="button" class="weave-chips__remove" aria-label={{ removeLabelFor(chip) }} tabindex="-1"' +
  ' disabled={{ isDisabled() }} on:click={{ () => removeChip(chip) }}><Icon name={{ \'x\' }} /></button>' +
  '}' +
  '</span>' +
  '}' +
  '@if (showAdd()) {' +
  '<button type="button" class="weave-chips__chip weave-chips__chip--add" disabled={{ isDisabled() }}' +
  ' on:click={{ add }}><Icon name={{ \'plus\' }} />{{ addText() }}</button>' +
  '}' +
  '</div>';

export interface ChipsContext {
  root: Signal<HTMLElement | null>;
  chips: () => string[];
  groupClass: () => string;
  label: () => string | undefined;
  removable: () => boolean;
  isDisabled: () => boolean;
  tabindexFor: (chip: string) => number;
  removeLabelFor: (chip: string) => string;
  removeChip: (chip: string) => void;
  onKeydown: (event: KeyboardEvent) => void;
  showAdd: () => boolean;
  add: () => void;
  addText: () => string;
}

export function setup(props: ChipsProps): ChipsContext {
  const root: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);

  const chips = (): string[] => (props.control ? props.control.value() : props.value ?? []);
  const removable = (): boolean => props.removable !== false;
  const isDisabled = (): boolean => !!props.disabled;

  const manager: ListKeyManager<string> = listKeyManager(chips, { orientation: 'horizontal', wrap: false });

  // The single tabbable chip: the active one (once the keyboard has moved), else the first.
  const rovingIndex = (): number => {
    const active: number = manager.activeIndex();
    return active >= 0 ? active : 0;
  };

  const focusChip = (index: number): void => {
    const el: HTMLElement | null = root();
    if (!el || index < 0) return;
    const chip: HTMLElement | undefined = el.querySelectorAll<HTMLElement>('.weave-chips__chip:not(.weave-chips__chip--add)')[index];
    chip?.focus();
  };

  const emit = (next: string[]): void => {
    if (props.control) {
      props.control.value.set(next);
      props.control.touched?.set(true);
    } else {
      props.onChange?.(next);
    }
  };

  const removeChip = (chip: string): void => {
    if (isDisabled()) return;
    const list: string[] = chips();
    const index: number = list.indexOf(chip);
    if (index < 0) return;
    const next: string[] = list.slice();
    next.splice(index, 1);
    emit(next);
    // Focus the chip now at `index` (its former neighbour), else the new last one.
    const focusIndex: number = Math.min(index, next.length - 1);
    manager.setActiveItem(focusIndex >= 0 ? focusIndex : 0);
    focusChip(focusIndex);
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (isDisabled()) return;
    if (manager.activeIndex() < 0) manager.setActiveItem(rovingIndex());
    if (event.key === 'Backspace' || event.key === 'Delete') {
      const chip: string | undefined = chips()[manager.activeIndex()];
      if (chip !== undefined) {
        removeChip(chip);
        event.preventDefault();
      }
      return;
    }
    if (manager.onKeydown(event)) {
      event.preventDefault();
      focusChip(manager.activeIndex());
    }
  };

  return {
    root,
    chips,
    groupClass: (): string => (props.class ? `weave-chips ${props.class}` : 'weave-chips'),
    label: (): string | undefined => props.label,
    removable,
    isDisabled,
    tabindexFor: (chip): number => {
      if (isDisabled()) return -1;
      return chips().indexOf(chip) === rovingIndex() ? 0 : -1;
    },
    removeLabelFor: (chip): string => (props.removeLabel ? props.removeLabel(chip) : `Remove ${chip}`),
    removeChip,
    onKeydown,
    showAdd: (): boolean => typeof props.onAdd === 'function',
    add: (): void => {
      if (!isDisabled()) props.onAdd?.();
    },
    // No '+' prefix: a lucide `plus` Icon draws it now (UI-icons rule — never a glyph).
    addText: (): string => props.addLabel ?? 'Add',
  };
}
