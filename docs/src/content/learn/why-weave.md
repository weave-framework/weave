# Why Weave?

Before you spend an afternoon learning it, here's an honest answer to the only question that matters: *what is Weave for, and when would you reach for it?*

## What Weave is, in one line

Weave is a particular set of trade-offs, pulled tight:

> **Signals all the way down, a compiler that disappears, and everything you need already in the box — with nothing third-party reaching the browser.**

Four claims. Each one below is stated, then shown, then measured — in that order, because a claim you cannot check is just a slogan.

## Fine-grained: see it, do not take my word for it

The claim is that changing one value updates the one place that depends on it. Every row below counts
its own re-renders the same way the framework counts them — an effect subscribed to exactly one value.
Press **add one** on a single row and watch which numbers move.

:::demo why-fine-grained

:::callout see "What you should see"
The row you pressed goes up by one. The other two rows do not move at all. The **Total** does move —
and that is the point, not an exception: the total genuinely reads all three values, so it genuinely
depends on all three. Fine-grained does not mean "nothing else updates". It means **exactly what
depends on it updates, and nothing else** — which is a promise you can check, one row at a time.
:::

There is no memoization to add, no dependency array to keep in step, and no change detection to opt
into. You read a value; the place that read it is the place that updates.

## A compiler that gets out of the way

Your template is not shipped and interpreted at runtime. It is read at build time and turned into the
DOM calls it describes. Below is a real component and the real output — not a sketch of it; this is
what `compileComponent` printed for exactly these two files.

:::tabs
~~~html title="you write this"
<p>Hello, {{ name() }}!</p>
~~~
~~~ts title="and this"
import { signal } from '@weave-framework/runtime';

export function setup() {
  const name = signal('world');
}
~~~
~~~js title="the browser gets this"
const _t0 = template("<p data-w-10c1kl>Hello, <!---->!</p>");

function render(ctx, slots) {
  const _r = clone(_t0);
  const _n0 = child(_r, 1);
  bindText(_n0, () => ctx.name());
  return _r;
}
~~~
:::

Four things are worth noticing, because each one is a decision rather than an accident:

- The markup became **one `<template>` string**, cloned per instance. Cloning is the fastest way a
  browser can produce a subtree, and the parse happens once for every instance ever created.
- `<!---->` is a **placeholder comment** marking where the text goes. `child(_r, 1)` walks straight to
  it — no query, no selector, no scan.
- `bindText(_n0, () => ctx.name())` is the **entire** subscription. That one call is what "fine-grained"
  means in the emitted code: a function tied to a single node.
- `data-w-10c1kl` is the **style scope** — the marker that keeps this component's CSS from leaking
  into anyone else's. It is derived from the file, so it is the same on every build.

And notice what is *not* there. No `{{ }}` survived — nothing at runtime ever parses that syntax. There
is no diff, no previous tree to compare against, and no table of features the runtime must understand in
case you used one. A feature you did not write emits nothing, so it costs nothing.

Which is why the SPA core — signals plus the renderer — is **6.6 KB gzipped**. That figure comes from
`pnpm verify:size`, a gate that fails the build when it moves, not a number somebody typed once and
stopped checking.

## Batteries included, and nothing third-party in the browser

Routing, a store, forms, translations, data fetching and motion are all official, all built in-house,
and all designed against the same reactive core. That is a deliberate rule: fewer moving parts you did
not choose, and a much smaller surface for a supply-chain surprise.

:::callout trap "Said precisely, because the loose version is not true"
**Nothing third-party reaches the browser.** Every package that ships code to a page —
`runtime`, `router`, `store`, `forms`, `i18n`, `data`, `ui` — declares zero third-party dependencies.

Your **build tools are a different question**, and the honest answer is that `@weave-framework/cli`
depends on esbuild and TypeScript, and `@weave-framework/nx` depends on Nx's own devkit. Those run on
your machine, never in your user's browser. Anyone who tells you a framework has "zero dependencies"
full stop is either counting only one of those two things or not counting.
:::

## Functions, not classes

Components and services are plain functions. Which deserves its own section.

### Why, though?

Weave is built on functions rather than classes — and that isn't a style preference, it falls out of signals.

- **Closures + signals already *are* encapsulation.** A `setup` function's local signals are its private state; the object it returns is its public surface. You don't need `private` keywords or `this` to draw that line — the closure draws it for you.
- **No `this` to bind.** No `.bind(this)`, no arrow-vs-method gotchas, no "why is `this` undefined in my callback." A handler is just a function that closes over the signals it needs.
- **Reactivity tracks function calls.** Reading a signal is calling it; that call is what subscribes. Functions are the natural grain of a signal-based system.
- **Better tree-shaking.** Independent functions are easy for a bundler to drop when unused. A class is a single unit — you tend to keep all of it or none.

Classes aren't forbidden — if you have one (a parser, a state machine, an SDK you depend on), wrap an instance in a [store](/learn/store) or [provide](/learn/lifecycle-context-di) it. You just won't *need* one to write idiomatic Weave. (Looking for what replaces class inheritance? [Lifecycle, context & DI](/learn/lifecycle-context-di) shows the functional equivalents of `extends`, `implements`, `super`, and abstract methods — it's composition all the way down.)

## So, is Weave for you?

Reach for Weave when you want **one coherent toolkit** with the ergonomics of signals and the output
size of a compiler, and you would rather learn one set of ideas well than assemble your own stack.

Be honest with yourself about the other side of that. Everything is first-party, which means the
answers come from one place — and it also means there is no ecosystem of alternatives to reach for when
you dislike one of them. That trade is the whole design, and it is the right one for some teams and the
wrong one for others.

Ready? The fastest way to understand a loom is to weave something.

[Next: Quick start :icon[arrow-right]](/learn/quick-start) · [Or start with the core idea: Thinking in signals :icon[arrow-right]](/learn/signals)

## Where it goes wrong for people

The trade this page describes has costs, and they land in predictable places.

:::callout trap "You need request-time rendering"
Static generation covers SEO and first paint with no server in the request path. **Rendering per request
is deliberately not built.** If your product needs per-request HTML, that gap does not close by waiting —
weigh it now. [Is Weave safe to bet on?](/enterprise/safe-to-bet-on#when-the-bet-goes-wrong) states the
rest of the honest case.
:::

**You reach for a library that does not exist here.** Third-party code works normally, and the CDK covers
the hard primitives. But a ready-made niche integration may simply not exist, and that is time you are
choosing to spend rather than a problem to solve later.

**You expect a component to re-render.** It never does — there is nothing to re-render. Most of what
people find surprising in the first week comes from that one fact, and the pages ahead take it apart:
[signals](/learn/signals), then [reactivity](/learn/reactivity).
