# @weave-framework/forms

Weave forms — signal-native field/form state + validation, wired to inputs with `use:control`. Zero third-party deps.

Part of **[Weave](https://weaveframework.dev/)** — a fine-grained reactive, signal-native UI framework: no Virtual DOM, zero third-party runtime dependencies.

```bash
npm install @weave-framework/forms
```

Most apps get this (and the rest of Weave) in one step:

```bash
npm create weave@latest my-app
```

## Usage

A `field` is a value signal plus reactive validity, touched, and dirty state. A `form` (an alias of `group`) aggregates named controls and owns the submit dance.

```ts
import { field, form, validators } from '@weave-framework/forms';

const login = form({
  email: field('', [validators.required(), validators.email()]),
  password: field('', [validators.required(), validators.minLength(8)]),
});

const onSubmit = login.submit(async (values) => {
  await api.post('/login', values); // values is { email, password }, typed
});
```

Bind it in the template with one directive. `use:control` binds the value, flips `touched` on blur, and sets `aria-invalid` — which is what submit uses to focus the first bad control:

```html
<form on:submit={{ onSubmit }}>
  <input type="email" use:control={{ login.controls.email }} />
  @if (login.controls.email.touched() && login.controls.email.error()) {
    <p class="error">{{ login.controls.email.error() }}</p>
  }
  <button type="submit" disabled={{ login.submitting() }}>Sign in</button>
</form>
```

`control` comes from the DOM subpath:

```ts
import { control } from '@weave-framework/forms/dom';
```

## What `submit` does for you

`form.submit(handler)` returns an event handler that runs the whole sequence: `preventDefault` → `touchAll()` to reveal every error → await any in-flight async validation → if invalid, focus the first control marked `aria-invalid` and stop → else run `handler(values)` while tracking `submitting()` and `submitError()`.

## Composition

`field`, `group`, and `fieldArray` all satisfy one `Control` interface, so they nest to any depth (`form → group → fieldArray → group → field`). Validity, the value snapshot, `touched`, `dirty`, `reset`, and `touchAll` recurse through the whole tree.

```ts
import { field, fieldArray, validators } from '@weave-framework/forms';

const emails = fieldArray((seed = '') => field(seed, [validators.email()]), ['a@b.com']);
emails.push();        // append a control
emails.removeAt(0);
emails.controls();    // reactive list — render with @for
```

## Validation

Built-in validators: `required`, `minLength`, `maxLength`, `pattern`, `email`, `min`, `max` — each takes an optional message, and the first failure wins. A validator is just `(value) => string | null`, so your own drop in beside them.

**Async** validation is per-field, debounced (300 ms by default) and abortable, and only fires once the sync layer is clean:

```ts
const username = field('', [validators.required()], {
  asyncValidate: async (value, { signal }) => {
    const taken = await api.get(`/check?u=${value}`, { signal });
    return taken ? 'Already taken' : null;
  },
  debounceMs: 400,
});
```

**Cross-field** validation lives on the group. Keys target its direct field children; the reserved `_form` key (`FORM_ERROR_KEY`) surfaces via `group.formError()`:

```ts
const signup = form(
  { password: field(''), confirm: field('') },
  { validate: (v) => (v.password === v.confirm ? {} : { confirm: 'Passwords must match' }) }
);
```

📚 **Guides + full API reference:** [Forms guide](https://weaveframework.dev/learn/forms) · [API reference](https://weaveframework.dev/reference/forms)

## License

MIT
