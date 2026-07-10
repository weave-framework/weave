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
export function setup() {
  const email = field('', { validate: validators.email });
}
```
```html
<input type="email" use:control={{ email }} />
@if (email.touched() && email.error()) { <span class="err">{{ email.error() }}</span> }
```
`use:control={{ field }}` binds value both ways, tracks `touched` on blur, and sets `aria-invalid`. A field exposes: `value()`, `set(v)`, `error()` (reactive message or null), `valid()`, `validating()` (true while an async check runs), `touched()`, `touchAll()`.

## Composing a form

```ts
import { form, field, validators } from '@weave-framework/forms';
export function setup() {
  const f = form({
    email: field('', { validate: validators.email }),
    password: field('', { validate: validators.minLength(8) }),
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
A form/group exposes: `controls` (the fields), `values` (a typed snapshot), `valid()`, `validating()`, `touchAll()`, and **`submit(handler)`** — which validates (awaiting async), focuses the first invalid control, and only then runs `handler(values)`. `group(...)` nests; `fieldArray(...)` is a dynamic list of fields (add/remove rows).

## Validators

`validators` provides the common ones (`required`, `email`, `minLength`, `maxLength`, `pattern`, …). A validator is just `(value) => string | null` (message or null) — write your own inline:

```ts
const age = field(0, { validate: (v) => (v >= 18 ? null : 'Must be 18+') });
```
Compose several by passing an array, or combine in one function.

## Async validation (server checks)

Provide `asyncValidate` for a debounced server check (uniqueness, availability). While it runs, `field.validating()` is `true`; the error lands when it settles. A **sync** (format) error skips the server call entirely.

```ts
const username = field('', {
  validate: validators.minLength(3),
  asyncValidate: async (v) => ((await api.isTaken(v)) ? 'Already taken' : null),
});
```
`form.submit(...)` awaits async validation before deciding — so a slow uniqueness check can't let an invalid submit through.

## Patterns

- **Gate the submit button** on `!f.valid() || f.validating()`.
- **Show an error only after interaction**: `@if (field.touched() && field.error())`.
- **Dirty tracking / unsaved-changes**: compare `f.values` to a captured baseline; combine with the router's `beforeEach` leave guard (weave-router).
- **Defaults / reset**: build the form with initial values; re-create or `.set()` fields to reset.

## Gotchas

- **`use:control` wants the field object**, not its value: `use:control={{ f.controls.email }}`.
- Read `field.value()` / `field.error()` with `()` — they're reactive.
- A handler that must run extra logic on change (coercion, a derived preview) stays an explicit `on:input` handler; `use:control` is for the plain bind. (See weave-templates for `bind:` vs handlers.)
- Validation is a **separate reactive computed** over the field's signal — switching a pure setter to `use:control`/`bind:` never disturbs it.
