# Slide Toggle — examples

Every feature of `<SlideToggle>`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [Slide Toggle reference page](/ui/slide-toggle); this page is just the
examples, covering the full component surface.

```ts
import SlideToggle from '@weave-framework/ui/slide-toggle';
```
```scss
@use 'pkg:@weave-framework/ui/slide-toggle';
```

## Basic — checked + onChange

A real `<input type="checkbox" role="switch">` bound two-way to a boolean signal. `label` is the visible text
and, via the wrapping `<label>`, the accessible name.

:::demo ex-slide-toggle-basic

:::tabs
~~~html title="app.html"
<SlideToggle checked={{ on() }} onChange={{ setOn }} label={{ 'Notifications' }} />
<span>{{ on() ? 'On' : 'Off' }}</span>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import SlideToggle from '@weave-framework/ui/slide-toggle';

export function setup() {
  const on = signal(true);
  return { on, setOn: (v) => on.set(v) };
}
~~~
:::

## States — disabled, required

The native states, forwarded straight to the input. `disabled` greys the control and blocks toggling (shown
both off and on); `required` marks the native input required.

:::demo ex-slide-toggle-states

:::tabs
~~~html title="app.html"
<SlideToggle checked={{ true }} disabled={{ true }} label={{ 'Disabled — on' }} />
<SlideToggle checked={{ false }} disabled={{ true }} label={{ 'Disabled — off' }} />
<SlideToggle checked={{ false }} onChange={{ () => {} }} required={{ true }} label={{ 'Required' }} />
~~~
:::

## Forms control + validation

Bind a forms `Field<boolean>` with `control`: two-way value, touched-on-blur, and `aria-invalid` while
touched and invalid. `control` wins over `checked` + `onChange`. `validators.required()` treats `false` as
empty, so it reads as "must be on" — the message shows only once the field is `touched`. Tab in, then out
without turning it on.

:::demo ex-slide-toggle-forms

:::tabs
~~~html title="app.html"
<SlideToggle control={{ consent }} required={{ true }} label={{ 'Enable data sync' }} />
<span>{{ consentError() }}</span>
<span>Value: {{ consent.value() ? 'true' : 'false' }}</span>
~~~
~~~ts title="app.ts"
import { field, validators } from '@weave-framework/forms';

export function setup() {
  const consent = field(false, [validators.required('You must enable this to continue')]);
  const consentError = () => (consent.touched() ? consent.error() ?? '' : '');
  return { consent, consentError };
}
~~~
:::

## Native name + custom class

`name` sets the native form-submission name (so a real `<form>` posts it), and `class` forwards extra classes
onto the `<label>` root for your own styling hooks.

:::demo ex-slide-toggle-name

:::tabs
~~~html title="app.html"
<SlideToggle
  checked={{ subscribe() }}
  onChange={{ setSubscribe }}
  name={{ 'notifications' }}
  class={{ 'my-toggle' }}
  label={{ 'Email notifications' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import SlideToggle from '@weave-framework/ui/slide-toggle';

export function setup() {
  const subscribe = signal(true);
  return { subscribe, setSubscribe: (v) => subscribe.set(v) };
}
~~~
:::
