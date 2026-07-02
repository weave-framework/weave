/**
 * `<Input>` — a native `<input>` (or `<textarea>`) as a Weave **underline field**
 * (`border-bottom: 1.5px line`, transparent, focus → accent). Batteries-included:
 *
 *  - **Prefix / suffix** — named slots (`slot="prefix"` / `slot="suffix"`) that hold text
 *    or an icon, flanking the input *inside the underline* (they share the border). Empty
 *    slots collapse (hidden), so the field has no dead gaps.
 *  - **Clearable** — `clearable` shows a `×` button (when non-empty, editable) that empties
 *    the value and refocuses.
 *  - **Multiline** — `multiline` renders a `<textarea>` (with `rows`) instead of `<input>`.
 *  - **Binding** — the Weave form-control convention (string value): `value` (a getter) +
 *    `onInput`, OR `control` (a structural `Field<string>`). `control` wins; it drives the
 *    value two-way, marks `touched` on blur, and drives the error underline (`--invalid`)
 *    off `touched() && error()`.
 *  - Forwards `type` / `placeholder` / `disabled` / `readonly` / `required` / `name`.
 *
 * Compose with `<FormField>` for a label + hint/error line (which also wires `for`/`id`).
 *
 *   import Input from '@weave-framework/ui/input';
 *   <Input control={{ form.controls.email }} type={{ 'email' }} placeholder={{ 'you@…' }} />
 *   <Input value={{ q() }} onInput={{ setQ }} clearable>
 *     <Icon slot="prefix" name={{ 'search' }} />
 *   </Input>
 */

import { signal, effect, onMount, type Signal } from '@weave-framework/runtime';

/** The subset of a `@weave-framework/forms` `Field<string>` an input binds to. */
export interface InputControl {
  value: Signal<string>;
  touched?: Signal<boolean>;
  error?: () => string | null;
}

export interface InputProps {
  /** Controlled value (a getter). Ignored when `control` is set. */
  value?: string;
  /** Called with the next value on every input. Ignored when `control` is set. */
  onInput?: (value: string) => void;
  /** A forms `Field<string>` — two-way value + touched-on-blur + error underline. */
  control?: InputControl;
  /** Native input type (text/email/password/number/search/…). Default 'text'. Ignored when `multiline`. */
  type?: string;
  /** Render a `<textarea>` instead of an `<input>`. */
  multiline?: boolean;
  /** Rows for the textarea. Default 3. */
  rows?: number;
  /** Placeholder text. */
  placeholder?: string;
  /** Disable the field. */
  disabled?: boolean;
  /** Make the field read-only. */
  readonly?: boolean;
  /** Mark the native input required. */
  required?: boolean;
  /** Native `name` (form submission). */
  name?: string;
  /** Accessible name (when not wrapped by a FormField label). */
  label?: string;
  /** Show a clear (`×`) button when the field is non-empty and editable. */
  clearable?: boolean;
  /** Accessible name for the clear button. Default 'Clear'. */
  clearLabel?: string;
  /** Called on mount with the native field — lets a composer (e.g. Autocomplete) add
   *  combobox ARIA / manage `aria-activedescendant` without re-creating the field. */
  onInputRef?: (el: HTMLInputElement | HTMLTextAreaElement) => void;
  /** Extra classes, forwarded onto the field wrapper. */
  class?: string;
}

export const template: string =
  '<div class={{ rootClass() }} ref={{ root }}>' +
  '<span class="weave-input__prefix"><slot name="prefix"></slot></span>' +
  '@if (multiline()) {' +
  '<textarea class="weave-input__field" ref={{ input }} rows={{ rows() }} placeholder={{ placeholder() }}' +
  ' .value={{ currentValue() }} disabled={{ isDisabled() }} readonly={{ isReadonly() }} required={{ isRequired() }}' +
  ' name={{ name() }} aria-label={{ label() }} on:input={{ onNativeInput }} on:blur={{ onBlur }}></textarea>' +
  '}' +
  '@if (singleline()) {' +
  '<input class="weave-input__field" ref={{ input }} type={{ type() }} placeholder={{ placeholder() }}' +
  ' .value={{ currentValue() }} disabled={{ isDisabled() }} readonly={{ isReadonly() }} required={{ isRequired() }}' +
  ' name={{ name() }} aria-label={{ label() }} on:input={{ onNativeInput }} on:blur={{ onBlur }} />' +
  '}' +
  '@if (showClear()) {' +
  '<button type="button" class="weave-input__clear" aria-label={{ clearLabel() }} on:click={{ clear }}>×</button>' +
  '}' +
  '<span class="weave-input__suffix"><slot name="suffix"></slot></span>' +
  '</div>';

export interface InputContext {
  root: Signal<HTMLElement | null>;
  input: Signal<HTMLInputElement | HTMLTextAreaElement | null>;
  rootClass: () => string;
  multiline: () => boolean;
  singleline: () => boolean;
  type: () => string;
  rows: () => number;
  placeholder: () => string | undefined;
  currentValue: () => string;
  isDisabled: () => boolean;
  isReadonly: () => boolean;
  isRequired: () => boolean;
  name: () => string | undefined;
  label: () => string | undefined;
  showClear: () => boolean;
  clearLabel: () => string;
  onNativeInput: (event: Event) => void;
  onBlur: () => void;
  clear: () => void;
}

export function setup(props: InputProps): InputContext {
  const root: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);
  const input: Signal<HTMLInputElement | HTMLTextAreaElement | null> = signal<
    HTMLInputElement | HTMLTextAreaElement | null
  >(null);

  const currentValue = (): string => (props.control ? props.control.value() : props.value ?? '');
  const isDisabled = (): boolean => !!props.disabled;
  const isReadonly = (): boolean => !!props.readonly;
  const invalid = (): boolean => {
    const c: InputControl | undefined = props.control;
    return !!(c && c.touched?.() && c.error?.());
  };

  // Forms validity → aria-invalid on the field (touched AND invalid).
  effect(() => {
    const el: HTMLInputElement | HTMLTextAreaElement | null = input();
    if (!el) return;
    if (invalid()) el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');
  });

  // Hand the native field to a composer (Autocomplete) so it can add combobox ARIA.
  onMount(() => {
    const el: HTMLInputElement | HTMLTextAreaElement | null = input();
    if (el) props.onInputRef?.(el);
  });

  // Empty prefix/suffix slots collapse, so the field has no dead gap (flex `gap` skips
  // display:none children). Static once mounted — named slots don't change here.
  onMount(() => {
    const el: HTMLElement | null = root();
    if (!el) return;
    for (const part of ['prefix', 'suffix']) {
      const span: HTMLElement | null = el.querySelector<HTMLElement>(`.weave-input__${part}`);
      if (span && !span.querySelector('*') && !(span.textContent ?? '').trim()) {
        span.classList.add(`weave-input__${part}--empty`);
      }
    }
  });

  const commit = (next: string): void => {
    if (props.control) props.control.value.set(next);
    else props.onInput?.(next);
  };

  const onNativeInput = (event: Event): void => {
    commit((event.target as HTMLInputElement | HTMLTextAreaElement).value);
  };

  const onBlur = (): void => {
    props.control?.touched?.set(true);
  };

  const clear = (): void => {
    commit('');
    input()?.focus();
  };

  return {
    root,
    input,
    rootClass: (): string => {
      const parts: string[] = ['weave-input'];
      if (props.multiline) parts.push('weave-input--multiline');
      if (invalid()) parts.push('weave-input--invalid');
      if (props.class) parts.push(props.class);
      return parts.join(' ');
    },
    multiline: (): boolean => !!props.multiline,
    singleline: (): boolean => !props.multiline,
    type: (): string => props.type ?? 'text',
    rows: (): number => props.rows ?? 3,
    placeholder: (): string | undefined => props.placeholder,
    currentValue,
    isDisabled,
    isReadonly,
    isRequired: (): boolean => !!props.required,
    name: (): string | undefined => props.name,
    label: (): string | undefined => props.label,
    showClear: (): boolean => !!props.clearable && !isDisabled() && !isReadonly() && currentValue().length > 0,
    clearLabel: (): string => props.clearLabel ?? 'Clear',
    onNativeInput,
    onBlur,
    clear,
  };
}
