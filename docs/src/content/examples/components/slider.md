# Slider — examples

Every feature of `<Slider>`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [Slider reference page](/ui/slider); this page is just the examples,
covering the full component surface.

```ts
import Slider from '@weave-framework/ui/slider';
```
```scss
@use 'pkg:@weave-framework/ui/slider';
```

## Basic — value + onChange

The default `0`–`100` range bound two-way to a signal: `value` is the getter, `onChange` fires with the
next (snapped, clamped) number on every change.

:::demo ex-slider-basic

:::tabs
~~~html title="app.html"
<Slider value={{ v() }} onChange={{ setV }} label={{ 'Level' }} />
<span>Value: {{ v() }}</span>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Slider from '@weave-framework/ui/slider';

export function setup() {
  const v = signal(40);
  return { v, setV: (n) => v.set(n) };
}
~~~
:::

## Range — min & max

Set your own bounds with `min` / `max`. Here a thermostat runs 16–28 °C.

:::demo ex-slider-range

:::tabs
~~~html title="app.html"
<Slider min={{ 16 }} max={{ 28 }} value={{ temp() }} onChange={{ setTemp }} label={{ 'Temperature' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Slider from '@weave-framework/ui/slider';

export function setup() {
  const temp = signal(21);
  return { temp, setTemp: (v) => temp.set(v) };
}
~~~
:::

## Step

`step` sets the increment. Values snap to the grid (measured from `min`) and clamp to the range, so
arrows and drag both land on multiples of it — here 10.

:::demo ex-slider-step

:::tabs
~~~html title="app.html"
<Slider min={{ 0 }} max={{ 100 }} step={{ 10 }} value={{ rating() }} onChange={{ setRating }} label={{ 'Rating' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Slider from '@weave-framework/ui/slider';

export function setup() {
  const rating = signal(30);
  return { rating, setRating: (v) => rating.set(v) };
}
~~~
:::

## Uncontrolled — defaultValue

Give a `defaultValue` and omit `value`/`onChange`, and the slider keeps its own internal state — read
it only when you need it (e.g. on submit).

:::demo ex-slider-uncontrolled

:::tabs
~~~html title="app.html"
<Slider defaultValue={{ 25 }} label={{ 'Brightness' }} />
~~~
:::

## Format — aria-valuetext

`format` turns the raw number into the spoken `aria-valuetext` (screen readers announce "40 %" rather
than "40"). It's the same function you'll reuse for your own readout.

:::demo ex-slider-format

:::tabs
~~~html title="app.html"
<Slider min={{ 0 }} max={{ 100 }} step={{ 5 }} value={{ vol() }} onChange={{ setVol }} format={{ fmt }} label={{ 'Volume' }} />
<span>Value: {{ fmt(vol()) }}</span>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Slider from '@weave-framework/ui/slider';

export function setup() {
  const vol = signal(40);
  return { vol, setVol: (v) => vol.set(v), fmt: (v) => `${v}%` };
}
~~~
:::

## Disabled

`disabled` greys the track out, drops it from the tab order, and ignores pointer + keyboard input.

:::demo ex-slider-disabled

:::tabs
~~~html title="app.html"
<Slider value={{ v() }} onChange={{ setV }} disabled={{ true }} label={{ 'Locked' }} />
~~~
:::

## Forms control + validation

Bind a forms `Field<number>` with `control`: two-way value, `touched` on release, and `aria-invalid`
when the field is touched and invalid. Here the level must be at least 20 — drag below it, release, and
the error underline plus message appear. `control` wins over `value`.

:::demo ex-slider-control

:::tabs
~~~html title="app.html"
<FormField label={{ 'Level' }} error={{ levelError() }}>
  <Slider control={{ level }} min={{ 0 }} max={{ 100 }} step={{ 5 }} />
</FormField>
~~~
~~~ts title="app.ts"
import { field, validators } from '@weave-framework/forms';

export function setup() {
  const level = field(10, [validators.min(20, 'Pick at least 20')]);
  const levelError = () => (level.touched() ? level.error() ?? '' : '');
  return { level, levelError };
}
~~~
:::

## Custom class

`class` is forwarded onto the container, so you can hook your own CSS onto the slider — here to stretch
it to full width.

:::demo ex-slider-class

:::tabs
~~~html title="app.html"
<Slider value={{ v() }} onChange={{ setV }} class={{ 'my-wide-slider' }} label={{ 'Styled' }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Slider from '@weave-framework/ui/slider';

export function setup() {
  const v = signal(50);
  return { v, setV: (n) => v.set(n) };
}
~~~
:::
