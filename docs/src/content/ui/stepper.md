# Stepper

A wizard — numbered steps with connectors, one panel at a time, and built-in Back / Continue navigation. Done steps
get a checkmark, the current one is highlighted, upcoming ones are quiet. Use it for multi-step forms and flows.

:::demo stepper-demo

## Import

```ts
import Stepper from '@weave-framework/ui/stepper';
```

```scss
@use 'pkg:@weave-framework/ui/stepper';
```

## Basic usage

Describe the steps as data — each `{ label, content }` — and bind the current **index** with `value` + `onChange`.
The **Back / Continue** buttons come built in (Continue becomes **Finish** on the last step, firing `onComplete`):

:::tabs
~~~html title="app.html"
<Stepper steps={{ steps }} value={{ idx() }} onChange={{ setIdx }} onComplete={{ submit }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Stepper from '@weave-framework/ui/stepper';

export function setup() {
  const idx = signal(0);
  const steps = [
    { label: 'Account', content: 'Create your account.' },
    { label: 'Profile', content: 'Fill in your profile.' },
    { label: 'Confirm', content: 'Review and confirm.' },
  ];
  const submit = () => { /* all steps done */ };
  return { steps, idx, setIdx: (i) => idx.set(i), submit };
}
~~~
:::

`content` is a string, node, or factory (all panels mount, inactive ones hidden, so per-step form state survives
navigation — each panel's content is attached once, when the stepper mounts). Hide the built-in buttons with
`showNav={{ false }}` to drive navigation yourself.

## Linear mode

Set `linear={{ true }}` and forward navigation is gated on each step's `completed` flag — Continue only advances
once the current step is complete, and clicking a later step only works when every step in between is complete.
Going back is always allowed. Wire `completed` to a forms field's validity to keep the UI forms-decoupled:

```html
<Stepper steps={{ steps }} linear={{ true }} value={{ idx() }} onChange={{ setIdx }} />
```

Mark a step `optional: true` to let it be skipped even in linear mode.

## Accessibility

Steps are a `role="list"` with `aria-current="step"` on the active one; each panel is a `role="region"` labelled by
its step. Each step header is a real `<button>`, and one you can't navigate to right now (disabled, or blocked by
linear mode) carries `aria-disabled="true"`. The built-in nav are real Buttons. Step state is also exposed as a
`data-state` attribute (`done` / `active` / `upcoming`) — a styling hook, not an announcement.

## API reference

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `steps` | `StepItem[]` | — | The steps, each `{ label, content, completed?, optional?, disabled? }`. |
| `value` | `number` | — | Controlled current index. |
| `onChange` | `(index: number) => void` | — | Called with the next index on navigation. |
| `defaultIndex` | `number` | `0` | Uncontrolled initial index (ignored when `value` is set). |
| `linear` | `boolean` | `false` | Gate forward nav on `completed` steps. |
| `onComplete` | `() => void` | — | Fired when Finish is pressed on the last step. |
| `showNav` | `boolean` | `true` | Show the built-in Back / Continue buttons. |
| `backLabel` / `continueLabel` / `finishLabel` | `string` | Back / Continue / Finish | Button labels. |
| `disabled` | `boolean` | `false` | Disable the whole stepper. |
| `label` | `string` | — | Accessible name for the step list. |
| `class` | `string` | — | Extra classes forwarded onto the container. |
