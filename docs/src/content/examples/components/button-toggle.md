# Button Toggle — examples

Every feature of `<ButtonToggle>`, each as a live, self-contained example you can read and lift straight
into your project. The prose lives on the [Button Toggle reference page](/ui/button-toggle); this page is
just the examples, covering the full component surface.

```ts
import ButtonToggle from '@weave-framework/ui/button-toggle';
```
```scss
@use '@weave-framework/ui/button-toggle';
```

## Single-select — value + onChange

The default is a radio group: exactly one segment is on, and the `value` is that segment's key. It's a
controlled component — pass `value` and update it in `onChange`. Each option is `{ value, label? }`.

:::demo ex-button-toggle-single

:::tabs
~~~html title="app.html"
<ButtonToggle options={{ opts }} value={{ view() }} onChange={{ setView }} label={{ 'View' }} />
<span>Selected: {{ view() }}</span>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import ButtonToggle from '@weave-framework/ui/button-toggle';

export function setup() {
  const view = signal('list');
  const opts = [
    { value: 'list', label: 'List' },
    { value: 'grid', label: 'Grid' },
    { value: 'map', label: 'Map' },
  ];
  return { opts, view, setView: (v) => view.set(v) };
}
~~~
:::

## Multi-select — multiple

Add `multiple` and it becomes a toolbar of independent toggles — any number can be on, and the `value` is
an **array** of the pressed keys. Perfect for bold / italic / underline.

:::demo ex-button-toggle-multi

:::tabs
~~~html title="app.html"
<ButtonToggle multiple={{ true }} options={{ opts }} value={{ marks() }} onChange={{ setMarks }} label={{ 'Text style' }} />
<span>Active: {{ marks().join(', ') || 'none' }}</span>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import ButtonToggle from '@weave-framework/ui/button-toggle';

export function setup() {
  const marks = signal(['bold']);
  const opts = [
    { value: 'bold', label: 'B' },
    { value: 'italic', label: 'I' },
    { value: 'underline', label: 'U' },
  ];
  return { opts, marks, setMarks: (v) => marks.set(v) };
}
~~~
:::

## Icons — icon per option

Add an `icon` to an option (a name in the active `<Icon>` registry, Lucide by default) and it renders as a
leading icon before the label.

:::demo ex-button-toggle-icons

:::tabs
~~~html title="app.html"
<ButtonToggle options={{ opts }} value={{ view() }} onChange={{ setView }} label={{ 'View' }} />
<span>Selected: {{ view() }}</span>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import ButtonToggle from '@weave-framework/ui/button-toggle';

export function setup() {
  const view = signal('list');
  const opts = [
    { value: 'list', label: 'List', icon: 'menu' },
    { value: 'board', label: 'Board', icon: 'house' },
    { value: 'calendar', label: 'Calendar', icon: 'calendar' },
  ];
  return { opts, view, setView: (v) => view.set(v) };
}
~~~
:::

## Disabled option — disabled on an option

Set `disabled` on a single option and that segment is greyed out, skipped in keyboard navigation, and can't
be selected. The rest of the group stays live.

:::demo ex-button-toggle-option-disabled

:::tabs
~~~html title="app.html"
<ButtonToggle options={{ opts }} value={{ range() }} onChange={{ setRange }} label={{ 'Range' }} />
<span>Selected: {{ range() }}</span>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import ButtonToggle from '@weave-framework/ui/button-toggle';

export function setup() {
  const range = signal('day');
  const opts = [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'year', label: 'Year', disabled: true },
  ];
  return { opts, range, setRange: (v) => range.set(v) };
}
~~~
:::

## Disabled group — disabled

`disabled` on the group disables every segment at once — it takes a reactive value, so flipping a signal
enables or disables the whole control with no manual DOM work.

:::demo ex-button-toggle-disabled

:::tabs
~~~html title="app.html"
<ButtonToggle disabled={{ disabled() }} options={{ opts }} value={{ size() }} onChange={{ setSize }} label={{ 'Size' }} />
<button on:click={{ toggle }}>{{ label() }}</button>
<span>Selected: {{ size() }}</span>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import ButtonToggle from '@weave-framework/ui/button-toggle';

export function setup() {
  const size = signal('m');
  const disabled = signal(true);
  const opts = [
    { value: 's', label: 'S' },
    { value: 'm', label: 'M' },
    { value: 'l', label: 'L' },
  ];
  return {
    opts,
    size,
    setSize: (v) => size.set(v),
    disabled,
    toggle: () => disabled.set((d) => !d),
    label: () => (disabled() ? 'Enable' : 'Disable'),
  };
}
~~~
:::

## class — forwarded to the group container

`class` is forwarded onto the group container alongside the Weave classes, so layout stays yours — here a
utility class stretches the control to fill its column.

:::demo ex-button-toggle-class

:::tabs
~~~html title="app.html"
<ButtonToggle class={{ 'demo-block' }} options={{ opts }} value={{ view() }} onChange={{ setView }} label={{ 'Filter' }} />
<span>Selected: {{ view() }}</span>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import ButtonToggle from '@weave-framework/ui/button-toggle';

export function setup() {
  const view = signal('all');
  const opts = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'done', label: 'Done' },
  ];
  return { opts, view, setView: (v) => view.set(v) };
}
~~~
:::
