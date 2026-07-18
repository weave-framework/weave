# DateRangePicker — examples

Live, self-contained examples of `<DateRangePicker>` you can read and lift straight into your project. The prose lives
on the [DateRangePicker reference page](/ui/date-range-picker); this page is just the examples. The value is a plain
`DateRange | null` — `{ start: Date | null, end: Date | null }`.

```ts
import DateRangePicker from '@weave-framework/ui/date-range-picker';
```
```scss
@use 'pkg:@weave-framework/ui/date-range-picker';
```

## Basic — value + onChange

The trigger field opens a calendar popover; bind a `DateRange | null` two-way with `value` + `onChange`. Selecting is
two clicks (anchor → end, auto-ordered); hovering previews the span. `placeholder` shows when nothing is picked.

:::demo ex-date-range-picker-basic

:::tabs
~~~html title="app.html"
<DateRangePicker value={{ range() }} onChange={{ setRange }} label={{ 'Range' }} placeholder={{ 'Pick a date range' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import DateRangePicker from '@weave-framework/ui/date-range-picker';

export function setup() {
  const range = signal(null); // { start, end } | null
  return { range, setRange: (v) => range.set(v) };
}
~~~
:::

## Bounds & filtering

`min` / `max` cap the selectable range (inclusive); `dateFilter` disables individual days. Here: weekdays from today.

:::demo ex-date-range-picker-bounds

~~~html title="app.html"
<DateRangePicker
  value={{ range() }} onChange={{ setRange }}
  min={{ today }} dateFilter={{ (d) => d.getDay() !== 0 && d.getDay() !== 6 }}
  label={{ 'Weekdays from today' }}
/>
~~~

## Forms — `control`

Bind a forms `Field<DateRange | null>` with `control`: two-way value, `touched` on close, and the error underline.
Compose with [FormField](/ui/form-field) for the label / error line.

:::demo ex-date-range-picker-control

:::tabs
~~~html title="app.html"
<FormField label={{ 'Your stay' }} error={{ stayError() }}>
  <DateRangePicker control={{ stay }} min={{ today }} placeholder={{ 'Check-in – Check-out' }} clearable={{ true }} />
</FormField>
~~~
~~~ts title="app.ts"
import { field, validators } from '@weave-framework/forms';

export function setup() {
  const stay = field(null, [validators.required('Please choose your stay')]);
  const stayError = () => (stay.touched() ? stay.error() ?? '' : '');
  return { stay, today: new Date(), stayError };
}
~~~
:::
