/**
 * @weave/forms/dom — the one DOM-touching part of the forms package: a `use:`
 * directive that wires a {@link Field} to a single form control in one line.
 *
 * Kept out of the core (`@weave/forms`) so that `field`/`group`/`form` stay pure
 * signal state, testable without a DOM. Import this only where you bind to inputs.
 */

import { effect } from '@weave/runtime';
import { bindValue, type Action } from '@weave/runtime/dom';
import type { Field } from './index';

/**
 * `use:control={field}` — bind a DOM input/select/checkbox/radio to a {@link Field}:
 *   • two-way value binding (`value` / `checked` / radio `group`, picked from the element),
 *   • `touched` set on blur (gates error display),
 *   • `aria-invalid="true"` while the field is touched **and** invalid — which doubles as
 *     the marker `form.submit(...)` uses to focus the first error.
 *
 * Replaces the per-field `bind:value` + `on:blur` + `class:invalid` boilerplate:
 *
 * ```html
 * <input use:control={form.controls.title} />
 * @if (form.controls.title.error()) { <span class="msg">{{ form.controls.title.error() }}</span> }
 * ```
 */
export const control: Action<Field<unknown>> = (el: Element, f: Field<unknown>) => {
  const input: HTMLInputElement = el as HTMLInputElement;
  const kind: 'value' | 'checked' | 'group' =
    input.type === 'checkbox' ? 'checked' : input.type === 'radio' ? 'group' : 'value';
  bindValue(el, f.value, kind);

  el.addEventListener('blur', () => f.touched.set(true));

  effect(() => {
    if (f.touched() && f.error()) el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');
  });
};
