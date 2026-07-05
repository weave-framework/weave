# Forms

`@weave-framework/forms` is signal-native form state and validation. A field is a writable signal plus a few derived bits (`error`/`valid`/`touched`) — so your template binds the value and reads errors directly, all surgically reactive. No form-library runtime, no boilerplate. And because every control shares one shape, the same primitives compose from a single input up to deeply nested groups and arrays. Zero dependencies.

There are three building blocks — `field`, `group` (aka `form`), and `fieldArray` — plus a `use:control` directive that wires a field to a DOM input, and a `validators` bag of ready-made checks. We'll walk through each, including the sharp edges.

## The mental model: one `Control`, three shapes

Everything in `@weave-framework/forms` is a **`Control`**. A `field`, a `group`, and a `fieldArray` all implement the same interface, which is why they nest to any depth (`form → fieldArray → group → field`) and aggregate validity/values/touched the whole way up. It's the Weave analog of Angular's `AbstractControl`.

Here's the shared shape every control gives you:

| Member | Type | Meaning |
|--------|------|---------|
| `value()` | reactive | This control's value — a field's value, a group's nested snapshot, or an array's items |
| `valid()` | reactive | `true` when this control **and every descendant** is valid |
| `validating()` | reactive | `true` while an async check is in flight here or in any descendant |
| `touched()` | reactive | `true` once this control (or any descendant) has been touched |
| `dirty()` | reactive | `true` once this control (or any descendant) has **changed from its initial value** |
| `reset()` | method | Restore initial value(s) and clear touched/errors |
| `touchAll()` | method | Mark this control **and every descendant** touched — e.g. on a failed submit, to reveal all errors |

`touched` and `dirty` answer different questions: **`touched`** is about *interaction* (the field was blurred), **`dirty`** is about *value change*. `pristine` is simply `!dirty()`. Both are derived and cascade up a group/array, and `reset()` clears them. Use `dirty()` for "unsaved changes" guards or to enable a Save button only when something actually changed:

~~~ts
const changed = form.dirty();     // true if any field differs from its initial value
~~~

Two of those are worth calling out now because the brief leans on them later:

- **`touchAll()`** is a real, callable method on every control. On a `field` it's equivalent to `field.touched.set(true)`; on a `group` or `fieldArray` it recurses into every child. `form.submit(...)` calls it for you, but you can call it yourself for a custom "validate now, show everything" button.
- **`validateAsync(): Promise<boolean>`** (on groups — see [Submitting](#submitting)) settles any in-flight async validation and then resolves with the current validity.

One more exported constant lives alongside these: **`FORM_ERROR_KEY`** — the string `'_form'`. It's the reserved key a cross-field validator uses for a group-level error that isn't bound to any one field. You can import it instead of hardcoding the literal:

~~~ts title="form.ts"
import { FORM_ERROR_KEY } from '@weave-framework/forms'; // === '_form'
~~~

## A field

`field(initial, validators?, options?)` is the unit. It's a signal you can bind, with validation layered on top:

~~~ts title="field.ts"
import { field, validators } from '@weave-framework/forms';

const title = field('', [
  validators.required('A title is required'),
  validators.minLength(3, 'At least 3 characters'),
  validators.maxLength(80),
]);
~~~

A field exposes everything in the `Control` table above, plus an `error()`:

| Member | Type | Meaning |
|--------|------|---------|
| `value` | writable signal | The editable value — bind it, or read `value()` / write `value.set(...)` |
| `error()` | reactive | First error message across all layers, or `null` |
| `valid()` | reactive | `true` when `error()` is `null` |
| `touched` | writable signal | Has the user visited it? **Gates when errors show.** You can `touched.set(true)` by hand |
| `validating()` | reactive | Is an async check in flight? |
| `reset()` | method | Restore the initial value; clear touched **and** external/async errors and `validating` |
| `touchAll()` | method | Same as `touched.set(true)` (here for `Control` parity) |

Note that `value` and `touched` are **writable signals** (so you can read or write them directly), while `error`/`valid`/`validating` are read-only reactive getters.

### `field` options

The third argument is `FieldOptions<T>`:

| Option | Default | Meaning |
|--------|---------|---------|
| `asyncValidate` | none | An async check (e.g. "username taken?"). Runs only when the sync validators pass — see [Async validation](#async-validation) |
| `debounceMs` | `300` | Quiet window before the async check fires. Overrides the default 300 ms |

### Error precedence

`error()` is a single string (or `null`), but three layers can produce it. They're checked in a strict order — the first non-null wins:

1. **Sync validators** — the field's own ordered `validators` (first failing validator's message).
2. **Cross-field** — an error pushed down by a parent group's `validate` (stored internally as `_external`). See [Grouping fields](#grouping-fields).
3. **Async** — the result of `asyncValidate`.

So a format error always hides a cross-field or async error, and a cross-field error always hides an async one. That's deliberate: you never run a server check on a value the sync layer already rejected, and you never show a stale async message over a fresh format problem.

### `reset()` clears more than the value

`field.reset()` restores the initial value **and** sets `touched` back to `false`, clears any cross-field (external) error, clears the async error, and sets `validating` to `false`. It's a full wipe back to the field's birth state, not just a value reset.

## Built-in validators

A custom validator is just `(value) => string | null` — return a message to fail, `null` to pass:

~~~ts title="custom-validator.ts"
const slug = field('', [(v) => /^[a-z0-9-]+$/.test(v) ? null : 'Lowercase, digits, dashes only']);
~~~

The `validators` bag ships the common ones. Every one takes an **optional** message; omit it and you get a sensible default. Validators run in order and the first failure wins.

| Validator | Operates on | Fails when… | Default message |
|-----------|-------------|-------------|-----------------|
| `required(msg?)` | `unknown` | value is `null`, `undefined`, `''`, an **empty array**, or `false` | `Required` |
| `minLength(n, msg?)` | `string` | `(value ?? '').length < n` (tolerates null/undefined) | `Must be at least {n} characters` |
| `maxLength(n, msg?)` | `string` | `(value ?? '').length > n` (tolerates null/undefined) | `Must be at most {n} characters` |
| `min(n, msg?)` | `number` | `value < n` — **strict**, so `value === n` passes | `Must be ≥ {n}` |
| `max(n, msg?)` | `number` | `value > n` — **strict**, so `value === n` passes | `Must be ≤ {n}` |
| `pattern(re, msg?)` | `string` | `re.test(value ?? '')` is false | `Invalid format` |
| `email(msg?)` | `string` | the value doesn't match the email regex | `Enter a valid email` |

A few sharp edges worth knowing:

- **`required` is typed `unknown`, not string-only**, and it fails on an empty array or on `false`. That means it doubles as a "must check this box" rule (a `false` checkbox fails) and a "must pick at least one" rule (an empty multi-select array fails). One validator, three jobs.
- **`min`/`max` are strict** (`<` and `>`), so the boundary value itself is allowed. `min(18)` passes on exactly `18`.
- **`minLength`/`maxLength` tolerate `null`/`undefined`** — they coalesce to `''` first, so they won't blow up on an uninitialized value (treated as length 0).
- **`email` uses a deliberately loose regex** — `^[^\s@]+@[^\s@]+\.[^\s@]+$`. It catches the obvious mistakes (no `@`, no dot) but it is **not** RFC-strict. For example, `a@b.c` passes. If you need real verification, do it server-side with `asyncValidate`.

~~~ts title="validators.ts"
validators.required(msg?)
validators.minLength(n, msg?)   validators.maxLength(n, msg?)
validators.min(n, msg?)         validators.max(n, msg?)
validators.pattern(regexp, msg?)
validators.email(msg?)
~~~

## Binding a field to the DOM

You *could* wire `bind:value` + a blur handler + `aria-invalid` by hand. Don't — `use:control` from `@weave-framework/forms/dom` does all three in one directive:

:::tabs
~~~html title="form.html"
<label class="field">
  <span>Title</span>
  <input type="text" use:control={{ fields.title }} />
  @if (fields.title.error()) {
    <span class="msg">{{ fields.title.error() }}</span>
  }
</label>
~~~
~~~ts title="form.ts"
import { control } from '@weave-framework/forms/dom';
// expose `control` and the fields from setup:
return { fields: { title }, control };
~~~
:::

`use:control` does exactly three things:

1. **Two-way value binding** — it reads the element's `type` and picks the right binding (details below).
2. **Sets `touched` on blur** — so errors only appear after the user has left the control.
3. **Sets `aria-invalid="true"`** — but **only when the field is touched *and* has an error**, not merely when it's invalid. (A pristine, never-visited invalid field is *not* marked.) That same attribute is the marker `form.submit(...)` uses to focus the first bad control on a failed submit.

### The element-kind matrix

`use:control` inspects `element.type` and binds accordingly. It supports every native control kind:

| Element | Binds to | Notes |
|---------|----------|-------|
| `<input type="text">` (and most text-like inputs) | `string` | Plain value binding |
| `<input type="number">` / `type="range"` | `number` | Numeric binding — a mid-edit `"1."` is **not** clobbered back to `1`, and it's **IME-safe** (composition in CJK/etc. isn't interrupted) |
| `<input type="checkbox">` | `boolean` | Binds `checked`, not `value` |
| `<input type="radio">` | grouped value | Binds the selected value across the radio group |
| `<select multiple>` | `string[]` | Binds an array of the selected option values |

The text/number/checkbox/radio/multi-select handling all comes from the runtime's `bindValue`; `use:control` just picks the `kind` (`'value'` | `'checked'` | `'group'`) from the element and hands off. So whatever native control you reach for, the field's value type matches what you'd expect.

### Custom controls

Because `touched` is a writable signal, you can drive a non-standard control yourself: bind its value to `field.value` however your widget needs, and call `field.touched.set(true)` when the user is done editing (e.g. on close/blur of a custom date picker). The error display and `aria-invalid` logic then work exactly as they do for native inputs.

## The validation timing model

This is the part that trips people up, so here it is as one clear model. Three things happen at three different moments:

1. **Sync validators run on *every* value change.** The moment `field.value` changes, the sync layer recomputes. `valid()` is always up to date.
2. **Errors only *display* once the field is `touched`.** Validation and display are separate. A field can be invalid from the first keystroke, but you don't show the message until the user has visited it. `touched` flips to `true` on blur (via `use:control`), or for **every** field at once when you call `touchAll()` — which `form.submit(...)` does, so a failed submit reveals all errors, not just the ones the user happened to visit.
3. **Async runs debounced, *after* sync passes.** Only when the sync layer is clean does the async check fire, and only after the debounce window (default 300 ms) of quiet.

So the rule of thumb: *validity is computed eagerly; error visibility is gated on `touched`; async is the last, slowest layer.* And because `touched` is a writable signal, you're never locked into the blur-driven default — set it manually for custom controls or "show me everything now" buttons.

## Async validation

For checks that need the server — "is this username taken?" — pass `asyncValidate`. It runs **only after the sync validators pass**, is **debounced** (default 300 ms, override with `debounceMs`) and **abortable** (a newer edit cancels the in-flight check via an `AbortSignal`), and surfaces through the same `error()`:

~~~ts title="async-field.ts"
const assignee = field('', [], {
  debounceMs: 500, // optional — override the 300 ms default
  asyncValidate: async (name, { signal }) => {
    if (!name.trim()) return null;
    const team = await api.get<string[]>('/team', { signal });
    return team.includes(name.trim()) ? null : `"${name.trim()}" is not on the team`;
  },
});
~~~

Show a spinner off `assignee.validating()` while it checks. The lifecycle in detail:

- While a **sync error is present, async does not run at all** — and any stale async state is cleared (`validating` → `false`, async error → `null`). You never hit the server on a value the format layer already rejected.
- On each accepted edit, the async error is cleared optimistically and `validating` flips to `true`; the actual call fires after the debounce.
- A newer edit (or the component unmounting) **aborts** the pending/in-flight check — that abort is expected and silently ignored.

:::callout tip "Footgun: a rejected async check silently passes"
If your `asyncValidate` throws or rejects for a **non-abort** reason — a network failure, a 500, a thrown bug — the field clears `validating` and is left with **no error**. In other words, a failed check is treated as a *pass*, not a fail. The field looks valid. If you care about that case (you usually do), catch inside your validator and return a message yourself:

~~~ts title="defensive-async.ts"
asyncValidate: async (name, { signal }) => {
  try {
    const team = await api.get<string[]>('/team', { signal });
    return team.includes(name) ? null : 'Not on the team';
  } catch (e) {
    if (signal.aborted) throw e;       // let real aborts propagate
    return 'Could not verify — try again';
  }
}
~~~
:::

## Grouping fields

`group(controls, options?)` aggregates named controls into one unit. Its `valid`, `value`, `touched`, `reset`, and `touchAll` recurse through the children. `form` is just the conventional alias for the top-level group (`form === group`):

~~~ts title="group.ts"
import { field, form, validators } from '@weave-framework/forms';

const fields = {
  title: field('', [validators.required()]),
  assignee: field(''),
  priority: field<Priority>('med'),
};

const taskForm = form(fields, {
  // cross-field rule: keys target a child FIELD; `_form` is a group-level error
  validate: (v) =>
    v.priority === 'high' && !v.assignee.trim()
      ? { assignee: 'High-priority tasks need an owner' }
      : null,
});
~~~

A group exposes the full `Control` interface plus a few group-only members:

| Member | Type | Meaning |
|--------|------|---------|
| `controls` | object | The child controls — reach them as `group.controls.title`, etc. |
| `value()` | reactive | Nested `{ name: value }` snapshot of every child (Angular's `FormGroup.value`) |
| `valid()` | reactive | `true` when every child is valid **and** there's no group-level (`_form`) error |
| `formError()` | reactive | The group-level (`_form`) cross-field error, or `null` |
| `validating()` | reactive | `true` while any descendant is running an async check |
| `touched()` | reactive | `true` once any descendant has been touched |
| `reset()` / `touchAll()` | methods | Recurse into every child |
| `submitting()` | reactive | `true` while a `submit(...)` run is in flight — see below |
| `submitError()` | reactive | The last submit rejection (the value the handler threw); typed `unknown` |
| `validateAsync()` | method | `Promise<boolean>` — settle in-flight async, then resolve validity |
| `submit(handler)` | method | Build a submit handler — see [Submitting](#submitting) |

### Cross-field `validate`

The `validate` option gets the whole value snapshot and returns either `null` (all good) or a `{ key: message }` map. Two kinds of key:

- **A child *field* name** — the message is pushed into that field's `error()` (as the cross-field layer, precedence #2 above).
- **`_form`** (i.e. `FORM_ERROR_KEY`) — a group-level error not bound to any field; read it via `group.formError()`.

:::callout info "Cross-field keys target direct *field* children only"
A key that points at a nested **group** or a **fieldArray** is **silently dropped** — the cross-field machinery only writes into a child's internal `_external` signal, and only `field`s have one. If you need to flag a whole nested group, put the rule inside that group's own `validate`, or surface it at this level via the `_form` key.
:::

## Dynamic lists

`fieldArray(factory, seeds?)` is a growable list of like-typed controls — the analog of a `FormArray`. `factory(seed?)` builds one item (a field, a group, even another array); `seeds` is the array of initial item values:

~~~ts title="field-array.ts"
import { field, fieldArray, group, validators } from '@weave-framework/forms';

// a checklist: an array of { text, done } groups
const checklist = fieldArray(
  (s) => group({
    text: field(s?.text ?? '', [validators.required('Describe the item')]),
    done: field(s?.done ?? false),
  }),
  [] // initial items (seeds)
);

checklist.push();          // add a blank item (factory called with no seed)
checklist.push({ text: 'Write tests', done: false }); // seeded item
checklist.removeAt(0);     // remove the first
~~~

A `fieldArray` exposes the `Control` interface plus list operations:

| Member | Type | Meaning |
|--------|------|---------|
| `controls()` | reactive | The live list of item controls — **callable** (it's a getter), render with `@for (c of arr.controls(); …)` |
| `length()` | reactive | Number of items |
| `value()` | reactive | Array of every item's value, in order |
| `push(seed?)` | method | Append one item, built by the factory (optionally seeded) |
| `removeAt(index)` | method | Remove the item at `index` |
| `reset()` | method | **Rebuild from the original `seeds` list** — see the caveat below |
| `valid()` / `validating()` / `touched()` / `touchAll()` | | Aggregate over the current items |

:::callout info "`controls` is a function — call it"
On a `fieldArray`, `controls` is a reactive getter (`controls()`), unlike on a `group` where `controls` is a plain object. So you iterate the array's items with `arr.controls()`, not `arr()` — a `fieldArray` is **not** itself callable.
:::

Render it with `@for` over `controls()`:

~~~html title="checklist.html"
@for (item of checklist.controls(); track item) {
  <div class="row">
    <input type="checkbox" use:control={{ item.controls.done }} />
    <input type="text" use:control={{ item.controls.text }} />
    <button type="button" on:click={{ () => removeItem(item) }}>×</button>
  </div>
} @empty {
  <p class="muted">No items yet.</p>
}
<button type="button" on:click={{ addItem }}>+ Add item</button>
~~~

:::callout tip "`reset()` rebuilds from the seeds, not the current items"
`fieldArray.reset()` doesn't reset the items in place — it **rebuilds the whole list from the original `seeds`** you passed to `fieldArray(...)`. Anything you `push`ed is discarded, and anything you `removeAt`'d comes back. If you seeded with `[]`, `reset()` empties the list.
:::

:::callout info "Pushed items with effects don't auto-dispose on remove"
An item created by `push` is built outside a component owner. If that item registers effects of its own — a `field` with `asyncValidate`, or a `group` with a cross-field `validate` — those effects won't be torn down by `removeAt`; they're cleaned up only when the whole component unmounts. Plain sync-validated items have no such effect and are unaffected.
:::

Because `field`, `group`, and `fieldArray` all share one `Control` interface, they nest to any depth — `form → fieldArray → group → field` — and validity/values/touched aggregate the whole way up.

## Submitting

`group.submit(handler)` builds a submit handler that owns the entire dance, so you wire exactly one thing on the `<form>`:

:::tabs
~~~ts title="submit.ts"
const onSubmit = taskForm.submit(async (values) => {
  await board.create(values); // values is the typed snapshot
  toasts.push('success', 'Created');
  props.onClose();
});
return { form: taskForm, onSubmit };
~~~
~~~html title="submit.html"
<form on:submit={{ onSubmit }} novalidate>
  …fields…
  @if (form.formError()) { <p class="form-error">{{ form.formError() }}</p> }
  <button type="submit" disabled={{ form.submitting() }}>
    {{ form.submitting() ? 'Saving…' : 'Save' }}
  </button>
</form>
~~~
:::

:::callout info "Wire it on `<form on:submit>` — it needs `currentTarget`"
The handler focuses the first invalid control by querying the form element, which it reads from the event's **`currentTarget`**. So attach it to the `<form>`'s `on:submit`, not to a button's `on:click`. (It captures `currentTarget` *synchronously* before awaiting, because the browser nulls it once dispatch ends.)
:::

Step by step, on submit it:

1. **Prevents default** (`e.preventDefault()`).
2. **Marks every field touched** (`touchAll()`) — so *all* errors show, not just visited ones.
3. **Awaits async validation** via `validateAsync()` — which settles any in-flight async check, then reports validity. Internally this is a **bounded poll** (~30 ms ticks, capped at ~2 s) that only ever waits on a debounced/in-flight async validator; sync reactivity is already settled.
4. **If invalid**, focuses the first control that `use:control` flagged `aria-invalid="true"` and **stops** — your handler never runs.
5. **If valid**, runs your `handler(values())`, tracking `submitting()` (true for the duration) and `submitError()`.

If your handler throws or rejects, the thrown value is stored in `submitError()` (typed `unknown` — it's whatever you threw) and `submitting()` flips back to `false`. The button re-enables either way. So throw from the handler to record a failure and let the UI react.

## Schema-driven forms

When you'd rather **describe** a form than hand-wire every `field(...)`, reach for `@weave-framework/forms/schema`. A **field-type registry** maps a declarative field's `type` to its default value, the validators its constraints translate to, and a UI render hint; `schemaForm()` walks the schema and composes the exact same `field`/`group` primitives — so validity, values, `touched`, `dirty`, cross-field `validate`, and `submit` all work identically.

~~~ts
import { schemaForm, fieldType } from '@weave-framework/forms/schema';

const f = schemaForm({
  fields: [
    { name: 'email', type: 'email', required: true, label: 'Email' },
    { name: 'age',   type: 'number', min: 18 },
    { name: 'plan',  type: 'select', options: [{ value: 'free', label: 'Free' }] },
    { name: 'tos',   type: 'checkbox', required: true },
  ],
});

f.valid();      // aggregate validity, reactive
f.value();      // { email, age, plan, tos }
f.render();     // [{ name, field, control:'input', props:{type:'email'}, label }, …] → drive the UI
~~~

Built-in types: `text`, `textarea`, `email`, `password`, `number`, `checkbox`, `select`, `radio`, `date`. Register your own with `fieldType({ name, defaultValue, validators, control, props })` (globally, or per-form via `schemaForm(schema, { types: [...] })` — which wins without mutating the global registry). An unknown `type` fails loud. Iterate `render()` to build the UI: each entry carries the live `field` plus a `control` component key and merged `props`.

:::callout info "What you just learned"
Everything is a `Control` (value/valid/validating/touched/reset/touchAll), so `field`, `group`/`form`, and `fieldArray` nest to any depth. A `field` is a writable signal plus derived `error`/`valid`/`touched`; `error()` resolves sync ?? cross-field ?? async. Sync validators run on every change but errors only *show* once `touched`; `asyncValidate` is debounced (`debounceMs`), abortable, runs only after sync passes — and silently *passes* on a thrown rejection (catch it yourself). Built-in `validators` cover required (also "must-check"/"must-pick"), min/max (strict), minLength/maxLength (string, null-tolerant), pattern, and a loose email. `use:control` binds value/touched/aria-invalid and adapts to text/number/checkbox/radio/multi-select. `group`/`form` run cross-field rules (field keys only; `_form`/`FORM_ERROR_KEY` for group-level), `fieldArray` does dynamic lists (`controls()`, `reset()` rebuilds from seeds), and `form.submit(handler)` owns touch-all → `validateAsync` → focus-first-error → `submitting`/`submitError`.
:::

[Next: Internationalization →](/learn/i18n) · [Reference: @weave-framework/forms →](/reference/forms)
