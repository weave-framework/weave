# Progress Bar — examples

Every feature of `<ProgressBar>`, each as a live, self-contained example you can read and lift straight
into your project. The prose lives on the [Progress Bar reference page](/ui/progress-bar); this page is
just the examples, covering the full component surface.

```ts
import ProgressBar from '@weave-framework/ui/progress-bar';
```
```scss
@use '@weave-framework/ui/progress-bar';
```

## Determinate — value + label

The default: `value` (0–100, clamped) drives the accent fill, and `label` is the accessible name. Bind
`value` to a signal for live progress — the buttons here move it.

:::demo ex-progress-bar-determinate

:::tabs
~~~html title="app.html"
<ProgressBar value={{ pct() }} label={{ 'Upload' }} />
<Button on:click={{ bump }}>+10%</Button>
<Button variant={{ 'outline' }} on:click={{ reset }}>Reset</Button>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import ProgressBar from '@weave-framework/ui/progress-bar';
import Button from '@weave-framework/ui/button';

export function setup() {
  const pct = signal(40);
  return {
    pct,
    bump: () => pct.set((n) => Math.min(100, n + 10)),
    reset: () => pct.set(0),
  };
}
~~~
:::

## Value ladder & clamping

A range of fixed `value`s from 0 to 100. Values outside 0–100 are clamped, so `140` renders as a full
bar.

:::demo ex-progress-bar-values

:::tabs
~~~html title="app.html"
<ProgressBar value={{ 0 }} label={{ '0%' }} />
<ProgressBar value={{ 25 }} label={{ '25%' }} />
<ProgressBar value={{ 50 }} label={{ '50%' }} />
<ProgressBar value={{ 75 }} label={{ '75%' }} />
<ProgressBar value={{ 100 }} label={{ '100%' }} />
<ProgressBar value={{ 140 }} label={{ 'Clamped to 100' }} />
~~~
:::

## Indeterminate

When you can't measure progress, set `indeterminate={{ true }}` — a segment slides across instead, and
`aria-valuenow` is omitted (per WAI-ARIA, only min/max remain).

:::demo ex-progress-bar-indeterminate

:::tabs
~~~html title="app.html"
<ProgressBar indeterminate={{ true }} label={{ 'Loading' }} />
~~~
:::

## Custom class

`class` is forwarded onto the container, so a local rule can restyle the track and fill — here a taller,
rounded bar.

:::demo ex-progress-bar-class

:::tabs
~~~html title="app.html"
<style>
  .tall-progress { height: 10px; border-radius: 5px; }
  .tall-progress .weave-progress-bar__fill { border-radius: 5px; }
</style>
<ProgressBar value={{ 60 }} class={{ 'tall-progress' }} label={{ 'Custom track' }} />
~~~
:::
