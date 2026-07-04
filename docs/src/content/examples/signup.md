# Sign-up wizard

A multi-step form where each step must be valid before you can move on — the classic wizard. This one is built on
[`Stepper`](/ui/stepper) for the flow and [`@weave-framework/forms`](/learn/forms) for the validation, and the two
meet at one point: **the Stepper's per-step `completed` flag is wired straight to each step's form validity.** When
the fields are valid, Continue lights up. That's the entire integration.

:::demo examples-signup

Try to press **Continue** with an empty field — it's disabled. Fill in a valid email and password and it wakes
up. The **Review** step gates **Finish** on the terms checkbox.

## What it shows

- **A real form model** — [`field`](/learn/forms) with `validators` (required, email, minLength); each field
  derives its own `error()`, `valid()`, and `touched()`.
- **`control` binding** — every control takes a `control={{ field }}` prop: [`Input`](/ui/input),
  [`Select`](/ui/select), and [`Checkbox`](/ui/checkbox) all bind two-way to a forms `Field`, mark it touched on
  blur, and show the error — no manual value/`onInput` wiring.
- **Validity drives the UI** — a `computed` per step feeds the `Stepper`'s `completed` flag; in `linear` mode
  that's what enables or blocks **Continue**.
- **Auto error display** — wrap a control in a [`FormField`](/ui/form-field) with the same `control`, and the
  label + error line derive themselves from `touched() && error()`.

## The form model

Every field is one line: an initial value and an ordered list of validators. The first failing validator's
message becomes `field.error()`. Step validity is then just a `computed` combining the relevant fields.

:::tabs
~~~ts title="form model (in app.ts)"
import { field, validators } from '@weave-framework/forms';
import { computed } from '@weave-framework/runtime';

const email = field('', [validators.required('Email is required'), validators.email()]);
const password = field('', [
  validators.required('Password is required'),
  validators.minLength(8, 'At least 8 characters'),
]);
const fullName = field('', [validators.required('Your name is required')]);
const role = field('developer');
const terms = field(false, [validators.required('You must accept the terms to continue')]);

// Each step is "complete" when its fields are valid.
const accountValid = computed(() => email.valid() && password.valid());
const profileValid = computed(() => fullName.valid() && role.valid());
const reviewValid = computed(() => terms.valid());
~~~
:::

:::callout tip "The whole Stepper ↔ forms bridge"
`Stepper` doesn't know what a form is. It just reads a `completed` boolean per step and, in `linear` mode, blocks
Continue until the current step is complete. You hand it `completed: accountValid()` — a signal — and the two
systems are wired together. Nothing else.
:::

## Binding a control to a field

This is the idiomatic forms pattern: give the control a `control` prop and it does the rest — reads the value,
writes it back, marks the field touched on blur, and turns red when `touched() && error()`. Wrapping it in a
`FormField` with the same `control` adds the label and the error message.

:::tabs
~~~ts title="a bound field (in app.ts)"
import FormField from '@weave-framework/ui/form-field';
import Input from '@weave-framework/ui/input';

// A labelled text field bound to a forms Field. In a template you'd write this as
// <FormField label control={{ email }}><Input control={{ email }} /></FormField>.
const textField = (f, label, type) =>
  FormField({ label, control: f }, { default: () => Input({ control: f, type }) });
~~~
~~~html title="the same thing, as template markup"
<FormField label={{ 'Email' }} control={{ email }}>
  <Input control={{ email }} type={{ 'email' }} />
</FormField>
~~~
:::

The template form on the right is what you'd write when a step is its own component. This demo builds the three
step panels as content factories so the whole wizard fits in one file — but the binding is identical either way:
`control={{ field }}` in, error out.

## The steps

Each step is a `{ label, content, completed }` object. `content` is a factory that builds that step's panel;
`completed` is the validity signal. The `Stepper` renders the numbered header, the active panel, and the
**Back / Continue** buttons — Continue becomes **Finish** on the last step and fires `onComplete`.

:::tabs
~~~ts title="steps + finish (in app.ts)"
const step = signal(0);
const steps = computed(() => [
  { label: 'Account', content: accountPanel, completed: accountValid() },
  { label: 'Profile', content: profilePanel, completed: profileValid() },
  { label: 'Review', content: reviewPanel, completed: reviewValid() },
]);

const complete = () => {
  // Finish isn't gated on the last step in linear mode, so enforce the terms here:
  // touch the field (surfacing its error) and bail if it isn't accepted yet.
  if (!reviewValid()) {
    terms.touchAll();
    return;
  }
  snackbar('Account created — welcome aboard!', { duration: 3500 });
};
~~~
~~~html title="app.html"
<Stepper
  steps={{ steps() }}
  value={{ step() }}
  onChange={{ setStep }}
  linear={{ true }}
  onComplete={{ complete }}
  label={{ 'Create your account' }}
/>
~~~
:::

:::callout warn "Finish needs its own guard"
`linear` mode blocks *advancing* past an incomplete step, but the **Finish** button on the last step isn't gated
that way — so a required last-step field (the terms checkbox) has to be enforced in `onComplete`. Touch the field
to surface its error and return early; only proceed when it's valid.
:::

## Notes

- **`control` beats manual wiring.** You *can* use `value` + `onInput` and read `field.error()` yourself — but the
  `control` prop folds value, touched, and error into one binding, and it's the same prop on Input, Select,
  Checkbox, Slide Toggle, and Radio.
- **Errors wait for a touch.** A field's error only shows once it's `touched()` (set on blur), so the form doesn't
  scream "Required" at fields the user hasn't reached yet. Continue is still correctly disabled the whole time —
  validity and error *display* are separate concerns.
- **The Review step is derived.** Its summary reads `email.value()`, `fullName.value()`, and `role.value()`
  directly — no copying into a separate object, because the fields *are* the source of truth.

Last one, and it's the most tactile: the [Kanban board](/examples/kanban) is pure drag, drop, and reorder.
