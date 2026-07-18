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
