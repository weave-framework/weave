# Reactivity in depth

You met `signal` and `effect` in [Thinking in signals](/learn/signals). Those two are the whole loom — but Weave gives you a few more threads to weave with. This page is the complete tour of the reactive core: every primitive, what it's for, and the one mental model that ties them together.

## The mental model

Everything reactive in Weave is a graph of two kinds of node:

- **Sources** — values you can read and write: a `signal`.
- **Derivations** — things that read sources and react: a `computed` (which produces a new value) and an `effect` (which produces a side effect).

When a source changes, Weave doesn't re-run your whole component or diff a virtual copy of the page. It walks the edges of that graph and touches *only* the derivations that actually read the changed source. Reads build the edges; you never declare them.

:::callout tip "Synchronous by default"
The moment you call `signal.set(...)` (outside a `batch`), every dependent `effect` has already re-run and the DOM is already up to date. There is no render queue to await, no “next tick” before your change is visible. This is why most Weave code reads top-to-bottom like ordinary JavaScript.
:::

## signal — the source

A `signal` holds a value and announces every change. Create it, read it by calling it, write it with `.set`:

~~~ts
import { signal } from '@weave/runtime';

const count = signal(0);

count();                  // read (and subscribe, if inside a derivation) → 0
count.set(5);             // write a value
count.set((n) => n + 1);  // write via an updater → 6
count.update((n) => n + 1); // exactly the same as .set(fn) → 7
count.peek();             // read WITHOUT subscribing → 7
~~~

`.set` returns the new value, and skips the whole notification if the value didn't actually change. "Didn't change" is decided by `Object.is` by default — override it for value-like objects:

~~~ts
// Treat two points as equal when their fields match, so setting an equal
// point is a no-op and dependents don't re-run.
const point = signal({ x: 0, y: 0 }, {
  equals: (a, b) => a.x === b.x && a.y === b.y,
});
~~~

:::callout info "peek() vs ()"
Calling the signal subscribes the current derivation to it. `peek()` reads the value *without* subscribing — reach for it when you need the current value but explicitly don't want to re-run when it later changes (e.g. reading a counter inside an effect that should only react to something else).
:::

## computed — the cached derivation

A `computed` derives a new value from other signals. It's **lazy** (it only recomputes when you read it) and **cached** (it won't recompute until one of its real dependencies changes):

~~~ts
import { signal, computed } from '@weave/runtime';

const first = signal('Ada');
const last = signal('Lovelace');
const fullName = computed(() => `${first()} ${last()}`);

fullName(); // "Ada Lovelace" — computed once, then cached
last.set('Byron');
fullName(); // "Ada Byron" — recomputed, because `last` changed
~~~

You never reach for `useMemo` or `useCallback` here — caching is the default, not an opt-in. A `computed` is read-only: it has no `.set`.

:::callout tip "Glitch-free diamonds"
If two computeds depend on the same signal, and a third depends on both, that third one still recomputes **exactly once** per update — never with a half-updated, inconsistent set of inputs. Weave's graph guarantees it, so you can compose derivations freely without worrying about intermediate “glitch” values.
:::

## effect — the side effect

An `effect` runs a function now, and again whenever anything it read changes. Use it to push reactive state *out* of the graph — into the console, `localStorage`, a canvas, a third-party widget:

~~~ts
import { signal, effect } from '@weave/runtime';

const theme = signal('light');

const stop = effect(() => {
  document.body.dataset.theme = theme(); // runs now, and on every theme change
});

theme.set('dark'); // effect re-runs → body theme attribute updates

stop(); // tear it down manually (rarely needed — see ownership below)
~~~

Dependencies are tracked by *what you actually read each run*. Add a branch that reads a new signal, and the effect starts reacting to it; stop reading one, and it stops. No dependency array to keep in sync — ever.

### Cleaning up

If an effect sets up something that needs tearing down (a timer, a subscription, a listener), return a cleanup function — or call `onCleanup`. It runs before the **next** re-run and on disposal:

~~~ts
import { signal, effect, onCleanup } from '@weave/runtime';

const room = signal('general');

effect(() => {
  const socket = openSocket(room()); // re-subscribe when `room` changes
  onCleanup(() => socket.close());   // close the old one first
});
~~~

Returning the cleanup works too — `effect(() => { const id = setInterval(...); return () => clearInterval(id); })`. Use whichever reads better.

## batch — group writes

Each `.set` flushes synchronously. When you change several signals at once and want dependents to run **once** after all of them, wrap the writes in `batch`:

~~~ts
import { signal, batch, effect } from '@weave/runtime';

const x = signal(0);
const y = signal(0);
effect(() => console.log('moved to', x(), y()));

batch(() => {
  x.set(10);
  y.set(20);
}); // the effect logs ONCE: "moved to 10 20", not twice
~~~

## untrack — read without subscribing

Inside a derivation, `untrack` reads signals without creating a dependency — the surgical version of `peek()` for a block of reads:

~~~ts
import { effect, untrack } from '@weave/runtime';

effect(() => {
  const live = source();              // subscribed: re-runs when `source` changes
  const snapshot = untrack(() => config()); // read, but DON'T re-run when `config` changes
  apply(live, snapshot);
});
~~~

## tick — await the microtask

Reactive updates are synchronous, so you usually don't await anything. But a few things are deferred to a microtask — `onMount` callbacks, error-boundary fallbacks. When a test or a measurement needs to wait for *those*, `await tick()`:

~~~ts
import { tick } from '@weave/runtime';

count.set(5);
// The DOM text already says 5 here — updates are synchronous.
await tick(); // …but this waits for onMount-timed work, if you need it.
~~~

It's the Weave analog of Svelte's `tick()` or Vue's `nextTick()` — just rarely needed, because there's no render queue to wait on.

## Ownership: who cleans up

Every effect you create inside a component's `setup` (or inside an `@if`/`@for` branch) is **owned** by that scope. When the component unmounts or the branch goes away, its effects are disposed automatically — cleanups run, subscriptions close, no leaks. This is why you almost never call the `stop()` handle from `effect` by hand: the tree does it for you. (More on this in [Lifecycle, context & DI](/learn/lifecycle-context-di).)

## The conveniences

Three small, tree-shakeable helpers cover patterns you'd otherwise hand-roll. Import them only when you need them — if you don't, they don't ship.

### linkedSignal — a writable value that resets from a source

A signal you can set locally, but that gets *overwritten* every time its source changes. The classic use: "select the first item, but re-select when the list reloads."

~~~ts
import { linkedSignal } from '@weave/runtime';

const selected = linkedSignal(() => items()[0]);
selected.set(items()[2]);  // local override — fine
// …items() reloads → `selected` snaps back to the new items()[0]
~~~

### debounced — a value that trails its source

A read-only value that updates only after its source has been quiet for `ms`. Perfect for search-as-you-type: the input stays instant, the expensive work waits for a pause.

~~~ts
import { signal, debounced } from '@weave/runtime';

const query = signal('');
const debouncedQuery = debounced(query, 300); // lags `query` by 300ms of quiet
// drive your search off debouncedQuery() — it fires once typing settles
~~~

### watch — react with the previous value

An effect with an explicit source and access to the *old* value. Only the source is tracked (the callback's own reads don't subscribe), it's lazy by default, and the callback can return a cleanup:

~~~ts
import { signal, watch } from '@weave/runtime';

const userId = signal(1);

watch(userId, (id, prevId) => {
  console.log(`switched from user ${prevId} to ${id}`);
}, { immediate: false }); // pass immediate: true to also fire on creation
~~~

:::callout info "What you just learned"
`signal` is the source; `computed` is a cached derivation; `effect` is a side effect. `batch` groups writes, `untrack`/`peek` read without subscribing, and `tick` awaits deferred work. Ownership disposes your effects for you. The extras — `linkedSignal`, `debounced`, `watch` — are thin, optional conveniences over those primitives.
:::

[Next: Components →](/learn/components) · [Full reactive API in the Reference →](/reference/runtime)
