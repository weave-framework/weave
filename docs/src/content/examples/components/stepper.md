# Stepper — examples

Every feature of `<Stepper>`, each as a live, self-contained example you can read and lift straight into
your project. The prose lives on the [Stepper reference page](/ui/stepper); this page is just the examples,
covering the full component surface.

```ts
import Stepper from '@weave-framework/ui/stepper';
```
```scss
@use '@weave-framework/ui/stepper';
```

## Basic — steps + value + onChange

Describe the steps as data — each `{ label, content }` — and bind the current **index** with `value` +
`onChange`. The **Back / Continue** buttons come built in; Continue becomes **Finish** on the last step,
firing `onComplete`.

:::demo ex-stepper-basic

:::tabs
~~~html title="app.html"
<Stepper steps={{ steps }} value={{ idx() }} onChange={{ setIdx }} onComplete={{ submit }} />
<p>On step {{ idx() + 1 }} of {{ steps.length }}.{{ done() ? ' Finished!' : '' }}</p>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Stepper from '@weave-framework/ui/stepper';

export function setup() {
  const idx = signal(0);
  const done = signal(false);
  const steps = [
    { label: 'Account', content: 'Step 1 — create your account.' },
    { label: 'Profile', content: 'Step 2 — fill in your profile.' },
    { label: 'Confirm', content: 'Step 3 — review and confirm.' },
  ];
  return { steps, idx, setIdx: (i) => idx.set(i), done, submit: () => done.set(true) };
}
~~~
:::

## External nav — showNav={{ false }}

`showNav={{ false }}` hides the built-in buttons so your own controls drive the current index. The header
still reflects the index and stays clickable.

:::demo ex-stepper-external-nav

:::tabs
~~~html title="app.html"
<Stepper steps={{ steps }} value={{ idx() }} onChange={{ setIdx }} showNav={{ false }} />
<Button variant={{ 'outline' }} disabled={{ atStart() }} on:click={{ back }}>Previous</Button>
<Button disabled={{ atEnd() }} on:click={{ next }}>Next</Button>
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Stepper from '@weave-framework/ui/stepper';
import Button from '@weave-framework/ui/button';

export function setup() {
  const idx = signal(0);
  const steps = [
    { label: 'Cart', content: 'Review the items in your cart.' },
    { label: 'Shipping', content: 'Enter a delivery address.' },
    { label: 'Payment', content: 'Choose how to pay.' },
  ];
  const last = steps.length - 1;
  return {
    steps, idx, setIdx: (i) => idx.set(i),
    atStart: () => idx() === 0,
    atEnd: () => idx() === last,
    back: () => idx.set(Math.max(0, idx() - 1)),
    next: () => idx.set(Math.min(last, idx() + 1)),
  };
}
~~~
:::

## Linear — completed gating

`linear` gates forward navigation on a fully-`completed` prefix — Continue is disabled and downstream steps
are unreachable until the current step is marked done. The `completed` flag is the consumer's to set (wire
it to a forms `Field`'s validity). Mark each step complete to unlock the next.

:::demo ex-stepper-linear

:::tabs
~~~html title="app.html"
<Stepper steps={{ steps }} value={{ idx() }} onChange={{ setIdx }} linear={{ true }} />
@if (idx() < 2) {
  <Button variant={{ 'outline' }} on:click={{ completeCurrent }}>Mark step {{ idx() + 1 }} complete</Button>
}
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Stepper from '@weave-framework/ui/stepper';
import Button from '@weave-framework/ui/button';

export function setup() {
  const idx = signal(0);
  const step0Done = signal(false);
  const step1Done = signal(false);
  const steps = () => [
    { label: 'Terms', content: 'Accept the terms to continue.', completed: step0Done() },
    { label: 'Details', content: 'Fill in your details.', completed: step1Done() },
    { label: 'Done', content: 'All set — finish up.' },
  ];
  const completeCurrent = () => { idx() === 0 ? step0Done.set(true) : step1Done.set(true); };
  return { steps, idx, setIdx: (i) => idx.set(i), completeCurrent };
}
~~~
:::

## Optional steps

An `optional` step shows an "Optional" caption and, in `linear` mode, doesn't gate Continue — you can skip
it without marking it `completed`.

:::demo ex-stepper-optional

:::tabs
~~~html title="app.html"
<Stepper steps={{ steps }} value={{ idx() }} onChange={{ setIdx }} linear={{ true }} />
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Stepper from '@weave-framework/ui/stepper';

export function setup() {
  const idx = signal(0);
  const steps = [
    { label: 'Basics', content: 'The required basics.', completed: true },
    { label: 'Extras', content: 'Nice-to-have extras — skip if you like.', optional: true },
    { label: 'Finish', content: 'Wrap it up.' },
  ];
  return { steps, idx, setIdx: (i) => idx.set(i) };
}
~~~
:::

## Disabled — per-step and whole control

A per-step `disabled` flag makes one step non-navigable; the stepper-level `disabled` prop freezes the whole
control (header + built-in buttons).

:::demo ex-stepper-disabled

:::tabs
~~~html title="app.html"
<Stepper steps={{ steps }} value={{ idx() }} onChange={{ setIdx }} disabled={{ frozen() }} />
<input type="checkbox" checked={{ frozen() }} on:change={{ toggle }} /> Freeze the whole stepper
~~~
~~~ts title="app.ts"
import { signal } from '@weave-framework/runtime';
import Stepper from '@weave-framework/ui/stepper';

export function setup() {
  const idx = signal(0);
  const frozen = signal(false);
  const steps = [
    { label: 'Start', content: 'The first step.' },
    { label: 'Locked', content: 'This step is disabled.', disabled: true },
    { label: 'End', content: 'The last step.' },
  ];
  return { steps, idx, setIdx: (i) => idx.set(i), frozen, toggle: () => frozen.set(!frozen()) };
}
~~~
:::

## Uncontrolled + custom labels + class

Uncontrolled via `defaultIndex` (no `value`/`onChange` — the stepper owns its index), with custom
`backLabel` / `continueLabel` / `finishLabel`, an accessible `label` for the step list, and an extra `class`.

:::demo ex-stepper-labels

:::tabs
~~~html title="app.html"
<Stepper
  steps={{ steps }}
  defaultIndex={{ 1 }}
  label={{ 'Signup progress' }}
  backLabel={{ 'Previous' }}
  continueLabel={{ 'Next step' }}
  finishLabel={{ 'Subscribe' }}
  class={{ 'my-stepper' }}
/>
~~~
~~~ts title="app.ts"
import Stepper from '@weave-framework/ui/stepper';

export function setup() {
  const steps = [
    { label: 'Pick a plan', content: 'Choose the plan that fits.' },
    { label: 'Add-ons', content: 'Bolt on any extras.' },
    { label: 'Review', content: 'Confirm and subscribe.' },
  ];
  return { steps };
}
~~~
:::
