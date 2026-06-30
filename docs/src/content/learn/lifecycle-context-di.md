# Lifecycle, context & DI

Three related ideas that all flow from one mechanism — the **owner tree**. When a component is created, it gets an ownership scope; that scope is what cleans up its effects, carries its provided values, and disposes everything when it unmounts. Understand the tree, and lifecycle, context, and dependency injection all click into place.

## Lifecycle: there's less than you think

There's no `ngOnInit`, no `componentDidMount`, no `useEffect` ceremony. `setup` *is* the "created" hook — it runs once. For the rest, you need just two functions.

### onMount — after the DOM is live

`setup` runs *before* your component's nodes are in the document. When you need the real, mounted DOM — to focus an input, measure a box, start a chart library, or kick off a fetch — use `onMount`. It fires on the next microtask, once the synchronous mount pass is done:

~~~ts
import { onMount } from '@weave/runtime';

export function setup() {
  onMount(() => void board.load()); // fetch after mount
  return { /* … */ };
}
~~~

`onMount` is skipped entirely if the component is disposed before that microtask — so it's safe even for components that mount and unmount quickly.

### onCleanup / returned cleanups — on the way out

Anything you set up that needs tearing down (a listener, a timer, a subscription) gets a cleanup. Inside an `effect`, return a function or call `onCleanup`; it runs before the effect's next run *and* on unmount:

~~~ts
import { effect, onCleanup } from '@weave/runtime';

effect(() => {
  if (!isOpen()) return;
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
  return () => {                 // runs when isOpen() flips or the component unmounts
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
  };
});
~~~

From an `onMount` callback you can return a cleanup too, or call `onDispose(fn)` for a teardown not tied to a specific effect.

:::callout tip "You rarely tear down by hand"
Every effect created in `setup` (or in an `@if`/`@for` branch) is owned by that scope. When the component or branch unmounts, its effects are disposed automatically — listeners removed, timers cleared. That's why you almost never keep the `stop()` handle from `effect`: the tree does it for you.
:::

## Context: values without prop-drilling

Sometimes a value is needed deep in a subtree — the current user, a theme, a feature flag — and threading it through every intermediate component as a prop is miserable. **Context** lets an ancestor `provide` a value and any descendant `inject` it.

Create a typed token once:

~~~ts title="session.ts"
import { createContext, type Context } from '@weave/runtime';

export interface Session { currentUser: string; }

export const SessionContext: Context<Session> =
  createContext<Session>({ currentUser: '' }); // default if no provider
~~~

An ancestor provides a value (in its `setup`):

~~~ts title="shell.ts"
import { provide } from '@weave/runtime';
import { SessionContext } from './session';

export function setup() {
  provide(SessionContext, { currentUser: 'Lina' });
  return { /* … */ };
}
~~~

Any descendant injects it — no props in between:

~~~ts title="task-card.ts"
import { inject } from '@weave/runtime';
import { SessionContext, type Session } from '../../app/session';

export function setup(props: { task: Task }) {
  const session: Session = inject(SessionContext);
  const mine = () => props.task.assignee === session.currentUser;
  return { mine };
}
~~~

`inject` walks up the owner chain to the nearest provider, falling back to the context's default. Because it rides the **owner tree** (not a synchronous render stack), it works in `setup`, inside effects, and in async callbacks — even inside a `@defer`-ed subtree that renders much later.

## Dependency injection: two scopes

"DI" in Weave isn't a separate system — it's the two ways to share a dependency, chosen by **how widely it should be shared**.

### App-wide singleton → `store()`

When exactly one instance should exist for the whole app — a cart, the board data, the current theme — use a [store](/learn/store). The factory runs once, lazily, on first use; everyone who calls the hook gets the same instance:

~~~ts
import { store } from '@weave/store';
import { signal } from '@weave/runtime';

export const useCart = store(() => {
  const items = signal<Item[]>([]);
  return { items, add: (i: Item) => items.set((xs) => [...xs, i]) };
});

// anywhere — same instance:
const cart = useCart();
~~~

### Subtree-scoped instance → `provide` / `inject`

When each part of the tree should get its *own* instance — a wizard's state, a per-dialog controller — `provide` a freshly-built object on the subtree's root and `inject` it below. A different subtree that provides its own gets a different instance. (This is the "scoped service" pattern: a per-subtree singleton.)

| You want… | Reach for | Scope |
|-----------|-----------|-------|
| One instance everywhere | `store()` | The whole app |
| One instance per subtree | `provide` + `inject` | Under the provider |
| Just pass a value down a level or two | a prop | Parent → child |

## Functional `extends` / `implements`

Coming from class-based code, you might wonder where inheritance went. Weave leans on **composition**, and every OO move has a clean functional stand-in.

**`implements I`** → type the factory's return value. Structural typing does the rest:

~~~ts
interface Logger { log(msg: string): void; }

function consoleLogger(): Logger {
  return { log: (msg) => console.log(msg) };
}
~~~

**`extends Base`** → build the base, then spread it and override:

~~~ts
function base() {
  return { greet: () => 'hi', name: 'base' };
}

function extended() {
  const b = base();
  return { ...b, name: 'extended' }; // override `name`, keep `greet`
}
~~~

**`super.method()`** → just call the base's method inside your override:

~~~ts
function timestamped(): Logger {
  const b = consoleLogger();
  return { log: (msg) => b.log(`[${Date.now()}] ${msg}`) }; // calls "super"
}
~~~

**`abstract method`** → pass the missing piece in as a parameter (that *is* dependency injection):

~~~ts
function repository<T>(fetchOne: (id: string) => Promise<T>) {
  return { get: (id: string) => fetchOne(id) }; // `fetchOne` is the "abstract" bit
}
~~~

**Polymorphism** → a shared interface plus a factory map or a discriminated union, instead of a class hierarchy.

**Mixins** → spread several factory results together: `return { ...withClock(), ...withCounter() }`.

**Reusing component logic** → a **composable**: a plain function that creates signals/effects and returns them, called from any `setup` (the hook-style pattern):

~~~ts
function useToggle(initial = false) {
  const on = signal(initial);
  return { on, toggle: () => on.set((v) => !v) };
}

export function setup() {
  const menu = useToggle();
  const drawer = useToggle();
  return { menu, drawer };
}
~~~

:::callout info "What you just learned"
The **owner tree** underpins all three. `onMount` runs after the DOM exists; cleanups (returned or via `onCleanup`/`onDispose`) run on unmount — usually automatically. **Context** (`createContext`/`provide`/`inject`) shares values down a subtree without prop-drilling. **DI** is just scope choice: `store()` for app-wide singletons, `provide`/`inject` for per-subtree instances. And inheritance becomes composition — factories, spreads, parameters, and composables.
:::

[Next: Router →](/learn/router) · [Reference: @weave/runtime →](/reference/runtime)
