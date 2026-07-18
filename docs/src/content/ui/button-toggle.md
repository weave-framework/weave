# Button Toggle

A segmented control — a row of connected buttons where one (or, in multi mode, several) is switched on. Think view
switchers, text-formatting toggles, filter pills. `<ButtonToggle>` picks the right ARIA semantics for you depending
on the mode, so the keyboard and screen-reader behaviour is correct without any wiring.

:::demo button-toggle-single

## Import

```ts
import ButtonToggle from '@weave-framework/ui/button-toggle';
```

```scss
@use 'pkg:@weave-framework/ui/button-toggle';
```

## When to use it

For picking between a few mutually-exclusive options that are all worth showing at once (a Select hides them behind
a dropdown). For on/off formatting marks that combine, use multi mode. More than a handful of options, or long
labels? A [Select](/ui/select) or [Tabs](/ui/tabs) will read better.

## Single-select (default)

The default is a **radio group**: exactly one segment is on, and the `value` is that segment's key. It's a
controlled component — you pass `value` and update it in `onChange`:

:::tabs
~~~html title="app.html"
<ButtonToggle options={{ opts }} value={{ view() }} onChange={{ setView }} label={{ 'View' }} />
<p>Selected: {{ view() }}</p>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import ButtonToggle from '@weave-framework/ui/button-toggle';

export function setup() {
  const view = signal('list');
  const opts = [
    { value: 'list', label: 'List' },
    { value: 'grid', label: 'Grid' },
    { value: 'map', label: 'Map' },
  ];
  // onChange gives you the next value; you store it and pass it back in.
  return { opts, view, setView: (v) => view.set(v) };
}
~~~
:::

Each option is `{ value, label?, icon?, disabled? }` — `value` is the key `value`/`onChange` speak in, `label` is
the visible text (defaults to `value`), and `icon` is an optional leading icon — a name in the active
[Icon](/ui/icon) registry (lucide by default):

```html
<ButtonToggle options={{ [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
] }} value={{ theme() }} onChange={{ setTheme }} />
```

## Multi-select

Add `multiple` and it becomes a **toolbar of independent toggles** — any number can be on, and the `value` is an
**array** of the pressed keys. Perfect for bold / italic / underline:

:::demo button-toggle-multi

:::tabs
~~~html title="app.html"
<ButtonToggle multiple={{ true }} options={{ opts }} value={{ marks() }} onChange={{ setMarks }} label={{ 'Text style' }} />
<p>Active: {{ marks().join(', ') || 'none' }}</p>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import ButtonToggle from '@weave-framework/ui/button-toggle';

export function setup() {
  const marks = signal(['bold']);
  const opts = [
    { value: 'bold', label: 'B' },
    { value: 'italic', label: 'I' },
    { value: 'underline', label: 'U' },
  ];
  return { opts, marks, setMarks: (v) => marks.set(v) };
}
~~~
:::

## Disabling

Disable the whole group with `disabled`, or a single segment with `disabled` on its option — a disabled segment is
skipped in keyboard navigation and can't be selected:

```html
<ButtonToggle
  options={{ [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'year', label: 'Year', disabled: true },
  ] }}
  value={{ range() }}
  onChange={{ setRange }}
/>
```

## Accessibility

The mode decides the pattern, and the component implements it fully:

| Mode | Role | Selection state | Arrow keys |
| --- | --- | --- | --- |
| Single | `radiogroup` + `radio` segments | `aria-checked` | Move focus **and** selection (APG radio group). |
| Multi | `group` + buttons | `aria-pressed` | Move focus only; Space/Enter toggles the focused one. |

Either way you get a single tab stop (roving tabindex), horizontal Arrow navigation that wraps and skips disabled
segments, and selection state exposed on the native ARIA attribute. Give the group a `label` for its accessible name.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `options` | `ButtonToggleOption[]` | — | The segments, left to right. Each is `{ value, label?, icon?, disabled? }`. |
| `multiple` | `boolean` | `false` | Multi-select (toolbar) instead of single-select (radio group). |
| `value` | `string \| string[] \| null` | — | Controlled value — a key (single) or array of keys (multi). |
| `onChange` | `(value: string \| string[]) => void` | — | Called with the next value on select/toggle. |
| `disabled` | `boolean` | `false` | Disable the whole group. |
| `label` | `string` | — | Accessible name for the group. |
| `class` | `string` | — | Extra classes forwarded onto the container. |
