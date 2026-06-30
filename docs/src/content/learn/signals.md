# Thinking in signals

A signal is a value that tells everyone when it changes. That one idea is the whole foundation of Weave — master it and the rest is downhill.

## A value that announces itself

Normally a variable is silent. You set `x = 5`, and nothing else in your app knows. A **signal** is a variable with a built-in announcement: whenever it changes, everything that read it is told, and updates itself.

You create one with `signal(initialValue)`. You read it by calling it like a function, and you change it with `.set(...)`:

~~~ts title="the basics"
import { signal } from '@weave/runtime';

const count = signal(0);

count();                 // read   → 0
count.set(5);            // write  → returns 5
count.set((n) => n + 1); // update → returns 6
count.peek();            // read WITHOUT subscribing → 6
~~~

:::callout tip "Why the parentheses?"
You read a signal by *calling* it: `count()`, not `count`. The call is what subscribes you to future changes — Weave needs that function call to know "this spot depends on count." It's a small habit that buys you automatic updates everywhere.
:::

## Creating one: `signal(initial, opts?)`

The first argument is the starting value. It can be anything — a number, a string, an object, an array, `null`, `undefined`, even another function. Whatever you pass becomes the value `count()` hands back until you write a new one.

~~~ts title="any value works"
const n     = signal(0);
const name  = signal('Ada');
const user  = signal<{ id: number } | null>(null);
const items = signal<string[]>([]);
~~~

The optional second argument is an options object. Right now it has exactly one field, `equals`, covered in [Skipping no-op writes](#skipping-no-op-writes) below. If you leave it off, you get the sensible default — so most of the time you'll just write `signal(initial)`.

## Reading: just call it

`count()` does two things at once:

1. It returns the current value.
2. If you're inside a tracking context — an [`effect` or a `computed`](/learn/reactivity) — it **subscribes** that context to this signal, so it re-runs when the value changes.

Outside of any effect or computed, calling `count()` is just a plain read — there's nobody to subscribe, so nothing is tracked. That's fine; it's not an error. If you want to read the value *without* subscribing even when you are inside an effect, use [`.peek()`](#peek-read-without-subscribing).

## Writing: `.set(value)` and `.set(fn)`

`.set` is how you change a signal. It comes in two flavors, and they are the same method — Weave looks at what you hand it:

~~~ts title="two ways to write"
const count = signal(0);

count.set(10);            // (a) a plain value → becomes 10
count.set((n) => n + 1);  // (b) an updater fn → gets the current value, returns the next
~~~

- **Pass a value** and that value becomes the new one, full stop.
- **Pass a function** and Weave calls it with the *current* value and uses what it returns. This is the right tool whenever the next value depends on the old one (`n => n + 1`, `list => [...list, item]`), because you never have to read the signal separately first.

:::callout info "The updater reads the current value untracked"
When you pass a function to `.set`, the `prev` it receives is read straight off the signal's internal value — it does **not** subscribe anything. So `count.set(n => n + 1)` is safe to call from inside an effect without that effect accidentally taking a dependency on `count` through the read.
:::

### `.set` returns the value it landed on

`.set` hands back the value the signal now holds. If the write went through, that's your new value; if it was a [no-op](#skipping-no-op-writes), it's the unchanged current value.

~~~ts title="set returns the result"
const count = signal(0);

const a = count.set(5);            // a === 5
const b = count.set((n) => n + 1); // b === 6
const c = count.set(6);            // c === 6, but nothing changed (equal write, see below)
~~~

### `.update(fn)` — the same thing, named

`.update(fn)` exists for readability: some people like writing `count.update(n => n + 1)` to make "I'm deriving the next value from the old one" obvious. Under the hood it is literally `count.set(fn)` — same behavior, same untracked read of the current value, same returned value. Pick whichever name reads better to you; there's no difference beyond the name.

~~~ts title="identical"
count.update((n) => n + 1);
count.set((n) => n + 1);    // exactly the same call
~~~

## `.peek()` — read without subscribing

`count.peek()` returns the current value and **never** subscribes the caller. Use it when you're inside an effect or computed but you only want to *glance* at a signal without making your effect depend on it.

~~~ts title="peek doesn't create a dependency"
const count = signal(0);
const label = signal('hits');

effect(() => {
  // re-runs when `label` changes, but NOT when `count` changes:
  console.log(label(), '=', count.peek());
});
~~~

Here the effect tracks `label` (read with `()`) but only peeks at `count`, so bumping `count` alone will not re-run it. Reach for `.peek()` sparingly — needing it a lot is usually a sign the logic belongs in a [computed](/learn/reactivity) instead.

## Skipping no-op writes

A signal won't bother announcing a change if the value didn't actually change. Before storing a new value, Weave compares it to the current one; if they're considered equal, `.set` does nothing — no notifications, no effects re-run — and just returns the existing value.

The default comparison is [`Object.is`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/is), which is like `===` with two tweaks: `NaN` equals `NaN`, and `+0` is distinct from `-0`. So:

~~~ts title="equal writes are no-ops"
const count = signal(0);

count.set(0); // value is already 0 → no-op, nothing re-runs
count.set(1); // different → announces, effects re-run
~~~

The catch: `Object.is` compares by **identity** for objects and arrays. A brand-new object is never equal to the old one, even with identical contents — so mutating in place and re-setting the *same* reference is a no-op, while building a fresh object always fires:

~~~ts title="objects compare by reference"
const user = signal({ name: 'Ada' });

const u = user.peek();
u.name = 'Grace';
user.set(u);            // SAME reference → equal → no-op! the UI won't update

user.set({ name: 'Grace' }); // NEW object → not equal → fires
~~~

The rule of thumb: **always set a new object/array**, don't mutate the old one in place.

### Custom `equals`

If you want different "did it really change?" logic, pass an `equals` function when you create the signal. It receives `(oldValue, newValue)` and returns `true` when they should be treated as **the same** (i.e., skip the write):

~~~ts title="custom equality"
// treat values within 0.5 of each other as unchanged
const temp = signal(20, {
  equals: (oldVal, newVal) => Math.abs(oldVal - newVal) < 0.5,
});

temp.set(20.3); // within 0.5 of 20 → no-op
temp.set(21);   // far enough → fires
~~~

You can also force a signal to **always** notify, even on identical values, by making `equals` return `false`:

~~~ts title="always fire"
const ping = signal(0, { equals: () => false });
ping.set(0); // still notifies, every time
~~~

## A first taste of `effect`

Reading a signal inside an `effect` creates a living connection. The effect runs **once immediately**, then again every time something it read changes — and only then. You never list what it depends on; Weave figures that out by watching what you actually read.

~~~ts title="effect reacts on its own"
import { signal, effect } from '@weave/runtime';

const count = signal(0);

const stop = effect(() => {
  console.log('count is', count());
});
// logs "count is 0" immediately

count.set(1); // the effect re-runs on its own → "count is 1"

stop(); // tear it down — it won't run again
~~~

Two things to notice, both of which matter later:

- `effect(fn)` **runs `fn` right away**, once, before `.set` is ever called.
- `effect(fn)` **returns a `stop()` handle**. Call it to disconnect the effect so it stops reacting. (Inside a component you rarely call `stop()` yourself — Weave tears effects down for you on unmount.)

That's all you need here. The full story on effects — cleanup functions, batching, ownership, glitch-free updates — lives in [Reactivity](/learn/reactivity), where cached derived values (`computed`) are covered too.

## The signal API at a glance

| Call | What it does | Returns |
|------|--------------|---------|
| `signal(initial, opts?)` | Create a signal. `opts.equals(a, b)` customizes change detection (default `Object.is`). | the signal |
| `count()` | Read the value; subscribes the current effect/computed (if any). | current value |
| `count.peek()` | Read the value **without** subscribing. | current value |
| `count.set(value)` | Write a plain value. No-op if `equals` says it's unchanged. | the resulting value |
| `count.set(fn)` | Write `fn(current)`; `current` is read untracked. No-op if unchanged. | the resulting value |
| `count.update(fn)` | Identical to `count.set(fn)`. | the resulting value |

:::callout info "What you just learned"
A **signal** holds a value and announces changes. Create it with `signal(initial)`, read it by calling `count()` (which subscribes you), and write it with `.set(value)` or `.set(fn)` — `.update(fn)` is the same thing. `.peek()` reads without subscribing, `.set` returns the resulting value, and equal writes (by `Object.is`, or your own `equals`) are skipped. An **effect** runs once immediately and re-runs when its reads change, handing you a `stop()` to tear it down.
:::

[Next: Reactivity — effects, cleanup, and how updates stay glitch-free →](/learn/reactivity)
