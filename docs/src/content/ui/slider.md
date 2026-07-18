# Slider

Drag a value along a range — volume, opacity, a price filter. `<Slider>` is a custom `role="slider"` (not a native
`<input type="range">`) so it can wear the Weave thumb — a 3×18 ink bar with an accent cap — and an accent fill up
to the value. Keyboard, focus, ARIA, and form binding are all provided, so it behaves exactly like a native one.

:::demo slider-basic

## Import

```ts
import Slider from '@weave-framework/ui/slider';
```

```scss
@use 'pkg:@weave-framework/ui/slider';
```

## Basic usage

Set the range with `min` / `max` / `step` and bind the number with `value` + `onChange`. `format` turns the value
into the spoken `aria-valuetext` (and is handy for your own readout too):

:::tabs
~~~html title="app.html"
<Slider min={{ 0 }} max={{ 100 }} step={{ 5 }} value={{ vol() }} onChange={{ setVol }} format={{ fmt }} label={{ 'Volume' }} />
<p>Volume: {{ vol() }}%</p>
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

Values snap to the `step` grid (measured from `min`) and clamp to the range, so `onChange` always gives you a valid
number.

## Controlled, uncontrolled, or forms

Three ways to hold the value:

- **Controlled** — `value` + `onChange` (above).
- **Uncontrolled** — `defaultValue` and let the slider keep its own state.
- **Forms** — a `control` (`Field<number>`), which marks `touched` when a drag ends or a key changes the value, and
  drives `aria-invalid`.

```html
<Slider control={{ form.controls.level }} step={{ 5 }} />
<Slider defaultValue={{ 25 }} label={{ 'Brightness' }} />
```

## Accessibility

It's the full WAI-ARIA slider pattern: `aria-valuemin` / `aria-valuemax` / `aria-valuenow`, plus `aria-valuetext`
from your `format`. Focus it and use **← / →** (or **↑ / ↓**) to step, **Page Up / Page Down** for a bigger jump
(a tenth of the range, or one `step` if that's larger), and **Home / End** for the ends. Under `dir="rtl"` the
horizontal arrows flip to match the reversed track; ↑ / ↓ always mean more / less. Pointer drag works too (with
pointer capture, so the drag survives leaving the track). Give it a `label` for its accessible name.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `min` | `number` | `0` | Range lower bound. |
| `max` | `number` | `100` | Range upper bound. |
| `step` | `number` | `1` | Step increment (values snap to this). |
| `value` | `number` | — | Controlled value. Ignored when `control` is set. |
| `onChange` | `(value: number) => void` | — | Called with the next value on change. |
| `defaultValue` | `number` | `min` | Uncontrolled initial value (ignored when `value`/`control` set). |
| `control` | `Field<number>` | — | A forms field — two-way + touched on drag-end/key + aria-invalid. Wins over `value`. |
| `disabled` | `boolean` | `false` | Disable the slider. |
| `label` | `string` | — | Accessible name. |
| `format` | `(value: number) => string` | *the number* | Formats the value for `aria-valuetext`. |
| `class` | `string` | — | Extra classes forwarded onto the container. |
