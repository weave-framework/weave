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

import { signal, effect, onMount, onDispose, type Signal } from '@weave-framework/runtime';

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
  /** For a `type="password"` field, show a reveal (eye) toggle that switches the value between hidden and visible. */
  revealable?: boolean;
  /** Accessible name for the reveal toggle in its hidden (will-show) state. Default 'Show password'. */
  revealLabel?: string;
  /** Accessible name for the reveal toggle in its revealed (will-hide) state. Default 'Hide password'. */
  hideLabel?: string;
  /**
   * Which tooltip renders on the reveal toggle (the visible hover/focus hint, text = the
   * current reveal/hide label, following the hidden↔revealed state):
   *
   *  - `'native'` (or `true`, or omitted) — the native browser `title`. Zero extra cost;
   *    Input stays CDK-free.
   *  - `'weave'` — the weave-ui `Tooltip` (styled bubble, hover + keyboard focus). The
   *    overlay/CDK code is **lazily imported** only when this mode is used, so `'native'`
   *    and `'none'` consumers never statically depend on it.
   *  - `'none'` (or `false`) — no tooltip at all.
   *
   * The `aria-label` (accessible name) on the toggle is present in every mode — a tooltip
   * is a description, not the accessible name.
   */
  revealTooltip?: boolean | 'none' | 'native' | 'weave';
  /**
   * Called every time the password reveal toggle flips, with the new state (`true` = value
   * now visible as plaintext, `false` = hidden). Lets the app react to the change — e.g.
   * drive its own tooltip — without reaching into Input's internal button.
   */
  onRevealToggle?: (revealed: boolean) => void;
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
  '@if (showReveal()) {' +
  '<button type="button" class="weave-input__reveal" ref={{ revealBtn }} aria-label={{ revealAriaLabel() }}' +
  ' title={{ revealTitle() }} aria-pressed={{ revealPressed() }} disabled={{ isDisabled() }} on:click={{ toggleReveal }}>' +
  '<Icon name={{ revealIcon() }} />' +
  '</button>' +
  '}' +
  '<span class="weave-input__suffix"><slot name="suffix"></slot></span>' +
  '</div>';

export interface InputContext {
  root: Signal<HTMLElement | null>;
  input: Signal<HTMLInputElement | HTMLTextAreaElement | null>;
  revealBtn: Signal<HTMLButtonElement | null>;
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
  showReveal: () => boolean;
  revealIcon: () => string;
  revealAriaLabel: () => string;
  revealTitle: () => string | undefined;
  revealPressed: () => string;
  toggleReveal: () => void;
  onNativeInput: (event: Event) => void;
  onBlur: () => void;
  clear: () => void;
}

export function setup(props: InputProps): InputContext {
  const root: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);
  const input: Signal<HTMLInputElement | HTMLTextAreaElement | null> = signal<
    HTMLInputElement | HTMLTextAreaElement | null
  >(null);

  // Password reveal (eye) toggle — only meaningful on a single-line `type="password"` field.
  const revealed: Signal<boolean> = signal<boolean>(false);
  const revealBtn: Signal<HTMLButtonElement | null> = signal<HTMLButtonElement | null>(null);
  const canReveal = (): boolean => !!props.revealable && (props.type ?? 'text') === 'password' && !props.multiline;
  // The label shown for the reveal toggle in the current state — the source for BOTH the
  // aria-label (accessible name) and the tooltip (native or weave).
  const revealText = (): string =>
    revealed() ? props.hideLabel ?? 'Hide password' : props.revealLabel ?? 'Show password';

  // Which tooltip renders on the reveal eye. Back-compat: `true`/omitted → native,
  // `false` → none; the three string modes pass through.
  const revealTooltipMode = (): 'none' | 'native' | 'weave' => {
    const t: boolean | 'none' | 'native' | 'weave' | undefined = props.revealTooltip;
    if (t === undefined || t === true) return 'native';
    if (t === false) return 'none';
    return t;
  };

  // FW-6 'weave' mode: attach the weave-ui Tooltip to the reveal eye. The Tooltip pulls the
  // overlay/CDK code, which native/none consumers must NOT pay for — so it is **lazily
  // imported** here, only when this field asks for it. `tooltip()` fixes its text at creation
  // (no reactive-update handle), so we re-apply it whenever the label flips (see toggleReveal).
  let tooltipDetach: (() => void) | null = null;
  let tooltipApply: ((el: HTMLButtonElement, text: string) => void) | null = null;
  const syncRevealTooltip = (): void => {
    if (!tooltipApply) return;
    const el: HTMLButtonElement | null = revealBtn();
    if (el) tooltipApply(el, revealText());
  };
  onMount((): void => {
    if (revealTooltipMode() !== 'weave') return;
    let disposed: boolean = false;
    void import('../tooltip/tooltip.js').then(({ tooltip }): void => {
      if (disposed) return;
      tooltipApply = (el: HTMLButtonElement, text: string): void => {
        tooltipDetach?.();
        tooltipDetach = tooltip(el, text);
      };
      syncRevealTooltip(); // initial attach with the current label
    });
    onDispose((): void => {
      disposed = true;
      tooltipDetach?.();
      tooltipDetach = null;
      tooltipApply = null;
    });
  });

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

  // Hand the native field to a composer (Autocomplete) so it can add combobox ARIA —
  // synchronously as soon as the ref is set, so composed behavior is wired before use.
  effect(() => {
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
    const el: HTMLInputElement | HTMLTextAreaElement | null = input();
    if (!el) {
      commit('');
      return;
    }
    // Fire a real `input` event so our own commit runs AND composers (Autocomplete)
    // react to the cleared value (e.g. close their panel).
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
  };

  return {
    root,
    input,
    revealBtn,
    rootClass: (): string => {
      const parts: string[] = ['weave-input'];
      if (props.multiline) parts.push('weave-input--multiline');
      if (invalid()) parts.push('weave-input--invalid');
      if (props.class) parts.push(props.class);
      return parts.join(' ');
    },
    multiline: (): boolean => !!props.multiline,
    singleline: (): boolean => !props.multiline,
    // While revealed, the native type becomes 'text' so the value shows as plaintext.
    type: (): string => (canReveal() && revealed() ? 'text' : props.type ?? 'text'),
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
    showReveal: (): boolean => canReveal(),
    revealIcon: (): string => (revealed() ? 'eye-off' : 'eye'),
    revealAriaLabel: (): string => revealText(),
    // Native `title` tooltip — only in 'native' mode (the default). 'none'/'weave' → no
    // title attribute ('weave' renders its own bubble). Text follows the toggle state.
    revealTitle: (): string | undefined => (revealTooltipMode() === 'native' ? revealText() : undefined),
    revealPressed: (): string => (revealed() ? 'true' : 'false'),
    toggleReveal: (): void => {
      const next: boolean = !revealed();
      revealed.set(next);
      props.onRevealToggle?.(next);
      syncRevealTooltip(); // 'weave' mode: refresh the bubble text to match the new state
    },
    onNativeInput,
    onBlur,
    clear,
  };
}
