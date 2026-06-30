# Lifecycle, context & DI

Three related ideas that all flow from one mechanism — the **owner tree**. When a component is created, it gets an ownership scope; that scope is what cleans up its effects, carries its provided values, and disposes everything when it unmounts. Understand the tree, and lifecycle, context, and dependency injection all click into place.

## Lifecycle: there's less than you think

There's no `ngOnInit`, no `componentDidMount`, no `useEffect` ceremony. `setup` *is* the "created" hook — it runs once, synchronously, *before* your component's nodes are in the document. For everything after that, you need just three functions: `onMount`, `onCleanup`, and `onDispose`. The catch is that they're easy to mix up, and when you reach for the wrong one nothing yells at you — it just quietly does nothing. So let's nail down exactly what each one does, and where each one goes silent.

### onMount — after the DOM is live

When you need the real, mounted DOM — to focus an input, measure a box, start a chart library, or kick off a fetch — use `onMount`. It does **not** run synchronously inside `setup`. It schedules your callback on the next **microtask**, after the whole synchronous construct-and-mount pass has finished, so by the time it fires the nodes are in the document:

~~~ts title="board.ts"
import { onMount } from '@weave-framework/runtime';

export function setup() {
  onMount(() => void board.load()); // fetch after the DOM is live
  return { /* … */ };
}
~~~

A few things worth being precise about, because each is a real branch in the code:

- **It captures the owner scope active *at registration*.** Whatever owner is current when you *call* `onMount` is the owner the callback runs inside later — not whatever happens to be current when the microtask fires. So `onMount` called in a `setup`, in an `@if` branch, or in a `@for` row each ties itself to that exact scope.
- **It's skipped entirely if that scope is disposed before the microtask.** If the component (or branch, or row) unmounts during that brief synchronous window — before the microtask runs — the callback never fires at all. That's what makes `onMount` safe for things that mount and unmount in the same tick: no torn-down DOM access, no half-started chart.
- **A returned cleanup ties to owner *disposal*, not to anything re-running.** If your callback returns a function, that function is registered via `onDispose` on the captured scope. It runs **once**, when the scope is disposed (unmount). It does **not** re-run — `onMount` fires exactly once, so its cleanup fires at most once.

~~~ts title="chart.ts"
import { onMount } from '@weave-framework/runtime';

export function setup(props: { data: number[] }) {
  let host: HTMLElement;
  onMount(() => {
    const chart = drawChart(host, props.data); // needs the real, sized element
    return () => chart.destroy();              // runs once, on unmount
  });
  return { /* … */ };
}
~~~

One sharp edge: if you call `onMount` **outside any owner scope** (no component, no active owner), the callback still runs on the microtask, but a cleanup it returns has nowhere to register — the `onDispose` tie-in is a **no-op**, so that cleanup will never run. In normal app code you're always inside an owner, so this only bites in standalone scripts or tests that forgot to wrap things in a scope.

### onCleanup vs onDispose — the trap

Both register teardown. They look interchangeable. They are not, and this is the single most common place to trip. The difference is **what each one attaches to**, and crucially, **each silently no-ops in the wrong place** — no error, no warning, just nothing.

- **`onCleanup(fn)` needs a running *computation*** — the body of an `effect`, a `computed`, or a `watch` that is executing *right now*. It pushes `fn` onto that computation's cleanup list. That cleanup runs **before the computation's next re-run** *and* when the computation is disposed. Call `onCleanup` anywhere there's no computation actively running (e.g. directly in `setup`, or in a plain event handler) and it is a **silent no-op**.
- **`onDispose(fn)` needs an active *owner scope*** — a component `setup`, a control-flow branch, a `root`. It pushes `fn` onto that owner's disposer list, to run **once** when the owner is disposed (unmount). Call `onDispose` with no active owner and it is a **silent no-op**.

The recompute behaviour is the part people miss: an `onCleanup` registered inside a `computed` (or `effect`/`watch`) runs **every time that computation recomputes**, just before the new run — not only at unmount. An `onDispose` only ever fires at unmount. So if you want "tear this down every time the effect re-runs," that's `onCleanup`; if you want "tear this down once when the component goes away," that's `onDispose`.

| | `onCleanup(fn)` | `onDispose(fn)` |
|---|---|---|
| Needs… | a **computation running now** (`effect` / `computed` / `watch` body) | an **active owner scope** (`setup`, branch, `root`) |
| Runs `fn`… | before the computation's **next recompute**, *and* on dispose | **once**, on owner dispose (unmount) |
| Re-runs on recompute? | **Yes** — every recompute | No — once only |
| Outside its required context | **silent no-op** (no error) | **silent no-op** (no error) |
| Reach for it when… | tearing down per-run resources inside an effect | tearing down once at unmount, not tied to any effect |

Inside an `effect`, you have a third option that's really just `onCleanup` in disguise: **return a function from the effect body**. Weave pushes that returned function onto the same cleanup list, so it behaves exactly like `onCleanup` — runs before the next run and on dispose:

~~~ts title="modal.ts"
import { effect, onCleanup } from '@weave-framework/runtime';

effect(() => {
  if (!isOpen()) return;
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
  return () => {                 // === onCleanup(() => …): runs when isOpen() flips, and on unmount
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
  };
});
~~~

Returning a cleanup and calling `onCleanup` are equivalent — pick whichever reads better; don't do both for the same teardown or it'll run twice. For a teardown that belongs to the *component*, not to any one effect — say, you `provide`d something or opened a connection directly in `setup` — use `onDispose`:

~~~ts title="setup.ts"
import { onDispose } from '@weave-framework/runtime';

export function setup() {
  const socket = openSocket();
  onDispose(() => socket.close()); // once, when the component unmounts
  return { /* … */ };
}
~~~

:::callout tip "You rarely tear down by hand"
Every effect created in `setup` (or in an `@if`/`@for` branch) is owned by that scope. When the component or branch unmounts, the scope is disposed and every effect's cleanups run automatically — listeners removed, timers cleared. That's why you almost never keep the `stop()` handle that `effect` returns: the owner tree does it for you. You only call `stop()` for an effect you deliberately created *outside* the normal scope and want to end early.
:::

## Context: values without prop-drilling

Sometimes a value is needed deep in a subtree — the current user, a theme, a feature flag — and threading it through every intermediate component as a prop is miserable. **Context** lets an ancestor `provide` a value and any descendant `inject` it. Three functions, and a couple of footguns worth knowing cold.

### createContext — the token

`createContext<T>(defaultValue?)` makes an opaque, typed token. The token's *identity* (the object itself) is the lookup key — there are no string names to collide. The optional `defaultValue` is what `inject` hands back when nobody up the tree provided one:

~~~ts title="session.ts"
import { createContext, type Context } from '@weave-framework/runtime';

export interface Session { currentUser: string; }

export const SessionContext: Context<Session> =
  createContext<Session>({ currentUser: '' }); // default if no provider
~~~

If you call `createContext<T>()` with **no** argument, the default is `undefined`. That matters for `inject` — see the footgun below.

### provide — set a value on the current scope

`provide(ctx, value)` stores `value` for `ctx` on the **current owner scope**, visible to every descendant that injects the same token until that scope disposes. Call it in a component `setup` (or any active owner scope):

~~~ts title="shell.ts"
import { provide } from '@weave-framework/runtime';
import { SessionContext } from './session';

export function setup() {
  provide(SessionContext, { currentUser: 'Lina' });
  return { /* … */ };
}
~~~

Outcomes to know:

- **No owner scope → it throws.** `provide` called with no active owner throws `weave: provide() must be called within a component setup or owner scope`. This is deliberate and loud — a provide with nowhere to live is always a bug, so it fails fast rather than silently dropping the value. (Contrast `inject`, which never throws.)
- **Provide twice on the same scope → last wins.** Calling `provide(ctx, …)` twice in one scope just overwrites the entry on that scope's context map. There's no error and no stacking; the second value replaces the first for that subtree.
- **Provide in a child scope → shadows the ancestor.** If an ancestor provided a value and a descendant scope provides its own for the same token, descendants of *that* scope see the child's value; siblings outside it still see the ancestor's. This is how per-subtree instances work (see DI below).

### inject — read the nearest value

`inject(ctx)` walks up the **owner chain** from the current scope, returning the first provided value it finds, or the token's default if it reaches the top without a hit:

~~~ts title="task-card.ts"
import { inject } from '@weave-framework/runtime';
import { SessionContext, type Session } from '../../app/session';

export function setup(props: { task: Task }) {
  const session: Session = inject(SessionContext);
  const mine = () => props.task.assignee === session.currentUser;
  return { mine };
}
~~~

Outcomes to know — and these differ sharply from `provide`:

- **No owner scope → it does *not* throw.** Unlike `provide`, `inject` is happy outside an owner: with no current owner the chain walk simply doesn't start, and it returns the token's `defaultValue`.
- **No provider, has a default → you get the default.** The walk reaches the top, finds nothing, hands back `defaultValue`. Clean and expected.

:::callout info "The footgun: no default + no provider = `undefined` typed as `T`"
If you created the context **without** a default and nothing up the tree provided a value, `inject` returns `undefined` — but the return type is still `T`, *not* `T | undefined`. The implementation does `return context.defaultValue as T`, so TypeScript will happily let you treat that `undefined` as a real value, and you'll only find out at runtime when something explodes. Two ways to stay safe: give every context a sensible `defaultValue`, or — when there genuinely is no sane default — guard the result (`if (!x) throw …`) right where you inject. Don't trust the `T` here.
:::

Because `inject` rides the **owner tree** (the ambient `_parent` chain), not a synchronous render stack, it works in `setup`, inside effects, and in async callbacks alike. It even works inside a `@defer`-ed or other control-flow subtree that renders much later: those subtrees capture their ambient owner at creation, so the parent chain — and therefore your provided context — is still reachable when the deferred code finally runs.

### The owner tree underneath it all

Everything above — automatic cleanup, `onMount`'s captured scope, `provide`/`inject` walking the chain — is the same mechanism: the **owner tree**. Each component, each control-flow branch, gets an ownership scope; the scope holds its effects' disposers and its provided context map, links to its parent, and tears everything down when it's disposed. You rarely touch it directly, but when you need to (a custom root, a detached subtree, manual lifecycle in a script or test), the primitives `root`, `getOwner`, `createOwner`, `runInOwner`, and `disposeOwner` are the low-level API — documented in [Reactivity → Ownership](/learn/reactivity#ownership-who-cleans-up). `onDispose`, `provide`, and `inject` are all just thin layers over what those primitives expose.

## Dependency injection: two scopes

"DI" in Weave isn't a separate system — it's the two ways to share a dependency, chosen by **how widely it should be shared**.

### App-wide singleton → `store()`

When exactly one instance should exist for the whole app — a cart, the board data, the current theme — use a [store](/learn/store). The factory runs once, lazily, on first use; everyone who calls the hook gets the same instance:

~~~ts
import { store } from '@weave-framework/store';
import { signal } from '@weave-framework/runtime';

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
The **owner tree** underpins all three. `onMount` runs on the next microtask in the scope active at registration, is skipped if that scope is already gone, and its returned cleanup runs once on unmount. The trap: **`onCleanup` needs a running computation** (and re-runs on every recompute), **`onDispose` needs an owner scope** (and runs once at unmount) — each is a *silent no-op* in the wrong place. **Context**: `provide` **throws** with no owner, `inject` **never throws** (it returns the default — and with no default + no provider you get `undefined` typed as `T`, so guard it); inject walks the parent chain, which is why it survives `@defer`. **DI** is just scope choice: `store()` for app-wide singletons, `provide`/`inject` for per-subtree instances. And inheritance becomes composition — factories, spreads, parameters, and composables.
:::

[Next: Router →](/learn/router) · [Reference: @weave-framework/runtime →](/reference/runtime)
