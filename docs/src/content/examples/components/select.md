# Select — examples

Every feature of `<Select>`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [Select reference page](/ui/select); this page is just the examples,
covering the full component surface.

```ts
import Select from '@weave-framework/ui/select';
```
```scss
@use 'pkg:@weave-framework/ui/select';
```

## Basic — value + onChange

Give it `options` and bind the selected value with `value` + `onChange`. With the default option shape
(`{ value, label }`) there's nothing else to wire. `placeholder` shows when nothing is selected; `label`
names the control when it isn't wrapped in a [FormField](/ui/form-field).

:::demo ex-select-basic

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

## Multiple

`multiple` lets you pick several — the panel stays open, options show a check, the field summarises as
`"N selected"`, and the value becomes an **array**.

:::demo ex-select-multiple

:::tabs
~~~html title="app.html"
<Select multiple={{ true }} options={{ options }} value={{ langs() }} onChange={{ setLangs }} label={{ 'Languages' }} placeholder={{ 'Choose languages' }} />
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

## Custom option shape — accessors & emit

Options don't have to be `{ value, label }`. Point `optionValue` / `optionLabel` / `optionDescription`
(a subtext line) at whatever fields your data has. With `emit="object"`, `onChange` hands back the whole
selected option instead of just its value string.

:::demo ex-select-custom

:::tabs
~~~html title="app.html"
<Select
  options={{ countries }}
  optionValue={{ optCode }}
  optionLabel={{ optName }}
  optionDescription={{ optRegion }}
  emit={{ 'object' }}
  value={{ picked() }}
  onChange={{ setPicked }}
  label={{ 'Country' }}
  placeholder={{ 'Pick a country' }}
/>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Select from '@weave-framework/ui/select';

export function setup() {
  const countries = [
    { code: 'lt', name: 'Lithuania', region: 'Baltics' },
    { code: 'lv', name: 'Latvia', region: 'Baltics' },
    { code: 'pl', name: 'Poland', region: 'Central Europe' },
    { code: 'de', name: 'Germany', region: 'Central Europe' },
  ];
  const picked = signal(countries[0]);
  return {
    countries,
    optCode: (c) => c.code,
    optName: (c) => c.name,
    optRegion: (c) => c.region,
    picked,
    setPicked: (v) => picked.set(v),
  };
}
~~~
:::

## Plain strings & disabled options

Plain-string options need no accessors at all. `optionDisabled` (here the default `.disabled` field)
greys an option out and the keyboard navigation skips it.

:::demo ex-select-options

:::tabs
~~~html title="app.html"
<Select options={{ sizes }} value={{ size() }} onChange={{ setSize }} label={{ 'Size' }} placeholder={{ 'Pick a size' }} />
<Select options={{ plans }} value={{ plan() }} onChange={{ setPlan }} label={{ 'Plan' }} placeholder={{ 'Pick a plan' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Select from '@weave-framework/ui/select';

export function setup() {
  const sizes = ['Small', 'Medium', 'Large'];
  const size = signal('Medium');
  const plans = [
    { value: 'free', label: 'Free' },
    { value: 'pro', label: 'Pro' },
    { value: 'enterprise', label: 'Enterprise', disabled: true },
  ];
  const plan = signal('free');
  return { sizes, size, setSize: (v) => size.set(v), plans, plan, setPlan: (v) => plan.set(v) };
}
~~~
:::

## Clearable

`clearable` shows a clear button (a lucide `x` icon) once something is selected; it empties the value. `clearLabel` names the
button for assistive tech (default `'Clear'`).

:::demo ex-select-clearable

:::tabs
~~~html title="app.html"
<Select options={{ options }} value={{ fruit() }} onChange={{ setFruit }} clearable={{ true }} clearLabel={{ 'Clear fruit' }} label={{ 'Fruit' }} placeholder={{ 'Pick a fruit' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Select from '@weave-framework/ui/select';

export function setup() {
  const fruit = signal('apple');
  const options = [
    { value: 'apple', label: 'Apple' },
    { value: 'pear', label: 'Pear' },
    { value: 'plum', label: 'Plum' },
  ];
  return { options, fruit, setFruit: (v) => fruit.set(v) };
}
~~~
:::

## States — disabled & required

`disabled` blocks interaction (and drops the trigger out of the tab order); `required` marks the control
required for assistive tech.

:::demo ex-select-states

:::tabs
~~~html title="app.html"
<Select options={{ options }} value={{ a() }} onChange={{ setA }} disabled={{ true }} label={{ 'Disabled' }} />
<Select options={{ options }} value={{ b() }} onChange={{ setB }} required={{ true }} label={{ 'Required' }} placeholder={{ 'Required — pick one' }} />
~~~
:::

## Prefix & suffix slots

Like [Input](/ui/input), the trigger has `prefix` / `suffix` slots for an icon or text. Empty slots
collapse, so there's no dead gap.

:::demo ex-select-adornments

:::tabs
~~~html title="app.html"
<Select options={{ options }} value={{ country() }} onChange={{ setCountry }} label={{ 'Country' }} placeholder={{ 'Pick a country' }}>
  <Icon slot="prefix" name={{ 'search' }} />
  <span slot="suffix">ISO</span>
</Select>
~~~
:::

## Panel position

`position` places the panel relative to the trigger — here `top-start` opens it above the field. It still
flips on overflow. Default is `bottom-start`. `class` forwards extra classes onto the root for styling.

:::demo ex-select-position

:::tabs
~~~html title="app.html"
<Select options={{ options }} value={{ value() }} onChange={{ setValue }} position={{ 'top-start' }} class={{ 'demo-select' }} label={{ 'Opens upward' }} placeholder={{ 'Pick one' }} />
~~~
:::

## Forms control & validation

The other binding dialect: a forms `control` (a `Field`) gives two-way value, `touched` on panel close,
and the error state — wrapped in `<FormField>` for the label + error line. Open and close the panel
without picking to see the message.

:::demo ex-select-validation

:::tabs
~~~html title="app.html"
<FormField label={{ 'Country' }} error={{ countryError() }}>
  <Select control={{ country }} options={{ options }} required={{ true }} placeholder={{ 'Pick a country' }} />
</FormField>
~~~
~~~ts title="app.ts"
import { field, validators } from '@weave-framework/forms';

export function setup() {
  const options = [
    { value: 'lt', label: 'Lithuania' },
    { value: 'lv', label: 'Latvia' },
    { value: 'ee', label: 'Estonia' },
  ];
  const country = field('', [validators.required('Please choose a country')]);
  const countryError = () => (country.touched() ? country.error() ?? '' : '');
  return { options, country, countryError };
}
~~~
:::
