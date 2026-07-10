---
name: weave-templates
description: >-
  Weave template syntax — the `.html`/`.weave` markup a component renders. Use this
  whenever you write or edit Weave template markup: `{{ }}` interpolation, control
  flow (`@if`/`@for`/`@switch`/`@await`/`@defer`/`@let`), bindings (`name={{ }}`,
  `.prop`, `on:`, `use:`, `bind:`, `class:`, `style:`, `ref`, `show`, transitions),
  and reusable markup (`@snippet`/`@render`/`@key`, slots, dynamic/teleport). Reach
  for it whenever markup is involved or the user asks how to express loops,
  conditionals, events, classes, or async in a Weave template — even casually.
---

# Weave templates

Templates are HTML with Weave directives. They compile to fine-grained DOM code.
**Every dynamic value uses double braces `{{ expr }}`** — a single brace (`attr={x}`)
is a compile error. Capitalized tags are components; lowercase are DOM elements.
Read signals with `()`. Names resolve to the component's exposed bindings (see
weave-component); common globals (`Math`, `JSON`, `setTimeout`, `confirm`, …) work as-is.

## Interpolation

```html
<h1>{{ user().name }}</h1>
<p>{{ count() * 2 }} items — {{ done() ? 'ok' : 'pending' }}</p>
```

## Control flow

**`@if` / `@else if` / `@else`** — with an optional `as` alias to narrow:

```html
@if (user()) {
  <span>Hi {{ user().name }}</span>
} @else if (loading()) {
  <Spinner />
} @else {
  <a href="/login">Sign in</a>
}

@if (currentUser(); as u) { <Avatar user={{ u }} /> }   <!-- u is the narrowed value -->
```

**`@for`** — keyed list; `track` gives the identity used to move/reuse rows:

```html
<ul>
  @for (todo of todos(); track todo.id) {
    <li class:done={{ todo.done }}>{{ $index }}. {{ todo.text }}</li>
  } @empty {
    <li class="muted">Nothing yet.</li>
  }
</ul>
```
Loop locals: `$index`, `$count`, `$first`, `$last`, `$even`, `$odd`. Always `track` a stable key so reconciliation reuses DOM instead of rebuilding.

**`@switch` / `@case` / `@default`:**
```html
@switch (status()) {
  @case ('loading') { <Spinner /> }
  @case ('error') { <Alert /> }
  @default { <Content /> }
}
```

**`@let`** — a template-local derived value (scoped to following siblings):
```html
@let full = user().first + ' ' + user().last;
<h2>{{ full }}</h2>
```

**`@await`** — render a Promise or a data resource with pending/error branches:
```html
@await (loadUser()) {
  <Spinner />                          <!-- pending -->
} @then (user) {
  <Profile user={{ user }} />          <!-- resolved value bound to `user` -->
} @catch (err) {
  <Alert>{{ String(err) }}</Alert>     <!-- rejected -->
}
```

**`@defer`** — mount a subtree lazily on a trigger, with a placeholder:
```html
@defer (on viewport) {
  <HeavyChart data={{ points() }} />
} @placeholder {
  <div class="skeleton" />
}
```
Triggers: `when <expr>`, `on idle`, `on viewport`, `on interaction`, `on hover`, `on timer(2000)`, `immediate`.

## Bindings on elements

| Form | Meaning |
| --- | --- |
| `name={{ expr }}` | reactive attribute (or a prop on a component) |
| `.prop={{ expr }}` | set a DOM **property** (not attribute) — `.value`, `.innerHTML`, `.checked` |
| `on:click={{ fn }}` | event listener; modifiers: `on:submit\|preventDefault`, `on:click\|stop\|once` |
| `bind:value={{ sig }}` | two-way on an input; also `bind:checked`, `bind:group` (radios), `bind:this` (ref) |
| `class:active={{ expr }}` | toggle one class by a boolean |
| `style:color={{ expr }}` | set one style property reactively |
| `ref={{ el }}` | receive the DOM node (a setter fn or a signal) |
| `show={{ expr }}` | toggle visibility (`display`) without unmounting |
| `use:action={{ arg }}` | attach a reusable behavior (see below) |
| `transition:fade` / `in:` / `out:` | enter/leave animation (`fade`/`fly`/`slide`/`scale` from runtime) |

```html
<input bind:value={{ query }} on:input={{ () => search() }} />
<button class:busy={{ saving() }} on:click|preventDefault={{ save }}>Save</button>
<div ref={{ (el) => (chartHost = el) }}></div>
```

Bare attribute on a **component** = boolean `true` (`<Button disabled>`); on a DOM element it renders bare. `bind:value` also works on a component (passes the signal — see weave-component).

## `use:` actions — reusable element behavior

An action is a function `(el, arg?) => cleanup | { update, destroy }`. It runs when the element mounts; return teardown; `update` re-runs when `arg` changes.

```ts
export function tooltip(el: HTMLElement, text: () => string) {
  const show = () => {/* … */};
  el.addEventListener('mouseenter', show);
  return { destroy: () => el.removeEventListener('mouseenter', show) };
}
```
```html
<button use:tooltip={{ () => label() }}>Info</button>
```
`use:` also works on a component tag — it forwards to the component's single root element.

## Reusable markup

**Slots** — a child leaves holes; a parent fills them:
```html
<!-- card.html -->
<div class="card">
  <header><slot name="header" /></header>
  <main><slot /></main>                 <!-- default slot -->
  <footer><slot name="footer">© 2026</slot></footer>   <!-- fallback content -->
</div>
<!-- parent -->
<Card>
  <h2 slot="header">Title</h2>
  Body goes in the default slot.
</Card>
```

**`@snippet` / `@render`** — named, parameterized markup reused *within one* component (no child needed). Parameters may be typed:
```html
@snippet row(item: Task) {
  <li class:done={{ item.done }}>{{ item.title }}</li>
}
<ul>
  @for (t of tasks(); track t.id) { @render (row(t)) }
</ul>
```
A `@snippet` can also be passed to a component template-prop typed `(x) => Node` (e.g. a `<List>` `rowTemplate`). A typed parameter (`item: Task`) type-checks the body; untyped is `any`.

**`@key (expr) { … }`** — force a subtree to re-create when `expr` changes (reset state on identity change).

## Dynamic structure

- **Dynamic component/element** — render a component/tag chosen at runtime (e.g. `<Dynamic this={{ comp() }} />` or the `bind:this`/`this=` form).
- **Teleport** — render children into a different DOM location (modals, toasts).
- **KeepAlive** — keep a subtree's state alive while toggled off-screen.

Use these sparingly; prefer plain `@if`/component composition first.

## Gotchas

- **`{{ }}` everywhere for dynamic values** — single brace is an error; inline `template` strings still use `{{ }}`, never `${…}`.
- **Always `track` in `@for`** — no track means DOM is rebuilt on every change.
- **Read signals with `()`** in bindings.
- **`on:x` is the same as the `onX` prop** on a component (events flow up as callback props).
- A DOM-only directive (`class:`, `bind:`, `transition:`, `ref`, `show`, `.prop`) on a **component** tag is an error (except `use:` and `bind:`) — pass data as props instead.
