# Why Weave?

There are a lot of good ways to build for the web. So before you spend an afternoon learning another one, here's an honest answer to the only question that matters: *what is Weave for, and when would you reach for it?*

## Woven from the best threads

Weave didn't appear in a vacuum. It's built on ideas the whole field has been converging on for years — and it owes a debt to the frameworks that found them.

- **React** taught a generation to think in components and one-way data flow. Hooks made logic composable.
- **Angular** showed how far a *batteries-included* framework can take you — routing, forms, DI, i18n, all in the box, all coherent.
- **Vue** made reactivity approachable and its templates a joy to read.
- **Svelte** asked the radical question — *what if the framework compiled itself away?* — and proved a compiler can do the heavy lifting.
- **Solid** showed that fine-grained signals could power a whole UI with no virtual DOM and astonishing performance.

Weave is woven from those threads. It isn't here to tell you the others got it wrong — they didn't. It's a particular set of trade-offs, pulled tight:

> **Signals all the way down, a compiler that disappears, and everything you need already in the box — with zero third-party dependencies.**

If you've used any of the frameworks above, you already know most of Weave. The names differ; the ideas rhyme.

## The trade-offs, stated plainly

**Fine-grained reactivity, no virtual DOM.** When a value changes, Weave updates the one piece of the page that depends on it — not the component, not a diffed copy of the tree. You get this without thinking about it: no memoization, no dependency arrays, no `shouldComponentUpdate`. (This is the [signals](/learn/signals) idea, and it's the foundation of everything.)

**A compiler that gets out of the way.** Your templates compile to direct DOM operations at build time. There's no template interpreter shipping to the browser, and unused features tree-shake away — a tiny counter app stays tiny.

**Batteries included, zero dependencies.** Routing, a store, forms, i18n, data fetching, motion — all official, all built in-house, all designed to fit together. Nothing here pulls a third-party package into your `node_modules`. That's a deliberate rule, not an accident: fewer moving parts you didn't choose, fewer supply-chain surprises.

**Functions, not classes.** Components and services are plain functions. Which deserves its own section.

## Why functions, not classes?

If you come from Angular or older React, you might expect classes. Weave is built on functions instead — and that isn't a style preference, it falls out of signals.

- **Closures + signals already *are* encapsulation.** A `setup` function's local signals are its private state; the object it returns is its public surface. You don't need `private` keywords or `this` to draw that line — the closure draws it for you.
- **No `this` to bind.** No `.bind(this)`, no arrow-vs-method gotchas, no "why is `this` undefined in my callback." A handler is just a function that closes over the signals it needs.
- **Reactivity tracks function calls.** Reading a signal is calling it; that call is what subscribes. Functions are the natural grain of a signal-based system.
- **Better tree-shaking.** Independent functions are easy for a bundler to drop when unused. A class is a single unit — you tend to keep all of it or none.

Classes aren't forbidden — if you have one (a parser, a state machine, a third-party SDK), wrap an instance in a [store](/learn/store) or [provide](/learn/lifecycle-context-di) it. You just won't *need* one to write idiomatic Weave. (Coming from class-based inheritance? [Lifecycle, context & DI](/learn/lifecycle-context-di) shows the functional equivalents of `extends`, `implements`, `super`, and abstract methods — it's composition all the way down.)

## Two ways to read these docs

However deep you want to go, there's a path for it:

- **🎓 Learn** — the section you're in. Friendly, narrative guides that build up one idea at a time, each with a live example you can click and copy. No prior framework experience assumed.
- **📖 Reference** — the exhaustive catalog: every package, every export, every option and type, with examples. When you know *what* you want and just need the exact signature, start here.

You can jump between them freely — every Learn page links out to the relevant Reference, and back.

## So, is Weave for you?

Reach for Weave when you want **one coherent, dependency-free toolkit** with the ergonomics of signals and the output size of a compiler — and you'd rather learn one framework's worth of ideas than wire five libraries together. If you're happy in a mature ecosystem you already know, those are great too; Weave is glad to share the field.

Ready? The fastest way to understand a loom is to weave something.

[Next: Quick start →](/learn/quick-start) · [Or start with the core idea: Thinking in signals →](/learn/signals)
