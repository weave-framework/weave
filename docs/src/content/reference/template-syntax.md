# Template syntax

The complete template language, as a reference. For a guided tour with explanations, see [Templates](/learn/templates); this page is the exhaustive catalog.

:::callout info "The one rule"
Every dynamic value uses double braces: `{{ expr }}`. A single brace (`attr={x}`) is a compile error. Capitalized tags are components; lowercase tags are DOM elements.
:::

## Text

| Syntax | Description |
|--------|-------------|
| `{{ expr }}` | Interpolate an expression as text. Reactive if it reads a signal; computed once otherwise. Inserted as text (never HTML), so `<`, `{`, `&` render literally — safe from injection. |

To render HTML rather than text, use the `.innerHTML` property binding below — and only with trusted content.

## Attributes & bindings

| Syntax | Description |
|--------|-------------|
| `name="value"` | Static string attribute. |
| `name` | A bare attribute name is a static boolean attribute (set to `""`). |
| `name={{ expr }}` | Reactive attribute. Removed when the value is `null`/`false`; set to `""` when `true`; otherwise stringified. |
| `.prop={{ expr }}` | Set a DOM **property** (e.g. `.value`, `.checked`, `.innerHTML`), not an attribute. Reactive. |
| `class:name={{ expr }}` | Toggle a single class by truthiness of the expression. |
| `style:prop={{ expr }}` | Set one inline style property reactively. `style:--accent={{ hex }}` sets a **CSS custom property** (bind a design token to a signal); a `null`/`false` value removes it. |
| `show={{ expr }}` | Toggle visibility via `display` (the element stays in the DOM, unlike `@if`). Restores the element's own inline `display` when shown. |
| `on:event={{ handler }}` | Attach an event listener. The handler is read once (handlers are never reactive). |
| `on:event\|mod={{ handler }}` | Event with modifiers (chain with `\|`). See the modifier table below. |
| `bind:value={{ signal }}` | Two-way bind text / textarea / number / range / `<select>` to a writable signal. |
| `bind:checked={{ signal }}` | Two-way bind a checkbox as a boolean. |
| `bind:group={{ signal }}` | Two-way bind a radio group or value-checkbox; the signal holds the **selected value**. |
| `ref={{ target }}` | Store the element reference into a signal or callback after insertion. Alias: `bind:this`. |
| `use:action={{ arg }}` | Run a `use:` action after insertion. Returns nothing, a teardown fn, or a reactive `{ update, destroy }` — `update(arg)` re-runs when the argument changes, `destroy()` on removal. |
| `transition:fn={{ params }}` | Play an enter **and** leave animation. |
| `in:fn={{ params }}` | Enter animation only. |
| `out:fn={{ params }}` | Leave animation only (the element's removal waits for it). |

### Event modifiers

Chain with `|` after the event name, e.g. `on:submit|preventDefault|once`.

| Modifier | Effect |
|----------|--------|
| `preventDefault` | Calls `e.preventDefault()` before your handler. |
| `stopPropagation` | Calls `e.stopPropagation()` before your handler. |
| `self` | Only runs when `e.target === e.currentTarget` (the event originated on this element, not a descendant). |
| `once` | Listener auto-removes after the first call (`{ once: true }`). |
| `capture` | Listen in the capture phase (`{ capture: true }`). |
| `passive` | Mark the listener passive (`{ passive: true }`) — promises not to call `preventDefault`. |

`preventDefault`, `stopPropagation`, and `self` wrap the handler as guards; `once`, `capture`, and `passive` are passed as `addEventListener` options. They can be combined freely.

:::callout tip "bind: takes the signal, not its value"
Write `bind:value={{ name }}` (the signal itself), not `bind:value={{ name() }}` — the runtime needs to call `.set()` on it. Number and range inputs read as numbers (`valueAsNumber`); a `<select multiple>` binds to a `string[]` of the selected option values. Text inputs are IME-safe (the value is committed on `compositionend`, not mid-composition), and a `<select>` populated by `@for` re-asserts the bound value after its options render so the signal still wins.
:::

## Control flow

### @if / @else

~~~html
@if (cond) { … } @else if (other) { … } @else { … }
@if (expr; as alias) { {{ alias }} }   <!-- bind the tested value to a local -->
~~~

Switching to a different branch unmounts the old one (disposing its effects); staying on the same branch leaves its live DOM untouched.

### @for

~~~html
@for (item of list(); track item.id) { … } @empty { … }
~~~

Always provide `track` (a stable, unique key). The `@empty` block is optional and renders when the list is empty. Body locals: `$index`, `$count`, `$first`, `$last`, `$even`, `$odd` — all reactive across reorders. Keyed reconciliation moves the minimum number of nodes; reused rows keep focus, scroll, and uncontrolled input state.

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
@key (expr) { … }   <!-- tear down + recreate the content (fresh DOM + effects) when expr changes -->
~~~

## Async blocks

### @defer

~~~html
@defer (on viewport) { … } @placeholder { … }
@defer (when ready()) { … }
~~~

The `@placeholder` is optional. Triggers — note the `on` keyword on the DOM/timing ones:

| Trigger | Fires when |
|---------|-----------|
| `on idle` | the browser is idle (`requestIdleCallback`, falling back to a 1 ms timer) |
| `on viewport` | the placeholder's root element scrolls into view (`IntersectionObserver`) |
| `on interaction` | the placeholder is clicked or keyed (`click` / `keydown`) |
| `on hover` | the pointer enters or focuses the placeholder (`pointerenter` / `focusin`) |
| `on timer(ms)` | after `ms` milliseconds |
| `when expr()` | the (reactive) condition becomes truthy — fires once, then disarms |
| `immediate` | right away (e.g. to code-split with `lazy()` without waiting on anything) |

`when` and `immediate` are written bare; everything else takes the `on` prefix. Anything else is a compile error naming the valid forms.

`viewport`, `interaction`, and `hover` observe the placeholder's root element — provide a `@placeholder`, or there is nothing to observe and they fire immediately. `idle`, `viewport`, and the unsupported-API fallbacks degrade gracefully (fire immediately) when the platform lacks the API.

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

Accepts a Promise, a `@weave-framework/data` resource (a refetch re-shows the pending branch), or a plain value (settles immediately into `@then`). All three branches are optional. `@then (alias)` / `@catch (alias)` bind the resolved value / error to a local. The source is read once, untracked — a fresh Promise on each render is not treated as a dependency.

## Snippets

~~~html
@snippet name(param, other) { … }
@snippet row(item: Task) { … }        <!-- a parameter may carry a TS type -->
@render (name(arg, value))
~~~

A named, parameterized template fragment; `@render` invokes it. A snippet can also be passed to a child as a prop — the render-prop / scoped-slot pattern.

:::callout info "Snippet parameters are `name` or `name: Type`"
Each parameter is a plain identifier (`param`, `$x`, `_y`), optionally with a TypeScript type annotation (`item: Task`). The annotation is consumed by `weave check` to type the snippet body — an untyped parameter is `any`. Nothing else is accepted: default values and destructuring are **not** supported, so `@snippet row(item, sep = ',')` is a compile error (`Invalid @snippet parameter 'sep = ','' (expected 'name' or 'name: Type')`). Pass any defaults from the call site at `@render` instead.
:::

## Components & slots

~~~html
<Child prop="static" other={{ expr }} on:event={{ handler }} />

<Card>
  <h2 slot="header">Title</h2>     <!-- named slot -->
  <p>Default-slot content</p>
</Card>
~~~

In the child: `<slot />` is the default slot, `<slot name="header" />` a named one, and content between the tags (`<slot>fallback</slot>`) is the fallback shown when nothing is provided for that slot.

A component tag takes static/dynamic props and `on:` events — plus **`use:` actions**, which forward to the component's single **root element** with the same lifecycle as on an element:

~~~html
<Button use:menu={{ accountMenu }}>Account</Button>   <!-- action attaches to the root <button> -->
~~~

The component must render exactly one root element (a fragment / text / empty root is a clear error). Other DOM directives (`bind:`, `ref`, `class:`, `.prop`, `show`, `transition:`/`in:`/`out:`) are **not** allowed on a component tag.

## Dynamic elements

~~~html
<w:element this={{ tag }}> … </w:element>
~~~

Renders an element whose tag name is dynamic; it rebuilds (disposing the old element's effects) when `this` changes. All other attributes and children apply to the created element.

## Built-in components

These are ordinary components, not directives — import them from `@weave-framework/runtime/dom` and use them as capitalized tags:

| Tag | Prop | What it does |
|-----|------|--------------|
| `<Dynamic is={{ comp }}>` | `is` | Render a **component** chosen at runtime, swapping reactively when `is` changes (the outgoing branch is disposed). |
| `<KeepAlive is={{ comp }}>` | `is` | Like `Dynamic`, but the outgoing instance is **detached and cached** — its DOM and live state survive the swap and are restored when you swap back. All cached instances dispose with the `<KeepAlive>`. |
| `<Portal to="body">` | `to` | Render the default slot into a **different DOM location** while staying in the logical component tree, so context, owner-scoped effects, and disposal behave as if it lived here. For modals, tooltips, and toasts escaping an `overflow`/`z-index` ancestor. `to` is a CSS selector or an `Element`, defaults to `document.body`, and is resolved **once** at mount. |
| `<Teleport to="body">` | `to` | An alias of `<Portal>` — one implementation, either name. |
| `<ErrorBoundary fallback={{ fn }}>` | `fallback`, `resetKey` | Catch an error thrown while rendering (or in an effect of) its children. `fallback` is `(err, reset) => Node`; the optional reactive `resetKey` clears the error when it changes — e.g. `resetKey={{ path() }}` to recover on navigation. Without a `fallback` the failed subtree renders nothing. |

`<Dynamic>` swaps a component; `<w:element>` above swaps a *tag name*. Reach for either sparingly — plain `@if` and component composition first.

## Escaping

In template **text**, a literal block keyword is escaped by doubling the `@`: write `@@for` to render the characters `@for`. A single `@` that is not a block keyword (as in an email address) is left untouched.

:::callout info "See also"
[Templates (guide)](/learn/templates) · [Components](/learn/components) · [Styling](/learn/styling) · [Motion](/learn/motion) · [@weave-framework/runtime reference](/reference/runtime)
:::
