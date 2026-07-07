# Checkbox — examples

Every feature of `<Checkbox>`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [Checkbox reference page](/ui/checkbox); this page is just the examples,
covering the full component surface.

```ts
import Checkbox from '@weave-framework/ui/checkbox';
```
```scss
@use '@weave-framework/ui/checkbox';
```

## Basic — checked + onChange

A real `<input type="checkbox">` bound two-way to a boolean signal. `label` is the visible text and, via the
wrapping `<label>`, the accessible name.

:::demo ex-checkbox-basic

:::tabs
~~~html title="app.html"
<Checkbox checked={{ done() }} onChange={{ setDone }} label={{ 'Mark as done' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Checkbox from '@weave-framework/ui/checkbox';

export function setup() {
  const done = signal(true);
  return { done, setDone: (v) => done.set(v) };
}
~~~
:::

## Tri-state (indeterminate)

`indeterminate` renders the "mixed" mark — the classic select-all parent that's neither all-on nor all-off.
It's a visual/AT state (the accessibility tree reports "mixed"); the actual `checked` value is still yours to
drive, here derived from the children.

:::demo ex-checkbox-tristate

:::tabs
~~~html title="app.html"
<Checkbox checked={{ allOn() }} indeterminate={{ indeterminate() }} onChange={{ toggleAll }} label={{ 'All notifications' }} />
<Checkbox checked={{ email() }} onChange={{ setEmail }} label={{ 'Email' }} />
<Checkbox checked={{ sms() }} onChange={{ setSms }} label={{ 'SMS' }} />
~~~
~~~ts title="app.ts"
import { signal, computed } from '@weave-framework/runtime';
import Checkbox from '@weave-framework/ui/checkbox';

export function setup() {
  const email = signal(true);
  const sms = signal(false);
  const allOn = computed(() => email() && sms());
  const indeterminate = computed(() => (email() || sms()) && !allOn());
  const toggleAll = (v) => { email.set(v); sms.set(v); };
  return { email, sms, setEmail: (v) => email.set(v), setSms: (v) => sms.set(v), allOn, indeterminate, toggleAll };
}
~~~
:::

## States — disabled, required

The native states, forwarded straight to the input. `disabled` greys the control and blocks toggling (shown
both off and on); `required` marks the native input required.

:::demo ex-checkbox-states

:::tabs
~~~html title="app.html"
<Checkbox checked={{ offOn() }} disabled={{ true }} label={{ 'Disabled (off)' }} />
<Checkbox checked={{ onOn() }} disabled={{ true }} label={{ 'Disabled (on)' }} />
<Checkbox checked={{ req() }} onChange={{ setReq }} required={{ true }} label={{ 'Required' }} />
~~~
:::

## Forms control + validation

Bind a forms `Field<boolean>` with `control`: two-way value, touched-on-blur, and `aria-invalid` while
touched and invalid. `validators.required()` treats `false` as empty, so it reads as "must accept" — the
message shows only once the field is `touched`. Tab in, then out without checking it.

:::demo ex-checkbox-forms

:::tabs
~~~html title="app.html"
<Checkbox control={{ agree }} required={{ true }} label={{ 'I accept the terms' }} />
<span>{{ agreeError() }}</span>
~~~
~~~ts title="app.ts"
import { field, validators } from '@weave-framework/forms';

export function setup() {
  const agree = field(false, [validators.required('You must accept the terms')]);
  const agreeError = () => (agree.touched() ? agree.error() ?? '' : '');
  return { agree, agreeError };
}
~~~
:::

## Native name + custom class

`name` sets the native form-submission name (so a real `<form>` posts it), and `class` forwards extra classes
onto the `<label>` root for your own styling hooks.

:::demo ex-checkbox-name

:::tabs
~~~html title="app.html"
<Checkbox
  checked={{ subscribe() }}
  onChange={{ setSubscribe }}
  name={{ 'newsletter' }}
  class={{ 'my-checkbox' }}
  label={{ 'Subscribe to the newsletter' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Checkbox from '@weave-framework/ui/checkbox';

export function setup() {
  const subscribe = signal(true);
  return { subscribe, setSubscribe: (v) => subscribe.set(v) };
}
~~~
:::
