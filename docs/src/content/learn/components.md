# Components

A component is the unit you build screens out of. In Weave it's refreshingly plain: a `setup` function and a template. No class, no `this`, no lifecycle methods to override. This page is about the component itself — how it's shaped, and how components talk to one another.

## Anatomy of a component

Two sibling files, same base name:

:::tabs
~~~ts title="task-card.ts"
import { inject } from '@weave-framework/runtime';
import { useEditor, type EditorStore } from '../../stores/editor';
import { SessionContext, type Session } from '../../app/session';
import type { Task } from '../../data/types';

export function setup(props: { task: Task }) {
  const task = () => props.task;
  const editor: EditorStore = useEditor();
  const session: Session = inject(SessionContext);
  const mine = () => !!props.task.assignee && props.task.assignee === session.currentUser;
  return { task, editor, mine };
}
~~~
~~~html title="task-card.html"
<article class="card">
  <p class="title">{{ task().title }}</p>
  @if (mine()) {
    <span class="mine">You</span>
  }
  <button on:click={{ () => editor.open(task().id) }}>Edit</button>
</article>
~~~
:::

The rules are short:

- **`setup` runs once**, when the component is created. It's the constructor and the body rolled into one.
- **It receives `props`** — the inputs from the parent.
- **It returns an object** — every name in that object is visible to the template. Functions, signals, computeds, plain values: all fair game.
- **The template reads those names.** Call signals/getters with `()` to read (and subscribe).

Because `setup` runs once, you don't memoize anything or guard against re-renders — there are none. State you create lives for the life of the component, and reactivity updates the DOM in place.

:::callout tip "Why a function and not a class?"
A closure already gives you private state (locals) and a public surface (what you return) — so there's nothing for `private` or `this` to add. See [Why Weave?](/learn/why-weave#why-functions-not-classes) for the full reasoning, and [Lifecycle, context & DI](/learn/lifecycle-context-di) for the functional stand-ins for `extends`/`implements`.
:::

### `setup` is optional, and flexible about its shape

`setup` is not mandatory and not rigid:

- **You can omit it entirely.** A component that's pure markup (no inputs, no state) needs no script — just a template. A `.ts` file becomes a component the moment it has a sibling `.html` (or declares a `template`), with or without a `setup`.
- **It can return nothing.** If `setup` only runs side effects (an `onMount`, a `provide`) and exposes no names, just return nothing — `void` is fine. The template simply has no bindings to read.
- **It can be `const` or `function`, and may be `async`.** All of `export function setup(props) {…}`, `export const setup = (props) => {…}`, and `export async function setup(props) {…}` are recognized. (The loader detects `setup` by either spelling.)

~~~ts title="header.ts — template-only, no setup"
// This file is a component purely because header.html sits next to it.
// No exports needed.
~~~

:::callout info "There is no default-props mechanism"
Coming from React (`defaultProps`) or Angular (an `@Input` initializer)? Weave has **no** such thing. A prop that the parent didn't pass simply reads as `undefined`. Default it yourself, in `setup`, where you can see it:

~~~ts
export function setup(props: { size?: 'sm' | 'md' }) {
  const size = () => props.size ?? 'md'; // your default lives here
  return { size };
}
~~~
:::

## How a component declares its template and styles

The two-sibling-files layout above is the **convention**, not the only way. A component is really just a script paired with some template text and (optionally) some CSS — and there are several legitimate ways to say where each comes from. Knowing them all saves you from fighting the build when a one-file or inline form would be cleaner.

A `.ts` file is treated as a component when **either** it has a sibling `.html` **or** it exports a `template`. Anything else is an ordinary module.

### Every form for the template

| # | Form | Looks like | When it applies |
| --- | --- | --- | --- |
| 1 | **Sibling file** (convention) | `app.ts` + `app.html` | Default. No `template` export; the loader reads `app.html` next to the `.ts`. |
| 2 | **Inline string** | `export const template = '<h1>{{ x() }}</h1>';` | Classified *inline* because the value contains `<`, `{`, `}`, or a newline. |
| 3 | **Explicit file** | `export const template = './custom.html';` | Classified *file* because the value has a `/` or `\`, or ends in `.html`. Read relative to the `.ts`. |

The "inline vs file" decision is made **by shape**, not by a separate `templateUrl` field. The rule:

- Contains any of `<` `{` `}` newline → **inline markup**.
- Otherwise has a slash/backslash, or ends `.html` → **file path**.
- Otherwise (short, path-less text like `"Hello"`) → treated as **inline** content.

### Every form for the styles

| # | Form | Looks like | When it applies |
| --- | --- | --- | --- |
| 4 | **Sibling file** (convention) | `app.ts` + `app.scss` | Default. No `styles` export; the loader reads the sibling `app.<styleLang>` (extension set by `styleLang` in config). |
| 5 | **Inline string** | `export const styles = '.x { color: red }';` | Classified *inline* (contains `{`, `}`, or a newline). |
| 6 | **Explicit file** | `export const styles = './a.scss';` | Classified *file* (has a slash/backslash, or ends `.css`/`.scss`/`.sass`). |
| 7 | **Array** | `export const styles = ['./base.scss', '.x{…}'];` | Each entry classified **independently** (file or inline), compiled, and concatenated in array order — so the cascade follows the order you list. |

`styles` is the only one of the two that accepts an array; a `template` array is an error (see below). Inline style strings are compiled with the project's `styleLang` (so an inline string in an SCSS project is parsed as SCSS), whereas a file entry is compiled by its **own** extension.

### The `.weave` single-file component

You don't have to split a component across files at all. A `.weave` file holds everything — script, template, and styles — in one place:

~~~html title="counter.weave"
<script>
  import { signal } from '@weave-framework/runtime';
  export function setup() {
    const n = signal(0);
    return { n, inc: () => n.set((v) => v + 1) };
  }
</script>

<button on:click={{ inc }}>Count: {{ n() }}</button>

<style>
  button { font: inherit; padding: 6px 10px; }
</style>
~~~

Everything outside the `<script>` and `<style>` blocks is the template. The `<style>` block is compiled with your configured `styleLang` and scoped exactly like a sibling stylesheet. This is a first-class authoring form — reach for it when a component is small enough that one file reads better than three.

### Fail-loud rules

Weave refuses ambiguous or unsafe declarations at **build time** rather than guessing. Each of these throws:

| You did | Error |
| --- | --- |
| Exported `template` **and** have a sibling `.html` | "declares `template` and also has a sibling .html — remove one" |
| Exported `styles` **and** have a sibling style file | "declares `styles` and also has a sibling .`<styleLang>` — remove one" |
| Pointed `template`/`styles` at a file that doesn't exist | "template file not found" / "style file not found" |
| Used `${…}` in a backtick `template`/`styles` | "cannot use `${…}` — Weave binds with `{expr}`, not JS interpolation" |
| Made `template` an array | "`template` must be a single string, not an array" |
| Gave `template`/`styles` a non-static value (not a string literal, or array of string literals) | "must be a static string" (these are read **statically**, never evaluated — a variable or function call can't be inspected at build time) |

:::callout tip "Why a backtick still can't interpolate"
You may write a `template` with backticks for multi-line convenience — but `${expr}` inside it is rejected. Weave's binding is `{{ expr }}` in the template, resolved by the compiler; `${…}` is JavaScript string interpolation that would run *before* Weave ever sees the markup. Keeping them separate is what makes the markup analyzable.
:::

## Props: data flowing down

A parent passes data to a child as attributes. Static values use quotes; dynamic values use `{{ }}`:

~~~html
<TaskCard task={{ t }} />
<Badge priority="high" />
~~~

Inside the child, props arrive as the first argument to `setup`. The key detail: **props are reactive getters, not snapshots.** Reading `props.task` re-reads the parent's expression, so when the parent's data changes, anything in the child that read it updates too. The idiom is to wrap a prop in a getter and expose that:

~~~ts
export function setup(props: { task: Task }) {
  const task = () => props.task; // a getter — stays live
  return { task };
}
~~~

Then `{{ task().title }}` in the template tracks changes to the parent's `task`. (If you destructured `const { task } = props`, you'd capture the value *once* and lose reactivity — so don't.)

:::callout info "Coming from Angular or React?"
Props are the equivalent of Angular's `@Input()` or a React prop. The difference: there's no change-detection pass and no re-render. A prop is a live getter into the parent, and only the bindings that actually read it react.
:::

## Events: messages flowing up

A child talks back to its parent by **calling a function the parent gave it**. Pass a callback down as a prop:

:::tabs
~~~html title="parent.html"
<TaskForm editId={{ editor.editId() }} onClose={{ editor.close }} />
~~~
~~~ts title="task-form.ts"
export function setup(props: { editId?: string; onClose: () => void }) {
  // …later, when the user is done:
  const done = () => props.onClose();
  return { done /* …and the rest */ };
}
~~~
:::

There are two spellings, and they are **the same prop**:

- A **plain callback prop**: `onClose={{ fn }}` → the child reads `props.onClose`.
- The **`on:` form** for event-style names: `on:close={{ fn }}` → compiled to the prop `onClose` (the event name is capitalized and prefixed with `on`). So `on:close` and `onClose` arrive at exactly the same prop; `on:select` becomes `onSelect`, and so on.

Use whichever reads better. The point is the same as everywhere else in UI: data flows down, events flow up. There's no `@Output` emitter to set up — a function *is* the channel.

:::callout info "What counts as a child component"
A tag is a **child component** when its name starts with an **uppercase letter** (`<TaskCard>`, `<Badge>`). A lowercase tag (`<div>`, `<my-widget>`) is a plain DOM element. That single rule is how the compiler decides whether to mount a component or emit an element — there is no registration step.

And because component tags compile to a function call with a props object, **static, dynamic (`{{ }}`), and `on:` attributes are the props/events surface of a `<Component>`**. One DOM directive is also allowed: **`use:` forwards its action to the component's single root element** (same lifecycle as on an element — see [`use:` on components](/learn/templates#use-on-components)). The other DOM-level directives — `class:`, `bind:`, `transition:`, `ref`, `show`, `.prop` — are compile errors on a component tag (they only mean something on a real element). Pass data as props instead.
:::

## Two-way: pass the signal itself

Sometimes a child should both read *and* write a parent's value. Don't invent a second event for that — just hand the child the **signal**, and it can read it (`sig()`) and set it (`sig.set(…)`):

:::tabs
~~~html title="parent"
<!-- parent passes the writable signal, not its value -->
<Stepper value={{ count }} />
~~~
~~~ts title="child (Stepper)"
// child reads and writes the same signal
export function setup(props: { value: Signal<number> }) {
  const inc = () => props.value.set((n) => n + 1);
  return { value: props.value, inc };
}
~~~
:::

For form controls, the DOM-level `bind:value` does this against an `<input>` — covered in [Templates](/learn/templates#two-way-binding) and [Forms](/learn/forms).

## Slots: content flowing in

Props pass *data*. **Slots** pass *markup* — they let a parent drop content into a hole the child leaves open. This is content projection (Angular's `<ng-content>`, React's `children`).

The child marks where content goes with `<slot>`:

~~~html title="card.html"
<div class="card">
  <header><slot name="header" /></header>
  <main><slot /></main>
  <footer><slot name="footer">© 2026</slot></footer>
</div>
~~~

The parent fills them — unmarked content goes to the default slot, `slot="name"` targets a named one:

~~~html title="parent.html"
<Card>
  <h2 slot="header">Welcome</h2>
  <p>This lands in the default slot.</p>
  <small slot="footer">Custom footer</small>
</Card>
~~~

- A bare `<slot />` is the **default** slot.
- `<slot name="header" />` is a **named** slot.
- Content *between* the `<slot>` tags (`<slot>© 2026</slot>`) is **fallback** — shown when the parent provides nothing for it.
- Routing content to a named slot needs a **static** `slot="name"` on the parent's fill — it's read at compile time, so it can't be a dynamic `{{ }}` expression.
- A fill that is only whitespace doesn't count as content: the slot **falls back**. So an empty line in the parent won't suppress a fallback.

:::callout info "Where does slot content's context come from?"
Slot markup is written by the parent but rendered inside the child. Its `inject()` calls resolve against the **child's** position in the tree. Usually that's exactly what you want; it's worth knowing when a slot needs a value from a provider.
:::

## Reusable markup with snippets

For repeated chunks *within one component*, you don't always need a whole child component. A `@snippet` is a named, parameterized piece of template you can `@render` as many times as you like:

~~~html
@snippet column(status, label) {
  <div class="column">
    <h3>{{ label }}</h3>
    @for (t of visible(status); track t.id) {
      <TaskCard task={{ t }} />
    } @empty {
      <p class="muted">Nothing here.</p>
    }
  </div>
}

<div class="columns">
  @render (column('todo', 'To do'))
  @render (column('doing', 'In progress'))
  @render (column('done', 'Done'))
</div>
~~~

A snippet can even be passed to a child as a prop and `@render`-ed there — the Weave take on render props / scoped slots. Full syntax in [Templates](/learn/templates#snippets).

## When a binding and a prop share a name

The template can read both props and the names `setup` returns. If a returned binding has the **same name** as a prop, the **binding wins** — it shadows the prop for the template. This is deliberate and is exactly how the live-getter idiom works: a prop `task` shadowed by a returned `task = () => props.task` lets the template call `{{ task() }}` and stay reactive, while `setup` still reaches the raw input through `props.task`.

~~~ts
export function setup(props: { task: Task }) {
  const task = () => props.task; // returned `task` shadows the `task` prop in the template
  return { task };
}
~~~

## A note on privacy

Only what `setup` returns is visible to the template, and only props + `on:` events cross the boundary into a child. A component's internal signals and helpers stay private by construction — there's no `@ViewChild` reaching into a child's guts. When a deeply nested component needs shared state, lift it: a signal passed down, a [context](/learn/lifecycle-context-di) provided to a subtree, or a [store](/learn/store) shared app-wide.

:::callout info "What you just learned"
A component is an optional `setup` (runs once, returns the template's names — may be omitted, `async`, or return nothing) + a template. Template and styles can come from a **sibling file**, an **inline string**, an **explicit file**, a **`styles` array**, or a **`.weave`** single file — and Weave fails loud on ambiguity (declaration *and* a sibling), a missing file, `${…}` in a backtick, or a non-static value. A tag is a child component iff it starts **uppercase**, and only static / `{{ }}` / `on:` attributes are legal on it. Props flow **down** as reactive getters (don't destructure); events flow **up** as callback props where `on:x` *is* `onX`; two-way means passing the **signal** itself. There's no default-props mechanism — default inside `setup`. A returned binding **shadows** a like-named prop. Slots project markup in (default, named, static `slot=`, whitespace-only falls back), and `@snippet`/`@render` reuse markup within a component.
:::

[Next: Templates →](/learn/templates) · [Reference: @weave-framework/runtime →](/reference/runtime)
