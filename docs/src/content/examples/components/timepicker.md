# Timepicker — examples

Every feature of `<Timepicker>`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [Timepicker reference page](/ui/timepicker); this page is just the examples,
covering the full component surface. The value is always a neutral `{ hours, minutes }` (24-hour internally), so
it stays unambiguous regardless of how it's displayed.

```ts
import Timepicker from '@weave-framework/ui/timepicker';
```
```scss
@use '@weave-framework/ui/timepicker';
```

## Basic — value + onChange

The trigger field bound two-way to a signal. Clicking it opens the spinner popover; the value is a
`{ hours, minutes } | null`.

:::demo ex-timepicker-basic

:::tabs
~~~html title="app.html"
<Timepicker value={{ time() }} onChange={{ setTime }} label={{ 'Time' }} />
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

## Step

`step` sets the minute increment used by the spinner (default 5). Here each ▲/▼ moves the minutes by 15.

:::demo ex-timepicker-step

:::tabs
~~~html title="app.html"
<Timepicker value={{ time() }} onChange={{ setTime }} step={{ 15 }} label={{ 'Slot' }} />
~~~
:::

## Placeholder

With a `null` value the `placeholder` text shows in the field until a time is picked.

:::demo ex-timepicker-placeholder

:::tabs
~~~html title="app.html"
<Timepicker value={{ time() }} onChange={{ setTime }} placeholder={{ 'Pick a time…' }} label={{ 'Start' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Timepicker from '@weave-framework/ui/timepicker';

export function setup() {
  const time = signal(null);
  return { time, setTime: (v) => time.set(v) };
}
~~~
:::

## Clearable

`clearable` adds a `×` button (accessible name from `clearLabel`, default `'Clear'`) that resets the value
to `null`.

:::demo ex-timepicker-clearable

:::tabs
~~~html title="app.html"
<Timepicker value={{ time() }} onChange={{ setTime }} clearable={{ true }} clearLabel={{ 'Clear time' }} label={{ 'Reminder' }} />
~~~
:::

## Bounds — min & max

`min` / `max` clamp the committed time; the spinner can't leave the range. Here the field stays within
09:00–17:00.

:::demo ex-timepicker-bounds

:::tabs
~~~html title="app.html"
<Timepicker value={{ time() }} onChange={{ setTime }} min={{ min }} max={{ max }} label={{ 'Office hours' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Timepicker from '@weave-framework/ui/timepicker';

export function setup() {
  const time = signal({ hours: 12, minutes: 0 });
  const min = { hours: 9, minutes: 0 };
  const max = { hours: 17, minutes: 0 };
  return { time, setTime: (v) => time.set(v), min, max };
}
~~~
:::

## Format — locale & use24

12- vs 24-hour display is derived from `locale`, or forced with `use24`. Both fields below share the same
signal — only the display differs; the stored value is always 24-hour.

:::demo ex-timepicker-format

:::tabs
~~~html title="app.html"
<Timepicker value={{ time() }} onChange={{ setTime }} locale={{ 'en-US' }} label={{ '12-hour (en-US)' }} />
<Timepicker value={{ time() }} onChange={{ setTime }} use24={{ true }} label={{ 'Forced 24-hour' }} />
~~~
:::

## States — disabled & required

`disabled` makes the field inert (no popover, `tabindex="-1"`); `required` marks it via aria.

:::demo ex-timepicker-states

:::tabs
~~~html title="app.html"
<Timepicker value={{ a() }} onChange={{ setA }} disabled={{ true }} label={{ 'Disabled' }} />
<Timepicker value={{ b() }} onChange={{ setB }} required={{ true }} placeholder={{ 'Required' }} label={{ 'Required' }} />
~~~
:::

## Position

`position` chooses where the popover opens relative to the field. Here it opens upward with `'top-start'`.

:::demo ex-timepicker-position

:::tabs
~~~html title="app.html"
<Timepicker value={{ time() }} onChange={{ setTime }} position={{ 'top-start' }} label={{ 'Opens upward' }} />
~~~
:::

## Custom class

`class` is forwarded onto the root, so you can widen or restyle a single instance.

:::demo ex-timepicker-class

:::tabs
~~~html title="app.html"
<Timepicker value={{ time() }} onChange={{ setTime }} class={{ 'tp-wide' }} label={{ 'Full-width' }} />

<style>
  .tp-wide { width: 100%; font-weight: 600; }
</style>
~~~
:::

## Forms control + validation

Bind a forms `Field<TimeValue>` with `control`: two-way value, touched-on-close, and the error state. The
message shows only once the field is `touched` — open the picker then click away without choosing.

:::demo ex-timepicker-control

:::tabs
~~~html title="app.html"
<FormField label={{ 'Start time' }} error={{ startError() }}>
  <Timepicker control={{ start }} required={{ true }} placeholder={{ 'Pick a time…' }} />
</FormField>
~~~
~~~ts title="app.ts"
import { field, validators } from '@weave-framework/forms';

export function setup() {
  const start = field(null, [validators.required('Pick a start time')]);
  const startError = () => (start.touched() ? start.error() ?? '' : '');
  return { start, startError };
}
~~~
:::
