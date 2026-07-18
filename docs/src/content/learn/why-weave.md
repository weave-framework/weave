# Why Weave?

Before you spend an afternoon learning it, here's an honest answer to the only question that matters: *what is Weave for, and when would you reach for it?*

## What Weave is, in one line

Weave is a particular set of trade-offs, pulled tight:

> **Signals all the way down, a compiler that disappears, and everything you need already in the box — with zero third-party dependencies.**

Everything below is what that sentence costs and what it buys.

## The trade-offs, stated plainly

**Fine-grained reactivity, no virtual DOM.** When a value changes, Weave updates the one piece of the page that depends on it — not the component, not a diffed copy of the tree. You get this without thinking about it: no memoization, no manual dependency lists, no opt-in change detection. (This is the [signals](/learn/signals) idea, and it's the foundation of everything.)

**A compiler that gets out of the way.** Your templates compile to direct DOM operations at build time. There's no template interpreter shipping to the browser, and unused features tree-shake away — a tiny counter app stays tiny.

**Batteries included, zero dependencies.** Routing, a store, forms, i18n, data fetching, motion — all official, all built in-house, all designed to fit together. Nothing here pulls a third-party package into your `node_modules`. That's a deliberate rule, not an accident: fewer moving parts you didn't choose, fewer supply-chain surprises.

**Functions, not classes.** Components and services are plain functions. Which deserves its own section.

## Why functions, not classes?

Weave is built on functions rather than classes — and that isn't a style preference, it falls out of signals.

- **Closures + signals already *are* encapsulation.** A `setup` function's local signals are its private state; the object it returns is its public surface. You don't need `private` keywords or `this` to draw that line — the closure draws it for you.
- **No `this` to bind.** No `.bind(this)`, no arrow-vs-method gotchas, no "why is `this` undefined in my callback." A handler is just a function that closes over the signals it needs.
- **Reactivity tracks function calls.** Reading a signal is calling it; that call is what subscribes. Functions are the natural grain of a signal-based system.
- **Better tree-shaking.** Independent functions are easy for a bundler to drop when unused. A class is a single unit — you tend to keep all of it or none.

Classes aren't forbidden — if you have one (a parser, a state machine, an SDK you depend on), wrap an instance in a [store](/learn/store) or [provide](/learn/lifecycle-context-di) it. You just won't *need* one to write idiomatic Weave. (Looking for what replaces class inheritance? [Lifecycle, context & DI](/learn/lifecycle-context-di) shows the functional equivalents of `extends`, `implements`, `super`, and abstract methods — it's composition all the way down.)

## Two ways to read these docs

However deep you want to go, there's a path for it:

- :icon[graduation-cap] **Learn** — the section you're in. Friendly, narrative guides that build up one idea at a time, each with a live example you can click and copy. No prior framework experience assumed.
- :icon[book-open] **Reference** — the exhaustive catalog: every package, every export, every option and type, with examples. When you know *what* you want and just need the exact signature, start here.

You can jump between them freely — every Learn page links out to the relevant Reference, and back.

## So, is Weave for you?

Reach for Weave when you want **one coherent, dependency-free toolkit** with the ergonomics of signals and the output size of a compiler — and you'd rather learn one set of ideas than wire five libraries together.

Ready? The fastest way to understand a loom is to weave something.

[Next: Quick start →](/learn/quick-start) · [Or start with the core idea: Thinking in signals →](/learn/signals)
