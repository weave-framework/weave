# Store

A store is shared state that lives outside any one component. In Weave it's almost nothing: a lazily-created singleton bag of signals and the functions that change them. Because the state *is* signals, every component that reads it updates surgically — no selectors, no reducers, no actions/dispatch ceremony, no context plumbing.

## The whole API

`store(factory)` returns a hook. The factory runs **once**, lazily, the first time the hook is called; every caller after that shares the same instance:

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

That's the entire surface. A store is just a factory of signals — everything you already know about [signals](/learn/signals) and [computeds](/learn/reactivity) applies inside it.

:::callout tip "Lazy by design"
The factory doesn't run until the first `useCart()`. A store nobody uses costs nothing, and there's no registration step or provider to mount — import the hook and call it.
:::

## A realistic store

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

Because the state is plain signals, an optimistic update is just: write the expected value now, call the server, then reconcile or roll back. No special API needed:

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
| **`store()`** | One shared instance for the whole app (cart, board, session data, theme) | App lifetime |
| **`provide`/`inject`** | A fresh instance per subtree (a wizard, a per-dialog controller) | The provider's subtree — see [DI](/learn/lifecycle-context-di#dependency-injection-two-scopes) |
| **a `signal` in `setup`** | State local to one component (and maybe passed a level down) | The component |

A useful hybrid: `provide()` a store-like object built in a parent's `setup` — you get a scoped singleton, shared by that subtree but not global.

:::callout info "What you just learned"
`store(factory)` is a lazy, app-wide singleton of signals + actions — no selectors, no reducers, no dispatch. Read its signals anywhere and the UI tracks them. Mutations are plain `signal.set` calls, which makes optimistic update + rollback trivial. Reach for a store for app-wide state, `provide`/`inject` for per-subtree, and a local signal for one component.
:::

[Next: Forms →](/learn/forms) · [Reference: @weave/store →](/reference/store)
