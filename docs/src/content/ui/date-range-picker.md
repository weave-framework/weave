# DateRangePicker

Pick a **date range** from a calendar. `<DateRangePicker>` is a trigger field showing the formatted `start – end`
plus a calendar icon; clicking it opens the same popover as [Datepicker](/ui/datepicker) — a fully keyboard-driven
day grid with the **three drill-down views** (day → year grid → month grid) — so the two share one calendar engine.
Selecting a range is **two clicks**: the first sets the anchor, the second completes it (the ends are ordered for
you). While you pick the end, hovering previews the span. The value is a plain `{ start, end }` of local-midnight
`Date`s.

:::demo date-range-picker-basic

## Import

```ts
import DateRangePicker from '@weave-framework/ui/date-range-picker';
```

```scss
@use '@weave-framework/ui/date-range-picker';
```

## Basic usage

Bind a `DateRange | null` (i.e. `{ start: Date | null, end: Date | null }`) with `value` + `onChange`. The value
only commits on the **second** click; closing the popover early keeps the previous range. `placeholder` shows when
nothing is picked; `clearable={{ true }}` adds a `×` to reset it:

:::tabs
~~~html title="app.html"
<DateRangePicker value={{ range() }} onChange={{ setRange }} label={{ 'Stay' }} placeholder={{ 'Pick a range' }} clearable={{ true }} />
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

## Selecting a range

The first click on a day sets the range's **anchor** (accent-filled) and the popover stays open. The second click
completes the range — click a day after the anchor and it becomes the end; click a day *before* it and the two swap,
so `start ≤ end` always. While you are picking the end, hovering a day **previews** the span (a tinted band with a
dashed ring on the tentative end). Press **Esc** or click away before the second click and the pending selection is
discarded — the committed value is unchanged.

## Bounds & filtering

`min` / `max` mark the selectable range (inclusive), and `dateFilter` disables individual days:

```html
<DateRangePicker
  value={{ range() }} onChange={{ setRange }}
  min={{ new Date() }}
  dateFilter={{ (d) => d.getDay() !== 0 && d.getDay() !== 6 }}
/>
```

## Navigating years & months

The day view's header ("June 2026") is a button: click it (or press **Enter**) to open a **year grid** of 24 years —
the ‹ / › buttons page by 24. Choose a year for a **month grid** (Jan–Dec), then a month to land on that month's day
calendar. Years and months entirely outside `min` / `max` are disabled. Every grid is fully keyboard navigable
(see [Accessibility](#accessibility)).

## Locale & format

The field's display uses `Intl` — set `displayFormat` (default `{ dateStyle: 'medium' }`, applied to both ends) and
`locale` for the format, weekday names, and month/year text. `separator` (default `' – '`) sits between the two
formatted dates. Bring your own `adapter` for custom date logic.

```html
<DateRangePicker value={{ range() }} onChange={{ setRange }} locale={{ 'lt-LT' }} separator={{ ' iki ' }} />
```

### First day of the week

`firstDayOfWeek` sets the weekday the grid starts on (`0` Sunday … `6` Saturday). It defaults to **Monday (`1`)** — a
deliberate component default, independent of the locale:

```html
<DateRangePicker value={{ range() }} onChange={{ setRange }} firstDayOfWeek={{ 0 }} />
```

## Translating the chrome (`labels`)

Month, weekday and year *text* is localised by `locale` (Intl). The **chrome strings** — the nav buttons' accessible
names, the year-switch header, the dialog name, and the clear button — are English by default and overridden via
`labels` (a partial object; unset keys keep their default). Because props are reactive, the values can be `t('…')`
from [@weave-framework/i18n](/reference/i18n):

```html
<DateRangePicker
  value={{ range() }} onChange={{ setRange }} clearable={{ true }}
  labels={{ {
    prevMonth: t('cal.prevMonth'), nextMonth: t('cal.nextMonth'),
    prevYearRange: t('cal.prevYears'), nextYearRange: t('cal.nextYears'),
    chooseYear: t('cal.chooseYear'), calendarLabel: t('cal.rangeTitle'),
    clear: t('cal.clear'),
  } }}
/>
```

## Binding & forms

The usual two dialects — `value` + `onChange`, or a forms `control` (`Field<DateRange>`) that marks `touched` on
close and drives the error state. Compose with [FormField](/ui/form-field) for a label / hint / error line.

```html
<DateRangePicker control={{ form.controls.stay }} min={{ new Date() }} />
```

## Accessibility

The trigger is a combobox with `aria-haspopup`; each view is a `role="grid"` of `role="gridcell"` buttons. Open with
↓ / Enter / Space. In the **day** grid: **Arrows** move by day, **Page Up / Down** by month, **Shift + Page Up / Down**
by year, **Home / End** to the week edges. In the **year** grid: **Arrows** move within the page (a row is 4 years),
**Page Up / Down** jump a 24-year page. In the **month** grid: **Arrows** move (a row is 3 months). Everywhere,
**Enter / Space** selects (drilling down a view, or setting the anchor / completing the range) and **Esc** closes and
returns focus. It's a non-modal popover (click-away also closes and discards a half-picked range).

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `DateRange \| null` | — | Controlled value (`{ start, end }`). Ignored when `control` is set. |
| `onChange` | `(value: DateRange \| null) => void` | — | Called when a range completes / clears. |
| `control` | `Field<DateRange>` | — | A forms field — two-way + touched-on-close + error. Wins over `value`. |
| `min` / `max` | `Date` | — | Earliest / latest selectable date (inclusive). |
| `dateFilter` | `(date: Date) => boolean` | — | Return `false` to disable a specific date. |
| `adapter` | `DateAdapter` | *(from locale)* | Bring your own date adapter. |
| `locale` | `string` | *(runtime)* | Locale for format / month / weekday / year text. |
| `firstDayOfWeek` | `number` | `1` (Monday) | First weekday of the grid (`0` Sunday … `6` Saturday). |
| `labels` | `Partial<DateRangePickerLabels>` | *(English)* | Translated chrome strings (nav, year switch, dialog, clear). |
| `displayFormat` | `Intl.DateTimeFormatOptions` | `{ dateStyle: 'medium' }` | The field's display format (both ends). |
| `separator` | `string` | `' – '` | Sits between the two formatted dates in the field. |
| `placeholder` | `string` | — | Shown when nothing is selected. |
| `clearable` | `boolean` | `false` | Show a `×` clear button. |
| `disabled` | `boolean` | `false` | Disable the control. |
| `required` | `boolean` | `false` | Mark required (aria). |
| `label` | `string` | — | Accessible name (when not wrapped by a FormField). |
| `clearLabel` | `string` | `'Clear'` | Clear button's accessible name (superseded by `labels.clear`). |
| `position` | `MenuPosition` | `'bottom-start'` | Popover position relative to the field. |
| `class` | `string` | — | Extra classes forwarded onto the root. |

### `DateRange`

`{ start: Date \| null; end: Date \| null }`. A committed value always has both ends; `null` means "no range".

### `DateRangePickerLabels`

All optional; each defaults to the English string shown. `prevMonth` (`'Previous month'`), `nextMonth`
(`'Next month'`), `prevYearRange` (`'Previous years'`), `nextYearRange` (`'Next years'`), `chooseYear`
(`'Choose year'`), `calendarLabel` (`'Choose date range'` — the dialog name), `clear` (`'Clear'`).
