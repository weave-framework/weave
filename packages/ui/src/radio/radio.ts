/**
 * `<RadioGroup>` — a single-select group of real `<input type=radio>` (Weave: a 20px
 * circle, off = 1.5px ring, on = accent ring + an 8px accent dot). Items-prop API like
 * `<ButtonToggle>` (leaner + more testable than a compound `<Radio>` child API). The
 * inputs share a native `name`, so the browser gives **arrow-key navigation + roving
 * tabindex + single-selection for free** — this component adds only value/forms binding
 * and the visual.
 *
 * Binding follows the **Weave form-control convention** set by Checkbox (here the value
 * is the selected key, a `string`):
 *  - **Signal**: `value` (a getter) + `onChange`.
 *  - **Forms**: `control` — a structurally-typed `Field<string>` (a real
 *    `@weave-framework/forms` Field satisfies it; `@weave-framework/ui` stays decoupled).
 *    `control` drives the value two-way, marks `touched` on blur, and reflects
 *    `aria-invalid` on the group while touched **and** invalid. `control` wins over
 *    `value`/`onChange`.
 *
 *   import RadioGroup from '@weave-framework/ui/radio';
 *   <RadioGroup options={{ plans }} value={{ plan() }} onChange={{ setPlan }} label={{ 'Plan' }} />
 *   <RadioGroup options={{ plans }} control={{ form.controls.plan }} />
 */

import { signal, effect, type Signal } from '@weave-framework/runtime';

/** The subset of a `@weave-framework/forms` `Field<string>` a radio group binds to. */
export interface RadioControl {
  value: Signal<string>;
  touched?: Signal<boolean>;
  error?: () => string | null;
}

export interface RadioOption {
  /** The value this radio carries (what `value`/`onChange` speak in). */
  value: string;
  /** Visible text. Defaults to `value` when omitted. */
  label?: string;
  /** Disable just this radio. */
  disabled?: boolean;
}

export interface RadioGroupProps {
  /** The radios, top to bottom. */
  options: RadioOption[];
  /** Controlled selected value (a getter). Ignored when `control` is set. */
  value?: string | null;
  /** Called with the next value on select. Ignored when `control` is set. */
  onChange?: (value: string) => void;
  /** A forms `Field<string>` — two-way value + touched-on-blur + aria-invalid. */
  control?: RadioControl;
  /** Shared native `name` (auto-generated if omitted). */
  name?: string;
  /** Disable the whole group. */
  disabled?: boolean;
  /** Accessible name for the group. */
  label?: string;
  /** Extra classes, forwarded onto the group container. */
  class?: string;
}

let _uid: number = 0;

export const template: string =
  '<div class={{ groupClass() }} ref={{ root }} role="radiogroup" aria-label={{ label() }}' +
  ' on:change={{ onNativeChange }} on:focusout={{ onFocusOut }}>' +
  '@for (opt of options(); track opt.value) {' +
  '<label class="weave-radio">' +
  '<input type="radio" class="weave-radio__input" name={{ name() }} value={{ opt.value }}' +
  ' .checked={{ isSelected(opt) }} disabled={{ isOptionDisabled(opt) }} />' +
  '<span class="weave-radio__box" aria-hidden="true"></span>' +
  '<span class="weave-radio__label">{{ opt.label ?? opt.value }}</span>' +
  '</label>' +
  '}' +
  '</div>';

export interface RadioGroupContext {
  root: Signal<HTMLElement | null>;
  options: () => RadioOption[];
  groupClass: () => string;
  label: () => string | undefined;
  name: () => string;
  isSelected: (opt: RadioOption) => boolean;
  isOptionDisabled: (opt: RadioOption) => boolean;
  onNativeChange: (event: Event) => void;
  onFocusOut: () => void;
}

export function setup(props: RadioGroupProps): RadioGroupContext {
  const root: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);
  const groupName: string = props.name ?? `weave-radio-${(_uid += 1)}`;

  const options = (): RadioOption[] => props.options ?? [];
  const groupDisabled = (): boolean => !!props.disabled;
  const isOptionDisabled = (opt: RadioOption): boolean => groupDisabled() || !!opt.disabled;
  const currentValue = (): string | null => (props.control ? props.control.value() : props.value ?? null);
  // Source → DOM per input, via a `.checked` property binding in the template (each
  // input binds itself, so it's reactive and needs no post-render child query).
  const isSelected = (opt: RadioOption): boolean => currentValue() === opt.value;

  // Forms validity → aria-invalid on the group (touched AND invalid).
  effect(() => {
    const el: HTMLElement | null = root();
    if (!el) return;
    const c: RadioControl | undefined = props.control;
    if (c && c.touched?.() && c.error?.()) el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');
  });

  const onNativeChange = (event: Event): void => {
    const target: HTMLInputElement = event.target as HTMLInputElement;
    if (!target.classList?.contains('weave-radio__input')) return;
    const next: string = target.value;
    if (props.control) props.control.value.set(next);
    else props.onChange?.(next);
  };

  const onFocusOut = (): void => {
    props.control?.touched?.set(true);
  };

  return {
    root,
    options,
    groupClass: (): string => (props.class ? `weave-radio-group ${props.class}` : 'weave-radio-group'),
    label: (): string | undefined => props.label,
    name: (): string => groupName,
    isSelected,
    isOptionDisabled,
    onNativeChange,
    onFocusOut,
  };
}
