/**
 * `<SlideToggle>` — a real `<input type=checkbox>` presented as an on/off switch
 * (`role=switch`; Weave: a 42×24 track, `field`→accent, with an 18px knob that slides
 * `.16s`). Same lean DOM + form-control convention as Checkbox — the native input
 * (visually hidden, overlaying the label) carries semantics/keyboard/focus while the
 * `__track` (+ its `::after` knob) paints from `:checked` / `:focus-visible` / `:disabled`.
 *
 * Binding = the Weave form-control convention (boolean value):
 *  - **Signal**: `checked` (a getter) + `onChange`.
 *  - **Forms**: `control` — a structural `Field<boolean>` (a real `@weave-framework/forms`
 *    Field satisfies it). `control` wins; it drives value two-way, marks `touched` on
 *    blur, and reflects `aria-invalid` while touched **and** invalid.
 *
 *   import SlideToggle from '@weave-framework/ui/slide-toggle';
 *   <SlideToggle checked={{ on() }} onChange={{ setOn }} label={{ 'Notifications' }} />
 *   <SlideToggle control={{ form.controls.subscribe }} label={{ 'Subscribe' }} />
 */

import { signal, effect, type Signal } from '@weave-framework/runtime';

/** The subset of a `@weave-framework/forms` `Field<boolean>` a toggle binds to. */
export interface SlideToggleControl {
  value: Signal<boolean>;
  touched?: Signal<boolean>;
  error?: () => string | null;
}

export interface SlideToggleProps {
  /** Controlled on/off state (a getter). Ignored when `control` is set. */
  checked?: boolean;
  /** Called with the next state on toggle. Ignored when `control` is set. */
  onChange?: (checked: boolean) => void;
  /** A forms `Field<boolean>` — two-way value + touched-on-blur + aria-invalid. */
  control?: SlideToggleControl;
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
  '<input type="checkbox" role="switch" class="weave-slide-toggle__input" ref={{ input }}' +
  ' .checked={{ isChecked() }} disabled={{ isDisabled() }} required={{ isRequired() }} name={{ name() }}' +
  ' on:change={{ onNativeChange }} on:blur={{ onBlur }} />' +
  '<span class="weave-slide-toggle__track" aria-hidden="true"></span>' +
  '@if (label()) {<span class="weave-slide-toggle__label">{{ label() }}</span>}' +
  '</label>';

export interface SlideToggleContext {
  input: Signal<HTMLInputElement | null>;
  rootClass: () => string;
  isChecked: () => boolean;
  isDisabled: () => boolean;
  isRequired: () => boolean;
  name: () => string | undefined;
  label: () => string | undefined;
  onNativeChange: (event: Event) => void;
  onBlur: () => void;
}

export function setup(props: SlideToggleProps): SlideToggleContext {
  const input: Signal<HTMLInputElement | null> = signal<HTMLInputElement | null>(null);

  const isChecked = (): boolean => (props.control ? !!props.control.value() : !!props.checked);

  // Forms validity → aria-invalid (touched AND invalid), the marker submit() focuses.
  effect(() => {
    const el: HTMLInputElement | null = input();
    if (!el) return;
    const c: SlideToggleControl | undefined = props.control;
    if (c && c.touched?.() && c.error?.()) el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');
  });

  const onNativeChange = (event: Event): void => {
    const next: boolean = (event.target as HTMLInputElement).checked;
    if (props.control) props.control.value.set(next);
    else props.onChange?.(next);
  };

  const onBlur = (): void => {
    props.control?.touched?.set(true);
  };

  return {
    input,
    rootClass: (): string => (props.class ? `weave-slide-toggle ${props.class}` : 'weave-slide-toggle'),
    isChecked,
    isDisabled: (): boolean => !!props.disabled,
    isRequired: (): boolean => !!props.required,
    name: (): string | undefined => props.name,
    label: (): string | undefined => props.label,
    onNativeChange,
    onBlur,
  };
}
