# Components

A component is the unit you build screens out of. In Weave it's refreshingly plain: a `setup` function and a template. No class, no `this`, no lifecycle methods to override. This page is about the component itself — how it's shaped, and how components talk to one another.

## Anatomy of a component

Two sibling files, same base name:

:::tabs
~~~ts title="task-card.ts"
import { inject } from '@weave/runtime';
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
  <button on:click={{ () => editor.open(task().id) }}>✎</button>
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

There are two spellings, and they compile to the same thing:

- A **plain callback prop**: `onClose={{ fn }}` → the child calls `props.onClose()`.
- The **`on:` form** for event-style names: `on:close={{ fn }}` → the child calls the corresponding handler.

Use whichever reads better. The point is the same as everywhere else in UI: data flows down, events flow up. There's no `@Output` emitter to set up — a function *is* the channel.

## Two-way: pass the signal itself

Sometimes a child should both read *and* write a parent's value. Don't invent a second event for that — just hand the child the **signal**, and it can read it (`sig()`) and set it (`sig.set(…)`):

~~~html
<!-- parent passes the writable signal, not its value -->
<Stepper value={{ count }} />
~~~

~~~ts
// child reads and writes the same signal
export function setup(props: { value: Signal<number> }) {
  const inc = () => props.value.set((n) => n + 1);
  return { value: props.value, inc };
}
~~~

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

## A note on privacy

Only what `setup` returns is visible to the template, and only props + `on:` events cross the boundary into a child. A component's internal signals and helpers stay private by construction — there's no `@ViewChild` reaching into a child's guts. When a deeply nested component needs shared state, lift it: a signal passed down, a [context](/learn/lifecycle-context-di) provided to a subtree, or a [store](/learn/store) shared app-wide.

:::callout info "What you just learned"
A component is `setup` (runs once, returns the template's names) + a template. Props flow **down** as reactive getters; events flow **up** as callback props (`onX` / `on:x`); two-way means passing the **signal** itself. Slots project markup in (default, named, with fallback), and `@snippet`/`@render` reuse markup within a component.
:::

[Next: Templates →](/learn/templates) · [Reference: @weave/runtime →](/reference/runtime)
