/**
 * `<FormField>` — the lean label / hint / error frame around a control (NOT Angular's
 * heavy `mat-form-field`). A `__label` above (uppercase 10px), the control in the default
 * slot, and a `__hint` / `__error` line below (11px). It **auto-wires** the slotted
 * control: generates an `id`, points the label's `for` at it, links the hint/error via
 * `aria-describedby`, and sets `aria-invalid` in the error state — so the simplest usage
 * is a couple of lines and fully accessible.
 *
 * Error state is either **manual** (`error` prop) or **auto-derived** from a bound forms
 * control (`control` — invalid AND touched → error). In the error state the label + line
 * turn `error` red; the control's own underline reddens off the `aria-invalid` this sets.
 *
 *   import FormField from '@weave-framework/ui/form-field';
 *   <FormField label={{ 'Email' }} hint={{ 'We never share it' }}>
 *     <Input control={{ form.controls.email }} />
 *   </FormField>
 *   <FormField label={{ 'Email' }} control={{ form.controls.email }}>…</FormField>
 */

import { signal, effect, onMount, type Signal } from '@weave-framework/runtime';

/** The subset of a `@weave-framework/forms` `Field` FormField reads for auto-error. */
export interface FormFieldControl {
  touched?: () => boolean;
  error?: () => string | null;
}

export interface FormFieldProps {
  /** Label text (uppercase). Omit for an unlabelled field. */
  label?: string;
  /** Hint shown below when there's no error. */
  hint?: string;
  /** Manual error message — sets the error state when non-empty. */
  error?: string;
  /** A forms control — error state auto-derives from `touched() && error()`. */
  control?: FormFieldControl;
  /** Extra classes, forwarded onto the root. */
  class?: string;
}

let _uid: number = 0;

export const template: string =
  '<div class={{ rootClass() }}>' +
  '@if (label()) {<label class="weave-form-field__label" ref={{ labelRef }}>{{ label() }}</label>}' +
  '<div class="weave-form-field__control" ref={{ controlWrap }}><slot></slot></div>' +
  '@if (message()) {<span class={{ messageClass() }} id={{ messageId() }}>{{ message() }}</span>}' +
  '</div>';

export interface FormFieldContext {
  labelRef: Signal<HTMLElement | null>;
  controlWrap: Signal<HTMLElement | null>;
  rootClass: () => string;
  label: () => string | undefined;
  message: () => string | null;
  messageClass: () => string;
  messageId: () => string;
}

export function setup(props: FormFieldProps): FormFieldContext {
  const labelRef: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);
  const controlWrap: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);
  const id: string = `weave-form-field-${(_uid += 1)}`;
  const messageId: string = `${id}-message`;

  // Error state: manual `error` prop wins; else the bound control's touched-and-invalid.
  const activeError = (): string | null => {
    if (props.error) return props.error;
    const c: FormFieldControl | undefined = props.control;
    if (c && c.touched?.() && c.error?.()) return c.error() ?? null;
    return null;
  };
  const invalid = (): boolean => activeError() !== null;
  const message = (): string | null => activeError() ?? props.hint ?? null;

  // Auto-wire the slotted control: id ↔ label `for`, aria-describedby ↔ the message,
  // aria-invalid in the error state. Deferred to onMount so the slotted control is in
  // the DOM; the inner effect then re-runs as the message / error state changes.
  onMount(() => {
    effect(() => {
      const wrap: HTMLElement | null = controlWrap();
      if (!wrap) return;
      const control: HTMLElement | null = wrap.querySelector<HTMLElement>('input, select, textarea');
      if (!control) return;
      if (!control.id) control.id = id;
      const label: HTMLElement | null = labelRef();
      if (label) label.setAttribute('for', control.id);
      if (message()) control.setAttribute('aria-describedby', messageId);
      else control.removeAttribute('aria-describedby');
      // Only manage aria-invalid when this field owns the error signal, so we don't
      // fight a control that sets its own (e.g. an Input bound to the same field).
      if (props.error !== undefined || props.control) {
        if (invalid()) control.setAttribute('aria-invalid', 'true');
        else control.removeAttribute('aria-invalid');
      }
    });
  });

  return {
    labelRef,
    controlWrap,
    rootClass: (): string => {
      const parts: string[] = ['weave-form-field'];
      if (invalid()) parts.push('weave-form-field--invalid');
      if (props.class) parts.push(props.class);
      return parts.join(' ');
    },
    label: (): string | undefined => props.label,
    message,
    messageClass: (): string =>
      activeError() !== null ? 'weave-form-field__error' : 'weave-form-field__hint',
    messageId: (): string => messageId,
  };
}
