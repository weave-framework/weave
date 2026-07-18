# @weave-framework/store

Weave's built-in state management — lazy singleton stores over signals. Zero dependencies.

Part of **[Weave](https://weaveframework.dev/)** — a fine-grained reactive, signal-native UI framework: no Virtual DOM, zero third-party runtime dependencies.

```bash
npm install @weave-framework/store
```

Most apps get this (and the rest of Weave) in one step:

```bash
npm create weave@latest my-app
```

## Usage

A store is a lazily-instantiated singleton bag of signals + actions. The factory runs once, on first use; every caller then shares that one instance. Because the state *is* signals, anything that reads it updates surgically — no selectors, no reducers, no context plumbing.

```ts
import { signal, computed } from '@weave-framework/runtime';
import { store } from '@weave-framework/store';

export const useCart = store(() => {
  const items = signal<Item[]>([]);
  const total = computed(() => items().reduce((sum, i) => sum + i.price, 0));
  return {
    items,
    total,
    add: (item: Item) => items.set((xs) => [...xs, item]),
  };
});
```

Call it anywhere — inside a component's `setup()`, inside another store, or in a plain module:

```ts
const cart = useCart();
cart.add(product);
cart.total(); // reactive
```

`store` is this package's single export. For state scoped to one subtree rather than the whole app, use context (`provide` / `inject` from `@weave-framework/runtime`) instead.

📚 **Guides + full API reference:** [Store guide](https://weaveframework.dev/learn/store) · [API reference](https://weaveframework.dev/reference/store)

## License

MIT
