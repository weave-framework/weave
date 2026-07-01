/**
 * `<Checkbox>` — a real `<input type=checkbox>` with the Weave visual (a 20px box that
 * fills accent with a white ✓ when on). Lean DOM: the native input (visually hidden,
 * kept for semantics/keyboard/focus) + a `__box` painted from its `:checked` /
 * `:indeterminate` / `:focus-visible` / `:disabled` state, wrapped in a `<label>` so
 * the whole control is clickable and the `__label` text is the accessible name.
 *
 * **Binding — the Weave form-control convention** (reused by Radio / Slide Toggle /
 * Input / Chips):
 *  - **Signal**: `checked` (a getter) + `onChange` — controlled two-way.
 *  - **Forms**: `control` — a `@weave-framework/forms` `Field<boolean>` (structurally
 *    typed here so `@weave-framework/ui` stays decoupled from forms). When present it
 *    drives the value two-way, marks `touched` on blur, and reflects `aria-invalid`
 *    while the field is touched **and** invalid. `control` wins over `checked`/`onChange`.
 *  - **Tri-state**: `indeterminate` sets the DOM input's `.indeterminate` (styled via
 *    `:indeterminate`; the accessibility tree reports "mixed" natively).
 *
 *   import Checkbox from '@weave-framework/ui/checkbox';
 *   <Checkbox checked={{ done() }} onChange={{ setDone }} label={{ 'Done' }} />
 *   <Checkbox control={{ form.controls.agree }} label={{ 'I agree' }} />
 *   <Checkbox indeterminate={{ someSelected() }} onChange={{ toggleAll }} />
 */

import { signal, effect, type Signal } from '@weave-framework/runtime';

/**
 * The subset of a `@weave-framework/forms` `Field<boolean>` a control binds to. A real
 * `Field<boolean>` satisfies it structurally — no runtime dependency on forms.
 */
export interface CheckboxControl {
  value: Signal<boolean>;
  touched?: Signal<boolean>;
  error?: () => string | null;
}

export interface CheckboxProps {
  /** Controlled checked state (a getter). Ignored when `control` is set. */
  checked?: boolean;
  /** Called with the next checked state on toggle. Ignored when `control` is set. */
  onChange?: (checked: boolean) => void;
  /** A forms `Field<boolean>` — two-way value + touched-on-blur + aria-invalid. */
  control?: CheckboxControl;
  /** Tri-state: render the "mixed" mark (sets the DOM input's `.indeterminate`). */
  indeterminate?: boolean;
  /** Disable the control. */
  disabled?: boolean;
  /** Mark the native input required. */
  required?: boolean;
  /** Visible label text (also the accessible name via the wrapping `<label>`). */
  label?: string;
  /** Native `name` (form submission). */
  name?: string;
  /** Extra classes, forwarded onto the `<label>` root. */
  class?: string;
}

export const template: string =
  '<label class={{ rootClass() }}>' +
  '<input type="checkbox" class="weave-checkbox__input" ref={{ input }}' +
  ' disabled={{ isDisabled() }} required={{ isRequired() }} name={{ name() }}' +
  ' on:change={{ onNativeChange }} on:blur={{ onBlur }} />' +
  '<span class="weave-checkbox__box" aria-hidden="true"></span>' +
  '@if (label()) {<span class="weave-checkbox__label">{{ label() }}</span>}' +
  '</label>';

export interface CheckboxContext {
  input: Signal<HTMLInputElement | null>;
  rootClass: () => string;
  isDisabled: () => boolean;
  isRequired: () => boolean;
  name: () => string | undefined;
  label: () => string | undefined;
  onNativeChange: () => void;
  onBlur: () => void;
}

export function setup(props: CheckboxProps): CheckboxContext {
  const input: Signal<HTMLInputElement | null> = signal<HTMLInputElement | null>(null);

  const isChecked = (): boolean => (props.control ? !!props.control.value() : !!props.checked);
  const isIndeterminate = (): boolean => !!props.indeterminate;

  // Source → DOM: keep the native `.checked` / `.indeterminate` properties in sync
  // (properties, not attributes — the attributes are only the initial/default state).
  effect(() => {
    const el: HTMLInputElement | null = input();
    if (el) el.checked = isChecked();
  });
  effect(() => {
    const el: HTMLInputElement | null = input();
    if (el) el.indeterminate = isIndeterminate();
  });

  // Forms validity → aria-invalid (touched AND invalid), the marker submit() focuses.
  effect(() => {
    const el: HTMLInputElement | null = input();
    if (!el) return;
    const c: CheckboxControl | undefined = props.control;
    if (c && c.touched?.() && c.error?.()) el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');
  });

  const onNativeChange = (): void => {
    const el: HTMLInputElement | null = input();
    if (!el) return;
    const next: boolean = el.checked;
    if (props.control) props.control.value.set(next);
    else props.onChange?.(next);
  };

  const onBlur = (): void => {
    props.control?.touched?.set(true);
  };

  return {
    input,
    rootClass: (): string => (props.class ? `weave-checkbox ${props.class}` : 'weave-checkbox'),
    isDisabled: (): boolean => !!props.disabled,
    isRequired: (): boolean => !!props.required,
    name: (): string | undefined => props.name,
    label: (): string | undefined => props.label,
    onNativeChange,
    onBlur,
  };
}
