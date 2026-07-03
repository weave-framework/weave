# Form Field

The frame around a control — a label above, the control in the middle, a hint or error line below. `<FormField>`
is deliberately lean (not a heavy wrapper), and it **auto-wires the accessibility**: it generates an id, points the
label's `for` at the control, links the hint/error via `aria-describedby`, and flips `aria-invalid` in the error
state. Two lines, fully accessible.

:::demo form-field-basic

## Import

```ts
import FormField from '@weave-framework/ui/form-field';
```

```scss
@use '@weave-framework/ui/form-field';
```

## Basic usage

Wrap any control in the default slot and give it a `label` and optional `hint`:

:::tabs
~~~html title="app.html"
<FormField label={{ 'Email' }} hint={{ 'We never share it.' }}>
  <Input value={{ email() }} onInput={{ setEmail }} type={{ 'email' }} placeholder={{ 'you@example.com' }} />
</FormField>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import FormField from '@weave-framework/ui/form-field';
import Input from '@weave-framework/ui/input';

export function setup() {
  const email = signal('');
  return { email, setEmail: (v) => email.set(v) };
}
~~~
:::

FormField finds the slotted `input` / `select` / `textarea`, gives it an id, and wires the label and message to it —
you don't touch `for` or `aria-describedby` yourself.

## Error state

Two ways to turn the field red. The first is a **manual** `error` string — set it (from a computed, say) and the
label + line go red and the message shows:

:::demo form-field-error

:::tabs
~~~html title="app.html"
<FormField label={{ 'Name' }} error={{ error() }}>
  <Input value={{ name() }} onInput={{ setName }} placeholder={{ 'Type, then clear it' }} />
</FormField>
~~~
~~~ts title="app.ts"
import { signal, computed } from '@weave-framework/runtime';
import FormField from '@weave-framework/ui/form-field';
import Input from '@weave-framework/ui/input';

export function setup() {
  const name = signal('');
  const error = computed(() => (name().trim() ? '' : 'Name is required'));
  return { name, setName: (v) => name.set(v), error };
}
~~~
:::

The second is **automatic** from a forms field: pass `control` and the error state derives from `touched() &&
error()` — so the message appears only after the user has been in the field:

```html
<FormField label={{ 'Email' }} control={{ form.controls.email }}>
  <Input control={{ form.controls.email }} />
</FormField>
```

## Hint vs error

`hint` shows below when there's no error; the error message replaces it when the field is invalid. So the line
never jumps — it's the same slot, showing guidance or a problem.

## Accessibility

This is the piece that makes a control properly labelled: the `<label for>` binds to the control's id, the
hint/error is linked with `aria-describedby`, and `aria-invalid` reflects the error state. Prefer wrapping controls
in a FormField over a bare `label` prop whenever there's a visible label.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `label` | `string` | — | Label text (uppercase). Omit for an unlabelled field. |
| `hint` | `string` | — | Hint shown below when there's no error. |
| `error` | `string` | — | Manual error message — sets the error state when non-empty. |
| `control` | `Field` | — | A forms field — error state auto-derives from `touched() && error()`. |
| `class` | `string` | — | Extra classes forwarded onto the root. |

### Slots

| Slot | Content |
| --- | --- |
| *(default)* | The control to frame (an Input, Select, Checkbox…). |
