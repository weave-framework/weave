# Select

Pick from a list that's too long to lay out — a dropdown that reads like a native `<select>` but looks like Weave
and does more. Under the hood it's a proper WAI-ARIA combobox: a trigger field showing the current choice, and a
`role="listbox"` panel that opens beneath it with full keyboard navigation and typeahead.

:::demo select-basic

## Import

```ts
import Select from '@weave-framework/ui/select';
```

```scss
@use 'pkg:@weave-framework/ui/select';
```

## Basic usage

Give it `options` and bind the selected value with `value` + `onChange`. With the default option shape
(`{ value, label }`) there's nothing else to wire:

:::tabs
~~~html title="app.html"
<Select options={{ options }} value={{ country() }} onChange={{ setCountry }} label={{ 'Country' }} placeholder={{ 'Pick a country' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Select from '@weave-framework/ui/select';

export function setup() {
  const country = signal('lt');
  const options = [
    { value: 'lt', label: 'Lithuania' },
    { value: 'lv', label: 'Latvia' },
    { value: 'ee', label: 'Estonia' },
  ];
  return { options, country, setCountry: (v) => country.set(v) };
}
~~~
:::

`placeholder` shows when nothing is selected; `label` names the control when it isn't wrapped in a
[FormField](/ui/form-field). With an empty `options` list the panel won't open — there's nothing to show.

## Any option shape

Your options don't have to be `{ value, label }` — point the accessors at whatever fields your data has. Plain
strings work with no accessors at all:

```html
<!-- arbitrary objects -->
<Select options={{ countries }}
        optionValue={{ (c) => c.code }}
        optionLabel={{ (c) => c.name }}
        optionDescription={{ (c) => c.region }}
        value={{ code() }} onChange={{ setCode }} />

<!-- plain strings -->
<Select options={{ ['Small', 'Medium', 'Large'] }} value={{ size() }} onChange={{ setSize }} />
```

`optionDescription` adds a subtext line under each option; `optionDisabled` greys and skips one. By default the
value emitted is the option's *value*; pass `emit="object"` to get the whole selected object back in `onChange`.

## Multiple

`multiple` lets you pick several — the panel stays open, selected options are check-marked, and the value becomes
an **array**. The field shows the one label while a single option is picked, and summarises as `"N selected"` once
there's more than one:

:::demo select-multiple

:::tabs
~~~html title="app.html"
<Select multiple={{ true }} options={{ options }} value={{ langs() }} onChange={{ setLangs }} label={{ 'Languages' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Select from '@weave-framework/ui/select';

export function setup() {
  const langs = signal(['ts']);
  const options = [
    { value: 'ts', label: 'TypeScript' },
    { value: 'js', label: 'JavaScript' },
    { value: 'rs', label: 'Rust' },
    { value: 'go', label: 'Go' },
  ];
  return { options, langs, setLangs: (v) => langs.set(v) };
}
~~~
:::

## Binding, clearable & more

Same two dialects as every Weave control — `value` + `onChange`, or a forms `control` (a `Field`) that also marks
`touched` on close and drives the error state. Add `clearable={{ true }}` for an inline clear button that appears
once something is selected and empties the selection (name it with `clearLabel`), plus `disabled`, `required`, and
`position` to place the panel:

```html
<Select control={{ form.controls.country }} options={{ countries }} clearable={{ true }} required={{ true }} />
```

Like [Input](/ui/input), the trigger has `prefix` / `suffix` slots for an icon.

## Accessibility

It implements the APG combobox/listbox pattern: the trigger is `role="combobox"` with `aria-haspopup="listbox"`
and `aria-expanded`; the panel is a `role="listbox"` (with `aria-multiselectable` in multi mode); the active option
is tracked with `aria-activedescendant` while focus stays on the trigger. Open with ↓/Enter/Space, move with the
arrows (or **typeahead** — start typing a label), select with Enter/Space, close with Esc.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `options` | `T[]` | — | The options (default shape, strings, or objects via accessors). |
| `multiple` | `boolean` | `false` | Allow multiple selection (value becomes an array). |
| `value` | `SelectValue<T>` | — | Controlled value. Ignored when `control` is set. |
| `onChange` | `(value: SelectValue<T>) => void` | — | Called with the next value. |
| `control` | `Field` | — | A forms field — two-way + touched-on-close + error state. Wins over `value`. |
| `optionValue` | `(o: T) => string` | `o.value` | Pick the value field. |
| `optionLabel` | `(o: T) => string` | `o.label ?? o.value` | Pick the display field. |
| `optionDescription` | `(o: T) => string \| undefined` | `o.description` | Optional subtext per option. |
| `optionDisabled` | `(o: T) => boolean` | `o.disabled` | Disable individual options. |
| `emit` | `'value' \| 'object'` | `'value'` | Emit the option's value or the whole object. |
| `placeholder` | `string` | — | Shown when nothing is selected. |
| `clearable` | `boolean` | `false` | Show an inline clear button while something is selected. |
| `disabled` | `boolean` | `false` | Disable the control. |
| `required` | `boolean` | `false` | Mark required (aria). |
| `label` | `string` | — | Accessible name (when not wrapped by a FormField). |
| `clearLabel` | `string` | `'Clear'` | Accessible name for the clear button. |
| `position` | `MenuPosition` | `'bottom-start'` | Panel position relative to the trigger. |
| `class` | `string` | — | Extra classes forwarded onto the root. |
