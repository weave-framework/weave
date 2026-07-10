---
name: weave-store
description: >-
  Shared / app-wide state in a Weave app with @weave-framework/store. Use this
  whenever state must live beyond a single component and be shared across the app:
  `store(factory)` — a lazily-created singleton of signals + actions (auth session,
  cart, theme, feature flags, cross-page selections). Reach for it when the user
  asks about global state, a "store", sharing state between routes/pages, or state
  that outlives a component. For subtree-scoped services use context (weave-component);
  for local state use plain signals (weave-reactivity).
---

# Weave store

`@weave-framework/store` is the smallest possible global-state primitive: `store`
wraps a factory so it runs **once**, lazily, and every consumer gets the same
instance. The factory returns signals/computeds/actions — the store IS just
reactive state in a shared owner, so reads stay fine-grained.

```ts
// stores/auth.ts
import { store } from '@weave-framework/store';
import { signal, computed } from '@weave-framework/runtime';

export const useAuth = store(() => {
  const user = signal<User | null>(null);
  const isAuthed = computed(() => user() !== null);
  const login = async (creds: Creds) => user.set(await api.login(creds));
  const logout = () => user.set(null);
  return { user, isAuthed, login, logout };
});
```
```ts
// any component / guard / anywhere
import { useAuth } from '../stores/auth';
export function setup() {
  const auth = useAuth();          // same instance everywhere
  const name = () => auth.user()?.name ?? 'Guest';
}
```

## When to use what

| Scope | Tool |
| --- | --- |
| Local to one component | plain `signal`/`computed` (weave-reactivity) |
| Shared down a subtree (a provided service, current theme) | context — `createContext`/`provide`/`inject` (weave-component) |
| App-wide, any component/route/guard | **`store`** |

- A **store** is a global singleton — great for session, cart, settings, cross-cutting caches. A route **guard** can read it (`isAuthed()`), so routes re-resolve on auth change (weave-router).
- **Context** is per-subtree and per-instance — great when different subtrees need different instances, or to inject a service without making it global.

## Patterns

- **Keep stores small and cohesive** — one per concern (`useAuth`, `useCart`), not a monolith.
- **Expose actions, not raw setters**, so mutations stay in one place: return `login()/logout()`, not the bare `user` signal's `.set` (unless a consumer legitimately needs it).
- **Derive with `computed`** inside the store for shared derived state (`isAuthed`, `itemCount`).
- **Persistence**: read `localStorage` in the factory to seed initial state; an `effect` inside the store can write back on change.
- Stores compose: one store's factory may call another `useX()`.

## Gotchas

- The factory runs **once** on first `useX()` — don't put per-call logic there.
- A store lives for the app's lifetime (module singleton). For state that should reset per subtree/route, prefer context.
- It's still signals — **read with `()`**, set new references for objects/arrays.
