# Form Field — examples

Every feature of `<FormField>`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [Form Field reference page](/ui/form-field); this page is just the
examples, covering the full component surface. FormField is the lean frame around a control — a label above,
the control in the default slot, a hint or error line below — and it auto-wires the accessibility (`id`,
`label for`, `aria-describedby`, `aria-invalid`) to whatever control you slot in.

```ts
import FormField from '@weave-framework/ui/form-field';
```
```scss
@use '@weave-framework/ui/form-field';
```

## Label + hint

Wrap any control in the default slot and give it a `label` (uppercase, above) and an optional `hint` (below).
FormField finds the slotted `input` / `select` / `textarea`, gives it an `id`, and points the label's `for`
and the hint's `aria-describedby` at it — you never touch those yourself.

:::demo ex-form-field-label-hint

:::tabs
~~~html title="app.html"
<FormField label={{ 'Email' }} hint={{ 'We never share it.' }}>
  <Input value={{ email() }} onInput={{ setEmail }} type={{ 'email' }} placeholder={{ 'you@example.com' }} />
</FormField>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import FormField from '@weave-framework/ui/form-field';
import Input from '@weave-framework/ui/input';

export function setup() {
  const email = signal('');
  return { email, setEmail: (v) => email.set(v) };
}
~~~
:::

## Manual error

The `error` prop turns the field red when it's non-empty: the label and line go to the error colour and the
message replaces the `hint`. Drive it from a computed — type a name, then clear it.

:::demo ex-form-field-manual-error

:::tabs
~~~html title="app.html"
<FormField label={{ 'Name' }} hint={{ 'As it appears on your ID.' }} error={{ error() }}>
  <Input value={{ name() }} onInput={{ setName }} placeholder={{ 'Type, then clear it' }} />
</FormField>
~~~
~~~ts title="app.ts"
import { signal, computed } from '@weave-framework/runtime';
import FormField from '@weave-framework/ui/form-field';
import Input from '@weave-framework/ui/input';

export function setup() {
  const name = signal('');
  const error = computed(() => (name().trim() ? '' : 'Name is required'));
  return { name, setName: (v) => name.set(v), error };
}
~~~
:::

## Forms control — auto error

Pass the same forms `Field` to FormField's `control` and to the control itself. The error state auto-derives
from `touched() && error()`, so the message appears only after the user blurs out of an invalid field — no
manual error string to compute.

:::demo ex-form-field-control

:::tabs
~~~html title="app.html"
<FormField label={{ 'Email' }} hint={{ 'We never share it.' }} control={{ email }}>
  <Input control={{ email }} type={{ 'email' }} placeholder={{ 'you@example.com' }} />
</FormField>
~~~
~~~ts title="app.ts"
import { field, validators } from '@weave-framework/forms';
import FormField from '@weave-framework/ui/form-field';
import Input from '@weave-framework/ui/input';

export function setup() {
  const email = field('', [validators.required('Email is required'), validators.email('Enter a valid email')]);
  return { email };
}
~~~
:::

## Wrapping a Select

FormField frames any control, not just Input. Slot a `<Select>` and the label + hint wire to it exactly the
same way.

:::demo ex-form-field-wrap-select

:::tabs
~~~html title="app.html"
<FormField label={{ 'Country' }} hint={{ 'Where you file taxes.' }}>
  <Select options={{ options }} value={{ country() }} onChange={{ setCountry }} placeholder={{ 'Pick a country' }} />
</FormField>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import FormField from '@weave-framework/ui/form-field';
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

## Wrapping a Checkbox

A `<Checkbox>` works too — the FormField `label` sits above as the group heading, and the checkbox's own
`label` names the box.

:::demo ex-form-field-wrap-checkbox

:::tabs
~~~html title="app.html"
<FormField label={{ 'Terms' }} hint={{ 'Required to continue.' }}>
  <Checkbox checked={{ agree() }} onChange={{ setAgree }} label={{ 'I agree to the terms' }} />
</FormField>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import FormField from '@weave-framework/ui/form-field';
import Checkbox from '@weave-framework/ui/checkbox';

export function setup() {
  const agree = signal(false);
  return { agree, setAgree: (v) => agree.set(v) };
}
~~~
:::

## Unlabelled

Omit `label` for an unlabelled field — you still get the hint/error line and its `aria-describedby` wiring.

:::demo ex-form-field-unlabelled

:::tabs
~~~html title="app.html"
<FormField hint={{ 'Press Enter to search.' }}>
  <Input value={{ q() }} onInput={{ setQ }} placeholder={{ 'Search…' }} />
</FormField>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import FormField from '@weave-framework/ui/form-field';
import Input from '@weave-framework/ui/input';

export function setup() {
  const q = signal('');
  return { q, setQ: (v) => q.set(v) };
}
~~~
:::

## Custom class

`class` is forwarded onto the root, so a utility can restyle the frame — here one that stretches the field to
fill its container.

:::demo ex-form-field-class

:::tabs
~~~html title="app.html"
<FormField label={{ 'Handle' }} hint={{ 'This class stretches the field full-width.' }} class={{ 'field-block' }}>
  <Input value={{ handle() }} onInput={{ setHandle }} placeholder={{ '@you' }} />
</FormField>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import FormField from '@weave-framework/ui/form-field';
import Input from '@weave-framework/ui/input';

export function setup() {
  const handle = signal('');
  return { handle, setHandle: (v) => handle.set(v) };
}
~~~
:::
