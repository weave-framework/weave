# Autocomplete — examples

Every feature of `<Autocomplete>`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [Autocomplete reference page](/ui/autocomplete); this page is just the
examples, covering the full component surface. Autocomplete **composes** the real `<Input>`, so the field,
underline, clear button and value binding are Input's by construction.

```ts
import Autocomplete from '@weave-framework/ui/autocomplete';
```
```scss
@use 'pkg:@weave-framework/ui/autocomplete';
```

## Basic — options + onSelect

Give it `options` and an `onSelect` callback. Suggestions are the options whose label contains the typed text
(case-insensitive); picking one fills the field with its label and fires `onSelect(item)`.

:::demo ex-autocomplete-basic

:::tabs
~~~html title="app.html"
<Autocomplete options={{ options }} onSelect={{ onSelect }} label={{ 'Framework' }} placeholder={{ 'Type to search…' }} />
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

## Controlled text — value + onInput

The text binds like [Input](/ui/input): `value` + `onInput` bind it two-way to a signal. Selecting a suggestion
writes the chosen label through the same binding. (Plain-string options work with no accessors.)

:::demo ex-autocomplete-value-oninput

:::tabs
~~~html title="app.html"
<Autocomplete options={{ options }} value={{ text() }} onInput={{ setText }} onSelect={{ onSelect }} label={{ 'City' }} placeholder={{ 'Type a city…' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Autocomplete from '@weave-framework/ui/autocomplete';

export function setup() {
  const text = signal('');
  const options = ['Amsterdam', 'Berlin', 'Copenhagen', 'Dublin', 'Edinburgh', 'Florence'];
  return { options, text, setText: (v) => text.set(v), onSelect: (item) => text.set(item) };
}
~~~
:::

## Clearable

`clearable` shows a clear button (a lucide `x` icon) when the field is non-empty; `clearLabel` names it for assistive tech (default
`'Clear'`). It empties the value and refocuses the field.

:::demo ex-autocomplete-clearable

:::tabs
~~~html title="app.html"
<Autocomplete options={{ options }} onSelect={{ onSelect }} label={{ 'Framework' }} clearable={{ true }} clearLabel={{ 'Clear framework' }} />
~~~
:::

## Any option shape

Options can be **any shape** — point the accessors at your data's fields. `optionValue`/`optionLabel` pick the
value and display; `optionDescription` adds a subtext line under each suggestion.

:::demo ex-autocomplete-option-shape

:::tabs
~~~html title="app.html"
<Autocomplete options={{ users }}
              optionValue={{ optionValue }}
              optionLabel={{ optionLabel }}
              optionDescription={{ optionDescription }}
              onSelect={{ onSelect }}
              label={{ 'User' }}
              placeholder={{ 'Search people…' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Autocomplete from '@weave-framework/ui/autocomplete';

export function setup() {
  const chosen = signal('');
  const users = [
    { id: 1, name: 'Ada Lovelace', email: 'ada@example.com' },
    { id: 2, name: 'Alan Turing', email: 'alan@example.com' },
    { id: 3, name: 'Grace Hopper', email: 'grace@example.com' },
  ];
  return {
    users,
    optionValue: (u) => String(u.id),
    optionLabel: (u) => u.name,
    optionDescription: (u) => u.email,
    chosen,
    onSelect: (item) => chosen.set(item.name),
  };
}
~~~
:::

## Custom filter

`filter` replaces the default label-contains match for static `options`. Here it's a prefix match on either the
country name or its ISO code.

:::demo ex-autocomplete-filter

:::tabs
~~~html title="app.html"
<Autocomplete options={{ options }} filter={{ filter }} onSelect={{ onSelect }} label={{ 'Country' }} placeholder={{ 'Name or code…' }} />
~~~
~~~ts title="app.ts"
const filter = (item, query) => {
  const q = query.toLowerCase();
  return item.label.toLowerCase().startsWith(q) || item.value.toLowerCase().startsWith(q);
};
~~~
:::

## minChars

`minChars` (default `1`) sets how many characters must be typed before the panel opens — here `2`.

:::demo ex-autocomplete-min-chars

:::tabs
~~~html title="app.html"
<Autocomplete options={{ options }} minChars={{ 2 }} onSelect={{ onSelect }} label={{ 'Fruit' }} placeholder={{ 'Type 2+ letters…' }} />
~~~
:::

## Async / dynamic data — optionsFor + noResultsText

Pass `optionsFor(query)` instead of `options` to fetch suggestions — return an array, or a `Promise` for a real
API call. A promise fills a reactive cache, so the panel re-renders when results land and stale (out-of-order)
responses are ignored. `noResultsText` labels the empty-results row (default `'No results'`).

:::demo ex-autocomplete-async

:::tabs
~~~html title="app.html"
<Autocomplete optionsFor={{ optionsFor }} onSelect={{ onSelect }} label={{ 'City' }} placeholder={{ 'Search cities…' }} noResultsText={{ 'No matching cities' }} />
~~~
~~~ts title="app.ts"
async function optionsFor(query: string) {
  const res = await fetch(`/api/cities?q=${encodeURIComponent(query)}`);
  return res.json(); // [{ value, label }, …]
}
~~~
:::

## Forms control + validation

Bind a forms `Field<string>` with `control`: two-way text, touched-on-blur, and the error underline. `required`
marks it native, and `name` sets the native attribute. The message shows only once the field is `touched` — blur
the empty field to see it.

:::demo ex-autocomplete-control

:::tabs
~~~html title="app.html"
<FormField label={{ 'City' }} error={{ cityError() }}>
  <Autocomplete control={{ city }} options={{ options }} onSelect={{ onSelect }} required={{ true }} name={{ 'city' }} placeholder={{ 'Type a city…' }} />
</FormField>
~~~
~~~ts title="app.ts"
import { field, validators } from '@weave-framework/forms';

export function setup() {
  const city = field('', [validators.required('Pick a city')]);
  const cityError = () => (city.touched() ? city.error() ?? '' : '');
  const options = [
    { value: 'lon', label: 'London' },
    { value: 'par', label: 'Paris' },
    { value: 'ber', label: 'Berlin' },
  ];
  return { city, cityError, options, onSelect: (item) => city.value.set(item.label) };
}
~~~
:::

## Disabled

`disabled` greys the field and stops the suggestion panel from opening.

:::demo ex-autocomplete-disabled

:::tabs
~~~html title="app.html"
<Autocomplete options={{ options }} value={{ 'React' }} disabled={{ true }} label={{ 'Framework' }} />
~~~
:::

## Panel position + class

`position` places the panel relative to the field (here `'top-start'`, opening upward); `class` forwards extra
classes onto the root for styling hooks.

:::demo ex-autocomplete-position

:::tabs
~~~html title="app.html"
<Autocomplete options={{ options }} onSelect={{ onSelect }} position={{ 'top-start' }} class={{ 'my-autocomplete' }} label={{ 'Framework' }} placeholder={{ 'Opens upward…' }} />
~~~
:::
