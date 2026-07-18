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
- The type is **`Signal<T>`** — `(): T` plus `set` / `update` / `peek`. `set` and `update` **return the value** they settled on.
- Second arg is `{ equals?, name? }`. `name` is *only* a devtools label (see below) — it changes no behavior.
- `set(fn)` treats a function as an updater. To store a function **as the value**, wrap it: `handler.set(() => myFn)`.
- **Signals hold values, not deep-reactive proxies.** To "change" an object/array, set a new reference: `list.set([...list(), item])`, not `list().push(item)`.

## Computeds — derived, cached, lazy

```ts
import { computed } from '@weave-framework/runtime';
const doubled = computed(() => count() * 2);
doubled();  // read like a signal (call it); recomputes only when a dependency changed
```
No manual memoization ever. A computed recomputes lazily on read, only if a source changed, and caches otherwise. Keep computeds **pure** (no side effects).

- The type is **`Computed<T>`** — literally `() => T`, read-only. There is no `.set` on a computed.
- Same options object as `signal`: `computed(fn, { equals, name })`.
- If the body **throws**, the memo is left dirty (never caches a stale value) and rethrows to its *reader* — so a `try/catch` at the read site, or a `catchError` boundary around the effect that reads it, is what catches it.

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
- An error thrown inside an effect does **not** propagate to the caller: it walks the owner chain to the nearest `catchError` boundary, and rethrows only if there is none.
- `effect(fn, { name })` — again, `name` is a devtools label only.

## Ownership & lifecycle

Reactive scopes form an ownership tree. A component's `setup` runs in its owner; its effects/computeds dispose when the component unmounts — no leaks, no manual teardown.

- **`onDispose(fn)`** — register a teardown on the **current owner scope**. Runs once, when that scope (component / `@if` branch / `@for` row) unmounts. This is the one to reach for in `setup` and inside `onMount`.
- **`onCleanup(fn)`** — register a teardown on the **current running computation** (an `effect` or `computed`). Runs before every re-run *and* on dispose. **It is a silent no-op when no computation is running** — see the gotcha below.
- **`onMount(fn)`** — run after the component's DOM is inserted (next microtask). Return a cleanup, or call `onDispose` inside; the callback is **skipped entirely** if the scope was disposed before the microtask fired, and it is inert during headless/server rendering.
- **`root(fn)`** — run `fn` in a fresh owner that nothing else disposes. `fn` receives the dispose handle: `root((dispose) => { … })`. For reactivity that must outlive the current scope (a global store). You dispose it yourself.
- **`getOwner()`** — the current `Owner` or `null`. Use it to capture a scope and re-enter it later from an async callback.
- **`createOwner(parent?)` / `runInOwner(owner, fn)` / `disposeOwner(owner)`** — the manual trio behind all of the above. `createOwner(parent)` only wires *disposal* to `parent`; the context chain always comes from the ambient owner at creation time. Reach for these when building infrastructure (a control-flow primitive, a custom renderer), not in app code.
- **`untrack(fn)`** — read signals WITHOUT subscribing: `effect(() => { if (a()) doThing(untrack(b)); })` reacts to `a` but not `b`.
- **`batch(fn)`** — coalesce multiple writes into one flush so effects run once: `batch(() => { x.set(1); y.set(2); });`.
- **`tick()`** — `await tick()` resolves after the current reactive flush + a microtask. Reactive updates are **synchronous** (the DOM is already current right after a `set` outside a `batch`), so `tick` is for waiting on microtask-queued work: `onMount` callbacks, deferred error-boundary swaps.

```ts
import { getOwner, runInOwner, onDispose, effect } from '@weave-framework/runtime';

const owner = getOwner();                       // captured in setup, synchronously
void fetch('/api/thing').then(() => {
  runInOwner(owner, () => {                     // effects created here dispose with the component
    effect(() => {/* … */});
    onDispose(() => {/* … */});
  });
});
```

### Error boundaries — `catchError`

```ts
import { catchError, signal } from '@weave-framework/runtime';

const failed = signal<unknown>(null);
const result = catchError(
  (err) => failed.set(() => err),   // handler: set a fallback, don't rethrow
  () => renderRiskyThing(),         // runs in a child owner; its effects route errors here
);
```

`catchError(handler, fn)` returns `fn`'s value, or `undefined` if `fn` threw synchronously. It catches (a) synchronous throws in `fn` and (b) throws from effects created inside it, *whenever they later re-run*. It does **not** catch a rejected promise you never awaited, and it does not catch a throw from a `computed` read outside the boundary. The boundary owner disposes with the surrounding scope.

## Context — `createContext` / `provide` / `inject`

Values ride the **owner tree**, not a render stack — so `inject` works in `setup`, in effects, and in async callbacks, as long as it runs inside the owning scope.

```ts
import { createContext, provide, inject } from '@weave-framework/runtime';

export const ThemeContext = createContext<'light' | 'dark'>('light'); // arg = default

// ancestor setup():
provide(ThemeContext, 'dark');
// any descendant setup():
const theme = inject(ThemeContext);
```

- A `Context<T>` token is an opaque object; its **identity** is the lookup key — never construct one by hand, and export the single token so provider and consumer share it.
- **`provide` throws** outside an owner scope (`provide() must be called within a component setup or owner scope`). `inject` does not throw — with no provider it returns the context's `defaultValue`, which is `undefined` if you created the context with no argument. Type it `createContext<T | undefined>()` or supply a default rather than assuming a provider exists.
- Context values are **not reactive by themselves**. Provide a *signal* (or an object of signals) if consumers must react: `provide(Ctx, { user, setUser })`.
- `inject` resolves at **call time** by walking `owner._parent` upward, so the value must already be provided when the descendant injects. Calling `provide` at the top of `setup` (before children render) is the reliable order.

## Extras (`@weave-framework/runtime`)

- **`watch(source, cb, opts?)`** — run `cb(value, prev)` when `source()` changes. **Only `source` is tracked** — reads inside `cb` do *not* subscribe, which is the whole point versus a bare `effect`. Lazy by default; `{ immediate: true }` also fires on creation with `prev === undefined`. `cb` may return a cleanup. Returns a stop handle (also owner-disposed).
- **`debounced(source, ms)`** — a `Computed<T>` that trails `source` by `ms` of quiet. The **initial value is seeded immediately** (no delay); each change restarts the timer, and unmount cancels the pending write.
- **`linkedSignal(source, opts?)`** — a writable `Signal<T>` derived from `source` but locally overridable until `source` changes again (e.g. "reset the selection when the list changes"). Owner-scoped.
- **`fromObservable(obs, initial?)` / `toObservable(source)`** — bridge an RxJS-style `Subscribable` to/from a signal (interop only — Weave itself is zero-dep; don't pull in RxJS just for this). Supporting types: `InteropObserver<T>` (`next`/`error`/`complete`, all optional) and `Unsubscribable` (`{ unsubscribe() }`); a `subscribe` may return either that object or a bare teardown function.
  - `fromObservable` returns `() => T | undefined` — it is `initial`/`undefined` until the first emission, so narrow before use. A stream error is **rethrown on the next read**, so it lands in a `catchError` boundary. Call it inside an owner scope or it never unsubscribes.
  - `toObservable` starts a fresh isolated `root` per `subscribe`, emitting the current value immediately then on every change; only `unsubscribe()` ends it.

## Transitions

`fade`, `fly`, `slide`, `scale` are enter/leave animations used from a template via `transition:` / `in:` / `out:` (see weave-templates). They are plain functions, so they must be **exposed from `setup`** like any other template value.

```ts
import { fade, fly } from '@weave-framework/runtime';
export function setup() {
  return { fade, fly };
}
```

```html
<div transition:fade>both ways</div>
<aside out:fly={{ { x: 200, duration: 200 } }}>flies out</aside>
```

- All four take `{ delay?, duration?, easing? }` (duration defaults to **300**ms); `fly` adds `x`/`y`, `scale` adds `start` (default 0), `slide` collapses the element's measured height.
- A custom transition is a **`TransitionFn<P>`** — `(node: Element, params: P) => TransitionConfig` — where `TransitionConfig` is `{ delay?, duration?, easing?, css?(t, u), tick?(t, u) }`. `t` runs 0→1 entering and 1→0 leaving, `u = 1 - t`. Prefer `css` over `tick`; `css` is composited, `tick` runs JS per frame.

## Devtools

Introspection is **off by default and zero-cost when off** — a node registers only if devtools are enabled *and* it was given a `name`.

```ts
import { enableDevtools, signal, computed, mountDevtoolsPanel, inspect } from '@weave-framework/runtime';

enableDevtools();                                   // must run BEFORE the nodes are created
const count = signal(0, { name: 'count' });
const doubled = computed(() => count() * 2, { name: 'doubled' });
const stopPanel = mountDevtoolsPanel({ position: 'bottom-right' });
console.log(inspect());                             // [{ id, name, kind, value }, …]
```

| Call | Returns |
| --- | --- |
| `enableDevtools(on = true)` / `isDevtoolsEnabled()` | toggle / read the flag |
| `inspect()` | `DevSnapshot[]` — flat list of named nodes with current values |
| `inspectGraph()` | `{ nodes, edges }` — the static "what depends on what" (`DevEdge = { from, to }`) |
| `inspectTree()` | `DevOwnerNode[]` — nodes nested under the owner/component scopes they were created in |
| `inspectTrace(limit?)` / `traceFor(id, limit?)` | `DevTrigger[]` — the temporal "what just fired and what it caused", newest first |
| `clearTrace()` / `setTraceLimit(n)` | reset / resize the trace ring buffer (default 500) |
| `devNodeCount()` | number of registered nodes |
| `onDevtoolsChange(cb)` | subscribe to registry *membership* changes; returns an unsubscribe fn |
| `mountDevtoolsPanel(opts?)` | mounts the floating panel; returns a disposer. `DevtoolsPanelOptions = { position?, target? }` |

Types: `DevKind` (`'signal' | 'computed' | 'effect'`), `DevNode`, `DevSnapshot`, `DevEdge`, `DevTrigger`, `DevOwner`, `DevOwnerNode`.

**The two mistakes here:** calling `enableDevtools()` *after* creating the signals (they were never registered, so `inspect()` is empty), and expecting unnamed nodes to appear (they never register — a name is the opt-in). `onDevtoolsChange` fires only when nodes appear/disappear, not on value changes; read `inspect()` inside an `effect` to react to values.

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
- **`onCleanup` outside a computation is a silent no-op.** It attaches to the *running* effect/computed, so `onCleanup` in a bare `setup` body — or inside an `onMount` callback, which runs in a later microtask with no computation active — registers nothing and leaks. Use **`onDispose`** there; keep `onCleanup` for teardown that must repeat on every effect re-run.

```ts
import { onMount, onDispose } from '@weave-framework/runtime';
export function setup() {
  onMount(() => {
    const id = setInterval(() => {/* … */}, 1000);
    onDispose(() => clearInterval(id));   // NOT onCleanup — no computation is running here
  });
}
```

- **`batch` and `untrack` are not interchangeable.** `batch` defers the *flush* of effects (writes); `untrack` suppresses *dependency collection* (reads). Wrapping writes in `untrack` does not coalesce them, and wrapping reads in `batch` still subscribes.
- **`root` is not disposed by its parent.** `root((dispose) => …)` deliberately detaches from the surrounding scope — if you never call `dispose`, it lives for the page's lifetime. Prefer plain `effect`/`computed` inside a component and let the owner handle it.
