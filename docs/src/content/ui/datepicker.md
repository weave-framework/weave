# Datepicker

Pick a date from a calendar. `<Datepicker>` is a trigger field showing the formatted value plus a calendar icon;
clicking it opens a popover with a fully keyboard-driven day grid. The popover is **three drill-down views in one
panel** — click the "Month Year" header to jump to a **year grid** (pages of 24), pick a year to reach a **month
grid** (Jan–Dec), pick a month to land back on that month's day grid — so hopping across decades is a couple of
clicks, not dozens of month steps. All the date maths runs through a zero-dep date adapter, and the value is a plain
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

## Navigating years & months

The day view's header ("June 2026") is a button: click it (or press **Enter** on it) to open a **year grid** of 24
years — the ‹ / › buttons page by 24. Choose a year and the panel switches to a **month grid** (Jan–Dec, no paging
needed); choose a month and it opens that month's day calendar to pick the day. Everything stays in the one popover.
Years and months that fall entirely outside `min` / `max` are disabled in their grids. Each grid is fully keyboard
navigable (see [Accessibility](#accessibility)).

## Locale & format

The field's display uses `Intl` — set `displayFormat` (default `{ dateStyle: 'medium' }`) and `locale` for the
format, weekday names, and month/year text. Bring your own `adapter` if you need custom date logic.

```html
<Datepicker value={{ date() }} onChange={{ setDate }} locale={{ 'lt-LT' }} displayFormat={{ { dateStyle: 'long' } }} />
```

### First day of the week

`firstDayOfWeek` sets the weekday the grid starts on (`0` Sunday … `6` Saturday). It defaults to **Monday (`1`)** —
a deliberate component default, independent of the locale — so override it per instance when you want another:

```html
<Datepicker value={{ date() }} onChange={{ setDate }} firstDayOfWeek={{ 0 }} />
```

## Translating the chrome (`labels`)

Month, weekday and year *text* is localised by `locale` (Intl). The **chrome strings** — the nav buttons' accessible
names, the year-switch header, the dialog name, and the clear / open-calendar buttons — are English by default and
overridden via `labels` (a partial object; unset keys keep their default). Because props are reactive, the values can
be `t('…')` from [@weave-framework/i18n](/reference/i18n) and re-render on a locale change:

```html
<Datepicker
  value={{ date() }} onChange={{ setDate }} clearable={{ true }}
  labels={{ {
    prevMonth: t('cal.prevMonth'), nextMonth: t('cal.nextMonth'),
    prevYearRange: t('cal.prevYears'), nextYearRange: t('cal.nextYears'),
    chooseYear: t('cal.chooseYear'), calendarLabel: t('cal.title'),
    clear: t('cal.clear'), openCalendar: t('cal.open'),
  } }}
/>
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

The trigger is a combobox with `aria-haspopup`; each view is a `role="grid"` of `role="gridcell"` buttons. Open with
↓ / Enter / Space. In the **day** grid: **Arrows** move by day, **Page Up / Down** by month, **Shift + Page Up / Down**
by year, **Home / End** to the week edges. In the **year** grid: **Arrows** move within the page (a row is 4 years),
**Page Up / Down** jump a 24-year page, **Home / End** to the page edges. In the **month** grid: **Arrows** move
(a row is 3 months), **Home / End** to Jan / Dec. Everywhere, **Enter / Space** selects (drilling down a view or
committing the day) and **Esc** closes and returns focus. It's a non-modal popover (click-away also closes).

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
| `locale` | `string` | *(runtime)* | Locale for format / parse / month / weekday / year text. |
| `firstDayOfWeek` | `number` | `1` (Monday) | First weekday of the grid (`0` Sunday … `6` Saturday). |
| `labels` | `Partial<DatepickerLabels>` | *(English)* | Translated chrome strings (nav, year switch, dialog, clear, open). |
| `displayFormat` | `Intl.DateTimeFormatOptions` | `{ dateStyle: 'medium' }` | The field's display format. |
| `editable` | `boolean` | `false` | Swap the button trigger for a typeable input. |
| `placeholder` | `string` | — | Shown when nothing is selected. |
| `clearable` | `boolean` | `false` | Show a `×` clear button. |
| `disabled` | `boolean` | `false` | Disable the control. |
| `required` | `boolean` | `false` | Mark required (aria). |
| `label` | `string` | — | Accessible name (when not wrapped by a FormField). |
| `clearLabel` | `string` | `'Clear'` | Clear button's accessible name (superseded by `labels.clear`). |
| `position` | `MenuPosition` | `'bottom-start'` | Popover position relative to the field. |
| `class` | `string` | — | Extra classes forwarded onto the root. |

### `DatepickerLabels`

All optional; each defaults to the English string shown. `prevMonth` (`'Previous month'`), `nextMonth`
(`'Next month'`), `prevYearRange` (`'Previous years'`), `nextYearRange` (`'Next years'`), `chooseYear`
(`'Choose year'` — the year-switch header), `calendarLabel` (`'Choose date'` — the dialog name), `clear`
(`'Clear'`), `openCalendar` (`'Open calendar'` — editable mode icon button).
