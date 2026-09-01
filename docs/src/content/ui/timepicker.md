# Timepicker

Pick a time of day. `<Timepicker>` is a trigger field showing the formatted time plus a clock icon; clicking it
opens a popover of **spinner columns** — an hour column and a minute column, each with an increment and a decrement
chevron, plus an AM/PM toggle on 12-hour locales. The value is a neutral `{ hours, minutes }` (24-hour internally),
so it's locale-independent.

:::demo timepicker-basic

## Import

```ts
import Timepicker from '@weave-framework/ui/timepicker';
```

```scss
@use 'pkg:@weave-framework/ui/timepicker';
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

Opening the panel with no value yet seeds the spinners from the current time, rounded to `step` and clamped into
`min` / `max` — nothing is committed until you actually spin a column.

## App-wide defaults

12/24h and the minute step are usually a system setting, not a per-field choice. Set them once at the app root with
`provideDateTimeDefaults` and every `<Timepicker>` below picks them up:

```ts
import { provideDateTimeDefaults } from '@weave-framework/ui';

provideDateTimeDefaults({
  locale: () => locale(),                                     // shared with the date pickers
  timepicker: () => ({ use24: timeFormat() === '24h', step: timeStep(), clearLabel: t('common.clear') }),
});
```

A `use24` / `step` / `clearLabel` prop on an individual field still wins, and an app that provides nothing behaves
exactly as before. Because the values are read through getters, flipping the setting updates fields that are already
mounted. See [Datepicker → App-wide defaults](/ui/datepicker) for the full contract.

## Binding & forms

`value` + `onChange`, or a forms `control` (`Field<TimeValue>`) that marks `touched` on close and drives the error
state. Compose with [FormField](/ui/form-field) for a label / hint / error.

```html
<Timepicker control={{ form.controls.start }} step={{ 15 }} />
```

## Accessibility

The trigger is a `role="combobox"` and the panel a `role="dialog"` labelled "Choose time"; each spinner column is a
`role="spinbutton"` with `aria-valuenow` / `aria-valuetext` and its own min/max. Open with **Arrow Down / Enter /
Space**; focus a column and use **Arrow Up / Down** to increment / decrement; **Esc** closes. It's a non-modal
popover (click-away also closes).

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `{ hours, minutes } \| null` | — | Controlled value (24-hour). Ignored when `control` is set. |
| `onChange` | `(value: TimeValue \| null) => void` | — | Called on change / clear. Ignored when `control` is set. |
| `control` | `Field<TimeValue>` | — | A forms field — two-way + touched-on-close + error. Wins over `value`. |
| `min` / `max` | `TimeValue` | — | Earliest / latest selectable time (inclusive). |
| `step` | `number` | `5` | Minute increment. |
| `use24` | `boolean` | *(from locale)* | Force 24-hour display. |
| `locale` | `string` | *(runtime)* | Locale for the display format + 12/24h default. |
| `placeholder` | `string` | — | Shown when nothing is selected. |
| `clearable` | `boolean` | `false` | Show an inline clear button once a time is set. |
| `clearLabel` | `string` | `'Clear'` | Accessible name for the clear button. |
| `disabled` | `boolean` | `false` | Disable the control. |
| `required` | `boolean` | `false` | Mark required (aria). |
| `label` | `string` | — | Accessible name (when not wrapped by a FormField). |
| `position` | `MenuPosition` | `'bottom-start'` | Popover position relative to the field. |
| `class` | `string` | — | Extra classes forwarded onto the root. |

<!-- gen-ui-types:begin -->
### Types

~~~ts
import type { TimeValue, TimepickerControl, TimepickerProps, TimepickerContext } from '@weave-framework/ui/timepicker';
~~~
<!-- gen-ui-types:end -->

## When it goes wrong

:::callout trap "It shows a value and your form never hears about it"
Every input-like component takes a `control`. Without one it is an ordinary uncontrolled element: it
displays, it accepts typing, and it reports nothing — so `valid()` stays true and Submit sends an empty
field.

~~~html
<Timepicker control={{ startsAt }} />
~~~

See [Forms](/learn/forms) for what a control carries: value, touched, dirty, error and the validation
timing that decides when a message is shown.
:::

**It renders unstyled.** The stylesheet is a separate import per component —
`@use 'pkg:@weave-framework/ui/timepicker';` in your Sass. Correct markup with no styling is always this.

**The error message never appears.** An error is set from the first keystroke; `touched` decides whether
it is *shown*. If Submit seems to do nothing on an empty form, call `touchAll()` on the group first.
