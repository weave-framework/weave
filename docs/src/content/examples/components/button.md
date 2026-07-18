# Button — examples

Every feature of `<Button>`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [Button reference page](/ui/button); this page is just the examples,
covering the full component surface.

```ts
import Button from '@weave-framework/ui/button';
```
```scss
@use 'pkg:@weave-framework/ui/button';
```

## Variants

The `variant` prop picks the look: `primary` (default, ink fill), `outline`, `marked` (soft accent tint),
`ghost` (no chrome until you hover it), and `icon` (34px square — pass a `label` for the accessible name).

:::demo ex-button-variants

:::tabs
~~~html title="app.html"
<Button>Primary</Button>
<Button variant={{ 'outline' }}>Outline</Button>
<Button variant={{ 'marked' }}>Marked</Button>
<Button variant={{ 'ghost' }}>Ghost</Button>
<Button variant={{ 'icon' }} label={{ 'Delete' }}>
  <Icon name={{ 'trash-2' }} />
</Button>
~~~
:::

## Content

Whatever you project between the tags becomes the button's content — a text label, an `<Icon>` alongside
text, or an icon on its own (with the `icon` variant and a `label`).

:::demo ex-button-content

:::tabs
~~~html title="app.html"
<Button>Save changes</Button>
<Button variant={{ 'outline' }}>
  <Icon name={{ 'cloud-download' }} /> Export
</Button>
<Button variant={{ 'icon' }} label={{ 'Settings' }}>
  <Icon name={{ 'settings' }} />
</Button>
~~~
:::

## Events — on:click and friends

`<Button>` forwards native button events straight through. `on:click` is the common one, but any native
`<button>` event works the same way — here `on:focus` / `on:blur` drive the state readout (tab to the
button to see it change).

:::demo ex-button-events

:::tabs
~~~html title="app.html"
<Button on:click={{ inc }} on:focus={{ onFocus }} on:blur={{ onBlur }}>
  Clicked {{ count() }} times
</Button>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Button from '@weave-framework/ui/button';

export function setup() {
  const count = signal(0);
  const status = signal('idle');
  return {
    count,
    status,
    inc: () => count.set((n) => n + 1),
    onFocus: () => status.set('focused'),
    onBlur: () => status.set('blurred'),
  };
}
~~~
:::

## Disabled

`disabled` is the native attribute — it greys the button, blocks the click, drops it from the tab order,
and suppresses the ripple. It takes a reactive value, so flipping a signal enables or disables the button
with no manual DOM work.

:::demo ex-button-disabled

:::tabs
~~~html title="app.html"
<Button disabled={{ disabled() }} on:click={{ hit }}>Submit ({{ count() }})</Button>
<Button variant={{ 'ghost' }} on:click={{ toggle }}>{{ label() }}</Button>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Button from '@weave-framework/ui/button';

export function setup() {
  const disabled = signal(true);
  const count = signal(0);
  return {
    disabled,
    count,
    hit: () => count.set((n) => n + 1),
    toggle: () => disabled.set((d) => !d),
    label: () => (disabled() ? 'Enable it' : 'Disable it'),
  };
}
~~~
:::

## Form types — button, submit, reset

`type` decides how the button behaves inside a `<form>`: `submit` submits it (and runs native
validation), `reset` clears the fields, and the default `button` never submits by accident.

:::demo ex-button-type

:::tabs
~~~html title="app.html"
<form on:submit={{ onSubmit }}>
  <input value={{ name() }} on:input={{ onName }} required />
  <Button type={{ 'submit' }}>Create account</Button>
  <Button type={{ 'reset' }} variant={{ 'outline' }}>Reset</Button>
  <Button type={{ 'button' }} variant={{ 'ghost' }}>Does nothing</Button>
</form>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Button from '@weave-framework/ui/button';

export function setup() {
  const name = signal('');
  const submitted = signal('');
  return {
    name,
    onName: (e) => name.set(e.target.value),
    submitted,
    onSubmit: (e) => {
      e.preventDefault();
      submitted.set(name());
    },
  };
}
~~~
:::

## ariaCurrent — the active item in a set

`ariaCurrent` sets `aria-current`. Use it to mark the selected item in a group — the classic case being
the current page in a paginator, so a screen reader announces which page you're on.

:::demo ex-button-aria-current

:::tabs
~~~html title="app.html"
<Button
  variant={{ page() === 1 ? 'primary' : 'ghost' }}
  ariaCurrent={{ currentOf(1) }}
  on:click={{ () => select(1) }}
>1</Button>
<!-- …one per page… -->
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Button from '@weave-framework/ui/button';

export function setup() {
  const page = signal(1);
  return {
    pages: [1, 2, 3, 4],
    page,
    select: (n) => page.set(n),
    currentOf: (n) => (page() === n ? 'page' : undefined),
  };
}
~~~
:::

## class — forwarded to the host button

`class` is forwarded onto the underlying `<button>` alongside the Weave classes, so layout stays yours —
here a utility class stretches the button to fill its column.

:::demo ex-button-class

:::tabs
~~~html title="app.html"
<Button class={{ 'demo-block' }}>Full-width primary</Button>
<Button class={{ 'demo-block' }} variant={{ 'outline' }}>Full-width outline</Button>
~~~
:::
