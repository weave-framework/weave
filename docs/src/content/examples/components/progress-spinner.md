# Progress Spinner — examples

Every feature of `<ProgressSpinner>`, each as a live, self-contained example you can read and lift straight
into your project. The prose lives on the [Progress Spinner reference page](/ui/progress-spinner); this page
is just the examples, covering the full component surface.

```ts
import ProgressSpinner from '@weave-framework/ui/progress-spinner';
```
```scss
@use 'pkg:@weave-framework/ui/progress-spinner';
```

## Basic — the spinning ring

The default 26px ring. It's always indeterminate — a `role="progressbar"` with no `aria-valuenow`, since the
work has no measurable length. Give it a `label` so screen readers announce what's loading.

:::demo ex-progress-spinner-basic

:::tabs
~~~html title="app.html"
<ProgressSpinner label={{ 'Loading' }} />
~~~
~~~ts title="app.ts"
import ProgressSpinner from '@weave-framework/ui/progress-spinner';

export function setup() {
  return {};
}
~~~
:::

## Sizes — default & small

`small={{ true }}` swaps the default 26px ring for the compact 18px one — good next to text or inside a button.

:::demo ex-progress-spinner-sizes

:::tabs
~~~html title="app.html"
<ProgressSpinner label={{ 'Loading' }} />
<ProgressSpinner small={{ true }} label={{ 'Saving' }} />
~~~
:::

## Custom color via class

`class` is forwarded straight onto the ring, so a class that overrides `--weave-progress-spinner-indicator`
retints the arc — here green and red.

:::demo ex-progress-spinner-class

:::tabs
~~~html title="app.html"
<style>
  .spinner-accent { --weave-progress-spinner-indicator: #16a34a; }
  .spinner-danger { --weave-progress-spinner-indicator: #dc2626; }
</style>

<ProgressSpinner label={{ 'Loading' }} class={{ 'spinner-accent' }} />
<ProgressSpinner small={{ true }} label={{ 'Deleting' }} class={{ 'spinner-danger' }} />
~~~
:::

## In context — a signal-driven busy state

Drive the spinner from a `signal`: while `loading` is true the small ring sits inline next to the button, and
the button disables itself. This is the everyday use — a request in flight with no percentage to report.

:::demo ex-progress-spinner-in-button

:::tabs
~~~html title="app.html"
<Button on:click={{ save }} disabled={{ loading() }}>Save</Button>
@if (loading()) {
  <ProgressSpinner small={{ true }} label={{ 'Saving' }} />
  <span>Saving…</span>
}
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import ProgressSpinner from '@weave-framework/ui/progress-spinner';
import Button from '@weave-framework/ui/button';

export function setup() {
  const loading = signal(false);
  const save = () => {
    loading.set(true);
    setTimeout(() => loading.set(false), 2000);
  };
  return { loading, save };
}
~~~
:::
