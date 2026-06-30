# Thinking in signals

A signal is a value that tells everyone when it changes. That one idea is the whole foundation of Weave — master it and the rest is downhill.

## A value that announces itself

Normally a variable is silent. You set `x = 5`, and nothing else in your app knows. A **signal** is a variable with a built-in announcement: whenever it changes, everything that read it is told, and updates itself.

You create one with `signal(initialValue)`. You read it by calling it like a function, and you change it with `.set(...)`:

~~~ts
import { signal } from '@weave/runtime';

const count = signal(0);

count();               // read   → 0
count.set(5);          // write  → 5
count.set((n) => n + 1); // update → 6
count.peek();          // read WITHOUT subscribing
~~~

:::callout tip "Why the parentheses?"
You read a signal by *calling* it: `count()`, not `count`. The call is what subscribes you to future changes — Weave needs that function call to know "this spot depends on count." It's a small habit that buys you automatic updates everywhere.
:::

## Reactions that run themselves

Reading a signal inside an `effect` creates a living connection. The effect runs once now, and then again every time something it read changes — **and only then**. You never list what it depends on; Weave figures that out by watching what you actually read.

~~~ts
import { signal, effect } from '@weave/runtime';

const count = signal(0);

effect(() => {
  console.log('count is', count());
});

count.set(1); // the effect re-runs on its own → "count is 1"
~~~

Change `count` and the effect re-runs by itself. Add a second signal inside it, and the effect now reacts to that one too — no extra wiring. **This is the part React's dependency arrays do by hand; in Weave it's automatic.**

## See it for real

Here is the classic counter, *running live on this page* — click it. Below it is the exact source that produces it. When you click, only the number text changes: the button doesn't re-render, the component function never runs a second time.

:::demo counter

The same component, written as two files — markup and logic kept apart (Weave's default), each copyable:

:::tabs
~~~ts title="counter.ts"
import { signal } from '@weave/runtime';

export function setup() {
  const count = signal(0);
  const inc = () => count.set((n) => n + 1);
  return { count, inc };
}
~~~
~~~html title="counter.html"
<button on:click={{ inc }}>count: {{ count() }}</button>
~~~
:::

:::callout info "What you just learned"
A **signal** holds a value and announces changes. Reading it (`count()`) subscribes you. An **effect** re-runs automatically when its reads change. From these two ideas, Weave builds everything else — components, the router, the store.
:::

[Next: the full reactive API in the Reference →](/reference/runtime)
