---
name: weave-forms
description: >-
  Build forms in a Weave app with @weave-framework/forms. Use this whenever you
  work with form state, inputs, validation, or submission: `field`, `form`,
  `group`, `fieldArray`, `validators`, the `use:control` binding, sync + async
  validation (debounced server checks), touched/dirty state, error display, and
  gated submit. Reach for it on any mention of a form, input validation, "required
  field", login/signup/settings forms, or submit handling — even a casual "add a
  form" or "validate this input".
---

# Weave forms

`@weave-framework/forms` is a signal-based form engine: a **field** is reactive
state + validation; a **form**/**group** composes fields; `use:control` wires a
field to a DOM input. Zero deps; validation is reactive, so errors and validity
recompute from the field's signal — you never poll.

## A field bound to an input

```ts
import { field, validators } from '@weave-framework/forms';
import { control } from '@weave-framework/forms/dom';   // needed for use:control
export function setup() {
  const email = field('', [validators.email()]);
}
```
```html
<input type="email" use:control={{ email }} />
@if (email.touched() && email.error()) { <span class="err">{{ email.error() }}</span> }
```

**The signature is positional — this is the #1 thing to get right:**
```ts
field<T>(initial: T, validators?: Validator<T>[], opts?: { asyncValidate?, debounceMs? })
```
Validators go in an **array as the second argument** — NOT in an options object, and there is no `validate` key on a field. Each entry in `validators` is a **factory that you must call**: `validators.email()`, not `validators.email`.

`use:control={{ field }}` binds the value both ways (picking `value`/`checked`/radio `group` from the element), sets `touched` on blur, and toggles `aria-invalid` while the field is touched **and** invalid — which is also the marker `submit` uses to focus the first error. Import `control` from **`@weave-framework/forms/dom`** (the core package stays DOM-free).

A field exposes: `value` (a **`Signal`** — read `value()`, write `value.set(v)`), `error()` (first message or null), `valid()`, `validating()`, `touched` (also a `Signal`, so `touched.set(true)`), `dirty()` (changed from its initial value; `pristine` is just `!dirty()`), `reset()`, `touchAll()`.

## Composing a form

```ts
import { form, field, validators } from '@weave-framework/forms';
export function setup() {
  const f = form({
    email: field('', [validators.required(), validators.email()]),
    password: field('', [validators.minLength(8)]),
  });
  const submit = f.submit(async (values) => { await api.login(values); });
}
```
```html
<form on:submit|preventDefault={{ submit }}>
  <input use:control={{ f.controls.email }} />
  <input type="password" use:control={{ f.controls.password }} />
  <button disabled={{ !f.valid() || f.validating() }}>Sign in</button>
</form>
```
A form/group exposes: `controls` (the children), **`value()`** (a typed nested snapshot — a method, not a `values` property), `valid()`, `validating()`, `touched()`, `dirty()`, `formError()`, `submitting()`, `submitError()`, `reset()`, `touchAll()`, `validateAsync()`, and **`submit(handler)`** — which `preventDefault`s, calls `touchAll()` to reveal every error, awaits async validation, focuses the first `aria-invalid` control if invalid, and only then runs `handler(value())` while tracking `submitting()`/`submitError()`.

`form` **is** `group` (the same function under a conventional name for the top level). Groups nest arbitrarily; `fieldArray(...)` is a dynamic list.

**Cross-field validation** lives on the group's options:
```ts
const f = form(
  { password: field(''), confirm: field('') },
  { validate: (v) => (v.password === v.confirm ? null : { confirm: 'Does not match' }) },
);
```
Returned keys target this group's direct **field** children (the message lands on that field's `error()`). The reserved `FORM_ERROR_KEY` (`'_form'`) key surfaces on `f.formError()` instead of any one field.

**`fieldArray(factory, seeds?)`** — `factory(seed?)` builds one item (field, group, or nested array):
```ts
const tags = fieldArray(() => field('', [validators.required()]));
tags.push();            // append; also removeAt(i), controls(), length(), value()
```
*Caveat:* items added by `push` are created outside a component owner, so an item that registers its own effects (`asyncValidate`, or a group `validate`) won't dispose on `removeAt` — only when the component unmounts. Plain sync-validated items are unaffected.

## Validators

`validators` ships **exactly seven**, each a factory taking an optional custom message:

| Validator | Signature |
| --- | --- |
| `required` | `(msg?) => Validator<unknown>` |
| `minLength` / `maxLength` | `(n, msg?) => Validator<string>` |
| `pattern` | `(re, msg?) => Validator<string>` |
| `email` | `(msg?) => Validator<string>` |
| `min` / `max` | `(n, msg?) => Validator<number>` |

There is no `oneOf`, `url`, `numeric`, or similar — don't invent one; write it inline. A validator is just `(value) => string | null` (message or null):

```ts
const age = field(0, [(v) => (v >= 18 ? null : 'Must be 18+')]);
```
Validators run in order and **the first failure wins**.

## Async validation (server checks)

`asyncValidate` goes in the **third** argument (the options object) — a debounced, abortable server check (uniqueness, availability). While it runs, `field.validating()` is `true`; the error lands when it settles. A **sync** (format) error skips the server call entirely, and a newer edit aborts the in-flight one.

```ts
const username = field(
  '',
  [validators.minLength(3)],                                        // 2nd arg: sync validators
  {                                                                  // 3rd arg: options
    asyncValidate: async (v, { signal }) => ((await api.isTaken(v, { signal })) ? 'Already taken' : null),
    debounceMs: 300,                                                 // default 300
  },
);
```
The async validator receives `(value, { signal })` — pass that `AbortSignal` to your fetch so a superseded check is cancelled.
`form.submit(...)` awaits async validation before deciding — so a slow uniqueness check can't let an invalid submit through.

## Patterns

- **Gate the submit button** on `!f.valid() || f.validating()`.
- **Show an error only after interaction**: `@if (field.touched() && field.error())`.
- **Dirty tracking / unsaved-changes**: use the built-in **`f.dirty()`** — don't hand-roll a baseline comparison. Combine with the router's `beforeEach` leave guard (weave-router).
- **Defaults / reset**: build the form with initial values and call **`f.reset()`** (restores every child's initial value and clears touched/errors).
- **Submit feedback**: gate on `f.submitting()` and surface `f.submitError()`; show group-level errors from `f.formError()`.

## Gotchas

- **Validators are a positional array, not an option**: `field('', [validators.email()])`. There is no `{ validate: … }` on a field — that key exists only on a **group**, for cross-field validation.
- **Call the validator factory**: `validators.required()`, not `validators.required`.
- **`use:control` wants the field object**, not its value: `use:control={{ f.controls.email }}`. Import `control` from `@weave-framework/forms/dom`.
- **A group's snapshot is `value()`**, a method — there is no `.values` property.
- **`field.value` and `field.touched` are `Signal`s**: write with `field.value.set(v)`, not `field.set(v)`.
- A handler that must run extra logic on change (coercion, a derived preview) stays an explicit `on:input` handler; `use:control` is for the plain bind. (See weave-templates for `bind:` vs handlers.)
- Validation is a **separate reactive computed** over the field's signal — switching a pure setter to `use:control`/`bind:` never disturbs it.
