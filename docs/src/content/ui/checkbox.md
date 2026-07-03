# Checkbox

A real `<input type="checkbox">` with the Weave look — a 20px box that fills accent with a white checkmark when on. The
native input stays for semantics, keyboard, and focus; the box you see is painted from its state. It also does
tri-state ("mixed") for select-all patterns.

:::demo checkbox-basic

## Import

```ts
import Checkbox from '@weave-framework/ui/checkbox';
```

```scss
@use '@weave-framework/ui/checkbox';
```

## Basic usage

Bind it to a boolean signal with `checked` + `onChange`. `label` is the visible text and, via the wrapping
`<label>`, the accessible name:

:::tabs
~~~html title="app.html"
<Checkbox checked={{ done() }} onChange={{ setDone }} label={{ 'Mark as done' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Checkbox from '@weave-framework/ui/checkbox';

export function setup() {
  const done = signal(true);
  return { done, setDone: (v) => done.set(v) };
}
~~~
:::

## Binding: signal or forms field

Same two dialects as every Weave control:

| Binding | What you pass |
| --- | --- |
| **Signal** | `checked` (a getter) + `onChange` |
| **Forms** | `control` — a `Field<boolean>` (wins over `checked`) |

A bound `control` drives the value two-way, marks `touched` on blur, and sets `aria-invalid` while touched and
invalid:

```html
<Checkbox control={{ form.controls.agree }} label={{ 'I accept the terms' }} />
```

## Tri-state (indeterminate)

`indeterminate` renders the "mixed" mark — the classic parent checkbox that's neither all-on nor all-off. It's a
visual/AT state (the accessibility tree reports "mixed"); the actual `checked` value is still yours to drive:

:::demo checkbox-tristate

:::tabs
~~~html title="app.html"
<Checkbox checked={{ allOn() }} indeterminate={{ indeterminate() }} onChange={{ toggleAll }} label={{ 'All notifications' }} />
<Checkbox checked={{ email() }} onChange={{ setEmail }} label={{ 'Email' }} />
<Checkbox checked={{ sms() }} onChange={{ setSms }} label={{ 'SMS' }} />
~~~
~~~ts title="app.ts"
import { signal, computed } from '@weave-framework/runtime';
import Checkbox from '@weave-framework/ui/checkbox';

export function setup() {
  const email = signal(true);
  const sms = signal(false);
  const allOn = computed(() => email() && sms());
  const indeterminate = computed(() => (email() || sms()) && !allOn());
  const toggleAll = (v) => { email.set(v); sms.set(v); };
  return { email, sms, setEmail: (v) => email.set(v), setSms: (v) => sms.set(v), allOn, indeterminate, toggleAll };
}
~~~
:::

## Accessibility

It *is* a checkbox — Space toggles it, it's in the tab order, and the state is announced natively (including
"mixed"). The `<label>` wrapping makes the whole control clickable and names it. Use `disabled` and `required`
(native attributes) as usual.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `checked` | `boolean` | `false` | Controlled checked state (getter). Ignored when `control` is set. |
| `onChange` | `(checked: boolean) => void` | — | Called with the next state on toggle. |
| `control` | `Field<boolean>` | — | A forms field — two-way + touched + aria-invalid. Wins over `checked`. |
| `indeterminate` | `boolean` | `false` | Render the "mixed" mark. |
| `disabled` | `boolean` | `false` | Disable the control. |
| `required` | `boolean` | `false` | Mark the native input required. |
| `label` | `string` | — | Visible label + accessible name. |
| `name` | `string` | — | Native `name` for form submission. |
| `class` | `string` | — | Extra classes forwarded onto the `<label>` root. |
