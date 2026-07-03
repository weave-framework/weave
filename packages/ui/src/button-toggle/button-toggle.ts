/**
 * `<ButtonToggle>` — a segmented control (a row of connected buttons where one, or in
 * multi mode several, is "on"). Two modes:
 *
 * - **Single-select (default)** — radio-group semantics: `role=radiogroup` with
 *   `role=radio` segments, `aria-checked`, roving tabindex, and Arrow keys that move
 *   BOTH focus and selection (WAI-ARIA APG radiogroup). Value = the selected key.
 * - **Multi-select (`multiple`)** — a toolbar of independent toggles: `role=group`
 *   with `aria-pressed` buttons; Arrow keys move focus only, Space/Enter toggles the
 *   focused one (e.g. B / I / U). Value = an array of the pressed keys.
 *
 * Headless nav is the CDK `listKeyManager` (horizontal, wrap, skip-disabled). Selection
 * state is exposed via the native ARIA attribute (`aria-checked` / `aria-pressed`), so
 * the styling hooks off `[aria-checked=true]` — no state class. Value binding is
 * controlled: pass `value` (a getter) + `onChange`; forms (`use:control`) integration
 * lands with the Checkbox pass that fixes the control-binding convention.
 *
 *   import ButtonToggle from '@weave-framework/ui/button-toggle';
 *   <ButtonToggle options={{ opts }} value={{ view() }} onChange={{ setView }} />
 *   <ButtonToggle multiple options={{ marks }} value={{ active() }} onChange={{ setActive }} />
 */

import { signal, type Signal } from '@weave-framework/runtime';
import { listKeyManager, type ListKeyManager } from '../cdk/key-manager.js';

export interface ButtonToggleOption {
  /** The value this segment carries (what `value`/`onChange` speak in). */
  value: string;
  /** Visible text. Defaults to `value` when omitted. */
  label?: string;
  /** Optional leading icon — a name in the active `<Icon>` registry (Lucide by default). */
  icon?: string;
  /** Disable just this segment (skipped in keyboard nav, not selectable). */
  disabled?: boolean;
}

export interface ButtonToggleProps {
  /** The segments, left to right. */
  options: ButtonToggleOption[];
  /** Multi-select (toolbar of toggles) instead of single-select (radio group). */
  multiple?: boolean;
  /** Controlled value: a key (single) or an array of keys (multi). */
  value?: string | string[] | null;
  /** Called with the next value (a key, or the next array) on select/toggle. */
  onChange?: (value: string | string[]) => void;
  /** Disable the whole group. */
  disabled?: boolean;
  /** Accessible name for the group. */
  label?: string;
  /** Extra classes, forwarded onto the container. */
  class?: string;
}

export const template: string =
  '<div class={{ groupClass() }} ref={{ host }} role={{ groupRole() }} aria-label={{ label() }}' +
  ' on:keydown={{ onKeydown }}>' +
  '@for (opt of options(); track opt.value) {' +
  '<button type="button" class="weave-button-toggle__segment" role={{ segmentRole() }}' +
  ' aria-checked={{ ariaChecked(opt) }} aria-pressed={{ ariaPressed(opt) }}' +
  ' tabindex={{ tabindexFor(opt) }} disabled={{ isOptionDisabled(opt) }}' +
  ' on:click={{ () => activate(opt) }}>' +
  '@if (opt.icon) {<Icon name={{ opt.icon }} />}' +
  '<span class="weave-button-toggle__label">{{ opt.label ?? opt.value }}</span>' +
  '</button>' +
  '}' +
  '</div>';

export interface ButtonToggleContext {
  host: Signal<Element | null>;
  options: () => ButtonToggleOption[];
  groupClass: () => string;
  groupRole: () => string;
  segmentRole: () => string | undefined;
  label: () => string | undefined;
  ariaChecked: (opt: ButtonToggleOption) => string | undefined;
  ariaPressed: (opt: ButtonToggleOption) => string | undefined;
  tabindexFor: (opt: ButtonToggleOption) => number;
  isOptionDisabled: (opt: ButtonToggleOption) => boolean;
  activate: (opt: ButtonToggleOption) => void;
  onKeydown: (event: KeyboardEvent) => void;
}

export function setup(props: ButtonToggleProps): ButtonToggleContext {
  const host: Signal<Element | null> = signal<Element | null>(null);

  const options = (): ButtonToggleOption[] => props.options ?? [];
  const multiple = (): boolean => !!props.multiple;
  const groupDisabled = (): boolean => !!props.disabled;
  const isOptionDisabled = (opt: ButtonToggleOption): boolean => groupDisabled() || !!opt.disabled;
  const currentValues = (): string[] => (Array.isArray(props.value) ? props.value : []);
  const isSelected = (opt: ButtonToggleOption): boolean =>
    multiple() ? currentValues().includes(opt.value) : props.value === opt.value;

  const manager: ListKeyManager<ButtonToggleOption> = listKeyManager(options, {
    orientation: 'horizontal',
    wrap: true,
    skipDisabled: true,
    isDisabled: isOptionDisabled,
  });

  const emit = (value: string | string[]): void => props.onChange?.(value);

  // The single tabbable segment: the active one (once the keyboard has moved), else
  // the selected one, else the first enabled — so the group always has a tab stop.
  const rovingIndex = (): number => {
    const active: number = manager.activeIndex();
    if (active >= 0) return active;
    const opts: ButtonToggleOption[] = options();
    const selected: number = opts.findIndex(isSelected);
    if (selected >= 0) return selected;
    const firstEnabled: number = opts.findIndex((o) => !isOptionDisabled(o));
    return firstEnabled >= 0 ? firstEnabled : 0;
  };

  const focusSegment = (index: number): void => {
    const el: Element | null = host();
    if (!el) return;
    const seg: HTMLElement | undefined = el.querySelectorAll<HTMLElement>('.weave-button-toggle__segment')[index];
    seg?.focus();
  };

  const activate = (opt: ButtonToggleOption): void => {
    if (isOptionDisabled(opt)) return;
    manager.setActiveItem(opt); // roving tab stop follows the interaction
    if (multiple()) {
      const next: Set<string> = new Set(currentValues());
      if (next.has(opt.value)) next.delete(opt.value);
      else next.add(opt.value);
      emit([...next]);
    } else {
      emit(opt.value);
    }
  };

  const onKeydown = (event: KeyboardEvent): void => {
    // Sync the manager to the current tab stop before it navigates, so the first Arrow
    // moves relative to the selected/focused segment (not from index 0).
    if (manager.activeIndex() < 0) manager.setActiveItem(rovingIndex());
    if (event.key === ' ' || event.key === 'Enter') {
      const opt: ButtonToggleOption | undefined = options()[manager.activeIndex()];
      if (opt) {
        activate(opt);
        event.preventDefault();
      }
      return;
    }
    if (manager.onKeydown(event)) {
      event.preventDefault();
      const index: number = manager.activeIndex();
      focusSegment(index);
      // Radio group: Arrow moves selection too (focus already followed above).
      if (!multiple()) {
        const opt: ButtonToggleOption | undefined = options()[index];
        if (opt) emit(opt.value);
      }
    }
  };

  return {
    host,
    options,
    groupClass: (): string => (props.class ? `weave-button-toggle ${props.class}` : 'weave-button-toggle'),
    groupRole: (): string => (multiple() ? 'group' : 'radiogroup'),
    segmentRole: (): string | undefined => (multiple() ? undefined : 'radio'),
    label: (): string | undefined => props.label,
    ariaChecked: (opt): string | undefined => (multiple() ? undefined : isSelected(opt) ? 'true' : 'false'),
    ariaPressed: (opt): string | undefined => (multiple() ? (isSelected(opt) ? 'true' : 'false') : undefined),
    tabindexFor: (opt): number => (options().indexOf(opt) === rovingIndex() ? 0 : -1),
    isOptionDisabled,
    activate,
    onKeydown,
  };
}
