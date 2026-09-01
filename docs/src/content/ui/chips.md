# Chips

A little row of removable tags — labels, categories, selected filters — each with a remove button (a lucide `x`
icon) to dismiss it, optionally trailed by a dashed **Add** chip (a lucide `plus` icon beside its label). The value
is simply the **array of chip strings**; removing one emits the shorter array.

:::demo chips-basic

## Import

```ts
import Chips from '@weave-framework/ui/chips';
```

```scss
@use 'pkg:@weave-framework/ui/chips';
```

## Basic usage

Bind the array with `value` + `onChange`. Add an `onAdd` handler to show the Add chip — Chips is controlled, so
you decide what adding means (prompt, open a picker, append a default):

:::tabs
~~~html title="app.html"
<Chips value={{ tags() }} onChange={{ setTags }} onAdd={{ addTag }} label={{ 'Tags' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Chips from '@weave-framework/ui/chips';

export function setup() {
  const tags = signal(['weave', 'signals', 'zero-dep']);
  let n = 0;
  return {
    tags,
    setTags: (v) => tags.set(v),          // called when a chip is removed
    addTag: () => tags.set([...tags(), `tag-${(n += 1)}`]), // the Add chip
  };
}
~~~
:::

Removing a chip calls `onChange` with the shorter array — you hold the state, Chips just reflects it.

## Binding: signal or forms field

| Binding | What you pass |
| --- | --- |
| **Signal** | `value` (a getter) + `onChange` |
| **Forms** | `control` — a `Field<string[]>` (wins over `value`) |

A bound `control` drives the array two-way and marks `touched` when a chip is removed.

## Options

- `removable` (default `true`) — show the remove button on each chip; set `false` for read-only tags.
- `onAdd` + `addLabel` — the trailing add chip and its text (default `'Add'`).
- `removeLabel(chip)` — customize each remove button's `aria-label` (default `Remove <chip>`).
- `disabled` — no focus, no removal.

## Accessibility

The chips are a roving-tabindex `role="group"`: Arrow / Home / End move focus between chips, and
**Backspace or Delete removes the focused chip**, then moves focus to its neighbour. Each remove control is a real
`<button>` with an `aria-label`. Give the group a `label` for its accessible name.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `string[]` | — | Controlled chip array. Ignored when `control` is set. |
| `onChange` | `(next: string[]) => void` | — | Called with the next array on remove. |
| `control` | `Field<string[]>` | — | A forms field — two-way + touched-on-remove. Wins over `value`. |
| `removable` | `boolean` | `true` | Show the remove button (a lucide `x` icon) on each chip. |
| `disabled` | `boolean` | `false` | Disable the whole group. |
| `label` | `string` | — | Accessible name for the group. |
| `onAdd` | `() => void` | — | When set, render a dashed Add chip that calls this. |
| `addLabel` | `string` | `'Add'` | Text for the add chip. |
| `removeLabel` | `(chip: string) => string` | `Remove <chip>` | aria-label for a chip's remove button. |
| `class` | `string` | — | Extra classes forwarded onto the group. |

<!-- gen-ui-types:begin -->
### Types

~~~ts
import type { ChipsControl, ChipsProps, ChipsContext } from '@weave-framework/ui/chips';
~~~
<!-- gen-ui-types:end -->

## When it goes wrong

:::callout trap "It shows a value and your form never hears about it"
Every input-like component takes a `control`. Without one it is an ordinary uncontrolled element: it
displays, it accepts typing, and it reports nothing — so `valid()` stays true and Submit sends an empty
field.

~~~html
<Chips control={{ tags }} />
~~~

See [Forms](/learn/forms) for what a control carries: value, touched, dirty, error and the validation
timing that decides when a message is shown.
:::

**It renders unstyled.** The stylesheet is a separate import per component —
`@use 'pkg:@weave-framework/ui/chips';` in your Sass. Correct markup with no styling is always this.

**The error message never appears.** An error is set from the first keystroke; `touched` decides whether
it is *shown*. If Submit seems to do nothing on an empty form, call `touchAll()` on the group first.
