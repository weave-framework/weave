# Radio Group

Pick exactly one from a short list. `<RadioGroup>` renders real `<input type="radio">` circles that share a native
`name`, so the browser hands you **arrow-key navigation, roving tab stop, and single-selection for free** — the
component adds the value binding and the Weave visual (a 20px ring that fills with an accent dot when on).

:::demo radio-basic

## Import

```ts
import RadioGroup from '@weave-framework/ui/radio';
```

```scss
@use 'pkg:@weave-framework/ui/radio';
```

## Basic usage

Pass the `options` (each `{ value, label?, disabled? }`) and bind the selected key with `value` + `onChange`:

:::tabs
~~~html title="app.html"
<RadioGroup options={{ plans }} value={{ plan() }} onChange={{ setPlan }} label={{ 'Plan' }} />
<p>Chosen: {{ plan() }}</p>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import RadioGroup from '@weave-framework/ui/radio';

export function setup() {
  const plan = signal('pro');
  const plans = [
    { value: 'free', label: 'Free' },
    { value: 'pro', label: 'Pro' },
    { value: 'team', label: 'Team' },
  ];
  return { plans, plan, setPlan: (v) => plan.set(v) };
}
~~~
:::

Like [ButtonToggle](/ui/button-toggle), it's an items-prop component — you describe the options as data rather than
composing child elements, which keeps it lean and testable.

## Binding: signal or forms field

| Binding | What you pass |
| --- | --- |
| **Signal** | `value` (the selected key) + `onChange` |
| **Forms** | `control` — a `Field<string>` (wins over `value`) |

```html
<RadioGroup options={{ plans }} control={{ form.controls.plan }} />
```

A bound `control` drives the value two-way, marks `touched` on blur, and sets `aria-invalid` on the group while
touched and invalid.

## Disabling

Disable the whole group with `disabled`, or a single option with `disabled` on it:

```html
<RadioGroup
  options={{ [
    { value: 'free', label: 'Free' },
    { value: 'pro', label: 'Pro' },
    { value: 'team', label: 'Team', disabled: true },
  ] }}
  value={{ plan() }}
  onChange={{ setPlan }}
/>
```

## Accessibility

The wrapper is a `role="radiogroup"`; the options are native radios sharing a `name`, so selection and Arrow-key
navigation are the platform's. Give the group a `label` for its accessible name. `name` is auto-generated if you
don't pass one.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `options` | `RadioOption[]` | — | The radios, top to bottom. Each is `{ value, label?, disabled? }`; `label` falls back to `value`. |
| `value` | `string \| null` | — | Controlled selected key. Ignored when `control` is set. |
| `onChange` | `(value: string) => void` | — | Called with the next value on select. Ignored when `control` is set. |
| `control` | `Field<string>` | — | A forms field — two-way + touched + aria-invalid. Wins over `value`. |
| `name` | `string` | *(auto)* | Shared native `name`. |
| `disabled` | `boolean` | `false` | Disable the whole group. |
| `label` | `string` | — | Accessible name for the group. |
| `class` | `string` | — | Extra classes forwarded onto the group container. |

<!-- gen-ui-types:begin -->
### Types

~~~ts
import type { RadioControl, RadioOption, RadioGroupProps, RadioGroupContext } from '@weave-framework/ui/radio';
~~~
<!-- gen-ui-types:end -->

## When it goes wrong

:::callout trap "It shows a value and your form never hears about it"
Every input-like component takes a `control`. Without one it is an ordinary uncontrolled element: it
displays, it accepts typing, and it reports nothing — so `valid()` stays true and Submit sends an empty
field.

~~~html
<RadioGroup control={{ size }} />
~~~

See [Forms](/learn/forms) for what a control carries: value, touched, dirty, error and the validation
timing that decides when a message is shown.
:::

**It renders unstyled.** The stylesheet is a separate import per component —
`@use 'pkg:@weave-framework/ui/radio';` in your Sass. Correct markup with no styling is always this.

**The error message never appears.** An error is set from the first keystroke; `touched` decides whether
it is *shown*. If Submit seems to do nothing on an empty form, call `touchAll()` on the group first.
