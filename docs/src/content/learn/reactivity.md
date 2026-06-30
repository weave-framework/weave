# Reactivity in depth

You met `signal` and `effect` in [Thinking in signals](/learn/signals). Those two are the whole loom — but Weave gives you a few more threads to weave with. This page is the complete tour of the reactive core: every primitive, every option, and the gotchas the happy path hides from you. By the end you'll know not just what each one does, but what it does when things get weird.

## The mental model

Everything reactive in Weave is a graph of two kinds of node:

- **Sources** — values you can read and write: a `signal`.
- **Derivations** — things that read sources and react: a `computed` (which produces a new cached value) and an `effect` (which produces a side effect).

When a source changes, Weave doesn't re-run your whole component or diff a virtual copy of the page. It walks the edges of that graph and touches *only* the derivations that actually read the changed source. Reads build the edges; you never declare them.

Under the hood every node has one of three states — clean, "check" (maybe-dirty), or dirty. A write pushes a cheap "maybe-dirty" signal downstream; a read pulls, verifying along the way and recomputing only the memos whose real inputs changed. That's what makes diamonds glitch-free and memos stay cached — but you don't have to hold any of that in your head to use the primitives below.

:::callout tip "Synchronous by default"
The moment you call `signal.set(...)` (outside a `batch`), every dependent `effect` has already re-run and the DOM is already up to date. There is no render queue to await, no "next tick" before your change is visible. This is why most Weave code reads top-to-bottom like ordinary JavaScript.
:::

## signal — the source

A `signal` holds a value and announces every change. Create it, read it by calling it, write it with `.set`:

~~~ts title="The four ways to touch a signal"
import { signal } from '@weave/runtime';

const count = signal(0);

count();                    // read (and subscribe, if inside a derivation) → 0
count.set(5);               // write a value
count.set((n) => n + 1);    // write via an updater → 6
count.update((n) => n + 1); // exactly the same as .set(fn) → 7
count.peek();               // read WITHOUT subscribing → 7
~~~

A quick map of every member, so there are no surprises:

| Call | Does | Returns |
| --- | --- | --- |
| `count()` | Read, and subscribe the current derivation (if any) | the value |
| `count.set(v)` | Write a value | the new value |
| `count.set(fn)` | Write via `fn(prev)` | the new value |
| `count.update(fn)` | Identical to `.set(fn)` — just reads nicer for in-place updates | the new value |
| `count.peek()` | Read **without** subscribing | the value |

`.set` returns the new value, and skips the whole notification if the value didn't actually change. "Didn't change" is decided by `Object.is` by default — override it with the `equals` option for value-like objects:

~~~ts title="Custom equality"
// Treat two points as equal when their fields match, so setting an equal
// point is a no-op and dependents don't re-run.
const point = signal({ x: 0, y: 0 }, {
  equals: (a, b) => a.x === b.x && a.y === b.y,
});

point.set({ x: 0, y: 0 }); // equal under our rule → no notification, no re-runs
~~~

:::callout info "peek() vs ()"
Calling the signal subscribes the current derivation to it. `peek()` reads the value *without* subscribing — reach for it when you need the current value but explicitly don't want to re-run when it later changes (e.g. reading a counter inside an effect that should only react to something else). For a whole block of un-subscribed reads, use [`untrack`](#untrack--read-without-subscribing) instead.
:::

## computed — the cached derivation

A `computed` derives a new value from other signals. It's **lazy** (it only recomputes when you read it) and **cached** (it won't recompute until one of its real dependencies changes):

~~~ts title="A basic computed"
import { signal, computed } from '@weave/runtime';

const first = signal('Ada');
const last = signal('Lovelace');
const fullName = computed(() => `${first()} ${last()}`);

fullName(); // "Ada Lovelace" — computed once, then cached
last.set('Byron');
fullName(); // "Ada Byron" — recomputed, because `last` changed
~~~

You never reach for `useMemo` or `useCallback` here — caching is the default, not an opt-in. A `computed` is read-only: it has no `.set`, `.update`, or `.peek`. You just call it.

### The equals option

Like `signal`, `computed` takes an `equals` option with the same meaning: it decides whether a freshly-computed result counts as "changed." If the new result is equal to the old one, the computed keeps its cached value and **does not** mark its readers dirty — so nothing downstream re-runs. Default is `Object.is`.

~~~ts title="computed(fn, { equals })"
// This computed produces a fresh array object every run, but if the
// contents are the same we don't want dependents to re-run.
const sorted = computed(
  () => [...items()].sort(),
  { equals: (a, b) => a.length === b.length && a.every((x, i) => x === b[i]) },
);
~~~

This is the same machinery that makes a `signal`'s `equals` work — same option name, same default, same effect of suppressing downstream notifications. If you already understand it on `signal`, you already understand it here.

### Lazy means lazy — side effects may never fire

A computed only runs its function **when something reads it**. Never read it, and it never runs. That's a feature for performance, but it's a trap if you smuggle side effects into a computed:

~~~ts title="Don't do this"
const logged = computed(() => {
  console.log('computing!'); // ⚠️ may NEVER print — nobody reads `logged`
  return expensive(data());
});
// `logged` is never called → the body never runs → no log, no recompute.
~~~

If you want something to happen, use an [`effect`](#effect--the-side-effect) (which runs eagerly). A `computed` is for *deriving a value you'll read*, nothing else.

### A computed that throws

If the function inside a `computed` throws, the error is **re-thrown to whoever reads the computed**. The computed does not swallow it and does not route it to an error boundary — it surfaces at the call site, exactly as if you'd called a function that threw.

~~~ts title="A throwing computed surfaces at the reader"
const ratio = computed(() => {
  if (denom() === 0) throw new Error('division by zero');
  return num() / denom();
});

ratio(); // throws right here if denom() is 0 — handle it where you read it
~~~

This is the key contrast with `effect` (next): a computed's error goes *out to its reader*; an effect's error goes *up the owner chain to an error boundary*. Same machinery underneath, opposite direction.

## effect — the side effect

An `effect` runs a function **immediately and synchronously** — before `effect(...)` even returns — and then again whenever anything it read changes. Use it to push reactive state *out* of the graph — into the console, `localStorage`, a canvas, a third-party widget:

~~~ts title="An effect runs now, then on every change"
import { signal, effect } from '@weave/runtime';

const theme = signal('light');

const stop = effect(() => {
  document.body.dataset.theme = theme(); // runs NOW, and on every theme change
});

theme.set('dark'); // effect re-runs synchronously → body theme attribute updates

stop(); // tear it down manually (rarely needed — see ownership below)
~~~

Two things to internalize:

- **It runs before it returns.** By the time you have the `stop` handle, the body has already run once. There's no "first tick" to wait for.
- **It returns a `stop()` handle.** Call it to dispose the effect: cleanups run, dependencies detach, and it's removed from any pending queue. After `stop()`, it never runs again.

Dependencies are tracked by *what you actually read each run*. Add a branch that reads a new signal, and the effect starts reacting to it; stop reading one, and it stops. No dependency array to keep in sync — ever.

### Cleaning up

If an effect sets up something that needs tearing down (a timer, a subscription, a listener), return a cleanup function — **or** call `onCleanup`. Either way, the cleanup runs **before each re-run** and **on disposal**:

~~~ts title="onCleanup vs returning a cleanup"
import { signal, effect, onCleanup } from '@weave/runtime';

const room = signal('general');

effect(() => {
  const socket = openSocket(room()); // re-subscribe when `room` changes
  onCleanup(() => socket.close());   // close the OLD socket before re-running
});
~~~

Returning the cleanup is equivalent — pick whichever reads better:

~~~ts title="The returned-function form"
effect(() => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id); // same lifecycle as onCleanup(...)
});
~~~

Both forms run the cleanup at exactly the same moments: just before the body runs again, and once more when the effect is disposed (by `stop()` or by its owner). If an effect registers several cleanups, they all run.

### An effect that throws goes to the nearest error boundary

This is the big contrast with `computed`. When an effect's function throws, the error does **not** surface at any reader (an effect has no readers). Instead Weave walks **up the owner chain** to the nearest error boundary and hands it the error. If there's no boundary anywhere up the chain, the error is re-thrown.

| When the function throws… | `computed` | `effect` |
| --- | --- | --- |
| Where the error goes | re-thrown to whoever **reads** it | up the **owner chain** to the nearest error boundary |
| If nothing catches it | propagates out of your read | re-thrown |
| Set up a handler with | a `try/catch` around the read | [`catchError`](#catcherror--the-programmatic-error-boundary) / `<ErrorBoundary>` |

The owner chain is set when the effect is *created* (it captures whatever owner is active then). See [`catchError`](#catcherror--the-programmatic-error-boundary) below for the programmatic boundary, and [Lifecycle, context & DI](/learn/lifecycle-context-di) for the `<ErrorBoundary>` component.

### Nested effects are NOT owned by the enclosing effect

Here's a sharp edge worth a warning. If you create an `effect` **inside** another effect, the inner one is **not** owned by the outer one. It registers into whatever ownership scope was active when the *outer* effect was created — which is usually the component, not the outer effect. So every time the outer effect re-runs, it creates a *fresh* inner effect, and the old ones are never disposed. They leak.

~~~ts title="⚠️ Leak: a new inner effect every re-run, none cleaned up"
effect(() => {
  const id = userId();      // outer re-runs when userId changes
  effect(() => {            // ⚠️ a NEW inner effect each time — old ones leak
    console.log(id, data());
  });
});
~~~

The fix is to give the inner work its own ownership scope you can dispose — wrap it in [`root`](#root--a-disposable-scope) (or `createOwner` + `runInOwner`) and tear it down in a cleanup:

~~~ts title="The fix: own the inner scope and dispose it"
import { effect, root, onCleanup } from '@weave/runtime';

effect(() => {
  const id = userId();
  root((dispose) => {
    onCleanup(dispose);     // the OUTER effect's cleanup disposes the inner scope
    effect(() => console.log(id, data()));
  });
});
~~~

Most of the time you simply don't nest effects — derive with `computed` instead, or read both signals in one effect. But when you must, own and dispose the inner scope.

## batch — group writes

Each `.set` flushes effects synchronously. When you change several signals at once and want dependent **effects** to run **once** after all of them, wrap the writes in `batch`:

~~~ts title="One flush instead of two"
import { signal, batch, effect } from '@weave/runtime';

const x = signal(0);
const y = signal(0);
effect(() => console.log('moved to', x(), y()));

batch(() => {
  x.set(10);
  y.set(20);
}); // the effect logs ONCE: "moved to 10 20", not twice
~~~

Three details that trip people up:

- **`batch` returns whatever the callback returns.** `const result = batch(() => { ...; return computeSomething(); })` works — it's not just for side effects.
- **Only effect *flushing* is deferred — reads see writes immediately.** Inside the batch, if you read a signal you just wrote (or a computed that depends on it), you get the **new** value right away. Batching delays when effects run, not when values update.
- **Nested batches flush at the outermost end.** If you call `batch` inside another `batch`, queued effects don't flush until the **outermost** batch finishes. Nesting is safe and composes — inner batches don't trigger an early flush.

~~~ts title="Reads inside a batch see the new values"
batch(() => {
  x.set(10);
  console.log(x());       // → 10, immediately (the read is not deferred)
  console.log(sum());     // a computed of x → also already updated
  // …only the EFFECT logging is held until the batch ends
});
~~~

## untrack — read without subscribing

Inside a derivation, `untrack` runs a block of code **without** creating any dependencies — it nulls tracking entirely for the duration. It returns whatever the block returns:

~~~ts title="A whole block of un-subscribed reads"
import { effect, untrack } from '@weave/runtime';

effect(() => {
  const live = source();                     // subscribed: re-runs when `source` changes
  const snapshot = untrack(() => config());  // read, but DON'T re-run when `config` changes
  apply(live, snapshot);
});
~~~

It's the surgical, block-scoped version of `peek()`. And because it nulls tracking completely, it goes further than `peek` in one way: **even a `computed` read inside `untrack` won't subscribe you to it.** Reads of any kind — signals or computeds — create no edges inside an `untrack` block.

~~~ts title="untrack also un-subscribes computed reads"
effect(() => {
  // Neither `a` (a signal) nor `total` (a computed) subscribes this effect:
  const x = untrack(() => a() + total());
  doSomethingWith(x);
});
~~~

## tick — await deferred work

Reactive updates are synchronous, so you usually don't await anything. But a few things are deferred to a microtask — `onMount` callbacks, error-boundary fallback swaps. When a test or a measurement needs to wait for *those*, `await tick()`.

`tick()` does two things, in order: it **flushes any queued effects** (a no-op when you're not inside a `batch`), then it **awaits a microtask** so anything scheduled with `queueMicrotask` has run:

~~~ts title="Waiting for microtask-deferred work"
import { tick } from '@weave/runtime';

count.set(5);
// The DOM text already says 5 here — updates are synchronous.
await tick(); // …but this waits for onMount-timed work, if you need it.
~~~

If you call it inside a `batch`, the queued effects flush first, then the microtask resolves — so `await tick()` is also a way to settle a batch and its deferred work in one go. It's the Weave analog of Svelte's `tick()` or Vue's `nextTick()` — just rarely needed, because there's no render queue to wait on.

## catchError — the programmatic error boundary

`catchError(handler, fn)` runs `fn` inside a fresh child ownership scope whose **error boundary** is `handler`. Any error thrown — synchronously during `fn` itself, **or** later by an `effect` created inside `fn` — is routed to `handler` instead of propagating. This is the primitive that powers the `<ErrorBoundary>` component, and you can use it directly.

~~~ts title="catchError(handler, fn)"
import { signal, catchError, effect } from '@weave/runtime';

const error = signal<unknown>(null);

const result = catchError(
  (err) => error.set(err),   // handler: stash the error, show a fallback, etc.
  () => {
    effect(() => {
      if (broken()) throw new Error('boom'); // caught by the handler above
    });
    return computeInitialView();             // a synchronous throw here is caught too
  },
);
~~~

The shape and behavior, precisely:

- **Argument order is `(handler, fn)`** — handler first.
- It catches **two** kinds of error: a synchronous throw during `fn`, and a throw from any `effect` created inside `fn` (routed up the owner chain to this boundary).
- It **returns whatever `fn` returns** — or `undefined` if `fn` threw synchronously (the handler ran, but there's no value to return).
- The boundary scope is **disposed with the surrounding scope**, so you don't leak it.

Reach for `catchError` when you want a boundary in plain code (a setup function, a utility) rather than in markup. For the declarative version, see `<ErrorBoundary>` in [Lifecycle, context & DI](/learn/lifecycle-context-di).

## Ownership: who cleans up

Every effect you create inside a component's `setup` (or inside an `@if`/`@for` branch) is **owned** by that scope. When the component unmounts or the branch goes away, its effects are disposed automatically — cleanups run, subscriptions close, no leaks. This is why you almost never call the `stop()` handle from `effect` by hand: the tree does it for you.

Most of the time that's all you need to know. But the ownership machinery is public, and you'll want it for the nested-effect fix above, for long-lived work outside any component, and for hand-rolled lifecycles. Here are the handles.

### root — a disposable scope

`root(fn)` runs `fn` inside a **fresh root owner** and hands `fn` a `dispose` function. Whatever `fn` returns becomes `root`'s return value. Use it when you need a reactive scope that isn't tied to a component — and that you'll tear down yourself.

~~~ts title="root(fn) → result, with a dispose handle"
import { root, effect } from '@weave/runtime';

const view = root((dispose) => {
  effect(() => render(state())); // owned by this root
  return { dispose };            // hand the dispose handle back out
});

// later, when you're done:
view.dispose(); // disposes every effect/child owner created inside the root
~~~

### getOwner, createOwner, runInOwner, disposeOwner

These are the lower-level handles `root` is built from. You rarely need them directly, but here's the full set:

| Function | What it does |
| --- | --- |
| `getOwner()` | Returns the currently-active ownership scope, or `null` if there isn't one. |
| `createOwner(parent?)` | Creates a new ownership scope. If you pass a `parent`, disposing the parent disposes this one too. Does **not** activate it. |
| `runInOwner(owner, fn)` | Runs `fn` with `owner` active, so effects created inside register into it; restores the previous owner afterward. Returns `fn`'s value. |
| `disposeOwner(owner)` | Disposes everything registered in `owner` — children first, in reverse order (LIFO). |

A typical hand-rolled scope looks like this — which is, in effect, what `root` does for you:

~~~ts title="The manual version of root"
import { createOwner, runInOwner, disposeOwner, effect } from '@weave/runtime';

const owner = createOwner();
runInOwner(owner, () => {
  effect(() => doWork());
});
// …later:
disposeOwner(owner); // tears down the effect above
~~~

:::callout tip "Capture the owner, defer the work"
`getOwner()` is handy when you need to run something *later* but still inside the right scope: grab `const o = getOwner()`, then `runInOwner(o, () => ...)` when the async work resolves. That's exactly how deferred lifecycle callbacks keep their cleanups tied to the component that registered them.
:::

## The conveniences

Three small, tree-shakeable helpers cover patterns you'd otherwise hand-roll. Each is a thin wrapper over the primitives above — import them only when you need them; if you don't, they don't ship.

### linkedSignal — a writable value that resets from a source

A signal you can set locally, but that gets **overwritten** every time its source changes. The classic use: "select the first item, but re-select when the list reloads."

~~~ts title="linkedSignal(source, opts?)"
import { linkedSignal } from '@weave/runtime';

const selected = linkedSignal(() => items()[0]);
selected.set(items()[2]);  // local override — fine
// …items() reloads → `selected` snaps back to the new items()[0]
~~~

It's a full `Signal<T>` — you get `()`, `.set`, `.update`, `.peek`, all of it. The initial value is seeded immediately (read once, untracked) so there's no flash of `undefined`. And it takes the same **`equals` option** as `signal`:

~~~ts title="linkedSignal with custom equality"
const selected = linkedSignal(() => items()[0], {
  equals: (a, b) => a?.id === b?.id,
});
~~~

That `equals` matters more than it looks: the reset only fires when the source's new value is **not equal** to the current one. If the source recomputes to an equal value, `linkedSignal` does **not** clobber your local override. Pick an `equals` that reflects what "the same source value" means for your data.

### debounced — a value that trails its source

A **read-only** value that updates only after its source has been quiet for `ms` milliseconds. Perfect for search-as-you-type: the input stays instant, the expensive work waits for a pause.

~~~ts title="debounced(source, ms)"
import { signal, debounced } from '@weave/runtime';

const query = signal('');
const debouncedQuery = debounced(query, 300); // lags `query` by 300ms of quiet
// drive your search off debouncedQuery() — it fires once typing settles
~~~

The exact behavior:

- **The initial value is seeded immediately** — no `ms` delay on the very first read.
- **Every change restarts the timer.** Each time the source changes, the pending write is cancelled and a fresh `ms` timer starts. Only a full `ms` of quiet produces an update.
- **The pending timer is cleared on unmount too.** It's owner-scoped, so when the surrounding component/branch goes away, any in-flight timeout is cancelled — no stray write after teardown.

### watch — react with the previous value

An effect with an **explicit source** and access to the **old** value. It's `watch(source, cb, opts?)`:

~~~ts title="watch(source, cb, opts?)"
import { signal, watch } from '@weave/runtime';

const userId = signal(1);

watch(userId, (id, prevId) => {
  console.log(`switched from user ${prevId} to ${id}`);
}, { immediate: false }); // pass immediate: true to also fire on creation
~~~

How it differs from a bare `effect`, and the one footgun about `prev`:

- **Only `source` is tracked.** The callback's own reads do **not** subscribe — the callback runs untracked. So `watch` reacts to exactly one thing, no matter what you read inside `cb`. (A bare `effect` subscribes to everything it reads.)
- **Lazy by default.** With `immediate: false` (the default) the callback does **not** run on creation — it waits for the first *change* to `source`.
- **`immediate: true` fires once on creation.** And on that first call, `prev` is `undefined`.
- **`prev` is `undefined` on the FIRST call either way.** Whether the first call is the immediate one or the first real change, there's no previous value yet, so `prev === undefined`. Don't assume `prev` is always a `T`.
- **The callback can return a cleanup** that runs before the next call and on stop — same lifecycle as an effect cleanup.
- **It returns a stop handle**, and it's owner-scoped, so it's also disposed with the surrounding owner.

| | bare `effect` | `watch` |
| --- | --- | --- |
| Tracks | everything it reads | only `source` |
| Callback's own reads | subscribe | do **not** subscribe (run untracked) |
| Previous value | not available | passed as second arg (`undefined` on first call) |
| Runs on creation | always | only with `immediate: true` |

:::callout info "What you just learned"
`signal` is the source (with an `equals` option); `computed` is a cached, **lazy** derivation (also with `equals`) — its body may never run if nobody reads it, and a throw inside it surfaces at the reader. `effect` runs **immediately**, returns a `stop()` handle, supports cleanups (before each re-run and on disposal), and a throw inside it goes **up the owner chain** to an error boundary. `batch` groups effect flushes (reads still see writes immediately; nested batches flush at the outermost end), `untrack` and `peek` read without subscribing (`untrack` even un-subscribes computed reads), and `tick` flushes then awaits a microtask. `catchError(handler, fn)` is the programmatic error boundary. Ownership — `root`, `getOwner`, `createOwner`, `runInOwner`, `disposeOwner` — disposes your effects for you, and is the fix for leaking nested effects. The extras — `linkedSignal`, `debounced`, `watch` — are thin, optional conveniences over those primitives.
:::

[Next: Components →](/learn/components) · [Full reactive API in the Reference →](/reference/runtime)
