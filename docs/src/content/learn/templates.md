# Templates

A Weave template is HTML with a few superpowers. It's compiled — at build time it becomes direct DOM operations, so there's no template interpreter shipped to the browser and nothing to diff at runtime. Each binding updates exactly one node, attribute, or property. This page is the full tour of the syntax: text, attributes, events, two-way binding, refs, directives, and control flow.

:::callout tip "One rule to remember: double braces"
Every dynamic value in a template is wrapped in `{{ }}`. Text, attributes, events, bindings — all of them. A single brace (`attr={x}`) is a deliberate error, so there's never any guessing about which form an attribute uses.
:::

## Text interpolation

`{{ expr }}` renders an expression as text. If the expression reads a signal, the text updates when that signal changes; if it doesn't read any signal, it's computed once and never touched again.

~~~html title="Text"
<p>Hello, {{ name() }}!</p>
<p>{{ 2 + 2 }}</p>
<p>{{ user().email }}</p>
~~~

Text is always inserted as plain text content, never as HTML — so `{{ "<b>" }}` shows the literal characters `<b>`, it does not create a bold tag. That makes interpolation safe from injection by default; there is no `innerHTML`-style escape hatch in template syntax.

A `null`, `undefined`, or `false` value renders as the empty string (handy for `{{ cond && label() }}`). Everything else is stringified with `String(...)`.

### Escaping a literal `@`

The `@` character starts a control-flow block. To write a literal `@` in text — for example to document the block keywords themselves — double it: `@@`. The parser emits a single `@` and does not treat what follows as a block.

~~~html title="Literal @"
<p>Use @@for to loop. Type your @@handle below.</p>
~~~

This only matters when the `@` is immediately followed by a block keyword (`@for`, `@if`, …). A stray `@` in prose (like an email address) is left alone.

## Attributes and properties

Five forms cover everything you put on an element other than events and bindings:

| Form | Example | What it does |
|------|---------|--------------|
| Static attribute | `<a href="/">` | A literal string attribute, set once |
| Dynamic attribute | `<a href={{ url() }}>` | Reactive attribute; re-applied when the expression changes |
| Property | `<input .value={{ text() }}>` | Sets a DOM *property* (`el.value`), not an attribute |
| Class toggle | `<li class:done={{ isDone() }}>` | Adds/removes one class by truthiness |
| Show | `<div show={{ open() }}>` | Toggles visibility via `display` (element stays in DOM) |

~~~html title="Attributes"
<button disabled={{ !canSubmit() }} class={{ statusClass() }}>Save</button>
<li class:done={{ task().done }} class:urgent={{ task().priority === 'high' }}>…</li>
<pre show={{ showRaw() }}>{{ JSON.stringify(data(), null, 2) }}</pre>
~~~

A few details worth knowing:

- **Boolean-aware attributes.** A dynamic attribute whose value is `false`, `null`, or `undefined` is *removed* from the element; `true` sets it to the empty string (`disabled=""`); anything else is stringified. So `disabled={{ !canSubmit() }}` does the right thing automatically.
- **Attribute vs property.** Most of the time the attribute form is what you want. Reach for the `.prop` form when the live DOM property and the attribute drift apart — `.value` on an `<input>` after the user has typed, `.checked`, `.indeterminate`, or any property that has no attribute mirror. The property form does no boolean-removal logic; it assigns the raw value.
- **`class:name` vs `class`.** Use `class={{ ... }}` to drive the whole class string and `class:name={{ ... }}` to toggle a single class independently. They compose — a static `class="card"` plus `class:active={{ ... }}` works fine.

`show` differs from `@if`: `show` keeps the element in the DOM and just flips `display` (cheap to toggle, preserves the element's state and any uncontrolled input), and it restores the element's own inline `display` when shown rather than clobbering it. `@if` removes and recreates the element (covered below).

## Events

`on:event={{ handler }}` attaches a listener. The handler is a function — name it or write it inline. Handlers are never reactive (the listener is attached once), so pass the function itself, do not call it.

~~~html title="Events"
<button on:click={{ inc }}>+1</button>
<button on:click={{ () => count.set(0) }}>Reset</button>
<form on:submit={{ onSubmit }}>…</form>
~~~

### Modifiers

Chain **modifiers** with `|` after the event name. They come in two kinds, and you can mix them freely:

~~~html title="Modifiers"
<a on:click|preventDefault={{ go }}>Navigate</a>
<button on:click|stopPropagation|preventDefault={{ edit }}>Edit</button>
<div on:click|self={{ onBackdrop }}>…</div>
<button on:click|once|capture={{ handler }}>…</button>
<div on:scroll|passive={{ onScroll }}>…</div>
~~~

| Modifier | Kind | What it does |
|----------|------|--------------|
| `preventDefault` | guard | Calls `e.preventDefault()` before your handler |
| `stopPropagation` | guard | Calls `e.stopPropagation()` before your handler |
| `self` | guard | Runs your handler only when `e.target === e.currentTarget` (the event fired *on* this element, not a descendant) |
| `once` | listener option | The listener auto-removes after firing once (`{ once: true }`) |
| `capture` | listener option | Listens in the capture phase, not bubble (`{ capture: true }`) |
| `passive` | listener option | Promises never to call `preventDefault`, letting the browser scroll smoothly (`{ passive: true }`) |

The **guard** modifiers wrap your handler in a tiny function that runs the guard, then calls you; `self` returns early without calling you when the target check fails. The **listener-option** modifiers are passed straight to `addEventListener`'s options object. That's the complete set — there are exactly six.

## Two-way binding

`bind:` connects a form control to a **writable signal** — the signal drives the control, and user input writes the signal back. Pass the signal *by reference* (don't call it). The expression must resolve to a writable signal.

~~~html title="bind:"
<input bind:value={{ name }} />
<textarea bind:value={{ bio }}></textarea>
<input type="number" bind:value={{ age }} />
<input type="range" bind:value={{ volume }} />
<input type="checkbox" bind:checked={{ agreed }} />
<input type="radio" name="size" value="L" bind:group={{ size }} />
<select bind:value={{ choice }}>
  <option value="a">A</option>
  <option value="b">B</option>
</select>
<select multiple bind:value={{ picks }}>
  <option value="x">X</option>
  <option value="y">Y</option>
</select>
~~~

The compiler picks the mechanism from the binding name; the runtime then specializes further based on the element and its `type`:

| Binding | Element | Signal holds | Notes |
|---------|---------|--------------|-------|
| `bind:value` | text input, `<textarea>`, single `<select>` | a **string** | IME-composition-safe (see below) |
| `bind:value` | `<input type="number">` / `type="range"` | a **number** | reads `valueAsNumber`, writes a number — not a string |
| `bind:value` | `<select multiple>` | a **string array** | one entry per selected option; an empty selection is `[]` |
| `bind:checked` | `<input type="checkbox">` | a **boolean** | mirrors the checkbox's checked state |
| `bind:group` | `<input type="radio">` | the **selected value** | the signal holds the `value` of the chosen radio in the group |

The signal is the source of truth. A few runtime guarantees worth knowing:

- **Text inputs are IME-safe.** While the user is mid-composition (Chinese/Japanese/Korean input, etc.) the bound value is *not* overwritten, and the signal is written once composition ends — so the half-typed text isn't clobbered.
- **No caret jump.** The DOM is only re-assigned when the value actually differs from what's already there, so the cursor stays put while typing.
- **Numeric edits are forgiving.** Typing `1.` (momentarily `NaN`) won't get clobbered; the comparison is numeric.
- **`<select>` self-heals.** Because `<option>`s are often inserted *after* the binding runs (static markup, an `@for`, or async data), and the browser auto-selects the first option of a freshly-populated select, the binding re-asserts the bound value once the current render settles — so the signal still wins.

:::callout tip "Forms have an even shorter way"
For validated forms you'll usually reach for the `use:control` directive from `@weave-framework/forms/dom`, which binds value, touched state, and `aria-invalid` in one go. See [Forms](/learn/forms).
:::

## References: `ref` / `bind:this`

Grab the actual DOM element with `ref` (or its alias `bind:this` — they compile identically). Handy for focus, measurement, or handing the node to a third-party library. The target can be either a **signal** or a plain **callback**:

:::tabs
~~~html title="template"
<input ref={{ inputEl }} />
<canvas bind:this={{ (el) => setupChart(el) }}></canvas>
~~~
~~~ts title="signal form"
const inputEl = signal<Element | null>(null);
onMount(() => (inputEl() as HTMLInputElement)?.focus());
~~~
:::

If you pass a writable signal, Weave calls `.set(el)` on it. If you pass a function, Weave calls it with the element. (Internally it checks for a `set` method to tell them apart.) The signal form is best when other code needs to read the element later; the callback form is best for fire-and-forget setup.

## Directives: `use:`

`use:action={{ arg }}` runs a function on the element once it's inserted — the escape hatch for imperative DOM work, kept tidy and owner-scoped. An action is `(el, arg) => cleanup?`. It runs at `onMount` timing (the element is live in the document, so focus/measure/3rd-party init all work), and is skipped entirely if the region is torn down before that fires.

:::tabs
~~~ts title="Defining actions"
import type { Action } from '@weave-framework/runtime/dom';

export const autofocus: Action = (el) => {
  (el as HTMLElement).focus();
};

export const tooltip: Action<string> = (el, text) => {
  const tip = makeTip(el, text);
  return () => tip.destroy(); // cleanup runs on unmount
};
~~~
~~~html title="Using actions"
<input use:autofocus />
<button use:tooltip={{ 'Delete forever' }}>Delete</button>
~~~
:::

Three tear-down options, all fired when the region unmounts: return a cleanup function, call `onDispose` inside the action, or create an `effect` (its disposal is tied to the element's region).

**Reactive actions.** For an argument that should *react*, return an `{ update, destroy }` handle — `update(arg)` runs whenever `use:action={{ arg }}` changes, `destroy()` on removal:

~~~ts
export const tooltip: Action<string> = (el, text) => {
  const tip = makeTip(el, text);
  return {
    update: (next) => tip.setText(next),   // re-runs when the arg changes
    destroy: () => tip.destroy(),
  };
};
~~~

(The older pattern — pass a getter `use:tip={{ () => label() }}` and read it inside an `effect` — still works too.)

## Styling one property: `style:`

`style:prop={{ expr }}` sets a single inline style property reactively. It shines for **CSS custom properties**, letting a signal drive a design token that your CSS then consumes:

~~~html
<div style:--accent={{ theme() }} style:opacity={{ faded() ? 0.5 : 1 }}>…</div>
~~~

A `null`/`undefined`/`false` value removes the property. Use it over a full `style={{ … }}` string when only one or two properties are dynamic.

## Dynamic & kept-alive components

`<Dynamic is={{ comp }}>` renders a component chosen at runtime, swapping reactively when `is` changes; other props and slots are forwarded. `<KeepAlive is={{ comp }}>` is the same, but **caches** the instance (DOM *and* live state) when you swap away and restores it on return — ideal for tabs or wizard steps whose state must survive being hidden.

~~~html
<Dynamic is={{ tab() === 'a' ? PanelA : PanelB }} />

<KeepAlive is={{ step() }} />   <!-- each step keeps its scroll / input across switches -->
~~~

`<Teleport to="…">` (an alias of `<Portal>`) renders its slot into a different DOM location — modals, tooltips, toasts that must escape an `overflow`/`z-index` ancestor — while staying in the logical tree (owner, context, and disposal behave as if it lived in place):

~~~html
<Teleport to="body"><div class="modal">…</div></Teleport>
~~~

## Transitions: `transition:` / `in:` / `out:`

Animate an element as it enters or leaves. `transition:` does both; `in:` only on enter; `out:` only on leave. Leave animations are **awaited** — a control-flow block (`@if`/`@for`/`@key`) plays the outro and waits for it before removing the node.

~~~html title="Transitions"
<div transition:fade>Fades both ways</div>
<div in:scale={{ { duration: 150 } }}>Scales in</div>
<aside out:fly={{ { x: 200 } }}>Flies out on removal</aside>
~~~

The optional `={{ params }}` is re-read each time the transition plays. Built-ins (`fade`, `fly`, `slide`, `scale`) come from `@weave-framework/runtime`. Full treatment in [Motion](/learn/motion).

## Control flow

Control-flow blocks start with `@` and use `{ … }` for their bodies. Each block renders in its own ownership scope, so the effects inside it are disposed when that branch/row/region unmounts.

### @if / @else

~~~html title="@if / @else if / @else"
@if (loading()) {
  <p>Loading…</p>
} @else if (error()) {
  <p class="error">{{ error() }}</p>
} @else {
  <Board />
}
~~~

Switching branches swaps the DOM; staying on the same branch leaves it untouched (no remount). The `; as alias` form binds the tested value to a name on the leading branch — perfect for null-narrowing:

~~~html title="@if … ; as alias"
@if (currentUser(); as user) {
  <span>Signed in as {{ user.name }}</span>
} @else {
  <a href="/login">Sign in</a>
}
~~~

### @for

A keyed loop. Always give it a `track` expression — a stable, unique key per item — so Weave reuses nodes across reorders instead of rebuilding them. (If you omit `track`, the index is used as the key, which defeats reuse on reorder — only safe for static lists.)

~~~html title="@for … track / @empty"
@for (task of tasks(); track task.id) {
  <li>{{ task.title }}</li>
} @empty {
  <p class="muted">No tasks yet.</p>
}
~~~

`@empty` renders when the list is empty (and animates out via any `out:` transition when items arrive). Inside the body you get reactive positional locals for free — they update across reorders, not just on first render:

| Local | Meaning |
|-------|---------|
| `$index` | 0-based position |
| `$count` | total number of items in the list |
| `$first` | `true` for the first item |
| `$last` | `true` for the last item |
| `$even` | `true` when `$index` is even |
| `$odd` | `true` when `$index` is odd |

~~~html title="Positional locals"
@for (row of rows(); track row.id) {
  <tr class:alt={{ $odd }}>
    <td>{{ $index + 1 }}</td>
    <td>{{ row.label }}</td>
  </tr>
}
~~~

Reordering, inserting, and removing all happen with the minimum DOM moves (a longest-increasing-subsequence reconcile) — focus, scroll position, and uncontrolled input state in reused rows are preserved.

### @switch / @case / @default

Equality-based branching — each `@case` is compared with `===` against the switch value, in order; `@default` is the fallthrough:

~~~html title="@switch"
@switch (status()) {
  @case ('pending') { <Spinner /> }
  @case ('done') { <Check /> }
  @default { <span>Unknown</span> }
}
~~~

`@default` is optional; if nothing matches and there's no default, nothing renders.

### @let

A local, reactive computed value, available to the siblings that come *after* it in the same block. It re-computes automatically when its inputs change.

~~~html title="@let"
@let fullName = user().first + ' ' + user().last;
<h1>{{ fullName }}</h1>
~~~

Note the trailing `;` — `@let` is a single-statement declaration, not a `{ … }` block.

### @key

Force a teardown-and-recreate of the body whenever the keyed value changes — fresh DOM, fresh state, mount-time work replayed. While the key stays the same, the DOM is left untouched.

~~~html title="@key"
@key (userId()) {
  <UserProfile id={{ userId() }} />
}
~~~

Use it to reset a subtree on identity change — e.g. navigating between two users on the same route, where the component instance would otherwise be reused.

## Async blocks

### @defer

Hold off rendering an expensive subtree until a trigger fires; show a `@placeholder` meanwhile. The placeholder is optional, but some triggers need it (see below).

~~~html title="@defer"
@defer (on idle) {
  <BoardInsights />
} @placeholder {
  <div class="skeleton">Loading insights…</div>
}
~~~

There are seven triggers. Six are one-shot; only `when` is reactive (it re-evaluates and fires the first time it becomes truthy):

| Trigger | Fires when |
|---------|-----------|
| `when expr` | `expr` first becomes truthy (reactive) |
| `on idle` | the browser is idle (`requestIdleCallback`, with a `setTimeout` fallback) |
| `on viewport` | the placeholder scrolls into view (`IntersectionObserver`) |
| `on interaction` | the user clicks or presses a key on the placeholder |
| `on hover` | the pointer enters or focus moves into the placeholder |
| `on timer(2000)` | the given number of milliseconds elapses |
| `immediate` | right away — renders the content synchronously, no waiting |

~~~html title="Other @defer triggers"
@defer (when ready()) { <Chart /> }
@defer (on viewport) { <Heavy /> } @placeholder { <div class="ph"></div> }
@defer (on timer(2000)) { <Banner /> }
~~~

:::callout info "viewport / interaction / hover need a placeholder"
These three triggers watch the **placeholder element** — that's what gets observed for intersection, click, or hover. If there's no placeholder (nothing to observe), the trigger fires immediately. So always give those three a `@placeholder`.
:::

Pair `@defer` with [`lazy()`](/learn/router#code-splitting) to also code-split the deferred chunk — `@defer` gates *rendering*; `lazy()` gates *loading the code*.

### @await / @then / @catch

Render by the settle state of a Promise or a [`@weave-framework/data` resource](/learn/recipes#fetching-data). The block right after `@await (src)` is the pending content; `@then (alias)` binds the resolved value; `@catch (alias)` binds the error. All three parts are optional, and the aliases are optional too.

~~~html title="@await"
@await (task) {
  <p>Loading task…</p>
} @then (t) {
  <h1>{{ t.title }}</h1>
} @catch (e) {
  <p class="error">Couldn't load. {{ String(e) }}</p>
}
~~~

The source is read **once** when the block mounts (a fresh Promise on every render would not be a useful dependency). With a plain Promise it settles once into then/catch. With a `@weave-framework/data` resource it's driven reactively off the resource's loading/error/data signals, so a refetch flips it back to the pending branch automatically.

## Snippets: @snippet / @render

A `@snippet` is a named, parameterized template fragment; `@render` invokes it. Reuse markup without spinning up a whole separate component — and because the snippet name is just a template-local value, you can even pass it to a child as a prop.

~~~html title="@snippet / @render"
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

`@render (expr)` will render anything that resolves to a node, so it also works for a snippet passed in as a prop. The parameter names (`label`, `value` above) are plain locals inside the snippet body.

## Components and slots

A **capitalized** tag is a component; a **lowercase** tag is a DOM element. That casing is the whole distinction — `<Card>` is a component, `<card>` is an (unknown) HTML element.

On a component tag, only three kinds of attribute are allowed:

- **Static props** — `label="Save"`
- **Dynamic props** — `task={{ t }}` (passed as a reactive getter, so the child re-reads through it)
- **Events** — `on:select={{ choose }}` (forwarded to the child as an `onSelect` prop)

~~~html title="Components and slots"
<TaskCard task={{ t }} on:select={{ choose }} />

<Card>
  <h2 slot="header">Title</h2>
  <p>Body goes in the default slot.</p>
</Card>
~~~

:::callout info "`use:` works on a component; other DOM directives don't (yet)"
`use:` **is** allowed on a component tag — the action is forwarded to the component's single root DOM element (see [`use:` on components](#use-on-components) below). `bind:`, `ref`/`bind:this`, `class:`, `.prop`, `show`, and `transition:`/`in:`/`out:` are **not** allowed on a component tag — the compiler rejects them (they target a real DOM element, and a component is an abstraction over potentially many elements). Put those on a plain element *inside* the component, or expose a prop. Project markup into the component through named or default `slot="…"`.
:::

### `use:` on components

A `use:` action attaches to a single-root component the same way it does to an element — Weave forwards it to that component's **root DOM element**, with the identical lifecycle (runs at mount, supports a returned cleanup or `{ update, destroy }`, and re-runs `update` when the argument changes). This means a menu/tooltip trigger can be a real component, not just a native tag, and the "define once, trigger from many places" pattern keeps working across a mix of components and elements:

~~~html title="One menu, many triggers"
<script>
  import Button from '@weave-framework/ui/button';
  export function setup() {
    const accountMenu = { items: [{ value: 'profile', label: 'Profile' }, { value: 'signout', label: 'Sign out' }], onSelect: (v) => {/* … */} };
    return { Button, accountMenu, menu };
  }
</script>

<Button use:menu={{ accountMenu }}>Account ▾</Button>   <!-- component trigger -->
<a use:menu={{ accountMenu }}>Account (footer)</a>       <!-- same menu, native trigger -->
~~~

The action's `aria-*` and listeners land on the component's root element — e.g. `aria-haspopup`/`aria-expanded` end up on the `<button>` inside `<Button>`, exactly where they belong. Multiple `use:` on one component all run, in order.

**Single-root constraint.** The component must render exactly one root element. A component that renders a fragment (multiple top-level nodes), a text/comment root, or nothing is a clear error — e.g. `use:menu on <Account>: actions attach to a single root element, but <Account> renders 3 nodes.` — never a silent mis-attach. (`transition:`/`in:`/`out:` and `ref`/`bind:this` on components are **not yet** supported — put them on an element inside for now.)

The full story — props as reactive getters, callbacks up, named/fallback slots — is in [Components](/learn/components).

## Dynamic elements: `<w:element>`

When the *tag itself* is dynamic, use `<w:element this={{ tag }}>`. It rebuilds the element (disposing the old one's effects) whenever the tag string changes; all other attributes apply to the created element.

~~~html title="<w:element>"
<w:element this={{ 'h' + level() }}>{{ title }}</w:element>
~~~

This renders `<h1>`…`<h6>` depending on `level()`. The same tag value across re-renders is deduped, so an unrelated re-render won't needlessly rebuild it.

:::callout info "What you just learned"
Every dynamic value uses `{{ }}` (and a literal `@` is escaped as `@@`). Bind attributes/properties/classes/visibility, wire `on:` events with all six modifiers (`preventDefault`, `stopPropagation`, `self`, `once`, `capture`, `passive`), go two-way with `bind:` (string / number / boolean / value / string-array depending on the control), and reach the DOM with `ref` (signal or callback) and `use:`. Structure with `@if` (incl. `; as`), `@for` (track, `@empty`, positional `$`-locals), `@switch`, `@let`, and `@key`; go async with `@defer` (seven triggers) and `@await`/`@then`/`@catch`; reuse with `@snippet`/`@render`; compose with components (capitalized tags — static/dynamic props, `on:` events, and `use:` actions forwarded to the root) and slots; and go dynamic with `<w:element>`.
:::

Keep your templates consistently formatted with the [Prettier plugin](/learn/tooling#formatting-templates-prettier) — it understands `{{ }}`, the `@`-blocks, and every binding kind, so you can stop `.prettierignore`-ing them.

[Next: Reactivity in depth →](/learn/reactivity) · [Reference: template syntax →](/reference/template-syntax)
