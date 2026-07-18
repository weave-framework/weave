---
name: weave-component
description: >-
  Author or edit a Weave component — a `setup()` function plus a sibling template.
  Use this whenever you create, modify, or review a `.ts`/`.weave` Weave component:
  writing `setup()`, exposing state to the template, `props`, `propDefaults`,
  pairing template/styles, component lifecycle (`onMount`/`onDispose`), events,
  two-way binding, slots, or component-scoped context/DI (`provide`/`inject`).
  Trigger it even when the user just says "make a Weave component/page/widget" or
  is unsure how state reaches the template. For the template markup itself use
  weave-templates; for signals use weave-reactivity.
---

# Weave components

A component = a `setup()` function (the logic) + a template (the structure), two
sibling files with the same base name (`task-card.ts` + `task-card.html`), or one
`.weave` file. No class, no `this`, no lifecycle methods to override.

```ts
// task-card.ts
import { signal } from '@weave-framework/runtime';

export function setup(props: { task: Task }) {
  const open = signal(false);
  const toggle = () => open.set((v) => !v);
  // no return needed — see "Exposing state" below
}
```
```html
<!-- task-card.html -->
<article class:open={{ open() }}>
  <h3>{{ props.task.title }}</h3>
  <button on:click={{ toggle }}>{{ open() ? 'Hide' : 'Show' }}</button>
</article>
```

## The rules

- **`setup` runs once**, when the component is created — it's the constructor and body in one. No re-runs, so never memoize or guard.
- **It receives `props`** — the reactive inputs from the parent.
- **It exposes names to the template** (see below). Signals, computeds, functions, plain values — all fair game.
- **The template reads those names**, calling signals/getters with `()` to read and subscribe.
- **`setup` is optional** — a pure-markup component needs only a template. It may be `const`, `function`, or `async`.

## Exposing state to the template (auto-expose)

The template can read any name `setup` exposes. **You do not need a `return`** — Weave
synthesizes it from exactly the names the template references:

```ts
export function setup() {
  const count = signal(0);
  const inc = () => count.set((n) => n + 1);
  // no return — Weave exposes `count` and `inc` because the template names them
}
```

- **Only what the template uses is exposed.** A private helper or timer the template never names stays private — nothing leaks.
- **Write an explicit `return { … }` to opt out** — when you want to rename, reshape, or expose something the template doesn't read directly, return it by hand and Weave uses that verbatim.
- Both styles type-check identically.

> Requires `@weave-framework/*` ≥ 1.5.11. On older versions, add an explicit `return { … }`.

## Props: data flowing DOWN

Props are **reactive getters** — read them live; **don't destructure** (that snapshots and breaks reactivity):

```ts
export function setup(props: { task: Task; size?: 'sm' | 'md' }) {
  const title = () => props.task.title;     // re-reads reactively
  // BAD: const { task } = props;           // snapshots — loses reactivity
}
```

**Prop defaults** — give static defaults in one place instead of `() => props.x ?? default` per prop:

```ts
export const propDefaults = { size: 'md', variant: 'primary' };
export function setup(props: { size: 'sm' | 'md'; variant: string }) {
  // props.size is 'md' when the parent omitted it
}
```
A prop the parent **omits** reads the default; one it **passes wins** (and stays reactive). An explicit `undefined`/falsy counts as passed. Defaulted props become **optional for the parent** (`weave check` won't demand them). Values must be static — no bindings. *(Requires ≥ 1.5.17.)*

There is **no** framework default-props magic beyond `propDefaults`; for a computed default, do `() => props.x ?? …` in `setup`.

## Events: messages flowing UP

A child reports up via a **callback prop**. `on:x` and `onX` are the *same prop*:

```html
<!-- parent -->  <TaskCard task={{ t }} on:remove={{ (id) => removeTask(id) }} />
```
```ts
// child — `on:remove` arrives as props.onRemove
export function setup(props: { task: Task; onRemove?: (id: string) => void }) {
  const remove = () => props.onRemove?.(props.task.id);
}
```
`on:remove` → `onRemove`, `on:save` → `onSave`, etc. A component-level `on:click` also auto-forwards to the child's root element, so consumers can listen without the child re-declaring it.

## Two-way: hand over the signal

For read+write, pass the **signal itself** (not its value) — the child reads `sig()` and writes `sig.set()`:

```html
<Stepper bind:value={{ count }} />         <!-- sugar: passes the signal -->
<!-- equivalently -->  <Stepper value={{ count }} />
```
```ts
export function setup(props: { value: Signal<number> }) {
  const inc = () => props.value.set((n) => n + 1);
}
```
`bind:value` on a component is sugar for passing the writable signal (*requires ≥ 1.5.19*). The same `bind:value` binds a DOM `<input>` — see weave-forms / weave-templates.

## Template & styles pairing

Precedence, with fail-loud on ambiguity:
- **Sibling files** (default): `foo.ts` + `foo.html` (+ optional `foo.css`/`.scss` per `styleLang`).
- **Declared inline/file**: `export const template = '<h1>{{ t() }}</h1>'` or `export const template = './custom.html'`; `export const styles = ['./a.scss']`. One field each; inline vs file is auto-detected by shape.
- **`.weave` SFC**: `<script>` + template + `<style>` in one file.
- Inline templates bind with `{{ expr }}` — **never** JS `${…}`.

## Child components & imports

A tag is a **child component** iff it starts with an **uppercase letter** (`<TaskCard>`); lowercase is a DOM element. Import it the ordinary way — `import TaskCard from './task-card'`. Even though it's used only in the template, the Weave editor tooling treats a component-tag usage as real use, so **no `void TaskCard;` keep-alive is needed** (with the tooling active). Only `static`, `{{ }}`, `on:`, `use:`, and `bind:` attributes are valid on a component tag.

A **bare** attribute on a component is the boolean `true`: `<Button disabled>` → `disabled: true` (a quoted `label="x"` stays a string).

## Lifecycle & side effects

All functional — call these inside `setup`, not as overridden methods:

- **`onMount(fn)`** — run after the component is in the DOM (measure, focus, start an observer).
- **`onDispose(fn)`** — run on unmount (clear timers, unsubscribe). **This is the one you want in
  `setup` and inside `onMount`.** It registers on the owner scope.
- **`onCleanup(fn)`** — registers on the **currently running computation** (an `effect`/`computed`),
  and runs before each re-run as well as on dispose. It is `if (listener) …` — **with no computation
  running it silently registers nothing**. In a bare `setup` body, or inside an `onMount` callback
  (which fires later, on a microtask, outside any computation), it is a no-op and your resource
  leaks with no error anywhere.
- Reactive side effects use **`effect(() => …)`** (see weave-reactivity).

```ts
import { onMount, onDispose } from '@weave-framework/runtime';
export function setup() {
  onMount(() => {
    const id = setInterval(tick, 1000);
    onDispose(() => clearInterval(id)); // onCleanup here would do NOTHING
  });
}
```

An `onMount` callback may also just **return** its teardown, which is equivalent:

```ts
onMount(() => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
});
```

## Context & dependency injection

For services/state shared down a subtree without prop-drilling: `createContext` + `provide` (in an ancestor's `setup`) + `inject` (in any descendant's `setup`).

```ts
// session.ts
import { createContext } from '@weave-framework/runtime';
export const SessionContext = createContext<Session>();          // or createContext<Session>(fallback)

// ancestor setup(): provide(SessionContext, session)
// descendant setup(): const session = inject(SessionContext)
```
Use context for subtree-scoped things (current user, theme, a service); use a **store** for app-wide state (weave-store); use plain **props/signals** for local parent→child data.

## Slots: markup flowing IN

A child leaves holes with `<slot>` (default + named + fallback); the parent fills them. For repeated markup *within one* component, use a `@snippet` instead of a whole child. Both are covered in **weave-templates**.

## Privacy & composition

Only the names the template reads are visible to it; a component's internal signals/helpers stay private. Reuse logic with **composable functions** that create and return signals — call them from `setup`:

```ts
function usePagination(total: number) {
  const page = signal(1);
  const next = () => page.set((p) => Math.min(p + 1, total));
  return { page, next };
}
export function setup() {
  const { page, next } = usePagination(100);   // shares reactive state, no inheritance
}
```

## Gotchas

- **Don't destructure `props`** — it snapshots and kills reactivity.
- **Call signals with `()`** in the template and in `setup` reads.
- **Inline template/styles use `{{ expr }}`**, not `${…}`.
- If `weave check` says a template name doesn't exist on the context after you removed a `return`, that name wasn't a same-named local — hoist it to a `const` (or restore the return).
- A returned binding may **shadow** a like-named prop (e.g. re-exposing `task: () => props.task`).
