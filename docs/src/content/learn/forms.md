# Forms

`@weave/forms` is signal-native form state and validation. A field is a writable signal plus derived `error`/`valid`/`touched` — so the template binds the value and reads errors directly, all surgically reactive. No form library runtime, no boilerplate, and the same primitives compose from a single input up to deeply nested groups and arrays.

## A field

`field(initial, validators?, options?)` is the unit. It's a signal you can bind, with validation layered on top:

~~~ts
import { field, validators } from '@weave/forms';

const title = field('', [
  validators.required('A title is required'),
  validators.minLength(3, 'At least 3 characters'),
  validators.maxLength(80),
]);
~~~

A field exposes:

| Member | Type | Meaning |
|--------|------|---------|
| `value` | writable signal | The editable value — bind it, or read `value()` |
| `error()` | reactive | First error message, or `null` |
| `valid()` | reactive | `true` when there's no error |
| `touched` | writable signal | Has the user visited it? Gates when errors show |
| `validating()` | reactive | Is an async check in flight? |
| `reset()` | | Restore the initial value, clear touched/errors |

Validators run in order; the first failure wins. The built-in set covers the basics — compose them freely:

~~~ts
validators.required(msg?)
validators.minLength(n, msg?)   validators.maxLength(n, msg?)
validators.min(n, msg?)         validators.max(n, msg?)
validators.pattern(regexp, msg?)
validators.email(msg?)
~~~

A custom validator is just `(value) => string | null`:

~~~ts
const slug = field('', [(v) => /^[a-z0-9-]+$/.test(v) ? null : 'Lowercase, digits, dashes only']);
~~~

## Binding a field to the DOM

You *could* wire `bind:value` + a blur handler + `aria-invalid` by hand. Don't — `use:control` from `@weave/forms/dom` does all three in one directive:

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
import { control } from '@weave/forms/dom';
// expose `control` and the fields from setup:
return { fields: { title }, control };
~~~
:::

`use:control` binds the input's value to `field.value`, marks `touched` on blur, and sets `aria-invalid` when the field is invalid — which also lets a failed submit focus the first bad control automatically (below).

## Async validation

For checks that need the server — "is this username taken?" — pass `asyncValidate`. It runs only after the sync validators pass, is **debounced** (default 300 ms) and **abortable** (a newer edit cancels the in-flight check), and surfaces through the same `error()`:

~~~ts
const assignee = field('', [], {
  asyncValidate: async (name, { signal }) => {
    if (!name.trim()) return null;
    const team = await api.get<string[]>('/team', { signal });
    return team.includes(name.trim()) ? null : `"${name.trim()}" is not on the team`;
  },
});
~~~

Show a spinner off `assignee.validating()` while it checks.

## Grouping fields

`group(controls, options?)` aggregates named controls into one unit. Its `valid`, `value`, `touched`, and `reset` recurse through the children. `form` is just the conventional alias for the top-level group:

~~~ts
import { field, form, validators } from '@weave/forms';

const fields = {
  title: field('', [validators.required()]),
  assignee: field(''),
  priority: field<Priority>('med'),
};

const taskForm = form(fields, {
  // cross-field rule: keys target a child field; `_form` is a group-level error
  validate: (v) =>
    v.priority === 'high' && !v.assignee.trim()
      ? { assignee: 'High-priority tasks need an owner' }
      : null,
});
~~~

A cross-field `validate` gets the whole value snapshot and returns `{ childName: message }` (pushed into that field's `error()`) and/or the reserved `_form` key (surfaced via `group.formError()`).

## Dynamic lists

`fieldArray(factory, seeds?)` is a growable list of like-typed controls — the analog of a `FormArray`. `factory(seed?)` builds one item (a field, a group, even another array):

~~~ts
import { field, fieldArray, group } from '@weave/forms';

// a checklist: an array of { text, done } groups
const checklist = fieldArray(
  (s) => group({
    text: field(s?.text ?? '', [validators.required('Describe the item')]),
    done: field(s?.done ?? false),
  }),
  [] // initial items
);

checklist.push();          // add a blank item
checklist.removeAt(0);     // remove the first
~~~

Render it with `@for` over `controls()`:

~~~html
@for (item of checklist(); track item) {
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

Because `field`, `group`, and `fieldArray` all share one `Control` interface, they nest to any depth — `form → fieldArray → group → field` — and validity/values/touched aggregate the whole way up.

## Submitting

`form.submit(handler)` owns the entire submit dance, so you wire one thing on the `<form>`:

~~~ts
const onSubmit = taskForm.submit(async (values) => {
  await board.create(values); // values is the typed snapshot
  toasts.push('success', 'Created');
  props.onClose();
});
return { form: taskForm, onSubmit };
~~~

~~~html
<form on:submit={{ onSubmit }} novalidate>
  …fields…
  @if (form.formError()) { <p class="form-error">{{ form.formError() }}</p> }
  <button type="submit" disabled={{ form.submitting() }}>
    {{ form.submitting() ? 'Saving…' : 'Save' }}
  </button>
</form>
~~~

On submit it: prevents default → marks **every** field touched (so all errors show, not just visited ones) → awaits async validation → if invalid, focuses the first `aria-invalid` control and stops → otherwise runs your `handler`, tracking `submitting()` and `submitError()` (the value the handler threw). Throw from the handler to record the error and roll back; the button re-enables either way.

:::callout info "What you just learned"
A `field` is a signal + derived `error`/`valid`/`touched`; bind it with `use:control` (value + touched + aria-invalid in one). Validators compose (first failure wins); `asyncValidate` is debounced and abortable. `group`/`form` aggregate and run cross-field rules; `fieldArray` does dynamic lists; all three nest via one `Control` interface. `form.submit(handler)` owns touch-all, async-validate, focus-first-error, and `submitting`/`submitError`.
:::

[Next: Internationalization →](/learn/i18n) · [Reference: @weave/forms →](/reference/forms)
