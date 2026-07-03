# Input

The workhorse text field — a real native `<input>` (or `<textarea>`) dressed as a Weave **underline field**: a
1.5px baseline that turns accent on focus, transparent everywhere else. It comes with batteries: a clear button,
prefix/suffix slots, multiline, and first-class binding to signals or a forms field.

:::demo input-basic

## Import

```ts
import Input from '@weave-framework/ui/input';
```

```scss
@use '@weave-framework/ui/input';
```

## Basic usage

Bind the field to a signal with `value` + `onInput` — you hold the state, the input reflects it and reports every
keystroke:

:::tabs
~~~html title="app.html"
<Input value={{ q() }} onInput={{ setQ }} label={{ 'Message' }} placeholder={{ 'Type something…' }} />
<p>You typed: {{ q() }}</p>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Input from '@weave-framework/ui/input';

export function setup() {
  const q = signal('');
  return { q, setQ: (v) => q.set(v) };
}
~~~
:::

`label` gives the field an accessible name when it isn't wrapped in a [FormField](/ui/form-field). Pass `type`
(`'email'`, `'password'`, `'number'`, `'search'`, …), `placeholder`, `disabled`, `readonly`, `required`, and `name`
straight through to the native element.

## Binding: signal or forms field

Like every Weave control, Input speaks two binding dialects — pick one:

| Binding | What you pass | When |
| --- | --- | --- |
| **Signal** | `value` (a getter) + `onInput` | Simple local state. |
| **Forms** | `control` — a `Field<string>` | When the field is part of a `@weave-framework/forms` form. |

`control` wins if both are present. A bound `control` drives the value two-way, marks the field **touched on blur**,
and reddens the underline (`aria-invalid`) once it's touched *and* invalid — no manual wiring:

```html
<Input control={{ form.controls.email }} type={{ 'email' }} />
```

## Prefix & suffix

Drop an icon or text into the `prefix` / `suffix` slots — they sit *inside* the underline and share it. Empty slots
collapse, so there's never a dead gap:

:::demo input-features

:::tabs
~~~html title="app.html"
<Input value={{ search() }} onInput={{ setSearch }} clearable={{ true }} label={{ 'Search' }}>
  <Icon slot="prefix" name={{ 'search' }} />
</Input>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Input from '@weave-framework/ui/input';
import Icon from '@weave-framework/ui/icon';

export function setup() {
  const search = signal('weave');
  return { search, setSearch: (v) => search.set(v) };
}
~~~
:::

## Clearable

`clearable` adds a `×` button that appears when the field is non-empty and editable; clicking it empties the value
and refocuses. `clearLabel` sets its accessible name (default `'Clear'`).

## Multiline

`multiline` swaps the `<input>` for a `<textarea>` — `rows` sets its height (default 3). Everything else (binding,
clearable, slots) works the same:

```html
<Input multiline={{ true }} rows={{ 5 }} value={{ notes() }} onInput={{ setNotes }} label={{ 'Notes' }} />
```

## Accessibility

Because it's a real input, focus, keyboard, and form participation are native. Give it a name — either a `label`
prop or, better, wrap it in a [FormField](/ui/form-field), which wires the `<label for>`, the hint/error line
(`aria-describedby`), and the invalid state for you. The clear button is a real `<button>` with an `aria-label`.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `string` | — | Controlled value (getter). Ignored when `control` is set. |
| `onInput` | `(value: string) => void` | — | Called with the next value on every input. |
| `control` | `Field<string>` | — | A forms field — two-way value + touched-on-blur + error underline. Wins over `value`. |
| `type` | `string` | `'text'` | Native input type (ignored when `multiline`). |
| `multiline` | `boolean` | `false` | Render a `<textarea>` instead of an `<input>`. |
| `rows` | `number` | `3` | Rows for the textarea. |
| `placeholder` | `string` | — | Placeholder text. |
| `disabled` | `boolean` | `false` | Disable the field. |
| `readonly` | `boolean` | `false` | Make the field read-only. |
| `required` | `boolean` | `false` | Mark the native input required. |
| `name` | `string` | — | Native `name` for form submission. |
| `label` | `string` | — | Accessible name (when not wrapped by a FormField). |
| `clearable` | `boolean` | `false` | Show a `×` clear button when non-empty and editable. |
| `clearLabel` | `string` | `'Clear'` | Accessible name for the clear button. |
| `class` | `string` | — | Extra classes forwarded onto the field wrapper. |

### Slots

| Slot | Content |
| --- | --- |
| `prefix` | Content before the field, inside the underline (an icon, text). |
| `suffix` | Content after the field, inside the underline. |
