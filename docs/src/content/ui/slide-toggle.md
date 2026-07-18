# Slide Toggle

An on/off switch — the same idea as a Checkbox, but shaped like a physical toggle for settings that take effect
immediately. Under the hood it's a real `<input type="checkbox">` with `role="switch"`: a 42×24 track that fills
accent with an 18px knob that slides across.

:::demo slide-toggle-basic

## Import

```ts
import SlideToggle from '@weave-framework/ui/slide-toggle';
```

```scss
@use 'pkg:@weave-framework/ui/slide-toggle';
```

## Basic usage

Bind it to a boolean signal with `checked` + `onChange`:

:::tabs
~~~html title="app.html"
<SlideToggle checked={{ on() }} onChange={{ setOn }} label={{ 'Notifications' }} />
<p>{{ on() ? 'On' : 'Off' }}</p>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import SlideToggle from '@weave-framework/ui/slide-toggle';

export function setup() {
  const on = signal(true);
  return { on, setOn: (v) => on.set(v) };
}
~~~
:::

## Checkbox or Slide Toggle?

They bind identically (both are `Field<boolean>` / `checked` + `onChange`) — the choice is about meaning:

- **Checkbox** — selecting items, agreeing to terms, anything submitted with a form.
- **Slide Toggle** — a setting that flips a mode *now* (dark mode, notifications on/off).

## Binding: signal or forms field

| Binding | What you pass |
| --- | --- |
| **Signal** | `checked` (a getter) + `onChange` |
| **Forms** | `control` — a `Field<boolean>` (wins over `checked`) |

```html
<SlideToggle control={{ form.controls.subscribe }} label={{ 'Subscribe to updates' }} />
```

## Accessibility

It carries `role="switch"`, so assistive tech announces it as an on/off switch (not a checkbox). Space toggles it,
it's in the tab order, and the `<label>` names it and makes the whole control clickable. `disabled` and `required`
are the native attributes.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `checked` | `boolean` | `false` | Controlled on/off state (getter). Ignored when `control` is set. |
| `onChange` | `(checked: boolean) => void` | — | Called with the next state on toggle. |
| `control` | `Field<boolean>` | — | A forms field — two-way + touched + aria-invalid. Wins over `checked`. |
| `disabled` | `boolean` | `false` | Disable the control. |
| `required` | `boolean` | `false` | Mark the native input required. |
| `label` | `string` | — | Visible label + accessible name. |
| `name` | `string` | — | Native `name` for form submission. |
| `class` | `string` | — | Extra classes forwarded onto the `<label>` root. |
