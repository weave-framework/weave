# Progress Bar

A thin horizontal bar that shows how far along something is — a 4px track with an accent fill. Use it for uploads,
multi-step saves, anything with a measurable percentage; or in indeterminate mode for work whose length you don't
know yet.

:::demo progress-bar-demo

## Import

```ts
import ProgressBar from '@weave-framework/ui/progress-bar';
```

```scss
@use '@weave-framework/ui/progress-bar';
```

## Determinate

The default: pass `value` (0–100, clamped) and the fill grows to it. Bind it to a signal for live progress:

```html
<ProgressBar value={{ uploaded() }} label={{ 'Upload' }} />
```

It's a `role="progressbar"` with `aria-valuemin` / `-valuemax` / `-valuenow`, so assistive tech announces the
percentage. Give it a `label` for its accessible name.

## Indeterminate

When you can't measure progress (waiting on a request), set `indeterminate={{ true }}` — a segment slides across
instead, and `aria-valuenow` is omitted (per WAI-ARIA, only min/max remain):

```html
<ProgressBar indeterminate={{ true }} label={{ 'Loading' }} />
```

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `number` | `0` | Completion 0–100 (clamped). Ignored when `indeterminate`. |
| `indeterminate` | `boolean` | `false` | Unknown-length work: a sliding segment, no `aria-valuenow`. |
| `label` | `string` | — | Accessible name for the bar. |
| `class` | `string` | — | Extra classes forwarded onto the container. |
