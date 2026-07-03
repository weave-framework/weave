# Datepicker

Pick a date from a calendar. `<Datepicker>` is a trigger field showing the formatted value plus a calendar icon;
clicking it opens a `role="grid"` month view in a popover with month navigation, a locale weekday header, and a
fully keyboard-driven day grid. All the date maths runs through a zero-dep date adapter, and the value is a plain
local-midnight `Date`.

:::demo datepicker-basic

## Import

```ts
import Datepicker from '@weave-framework/ui/datepicker';
```

```scss
@use '@weave-framework/ui/datepicker';
```

## Basic usage

Bind a `Date | null` with `value` + `onChange`. `placeholder` shows when nothing is picked; `clearable={{ true }}`
adds a `×` to reset it:

:::tabs
~~~html title="app.html"
<Datepicker value={{ date() }} onChange={{ setDate }} label={{ 'Date' }} placeholder={{ 'Pick a date' }} clearable={{ true }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Datepicker from '@weave-framework/ui/datepicker';

export function setup() {
  const date = signal(null); // Date | null
  return { date, setDate: (v) => date.set(v) };
}
~~~
:::

## Bounds & filtering

`min` / `max` mark the selectable range (inclusive), and `dateFilter` disables individual days — a weekends-off
picker, say:

```html
<Datepicker
  value={{ date() }} onChange={{ setDate }}
  min={{ new Date(2020, 0, 1) }} max={{ new Date() }}
  dateFilter={{ (d) => d.getDay() !== 0 && d.getDay() !== 6 }}
/>
```

## Locale & format

The field's display uses `Intl` — set `displayFormat` (default `{ dateStyle: 'medium' }`) and `locale` for the
format, weekday names, and first day of week. Bring your own `adapter` if you need custom date logic.

```html
<Datepicker value={{ date() }} onChange={{ setDate }} locale={{ 'lt-LT' }} displayFormat={{ { dateStyle: 'long' } }} />
```

## Typeable field

By default the field is a button that only opens the calendar. Set `editable={{ true }}` to swap in a typeable
input-as-combobox — the user can type a date (parsed via the adapter) or open the calendar; an unparseable entry
flags `aria-invalid`.

## Binding & forms

The usual two dialects — `value` + `onChange`, or a forms `control` (`Field<Date>`) that marks `touched` on close
and drives the error state. Compose with [FormField](/ui/form-field) for a label / hint / error line.

```html
<Datepicker control={{ form.controls.dob }} max={{ new Date() }} />
```

## Accessibility

The trigger is a combobox with `aria-haspopup`; the calendar is a `role="grid"` of `role="gridcell"` days. Open with
↓ / Enter / Space; then **Arrows** move by day, **Page Up / Down** by month, **Shift + Page Up / Down** by year,
**Home / End** to the week edges, **Enter / Space** selects, **Esc** closes and returns focus. It's a non-modal
popover (click-away also closes).

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `Date \| null` | — | Controlled value. Ignored when `control` is set. |
| `onChange` | `(value: Date \| null) => void` | — | Called on selection / clear. |
| `control` | `Field<Date>` | — | A forms field — two-way + touched-on-close + error. Wins over `value`. |
| `min` / `max` | `Date` | — | Earliest / latest selectable date (inclusive). |
| `dateFilter` | `(date: Date) => boolean` | — | Return `false` to disable a specific date. |
| `adapter` | `DateAdapter` | *(from locale)* | Bring your own date adapter. |
| `locale` | `string` | *(runtime)* | Locale for format / parse / names / first day. |
| `displayFormat` | `Intl.DateTimeFormatOptions` | `{ dateStyle: 'medium' }` | The field's display format. |
| `editable` | `boolean` | `false` | Swap the button trigger for a typeable input. |
| `placeholder` | `string` | — | Shown when nothing is selected. |
| `clearable` | `boolean` | `false` | Show a `×` clear button. |
| `disabled` | `boolean` | `false` | Disable the control. |
| `required` | `boolean` | `false` | Mark required (aria). |
| `label` | `string` | — | Accessible name (when not wrapped by a FormField). |
| `position` | `MenuPosition` | `'bottom-start'` | Popover position relative to the field. |
| `class` | `string` | — | Extra classes forwarded onto the root. |
