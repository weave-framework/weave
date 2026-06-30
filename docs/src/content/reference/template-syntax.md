# Template syntax

The complete template language, as a reference. For a guided tour with explanations, see [Templates](/learn/templates); this page is the exhaustive catalog.

:::callout info "The one rule"
Every dynamic value uses double braces: `{{ expr }}`. A single brace (`attr={x}`) is a compile error. Capitalized tags are components; lowercase tags are DOM elements.
:::

## Text

| Syntax | Description |
|--------|-------------|
| `{{ expr }}` | Interpolate an expression as text. Reactive if it reads a signal; computed once otherwise. Inserted as text (never HTML), so `<`, `{`, `&` render literally — safe from injection. |

## Attributes & bindings

| Syntax | Description |
|--------|-------------|
| `name="value"` | Static string attribute. A bare `name` is a boolean attribute. |
| `name={{ expr }}` | Reactive attribute. Removed when the value is `null`/`false`; set to `""` when `true`. |
| `.prop={{ expr }}` | Set a DOM **property** (e.g. `.value`, `.innerHTML`), not an attribute. |
| `class:name={{ expr }}` | Toggle a single class by truthiness. |
| `show={{ expr }}` | Toggle visibility via `display` (element stays in the DOM, unlike `@if`). |
| `on:event={{ handler }}` | Attach an event listener. |
| `on:event\|mod={{ handler }}` | Event modifiers: `preventDefault`, `stopPropagation`, `capture` (chain with `\|`). |
| `bind:value={{ signal }}` | Two-way bind text/number/range/`<select>` to a writable signal. |
| `bind:checked={{ signal }}` | Two-way bind a checkbox (boolean). |
| `bind:group={{ signal }}` | Two-way bind radios (signal holds the selected value). |
| `ref={{ target }}` | Store the element reference (signal or callback). Alias: `bind:this`. |
| `use:action={{ arg }}` | Run a `use:` action `(el, arg) => cleanup?` after insertion. |
| `transition:fn={{ params }}` | Play an enter **and** leave animation. |
| `in:fn={{ params }}` | Enter animation only. |
| `out:fn={{ params }}` | Leave animation only (the removal waits for it). |

:::callout tip "bind: takes the signal, not its value"
Write `bind:value={{ name }}` (the signal itself), not `bind:value={{ name() }}` — the runtime needs to call `.set()` on it. Text inputs are IME-safe; a `<select>` populated by `@for` re-asserts the bound value after its options render.
:::

## Control flow

### @if / @else

~~~html
@if (cond) { … } @else if (other) { … } @else { … }
@if (expr; as alias) { {{ alias }} }   <!-- bind the tested value -->
~~~

### @for

~~~html
@for (item of list(); track item.id) { … } @empty { … }
~~~

Always provide `track` (a stable, unique key). Body locals: `$index`, `$count`, `$first`, `$last`, `$even`, `$odd`. Keyed reconciliation moves the minimum nodes; reused rows keep focus, scroll, and input state.

### @switch

~~~html
@switch (expr) {
  @case (value) { … }
  @default { … }
}
~~~

### @let

~~~html
@let name = expr;   <!-- a local computed value, available to following siblings -->
~~~

### @key

~~~html
@key (expr) { … }   <!-- tear down + recreate the content when expr changes -->
~~~

## Async blocks

### @defer

~~~html
@defer (trigger) { … } @placeholder { … }
~~~

| Trigger | Fires when |
|---------|-----------|
| `on idle` | the browser is idle (`requestIdleCallback`) |
| `on viewport` | the placeholder scrolls into view |
| `on interaction` | the placeholder is clicked / keyed |
| `on hover` | pointer enters / focuses the placeholder |
| `on timer(ms)` | after `ms` milliseconds |
| `when expr()` | the (reactive) condition becomes truthy |
| `immediate` | right away (e.g. to code-split with `lazy()`) |

`viewport`/`interaction`/`hover` observe the placeholder's element — provide a `@placeholder`, or they fire immediately.

### @await

~~~html
@await (promiseOrResource) {
  …pending…
} @then (value) {
  …resolved…
} @catch (err) {
  …rejected…
}
~~~

Accepts a Promise, a `@weave/data` resource (a refetch re-shows pending), or a plain value. `@then (alias)` / `@catch (alias)` bind the value / error.

## Snippets

~~~html
@snippet name(param, other = 'default') { … }
@render (name(arg))
~~~

A named, parameterized template fragment; `@render` invokes it (and a snippet can be passed to a child as a prop — render-prop / scoped-slot pattern).

## Components & slots

~~~html
<Child prop="static" other={{ expr }} on:event={{ handler }} />

<Card>
  <h2 slot="header">Title</h2>     <!-- named slot -->
  <p>Default-slot content</p>
</Card>
~~~

In the child: `<slot />` is the default slot, `<slot name="header" />` a named one, and content between the tags (`<slot>fallback</slot>`) is the fallback shown when nothing is provided.

## Dynamic elements

~~~html
<w:element this={{ tag }}> … </w:element>
~~~

Renders an element whose tag name is dynamic; it rebuilds when `this` changes. All other attributes apply to the created element.

## Escaping

In template **text**, a literal block keyword is escaped by doubling the `@`: write `@@for` to render the characters `@for` (a single `@`, as in an email, is untouched).

:::callout info "See also"
[Templates (guide)](/learn/templates) · [Styling](/learn/styling) · [Motion](/learn/motion) · [@weave/runtime reference](/reference/runtime)
:::
