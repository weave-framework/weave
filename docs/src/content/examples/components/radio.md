# Radio Group — examples

Every feature of `<RadioGroup>`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [Radio Group reference page](/ui/radio); this page is just the examples,
covering the full component surface.

```ts
import RadioGroup from '@weave-framework/ui/radio';
```
```scss
@use 'pkg:@weave-framework/ui/radio';
```

## Basic — value + onChange

Pass `options` (each `{ value, label?, disabled? }`) and bind the selected key with `value` + `onChange`. The
radios share a native `name`, so the browser hands you arrow-key navigation, a roving tab stop, and
single-selection for free.

:::demo ex-radio-basic

:::tabs
~~~html title="app.html"
<RadioGroup options={{ plans }} value={{ plan() }} onChange={{ setPlan }} label={{ 'Plan' }} />
<span>Chosen: {{ plan() }}</span>
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

## States — disabled

Disable the whole group with the `disabled` prop, or a single option with `disabled` on its `RadioOption`.
Below, `team` is locked per-option while the rest stay selectable, and the second group is disabled whole.

:::demo ex-radio-disabled

:::tabs
~~~html title="app.html"
<RadioGroup options={{ plans }} value={{ plan() }} onChange={{ setPlan }} label={{ 'Plan' }} />

<RadioGroup options={{ plans }} value={{ locked() }} disabled={{ true }} label={{ 'Plan (locked)' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import RadioGroup from '@weave-framework/ui/radio';

export function setup() {
  const plan = signal('pro');
  const locked = signal('free');
  const plans = [
    { value: 'free', label: 'Free' },
    { value: 'pro', label: 'Pro' },
    { value: 'team', label: 'Team', disabled: true },
  ];
  return { plans, plan, setPlan: (v) => plan.set(v), locked };
}
~~~
:::

## Native name + custom class

`name` sets the shared native `name` on every radio (so a real `<form>` posts it; auto-generated if you omit
it), and `class` forwards extra classes onto the group container for your own styling hooks.

:::demo ex-radio-name

:::tabs
~~~html title="app.html"
<RadioGroup
  options={{ sizes }}
  value={{ size() }}
  onChange={{ setSize }}
  name={{ 'size' }}
  class={{ 'my-radio-group' }}
  label={{ 'Size' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import RadioGroup from '@weave-framework/ui/radio';

export function setup() {
  const size = signal('m');
  const sizes = [
    { value: 's', label: 'Small' },
    { value: 'm', label: 'Medium' },
    { value: 'l', label: 'Large' },
  ];
  return { sizes, size, setSize: (v) => size.set(v) };
}
~~~
:::

## Forms control + validation

Bind a forms `Field<string>` with `control` (the selected key): two-way value, touched-on-blur, and
`aria-invalid` on the group while touched and invalid. `control` wins over `value`/`onChange`. Starting empty,
`validators.required()` reports until you pick one — the message shows only once the field is `touched`. Tab in,
then out without choosing.

:::demo ex-radio-forms

:::tabs
~~~html title="app.html"
<FormField label={{ 'Plan' }} error={{ planError() }}>
  <RadioGroup options={{ plans }} control={{ plan }} label={{ 'Plan' }} />
</FormField>
~~~
~~~ts title="app.ts"
import { field, validators } from '@weave-framework/forms';
import FormField from '@weave-framework/ui/form-field';
import RadioGroup from '@weave-framework/ui/radio';

export function setup() {
  const plan = field('', [validators.required('Please choose a plan')]);
  const planError = () => (plan.touched() ? plan.error() ?? '' : '');
  const plans = [
    { value: 'free', label: 'Free' },
    { value: 'pro', label: 'Pro' },
    { value: 'team', label: 'Team' },
  ];
  return { plans, plan, planError };
}
~~~
:::
