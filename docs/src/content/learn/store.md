# Store

A store is shared state that lives outside any one component. In Weave it's almost nothing: a lazily-created singleton bag of signals and the functions that change them. Because the state *is* signals, every component that reads it updates surgically — no selectors, no reducers, no actions/dispatch ceremony, no context plumbing.

## The whole API

There is exactly one function, and this is its full signature:

~~~ts
store<T extends object>(factory: () => T): () => T
~~~

That's the entire surface. The implementation is two lines — a closure holding one slot:

~~~ts
export function store<T extends object>(factory: () => T): () => T {
  let instance: T | undefined;
  return () => (instance ??= factory());
}
~~~

So `store(factory)` returns a *hook* — a zero-argument function. The `factory` you pass is also zero-argument. The first time you call the hook, the factory runs and its return value is cached; every call after that hands back that same cached value. Both functions take no arguments, by design: a store is a global singleton, so there's nothing to parameterize.

~~~ts
import { store } from '@weave/store';
import { signal, computed } from '@weave/runtime';

export const useCart = store(() => {
  const items = signal<Item[]>([]);
  const total = computed(() => items().reduce((s, i) => s + i.price, 0));
  return {
    items,
    total,
    add: (i: Item) => items.set((xs) => [...xs, i]),
    clear: () => items.set([]),
  };
});
~~~

Consume it from anywhere — components, other stores, plain functions — and you get the one shared instance:

~~~ts
export function setup() {
  const cart = useCart();
  return { cart };
}
~~~

~~~html
<p>{{ cart.items().length }} items — {{ cart.total() }} €</p>
<button on:click={{ cart.clear }}>Empty cart</button>
~~~

A store is just a factory of signals — everything you already know about [signals](/learn/signals) and [computeds](/learn/reactivity) applies inside it. The `store` function itself adds nothing but the lazy-singleton wrapper.

### The factory must return an object

Look at the constraint: `T extends object`. The factory has to return an object (or array, or function — anything that isn't a primitive). The cart factory returns `{ items, total, add, clear }`; that's the object you get back from every `useCart()`.

This isn't a style suggestion, it's enforced by the type checker. A factory that returns a primitive won't compile:

~~~ts
const useCount = store(() => 0);
//                      ^ Type 'number' does not satisfy the constraint 'object'
~~~

If you genuinely want one shared number, wrap it in a signal and return *that* — which is the object the constraint wants anyway:

~~~ts
const useCount = store(() => ({ count: signal(0) }));
~~~

### "Runs once" has one exception

The factory runs lazily and is cached — but the cache is `instance ??= factory()`. The `??=` only fills the slot when it's still `null` or `undefined`. So "runs once" is true *only once the factory returns a non-nullish value*.

If your factory returns `null` or `undefined`, the slot stays empty and **the factory runs again on the next call** — every call, until it finally returns something:

~~~ts
const useThing = store(() => {
  if (!ready()) return undefined; // slot stays empty…
  return { /* … */ };             // …so the factory re-runs next time, until this branch hits
});
~~~

In practice the `T extends object` constraint pushes you away from this — `undefined` isn't an `object`, so you'd usually see a type error first. But if your return type includes `null`/`undefined` (or you cast), know that those values are *not* cached and the factory will keep running. Return a real object every time and the factory runs exactly once for the life of the program.

:::callout info "No reset, no teardown"
A store has no `dispose`, `reset`, or `clear` on the `store` API itself — once the factory runs, that instance lives for the entire lifetime of the module. There is no way to swap it out short of reloading the module.

This matters in two places. **Tests:** state leaks between test cases that import the same store module; isolate them by re-importing the module fresh (e.g. `vi.resetModules()`) rather than expecting a built-in reset. **HMR:** a hot reload that doesn't re-evaluate the store module keeps the old instance and its current values.

A `clear()` *action* (like `useCart`'s above) resets the *data* inside the store — but the instance, and its signals, are the same objects as before. That's an application choice you write, not part of `store`.
:::

:::callout tip "Lazy by design"
The factory doesn't run until the first `useCart()`. A store nobody uses costs nothing, and there's no registration step or provider to mount — import the hook and call it.
:::

## A realistic store

Everything past this point is **application code** — patterns you build *with* the `store` API, not features of it. The `store(...)` wrapper is the only Weave-provided part; the loader, selectors, and mutations below are plain functions and signals you write yourself.

Stores shine for server-backed data. Here's the shape of a board store: signals for state, a loader that fetches once, derived selectors, and mutations that update optimistically and roll back on failure.

~~~ts title="stores/board.ts"
import { store } from '@weave/store';
import { signal, computed } from '@weave/runtime';
import { api } from '../data/api';

export const useBoard = store(() => {
  const tasks = signal<Task[]>([]);
  const loading = signal(false);
  const error = signal<string | null>(null);
  let loaded = false;

  async function load(force = false) {
    if (loaded && !force) return; // fetch once unless forced
    loaded = true;
    loading.set(true);
    error.set(null);
    try {
      tasks.set(await api.get<Task[]>('/tasks'));
    } catch (e) {
      error.set(e instanceof Error ? e.message : String(e));
    } finally {
      loading.set(false);
    }
  }

  // derived selectors — just computeds / functions over the signals
  const byStatus = (status: Status) => tasks().filter((t) => t.status === status);
  const counts = computed(() => ({
    total: tasks().length,
    done: tasks().filter((t) => t.status === 'done').length,
  }));

  return { tasks, loading, error, load, byStatus, counts };
});
~~~

Note the `loaded` flag and the `load()` function are ordinary closure variables — `store` does nothing special with them. They work because the factory body *is* the closure that the singleton lives in.

Trigger the load from a component's `onMount`, and read the rest reactively:

~~~ts
export function setup() {
  const board = useBoard();
  onMount(() => void board.load());
  return { board };
}
~~~

~~~html
@if (board.loading()) {
  <p>Loading…</p>
} @else if (board.error()) {
  <p class="error">{{ board.error() }}</p>
} @else {
  <span>{{ board.counts().done }} / {{ board.counts().total }} done</span>
}
~~~

## Optimistic mutations

This too is application code. Because the state is plain signals, an optimistic update is just: write the expected value now, call the server, then reconcile or roll back. No special API needed:

~~~ts
async function create(input: NewTask): Promise<Task> {
  const temp: Task = { ...input, id: `tmp-${++seq}` };
  tasks.set((xs) => [...xs, temp]);            // 1. show it immediately
  try {
    const saved = await api.post<Task>('/tasks', input);
    tasks.set((xs) => xs.map((t) => (t.id === temp.id ? saved : t))); // 2. reconcile
    return saved;
  } catch (e) {
    tasks.set((xs) => xs.filter((t) => t.id !== temp.id)); // 3. roll back on failure
    throw e;
  }
}
~~~

The UI reflects each `tasks.set` the instant it runs. (For a more declarative take on optimistic UI, `@weave/data` offers an [`optimistic`](/learn/recipes#optimistic-ui) helper — but as you can see, the store can do it with nothing but signals.)

## Store, context, or a plain signal?

All three share reactive state; pick by **scope and lifetime**:

| Use | When | Lifetime |
|-----|------|----------|
| **`store()`** | One shared instance for the whole app (cart, board, session data, theme) | App lifetime — no reset |
| **`provide`/`inject`** | A fresh instance per subtree (a wizard, a per-dialog controller) | The provider's subtree — see [DI](/learn/lifecycle-context-di#dependency-injection-two-scopes) |
| **a `signal` in `setup`** | State local to one component (and maybe passed a level down) | The component |

A useful hybrid: `provide()` a store-like object built in a parent's `setup` — you get a scoped singleton, shared by that subtree but not global. Reach for that when "app lifetime, no reset" is exactly what you *don't* want.

:::callout info "What you just learned"
`store<T extends object>(factory)` is the whole API: a lazy, app-wide singleton of signals + actions — no selectors, no reducers, no dispatch. The factory and the returned hook both take no arguments, and the factory must return an object. It runs once and caches via `instance ??= factory()` — so a factory that returns `null`/`undefined` will run again until it returns a real object. There's no reset or teardown; the instance lives for the module's lifetime (mind that in tests and HMR). Everything else — loaders, selectors, optimistic update + rollback — is plain signal code you write inside the factory. Reach for a store for app-wide state, `provide`/`inject` for per-subtree, and a local signal for one component.
:::

[Next: Forms →](/learn/forms) · [Reference: @weave/store →](/reference/store)
