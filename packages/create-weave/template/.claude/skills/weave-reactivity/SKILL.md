---
name: weave-reactivity
description: >-
  Weave's reactive core — signals, computeds, and effects. Use this whenever you
  work with state and derived values in a Weave app: `signal`, `computed`,
  `effect`, `batch`, `untrack`, `tick`, `root`, or the extras `watch`,
  `debounced`, `linkedSignal`, `fromObservable`/`toObservable`. Reach for it when
  deciding how to model state, why a value isn't updating (or updates too often),
  how to run a side effect, or how to derive one value from others. Trigger it even
  for vague "how does state/reactivity work in Weave" questions.
---

# Weave reactivity

Weave is signal-native: state lives in **signals**, derived state in **computeds**,
side effects in **effects**. The graph is fine-grained, lazy (pull), and glitch-free.
A signal change patches exactly the DOM/computeds that read it — there is no re-render.
Everything is from `@weave-framework/runtime`.

## Signals — writable state

```ts
import { signal } from '@weave-framework/runtime';
const count = signal(0);

count();                     // READ (and subscribe, inside a reactive context)
count.set(5);                // WRITE
count.set((n) => n + 1);     // WRITE from previous
count.update((n) => n + 1);  // alias for set(fn)
count.peek();                // read WITHOUT subscribing
```

- Reading `count()` inside a template binding, `computed`, or `effect` **subscribes** that consumer.
- `set` skips notifying if the value is unchanged (`Object.is` by default; pass `{ equals }` for custom, e.g. deep).
- **Signals hold values, not deep-reactive proxies.** To "change" an object/array, set a new reference: `list.set([...list(), item])`, not `list().push(item)`.

## Computeds — derived, cached, lazy

```ts
import { computed } from '@weave-framework/runtime';
const doubled = computed(() => count() * 2);
doubled();  // read like a signal (call it); recomputes only when a dependency changed
```
No manual memoization ever. A computed recomputes lazily on read, only if a source changed, and caches otherwise. Keep computeds **pure** (no side effects).

## Effects — reactive side effects

```ts
import { effect } from '@weave-framework/runtime';
const stop = effect(() => {
  document.title = `Count: ${count()}`;   // re-runs when count changes
  return () => {/* optional cleanup, runs before each re-run and on dispose */};
});
```
- An effect runs once immediately, then re-runs when a tracked dependency changes.
- It auto-tracks whatever it reads. Return a cleanup function for teardown.
- Effects are owned by the surrounding component and dispose with it — you rarely call the returned `stop`.
- **Use effects for the outside world** (DOM, logging, subscriptions), not to compute values — use a `computed` for values.

## Ownership & lifecycle

Reactive scopes form an ownership tree. A component's `setup` runs in its owner; its effects/computeds dispose when the component unmounts — no leaks, no manual teardown.

- **`onCleanup(fn)` / `onDispose(fn)`** — run on unmount (see weave-component).
- **`root(fn)`** — create a detached owner for reactivity that must outlive the current scope (rare; e.g. a global store). You dispose it yourself.
- **`untrack(fn)`** — read signals WITHOUT subscribing: `effect(() => { if (a()) doThing(untrack(b)); })` reacts to `a` but not `b`.
- **`batch(fn)`** — coalesce multiple writes into one flush so effects run once: `batch(() => { x.set(1); y.set(2); });`.
- **`tick()`** — `await tick()` resolves after the current reactive flush + a microtask (for tests / post-update DOM reads). Note: synchronous updates are already applied before `tick`.

## Extras (`@weave-framework/runtime`)

- **`watch(source, cb)`** — run `cb(value, prev)` when `source()` changes (not immediately). For "do X when Y changes" without hand-rolling an effect + prev tracking.
- **`debounced(sig, ms)`** — a computed that trails `sig` by `ms` (search-as-you-type).
- **`linkedSignal(fn)`** — a writable signal whose value is derived from a source but can be locally overridden until the source changes again.
- **`fromObservable(obs)` / `toObservable(sig)`** — bridge an RxJS-style `Subscribable` to/from a signal (interop only — Weave itself is zero-dep; don't pull in RxJS just for this).

## Choosing the right tool

| Need | Use |
| --- | --- |
| Writable state | `signal` |
| A value derived from other state | `computed` (pure) |
| Touch the outside world when state changes | `effect` |
| "When X changes, do Y" with prev value | `watch` |
| Multiple writes, one update | `batch` |
| Read without subscribing | `peek()` or `untrack` |
| Trailing/debounced value | `debounced` |

## Gotchas

- **Read with `()`.** `count` is the accessor; `count()` is the value. A bare `count` in a template/computed passes the function, not the value.
- **Mutating in place doesn't notify.** Set a new reference for objects/arrays (or use a custom `equals`).
- **Don't compute in an effect** to feed the template — expose a `computed` and read it. Effects that write a signal they also read are a bug (Weave's loop-safety stops the runaway, but the logic is wrong — use `untrack`/`peek` or restructure).
- **Effects are for side effects, computeds are for values** — keeping this split makes reactivity predictable and leak-free.
