# Templates

A Weave template is HTML with a few superpowers. It's compiled — at build time it becomes direct DOM operations, so there's no template interpreter in the browser and nothing to diff. This page is the full tour of the syntax: text, bindings, directives, and control flow.

:::callout tip "One rule to remember: double braces"
Every dynamic value in a template is wrapped in `{{ }}`. Text, attributes, events, bindings — all of them. A single brace (`attr={x}`) is a deliberate error, so there's never any guessing about which form an attribute uses.
:::

## Text interpolation

`{{ expr }}` renders an expression as text. If the expression reads a signal, the text updates when that signal changes; if it doesn't, it's computed once.

~~~html
<p>Hello, {{ name() }}!</p>
<p>{{ 2 + 2 }}</p>
<p>{{ user().email }}</p>
~~~

Text is inserted as plain text content, never as HTML — so `{{ "<b>" }}` shows the literal characters `<b>`, it doesn't create a bold tag. That makes interpolation safe from injection by default.

## Attributes and properties

| Form | Example | What it does |
|------|---------|--------------|
| Static attribute | `<a href="/">` | A literal string attribute |
| Dynamic attribute | `<a href={{ url() }}>` | Reactive attribute (removed when `null`/`false`) |
| Property | `<input .value={{ text() }}>` | Sets a DOM *property*, not an attribute |
| Class toggle | `<li class:done={{ isDone() }}>` | Adds/removes one class by truthiness |
| Show | `<div show={{ open() }}>` | Toggles visibility via `display` (stays in DOM) |

~~~html
<button disabled={{ !canSubmit() }} class={{ statusClass() }}>Save</button>
<li class:done={{ task().done }} class:urgent={{ task().priority === 'high' }}>…</li>
<pre show={{ showRaw() }}>{{ JSON.stringify(data(), null, 2) }}</pre>
~~~

`show` differs from `@if`: `show` keeps the element in the DOM and just hides it (cheap to toggle, keeps state); `@if` removes and recreates it (covered below).

## Events

`on:event={{ handler }}` attaches a listener. The handler is a function — name it or write it inline:

~~~html
<button on:click={{ inc }}>+1</button>
<button on:click={{ () => count.set(0) }}>Reset</button>
<form on:submit={{ onSubmit }}>…</form>
~~~

Chain **modifiers** with `|` after the event name:

~~~html
<a on:click|preventDefault={{ go }}>Navigate</a>
<button on:click|stopPropagation|preventDefault={{ edit }}>✎</button>
~~~

Common modifiers: `preventDefault`, `stopPropagation`, `capture`.

## Two-way binding

`bind:` connects a form control to a **writable signal** — the signal drives the control, and user input writes the signal back. Pass the signal *by reference* (don't call it):

~~~html
<input bind:value={{ name }} />
<input type="number" bind:value={{ age }} />
<input type="checkbox" bind:checked={{ agreed }} />
<input type="radio" name="size" value="L" bind:group={{ size }} />
<select bind:value={{ choice }}>
  <option value="a">A</option>
  <option value="b">B</option>
</select>
~~~

The compiler picks the right mechanism from the binding name and element: `bind:value` for text/number/range/select, `bind:checked` for a checkbox boolean, `bind:group` for radios (the signal holds the selected value). Text inputs are IME-safe — the value isn't overwritten mid-composition.

:::callout tip "Forms have an even shorter way"
For validated forms you'll usually reach for the `use:control` directive from `@weave/forms/dom`, which binds value, touched state, and `aria-invalid` in one go. See [Forms](/learn/forms).
:::

## References

Grab the actual DOM element with `ref` (or its alias `bind:this`) — handy for focus, measurement, or a third-party library:

~~~html
<input ref={{ inputEl }} />
~~~

~~~ts
const inputEl = signal<Element | null>(null);
onMount(() => (inputEl() as HTMLInputElement)?.focus());
~~~

## Directives: `use:`

`use:action={{ arg }}` runs a function on the element once it's inserted — the escape hatch for imperative DOM work, kept tidy and owner-scoped. An action is `(el, arg) => cleanup?`:

~~~ts
import type { Action } from '@weave/runtime/dom';

export const autofocus: Action = (el) => {
  (el as HTMLElement).focus();
};

export const tooltip: Action<string> = (el, text) => {
  const tip = makeTip(el, text);
  return () => tip.destroy(); // cleanup runs on unmount
};
~~~

~~~html
<input use:autofocus />
<button use:tooltip={{ 'Delete forever' }}>🗑</button>
~~~

For an arg that should react, pass a getter (`use:tip={{ () => label() }}`) and read it inside an `effect` in the action.

## Transitions: `transition:` / `in:` / `out:`

Animate an element as it enters or leaves. `transition:` does both; `in:` only on enter; `out:` only on leave. Leave animations are awaited — a control-flow block waits for the outro before removing the node.

~~~html
<div transition:fade>Fades both ways</div>
<div in:scale={{ { duration: 150 } }}>Scales in</div>
<aside out:fly={{ { x: 200 } }}>Flies out on removal</aside>
~~~

Built-ins (`fade`, `fly`, `slide`, `scale`) come from `@weave/runtime`. Full treatment in [Motion](/learn/motion).

## Control flow

### @if / @else

~~~html
@if (loading()) {
  <p>Loading…</p>
} @else if (error()) {
  <p class="error">{{ error() }}</p>
} @else {
  <Board />
}
~~~

Switching branches swaps the DOM; staying on the same branch leaves it untouched. The `; as` form binds the tested value to a name — perfect for null-narrowing:

~~~html
@if (currentUser(); as user) {
  <span>Signed in as {{ user.name }}</span>
} @else {
  <a href="/login">Sign in</a>
}
~~~

### @for

A keyed loop. Always give it a `track` expression — a stable, unique key per item — so Weave reuses nodes across reorders instead of rebuilding them:

~~~html
@for (task of tasks(); track task.id) {
  <li>{{ task.title }}</li>
} @empty {
  <p class="muted">No tasks yet.</p>
}
~~~

`@empty` renders when the list is empty. Inside the body you get positional locals for free:

| Local | Meaning |
|-------|---------|
| `$index` | 0-based position |
| `$count` | total number of items |
| `$first` / `$last` | boolean edges |
| `$even` / `$odd` | boolean parity |

~~~html
@for (row of rows(); track row.id) {
  <tr class:alt={{ $odd }}>
    <td>{{ $index + 1 }}</td>
    <td>{{ row.label }}</td>
  </tr>
}
~~~

Reordering, inserting, and removing all happen with the minimum DOM moves — focus, scroll position, and input state in reused rows are preserved.

### @switch

Equality-based branching (`===` against each `@case`):

~~~html
@switch (status()) {
  @case ('pending') { <Spinner /> }
  @case ('done') { <Check /> }
  @default { <span>Unknown</span> }
}
~~~

### @let

A local computed value, available to siblings after it:

~~~html
@let fullName = user().first + ' ' + user().last;
<h1>{{ fullName }}</h1>
~~~

It re-computes automatically when its inputs change.

### @key

Force a teardown-and-recreate when a value changes — fresh DOM, fresh state, mount work replayed:

~~~html
@key (userId()) {
  <UserProfile id={{ userId() }} />
}
~~~

Use it to reset a subtree on identity change (e.g. navigating between two users on the same route).

## Async blocks

### @defer

Hold off rendering an expensive subtree until a trigger fires; show a `@placeholder` meanwhile:

~~~html
@defer (on idle) {
  <BoardInsights />
} @placeholder {
  <div class="skeleton">Loading insights…</div>
}
~~~

Triggers: `on idle`, `on viewport`, `on interaction`, `on hover`, `on timer(2000)`, `when ready()` (reactive), and `immediate`. `viewport`/`interaction`/`hover` watch the placeholder's element, so give them one. Pair `@defer` with [`lazy()`](/learn/router#code-splitting) to also code-split the chunk.

### @await

Render by the settle state of a Promise or a [`@weave/data` resource](/learn/recipes#fetching-data):

~~~html
@await (task) {
  <p>Loading task…</p>
} @then (t) {
  <h1>{{ t.title }}</h1>
} @catch (e) {
  <p class="error">Couldn't load. {{ String(e) }}</p>
}
~~~

`@then (alias)` binds the resolved value; `@catch (alias)` binds the error. With a resource, a refetch flips it back to the pending branch automatically.

## Snippets

A `@snippet` is a named, parameterized template fragment; `@render` invokes it. Reuse markup without a whole separate component, and even pass a snippet to a child as a prop:

~~~html
@snippet stat(label, value) {
  <div class="stat">
    <dt>{{ label }}</dt>
    <dd>{{ value }}</dd>
  </div>
}

<dl>
  @render (stat('Total', counts().total))
  @render (stat('Done', counts().done))
</dl>
~~~

## Components and slots

Capitalized tags are components; lowercase tags are DOM elements. Pass props with `{{ }}`, events with `on:`, and project markup through slots:

~~~html
<TaskCard task={{ t }} on:select={{ choose }} />

<Card>
  <h2 slot="header">Title</h2>
  <p>Body goes in the default slot.</p>
</Card>
~~~

The full story — props as reactive getters, callbacks up, named/fallback slots — is in [Components](/learn/components).

## Dynamic elements

When the *tag itself* is dynamic, use `<w:element this={{ tag }}>`. It rebuilds when the tag changes; all other attributes apply to the created element:

~~~html
<w:element this={{ 'h' + level() }}>{{ title }}</w:element>
~~~

This renders `<h1>`…`<h6>` depending on `level()`.

:::callout info "What you just learned"
Every dynamic value uses `{{ }}`. Bind attributes/properties/classes/visibility, wire `on:` events with modifiers, two-way with `bind:`, and reach the DOM with `ref` and `use:`. Structure with `@if`/`@for`/`@switch`/`@let`/`@key`, go async with `@defer`/`@await`, reuse with `@snippet`/`@render`, compose with components + slots, and go dynamic with `<w:element>`.
:::

[Next: Reactivity in depth →](/learn/reactivity) · [Reference: template syntax →](/reference/runtime)
