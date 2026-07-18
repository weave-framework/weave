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
```txt
field<T>(initial: T, validators?: Validator<T>[], opts?: FieldOptions<T>): Field<T>

Validator<T>      = (value: T) => string | null
AsyncValidator<T> = (value: T, ctx: { signal: AbortSignal }) => Promise<string | null>
FieldOptions<T>   = { asyncValidate?: AsyncValidator<T>; debounceMs?: number }   // debounce default 300
```
Validators go in an **array as the second argument** — NOT in an options object, and there is no `validate` key on a field. Each entry in `validators` is a **factory that you must call**: `validators.email()`, not `validators.email`.

`use:control={{ field }}` binds the value both ways (picking `value`/`checked`/radio `group` from the element), sets `touched` on blur, and toggles `aria-invalid` while the field is touched **and** invalid — which is also the marker `submit` uses to focus the first error. Import `control` from **`@weave-framework/forms/dom`** (the core package stays DOM-free).

A field exposes: `value` (a **`Signal`** — read `value()`, write `value.set(v)`), `error()` (first message or null), `valid()`, `validating()`, `touched` (also a `Signal`, so `touched.set(true)`), `dirty()` (changed from its initial value; `pristine` is just `!dirty()`), `reset()`, `touchAll()`.

`dirty()` is `!Object.is(value(), initial)` — **reference** comparison. A field holding an object or array is dirty the moment you `.set()` a new one, even with identical contents; and setting it back to a structurally-equal-but-new object never returns it to clean. Prefer primitive-valued fields (or a group of them) over one object-valued field.

**`Control<T>` is the shared interface** every control implements — `value()`, `valid()`, `validating()`, `touched()`, `dirty()`, `reset()`, `touchAll()`. `Field<T>`, `Group<C>`, and `FieldArray<T>` all extend it, and aggregation is written purely against it, which is why they nest to any depth (`form → group → fieldArray → group → field`). `Field<T>` narrows two of them: `value` is a writable `Signal<T>` and `touched` is a writable `Signal<boolean>` (both still callable), and it adds `error()`.

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

```txt
group<C extends Controls>(controls: C, opts?: GroupOptions<C>): Group<C>

Controls          = Record<string, Control<unknown>>          // the child bag you pass in
ValuesOf<C>       = { [K in keyof C]: <that child's value type> }   // the typed nested snapshot
FormValidator<C>  = (values: ValuesOf<C>) => Record<string, string> | null
GroupOptions<C>   = { validate?: FormValidator<C> }
```
`ValuesOf` is what `Group.value()` returns and what `submit(handler)` hands your handler, so the shape is **nested, mirroring the control tree** — a child `group` contributes a nested object, a `fieldArray` contributes an array. It is derived, not declared: type the controls correctly and the snapshot type follows. To name it, write `ValuesOf<typeof f.controls>`.

**`submit`'s focus-the-first-error step reads `e.currentTarget`** — so it only works when the returned handler is wired to `<form on:submit>` and actually receives the event. Calling it bare (`f.submit(fn)()` from a button) still validates and gates, but focuses nothing.

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
```txt
fieldArray<T>(factory: (seed?: T) => Control<T>, seeds?: T[]): FieldArray<T>

FieldArray<T> extends Control<T[]>
  controls(): Control<T>[]   length(): number   value(): T[]
  push(seed?: T): void       removeAt(index: number): void
```
The factory returns a **`Control<T>`**, so an item can be a `field`, a whole `group`, or another `fieldArray` — `T` is that item's value type, and the array's own `value()` is `T[]`:
```ts
type Item = { text: string; done: boolean };
const checklist = fieldArray<Item>(
  (s) => group({ text: field(s?.text ?? ''), done: field(s?.done ?? false) }),
  [{ text: 'Write tests', done: false }],   // one seeded item
);
```
**There is no `insertAt`, `move`, or `swap`** — the whole mutation surface is `push`/`removeAt`. Don't reach for a reorder API; there isn't one.

Render items by **tracking the control object itself**, never `$index` — `removeAt` shifts every later index, so an index key re-associates the wrong DOM (and the wrong focus/`touched`) with the wrong item:
```html
@for (c of tags.controls(); track c) { <input use:control={{ c }} /> }
```

`reset()` rebuilds from the **original `seeds`**, so it discards pushed items rather than restoring "the list as loaded". And `dirty()` compares only `length !== seeds.length` (plus each item's own `dirty()`) — a push followed by a removeAt reads clean again on the length axis.

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
- **A group's snapshot is `value()`**, a method — there is no `.values` property. Its type is `ValuesOf<C>` and it is **nested**: a child group appears as a nested object, a `fieldArray` as an array. Don't assume a flat `{ field: value }` bag when the form has depth.
- **A group's `controls` is a plain object; a fieldArray's `controls` is a function.** `f.controls.email` vs `arr.controls()[0]`.
- **`track` a fieldArray item by the control object, not `$index`** — `removeAt` renumbers everything after it.
- **`field.value` and `field.touched` are `Signal`s**: write with `field.value.set(v)`, not `field.set(v)`.
- A handler that must run extra logic on change (coercion, a derived preview) stays an explicit `on:input` handler; `use:control` is for the plain bind. (See weave-templates for `bind:` vs handlers.)
- Validation is a **separate reactive computed** over the field's signal — switching a pure setter to `use:control`/`bind:` never disturbs it.
