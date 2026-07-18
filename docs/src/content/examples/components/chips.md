# Chips — examples

Every feature of `<Chips>`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [Chips reference page](/ui/chips); this page is just the examples,
covering the full component surface.

```ts
import Chips from '@weave-framework/ui/chips';
```
```scss
@use 'pkg:@weave-framework/ui/chips';
```

## Basic — value + onChange

The value is the array of chip strings, bound with `value` + `onChange`. Removing a chip (its remove button, or
Backspace/Delete on a focused chip) calls `onChange` with the shorter array — you hold the state, Chips
just reflects it.

:::demo ex-chips-basic

:::tabs
~~~html title="app.html"
<Chips value={{ tags() }} onChange={{ setTags }} label={{ 'Tags' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Chips from '@weave-framework/ui/chips';

export function setup() {
  const tags = signal(['weave', 'signals', 'zero-dep']);
  return { tags, setTags: (v) => tags.set(v) };
}
~~~
:::

## Add chip — onAdd + addLabel

`onAdd` renders the dashed **add** chip — a lucide `plus` icon followed by the text; `addLabel` sets
that text (default `'Add'`). Chips is
controlled, so you decide what adding means — here we prompt and append.

:::demo ex-chips-add

:::tabs
~~~html title="app.html"
<Chips value={{ tags() }} onChange={{ setTags }} onAdd={{ addTag }} addLabel={{ 'New tag' }} label={{ 'Tags' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Chips from '@weave-framework/ui/chips';

export function setup() {
  const tags = signal(['weave', 'signals']);
  const addTag = () => {
    const next = window.prompt('New tag?')?.trim();
    if (next) tags.set([...tags(), next]);
  };
  return { tags, setTags: (v) => tags.set(v), addTag };
}
~~~
:::

## Read-only — removable

`removable={{ false }}` drops the remove button (a lucide `x` icon) on every chip, leaving a plain display row of tags.

:::demo ex-chips-readonly

:::tabs
~~~html title="app.html"
<Chips value={{ tags() }} removable={{ false }} label={{ 'Attributes' }} />
~~~
:::

## Disabled

`disabled` freezes the whole group — no focus, no removal, and the add chip is inert.

:::demo ex-chips-disabled

:::tabs
~~~html title="app.html"
<Chips value={{ tags() }} onChange={{ setTags }} onAdd={{ addTag }} disabled={{ true }} label={{ 'Tags' }} />
~~~
:::

## removeLabel + class

`removeLabel(chip)` customises each remove button's `aria-label` (default `Remove <chip>`), and `class`
forwards extra classes onto the group element.

:::demo ex-chips-remove-label

:::tabs
~~~html title="app.html"
<Chips value={{ tags() }} onChange={{ setTags }} removeLabel={{ removeLabel }} class={{ 'teams' }} label={{ 'Teams' }} />
~~~
~~~ts title="app.ts"
const removeLabel = (chip) => `Dismiss the ${chip} team`;
~~~
:::

## Forms control

Bind a forms `Field<string[]>` with `control`: it drives the array two-way and marks `touched` when a
chip is removed. `control` wins over `value` — remove a chip and watch the readout flip.

:::demo ex-chips-control

:::tabs
~~~html title="app.html"
<Chips control={{ tags }} label={{ 'Tags' }} />
~~~
~~~ts title="app.ts"
import { field } from '@weave-framework/forms';
import Chips from '@weave-framework/ui/chips';

export function setup() {
  const tags = field(['alpha', 'beta', 'gamma']);
  return { tags, touched: () => tags.touched() };
}
~~~
:::
