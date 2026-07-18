# Autocomplete

A text field that suggests as you type. It's an [Input](/ui/input) — the same underline field, clear button and
value binding — with a `role="listbox"` of matching options that opens beneath it. Focus
stays in the field; the active suggestion is tracked with `aria-activedescendant` (the WAI-ARIA combobox +
`aria-autocomplete="list"` pattern). Free text is allowed, and the data can be static or fetched from an API.

:::demo autocomplete-basic

## Import

```ts
import Autocomplete from '@weave-framework/ui/autocomplete';
```

```scss
@use 'pkg:@weave-framework/ui/autocomplete';
```

> Autocomplete **composes** the real `<Input>` component — you don't import Input yourself; the field, its
> underline, clear button and value binding are Input's, so the two stay identical by construction. It renders
> that Input with no children, so Input's `prefix` / `suffix` slots aren't reachable through Autocomplete.

## Basic usage

Give it `options` and an `onSelect` callback. By default suggestions are the options whose label contains the
typed text (case-insensitive); picking one fills the field with its label and fires `onSelect(item)`:

:::tabs
~~~html title="app.html"
<Autocomplete options={{ options }} onSelect={{ onSelect }} label={{ 'Framework' }} placeholder={{ 'Type to search…' }} clearable={{ true }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Autocomplete from '@weave-framework/ui/autocomplete';

export function setup() {
  const chosen = signal('');
  const options = [
    { value: 'ng', label: 'Angular' },
    { value: 'rc', label: 'React' },
    { value: 'wv', label: 'Weave' },
  ];
  return { options, chosen, onSelect: (item) => chosen.set(item.label) };
}
~~~
:::

`label` names the control when it isn't wrapped in a [FormField](/ui/form-field); `minChars` (default `1`) sets how
many characters open the panel.

## Any option shape

Like [Select](/ui/select), the options don't have to be `{ value, label }` — point the accessors at your data's
fields. Plain strings work with no accessors:

```html
<!-- arbitrary objects -->
<Autocomplete options={{ users }}
              optionValue={{ (u) => u.id }}
              optionLabel={{ (u) => u.name }}
              optionDescription={{ (u) => u.email }}
              onSelect={{ pick }} />

<!-- plain strings -->
<Autocomplete options={{ ['Small', 'Medium', 'Large'] }} onSelect={{ pick }} />
```

`optionDescription` adds a subtext line under each suggestion.

## Async / dynamic data

Pass `optionsFor(query)` instead of `options` to fetch suggestions — return an array, or a `Promise` for a real API
call. A promise fills a reactive cache, so the panel re-renders when results land, and out-of-order responses are
ignored (the latest query wins):

```html
<Autocomplete optionsFor={{ searchCities }} onSelect={{ pick }} placeholder={{ 'Search cities…' }} />
```

```ts
async function searchCities(query: string) {
  const res = await fetch(`/api/cities?q=${encodeURIComponent(query)}`);
  return res.json(); // [{ value, label }, …]
}
```

Use `noResultsText` for the empty-results row (default `'No results'`).

## Binding the text value

The text binds like [Input](/ui/input): controlled with `value` + `onInput`, or a forms `control` (a
`Field<string>`) that also marks `touched` on blur and drives the invalid underline. Selecting a suggestion writes
the chosen label through whichever binding is set:

```html
<Autocomplete control={{ form.controls.city }} optionsFor={{ searchCities }} onSelect={{ pick }} required={{ true }} />
```

## Accessibility

It implements the APG combobox (list-autocomplete) pattern: the field is `role="combobox"` with
`aria-autocomplete="list"`, `aria-haspopup="listbox"` and `aria-expanded`; the panel is a `role="listbox"` of
`role="option"` rows. The active option is tracked with `aria-activedescendant` while focus stays in the input.
Open with typing or ↓, move with ↑/↓, select with Enter, close with Esc.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `options` | `T[]` | — | Static options, filtered locally by the typed text. |
| `optionsFor` | `(query: string) => T[] \| Promise<T[]>` | — | Async / dynamic options. Overrides `options`. |
| `filter` | `(item: T, query: string) => boolean` | label-contains | Local filter for static `options`. |
| `onSelect` | `(item: T) => void` | — | Called with the chosen option (the field is filled with its label). |
| `value` | `string` | — | Controlled text value. Ignored when `control` is set. |
| `onInput` | `(text: string) => void` | — | Called on every input. Ignored when `control` is set. |
| `control` | `Field<string>` | — | A forms field — two-way text + touched-on-blur + error underline. |
| `optionValue` | `(o: T) => string` | `o.value` | Pick the value field. |
| `optionLabel` | `(o: T) => string` | `o.label` | Pick the display field. |
| `optionDescription` | `(o: T) => string` | `o.description` | Optional subtext per suggestion. |
| `minChars` | `number` | `1` | Characters before suggestions show. |
| `placeholder` | `string` | — | Placeholder text. |
| `clearable` | `boolean` | `false` | Show the inline clear button (a lucide `x` icon) when non-empty. |
| `clearLabel` | `string` | `'Clear'` | Accessible name for the clear button. |
| `disabled` | `boolean` | `false` | Disable the field. |
| `required` | `boolean` | `false` | Mark required (native). |
| `name` | `string` | — | Native `name` for form submission. |
| `label` | `string` | — | Accessible name (when not wrapped by a FormField). |
| `noResultsText` | `string` | `'No results'` | Text for the empty-results row. |
| `position` | `MenuPosition` | `'bottom-start'` | Panel position relative to the field. |
