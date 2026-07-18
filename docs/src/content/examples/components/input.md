# Input — examples

Every feature of `<Input>`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [Input reference page](/ui/input); this page is just the examples,
covering the full component surface.

```ts
import Input from '@weave-framework/ui/input';
```
```scss
@use 'pkg:@weave-framework/ui/input';
```

## Basic — value + onInput

The underline field bound two-way to a signal.

:::demo input-basic

:::tabs
~~~html title="app.html"
<Input value={{ q() }} onInput={{ setQ }} placeholder={{ 'Type something…' }} label={{ 'Message' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Input from '@weave-framework/ui/input';

export function setup() {
  const q = signal('');
  return { q, setQ: (v) => q.set(v) };
}
~~~
:::

## Prefix & suffix

Named slots (`slot="prefix"` / `slot="suffix"`) hold an icon or text flanking the field inside the
underline. Empty slots collapse, so there's no dead gap.

:::demo input-adornments

:::tabs
~~~html title="app.html"
<Input value={{ amount() }} onInput={{ setAmount }} type={{ 'number' }} label={{ 'Price' }}>
  <span slot="prefix">€</span>
  <span slot="suffix">/mo</span>
</Input>

<Input value={{ q() }} onInput={{ setQ }} label={{ 'Search' }}>
  <Icon slot="prefix" name={{ 'search' }} />
</Input>
~~~
:::

## Clearable

`clearable` shows a clear button (a lucide `x` icon) when the field is non-empty and editable; it empties the value and
refocuses.

:::demo input-clearable

:::tabs
~~~html title="app.html"
<Input value={{ text() }} onInput={{ setText }} clearable={{ true }} label={{ 'Clearable' }} />
~~~
:::

## Types

`type` is forwarded to the native input — `email`, `number`, `tel` and friends get the right on-screen
keyboard and native validation.

:::demo input-types

:::tabs
~~~html title="app.html"
<Input value={{ email() }} onInput={{ setEmail }} type={{ 'email' }} label={{ 'Email' }} />
<Input value={{ age() }} onInput={{ setAge }} type={{ 'number' }} label={{ 'Age' }} />
<Input value={{ tel() }} onInput={{ setTel }} type={{ 'tel' }} label={{ 'Phone' }} />
~~~
:::

## Multiline

`multiline` renders a `<textarea>` (with `rows`) instead of an `<input>`.

:::demo input-multiline

:::tabs
~~~html title="app.html"
<Input value={{ note() }} onInput={{ setNote }} multiline={{ true }} rows={{ 4 }} label={{ 'Notes' }} />
~~~
:::

## Password reveal

On a `type="password"` field, `revealable` adds the eye toggle that switches the value between hidden
and plaintext.

:::demo input-password

:::tabs
~~~html title="app.html"
<Input value={{ pw() }} onInput={{ setPw }} type={{ 'password' }} revealable={{ true }} label={{ 'Password' }} />
~~~
:::

## Reveal tooltip modes + onRevealToggle

`revealTooltip` chooses the hint on the eye: `'native'` (browser title), `'weave'` (the styled Tooltip —
hover **and** keyboard focus), or `'none'`. `onRevealToggle` fires with the new state on every flip, so
the app can react — here it drives the readout under the third field.

:::demo input-password-tooltip

:::tabs
~~~html title="app.html"
<Input value={{ a() }} onInput={{ setA }} type={{ 'password' }} revealable={{ true }}
  revealTooltip={{ 'native' }} label={{ 'Native title' }} revealLabel={{ 'Show' }} hideLabel={{ 'Hide' }} />
<Input value={{ b() }} onInput={{ setB }} type={{ 'password' }} revealable={{ true }}
  revealTooltip={{ 'weave' }} label={{ 'Weave tooltip' }} />
<Input value={{ c() }} onInput={{ setC }} type={{ 'password' }} revealable={{ true }}
  revealTooltip={{ 'none' }} label={{ 'No tooltip + onRevealToggle' }} onRevealToggle={{ onToggle }} />
~~~
~~~ts title="app.ts"
const shown = signal(false);
const onToggle = (revealed) => shown.set(revealed); // drives "{{ shown() ? 'visible' : 'hidden' }}"
~~~
:::

## States — disabled, readonly, required

The three native states, forwarded straight to the field.

:::demo input-states

:::tabs
~~~html title="app.html"
<Input value={{ x() }} onInput={{ setX }} disabled={{ true }} label={{ 'Disabled' }} />
<Input value={{ y() }} onInput={{ setY }} readonly={{ true }} label={{ 'Read-only' }} />
<Input value={{ z() }} onInput={{ setZ }} required={{ true }} label={{ 'Required' }} />
~~~
:::

## Forms control + validation

Bind a forms `Field<string>` with `control`: two-way value, touched-on-blur, and the error underline.
The message shows only once the field is `touched` — type an invalid address, then blur out.

:::demo input-validation

:::tabs
~~~html title="app.html"
<FormField label={{ 'Email' }} error={{ emailError() }}>
  <Input control={{ email }} type={{ 'email' }} placeholder={{ 'you@example.com' }} />
</FormField>
~~~
~~~ts title="app.ts"
import { field, validators } from '@weave-framework/forms';

export function setup() {
  const email = field('', [validators.required('Email is required'), validators.email('Enter a valid email')]);
  const emailError = () => (email.touched() ? email.error() ?? '' : '');
  return { email, emailError };
}
~~~
:::
