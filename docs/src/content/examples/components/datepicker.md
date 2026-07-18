# Datepicker — examples

Every feature of `<Datepicker>`, each as a live, self-contained example you can read and lift straight
into your project. The prose lives on the [Datepicker reference page](/ui/datepicker); this page is just
the examples, covering the full component surface. The value is a plain local-midnight `Date | null`.

```ts
import Datepicker from '@weave-framework/ui/datepicker';
```
```scss
@use 'pkg:@weave-framework/ui/datepicker';
```

## Basic — value + onChange

The trigger field opens a calendar popover; bind a `Date | null` two-way with `value` + `onChange`.
`placeholder` shows when nothing is picked, `label` names the field for assistive tech.

:::demo ex-datepicker-basic

:::tabs
~~~html title="app.html"
<Datepicker value={{ date() }} onChange={{ setDate }} label={{ 'Date' }} placeholder={{ 'Pick a date' }} />
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

## Clearable

`clearable` shows a clear button (a lucide `x` icon) once a date is set; it resets the value to `null` and re-focuses the
field. `clearLabel` names that button.

:::demo ex-datepicker-clearable

:::tabs
~~~html title="app.html"
<Datepicker value={{ date() }} onChange={{ setDate }} label={{ 'Date' }} clearable={{ true }} clearLabel={{ 'Reset date' }} />
~~~
:::

## Bounds — min & max

`min` and `max` (both inclusive) disable out-of-range days in the calendar. Here only the current month
is selectable.

:::demo ex-datepicker-bounds

:::tabs
~~~html title="app.html"
<Datepicker value={{ date() }} onChange={{ setDate }} min={{ min }} max={{ max }} label={{ 'This month only' }} placeholder={{ 'Pick a day' }} />
~~~
~~~ts title="app.ts"
export function setup() {
  const now = new Date();
  const min = new Date(now.getFullYear(), now.getMonth(), 1);
  const max = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const date = signal(null);
  return { date, setDate: (v) => date.set(v), min, max };
}
~~~
:::

## Filtering — dateFilter

`dateFilter` is a predicate: return `false` to disable a specific day. Here weekends are excluded.

:::demo ex-datepicker-filter

:::tabs
~~~html title="app.html"
<Datepicker value={{ date() }} onChange={{ setDate }} dateFilter={{ isWeekday }} label={{ 'Weekdays only' }} placeholder={{ 'Pick a weekday' }} />
~~~
~~~ts title="app.ts"
export function setup() {
  const date = signal(null);
  const isWeekday = (d) => d.getDay() !== 0 && d.getDay() !== 6;
  return { date, setDate: (v) => date.set(v), isWeekday };
}
~~~
:::

## Display format & locale

`displayFormat` takes `Intl.DateTimeFormatOptions` for the field text (default `{ dateStyle: 'medium' }`);
`locale` drives the default adapter — its format/parse, weekday names, and first day of week.

:::demo ex-datepicker-format

:::tabs
~~~html title="app.html"
<Datepicker value={{ date() }} onChange={{ setDate }} displayFormat={{ fullFormat }} locale={{ 'en-GB' }} label={{ 'Formatted date' }} />
~~~
~~~ts title="app.ts"
export function setup() {
  const date = signal(new Date());
  const fullFormat = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  return { date, setDate: (v) => date.set(v), fullFormat };
}
~~~
:::

## Editable — typeable combobox

`editable` swaps the button trigger for a typeable input-as-combobox: type a date (parsed via the
adapter) or click the calendar icon to open the picker. Unparseable text is flagged `aria-invalid`.

:::demo ex-datepicker-editable

:::tabs
~~~html title="app.html"
<Datepicker value={{ date() }} onChange={{ setDate }} editable={{ true }} label={{ 'Type or pick' }} placeholder={{ 'e.g. Jan 5, 2026' }} clearable={{ true }} />
~~~
:::

## Panel position

`position` chooses where the calendar opens relative to the field (default `'bottom-start'`). Here it
opens upward with `'top-start'`.

:::demo ex-datepicker-position

:::tabs
~~~html title="app.html"
<Datepicker value={{ date() }} onChange={{ setDate }} position={{ 'top-start' }} label={{ 'Opens upward' }} placeholder={{ 'Pick a date' }} />
~~~
:::

## States — disabled & required

`disabled` blocks interaction; `required` sets `aria-required` for assistive tech.

:::demo ex-datepicker-states

:::tabs
~~~html title="app.html"
<Datepicker value={{ a() }} onChange={{ setA }} disabled={{ true }} label={{ 'Disabled' }} />
<Datepicker value={{ b() }} onChange={{ setB }} required={{ true }} label={{ 'Required' }} placeholder={{ 'Required date' }} />
~~~
:::

## Forms control + validation

Bind a forms `Field<Date | null>` with `control`: two-way value, touched-on-close, and the error
underline. The message shows only once the field is `touched` — open then close without picking. `max`
caps the birthday at today.

:::demo ex-datepicker-control

:::tabs
~~~html title="app.html"
<FormField label={{ 'Date of birth' }} error={{ dobError() }}>
  <Datepicker control={{ dob }} max={{ today }} placeholder={{ 'Pick your birthday' }} clearable={{ true }} />
</FormField>
~~~
~~~ts title="app.ts"
import { field, validators } from '@weave-framework/forms';

export function setup() {
  const today = new Date();
  const dob = field(null, [validators.required('Date of birth is required')]); // Field<Date | null>
  const dobError = () => (dob.touched() ? dob.error() ?? '' : '');
  return { dob, today, dobError };
}
~~~
:::
