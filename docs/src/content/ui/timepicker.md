# Timepicker

Pick a time of day. `<Timepicker>` is a trigger field showing the formatted time plus a clock icon; clicking it
opens a popover of **spinner columns** — hour ▲/▼, minute ▲/▼, and an AM/PM toggle on 12-hour locales. The value is
a neutral `{ hours, minutes }` (24-hour internally), so it's locale-independent.

:::demo timepicker-basic

## Import

```ts
import Timepicker from '@weave-framework/ui/timepicker';
```

```scss
@use '@weave-framework/ui/timepicker';
```

## Basic usage

Bind a `{ hours, minutes } | null` with `value` + `onChange`. `step` sets the minute increment (default 5):

:::tabs
~~~html title="app.html"
<Timepicker value={{ time() }} onChange={{ setTime }} step={{ 15 }} label={{ 'Time' }} clearable={{ true }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Timepicker from '@weave-framework/ui/timepicker';

export function setup() {
  const time = signal({ hours: 9, minutes: 30 }); // 24-hour, or null
  return { time, setTime: (v) => time.set(v) };
}
~~~
:::

The value is always 24-hour (`{ hours: 13, minutes: 0 }` is 1 PM) regardless of how it's displayed — so your data
stays unambiguous.

## Bounds & format

`min` / `max` clamp the committed time. 12- vs 24-hour display is derived from the `locale`; force it with `use24`:

```html
<Timepicker value={{ time() }} onChange={{ setTime }}
            min={{ { hours: 9, minutes: 0 } }} max={{ { hours: 17, minutes: 0 } }}
            use24={{ true }} />
```

## Binding & forms

`value` + `onChange`, or a forms `control` (`Field<TimeValue>`) that marks `touched` on close and drives the error
state. Compose with [FormField](/ui/form-field) for a label / hint / error.

```html
<Timepicker control={{ form.controls.start }} step={{ 15 }} />
```

## Accessibility

The trigger is a combobox; each spinner column is a `role="spinbutton"` with `aria-valuenow` / `aria-valuetext`.
Open with ↓ / Enter / Space; focus a column and use **Arrow Up / Down** to increment / decrement; **Esc** closes.
It's a non-modal popover (click-away also closes).

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `{ hours, minutes } \| null` | — | Controlled value (24-hour). Ignored when `control` is set. |
| `onChange` | `(value: TimeValue \| null) => void` | — | Called on change / clear. |
| `control` | `Field<TimeValue>` | — | A forms field — two-way + touched-on-close + error. Wins over `value`. |
| `min` / `max` | `TimeValue` | — | Earliest / latest selectable time (inclusive). |
| `step` | `number` | `5` | Minute increment. |
| `use24` | `boolean` | *(from locale)* | Force 24-hour display. |
| `locale` | `string` | *(runtime)* | Locale for the display format + 12/24h default. |
| `placeholder` | `string` | — | Shown when nothing is selected. |
| `clearable` | `boolean` | `false` | Show a `×` clear button. |
| `disabled` | `boolean` | `false` | Disable the control. |
| `required` | `boolean` | `false` | Mark required (aria). |
| `label` | `string` | — | Accessible name (when not wrapped by a FormField). |
| `position` | `MenuPosition` | `'bottom-start'` | Popover position relative to the field. |
| `class` | `string` | — | Extra classes forwarded onto the root. |
