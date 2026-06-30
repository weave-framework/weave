# Introduction

Welcome to Weave. This is the gentle path — no prior framework experience assumed. We'll build up one idea at a time, and every concept comes with a runnable, copyable example.

## What is Weave?

Weave is a tool for building user interfaces — the buttons, lists, forms, and pages people click through in a web app. You describe what the screen should look like, and Weave keeps it in sync with your data as that data changes.

The thing that makes Weave special is **how** it keeps things in sync. When one value changes, Weave updates only the exact piece of the page that depends on it — not the whole component, not a copy of the page it diffs against. That's what *fine-grained reactive* means, and it's why apps built with Weave stay fast without you having to think about it.

:::callout tip "No experience? No problem."
If you've never built a web app before, that's fine. If you can read a line of JavaScript like `let name = "Ada"`, you already know enough to start. We explain the rest as we go.
:::

## The screen is a fabric

It helps to hold one picture in your head. The screen is a piece of **fabric**. Your data is the **thread**. Reactivity is the loom that weaves the two together — pull a thread, and the cloth shifts exactly where that thread runs, and nowhere else.

Everything in Weave is built from one small idea called a **signal** — a value that announces when it changes. Master that, and the framework falls into place: components, the router, the store, forms — they're all just signals, woven together.

## How these docs are organized

There are two ways to read these docs, and you can move between them freely:

- **🎓 Learn** — the section you're in now. Friendly, narrative guides that teach concepts step by step, each with a live example.
- **📖 Reference** — the exhaustive catalog: every package, function, option, and type, with examples for each.

Every Learn page links out to the matching Reference, and back.

## Your path from here

If you like to understand *why* before *how*, read [Why Weave?](/learn/why-weave) next. If you'd rather get something on screen first, jump to the [Quick start](/learn/quick-start). And if you want the one idea everything rests on, go straight to [Thinking in signals](/learn/signals).

[Next: Why Weave? →](/learn/why-weave)
