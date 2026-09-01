# Examples

Every other section of these docs shows you *one thread at a time* — a signal here, a `<Select>` there. This
section weaves them together. Each page below is a **complete, runnable application** built with nothing but
Weave: the reactive core, the router, the store, the forms package, and the `@weave-framework/ui` component
library. No third-party state library, no external UI kit, no build plugins — just Weave.

Every demo on these pages is the **real app running live**, right here on the page, and the full source sits
directly underneath it in a tabbed block. Read it top to bottom, then lift it straight into your own project —
there is no docs-only glue anywhere.

:::callout tip "Built with Weave, documented with Weave"
This very site is a Weave app, and so is every example on it. The live app you interact with above each source
block *is* that source, compiled and mounted — what you read is what runs.
:::

## See the flagship demo

Want a full, standalone app rather than a page-sized example? **[Weave Analytics](https://demo.weaveframework.dev)**
is a live dashboard deployed on its own — KPIs, a chart, a filterable data table, an activity feed, and five
distinct sidebar views including a real settings form — around a dozen `@weave-framework/ui` components wired
together. Its entire dark-violet look comes from **one `@include weave.theme((…))`**, so it doubles as a
demonstration of token re-skinning. **[Open the live demo :icon[arrow-right]](https://demo.weaveframework.dev)**

## The apps

Each one is chosen to exercise a different cluster of the framework, so together they cover essentially every
capability Weave ships with.

| Example | What it teaches | Built from |
| --- | --- | --- |
| [Todo list](/examples/todo) | Reactivity end to end — derived state, keyed lists, persistence | `signal` · `computed` · `store` · Input · Checkbox · Button · Badge |
| [Data dashboard](/examples/dashboard) | Presenting data: sort, filter, paginate | Table · Select · Paginator · Card · Progress Bar · Badge |
| [Settings panel](/examples/settings) | The full spread of form controls, live-previewed | Tabs · Input · Select · Slide Toggle · Radio · Slider · Snackbar |
| [Sign-up wizard](/examples/signup) | Multi-step forms with real validation | Stepper · `@weave-framework/forms` · Form Field · Snackbar |
| [Kanban board](/examples/kanban) | Direct manipulation — drag, drop, reorder | CDK drag & drop · Card · Badge · Button |

## How to read an example

Every page follows the same shape, so once you've read one you know your way around all of them:

1. **The live app** — running at the top. Click it, type in it, drag it. It's real.
2. **What it shows** — a short list of the concepts and components in play, each linking to its own reference page.
3. **The walkthrough** — the app broken into its parts, each with the exact `app.html` / `app.ts` / `app.scss`
   source in a tabbed block. Nothing is elided; if it runs above, it's printed below.
4. **Notes** — the interesting decisions, the gotchas, and where to go deeper.

## A note on structure

Each example is a single Weave component — a `setup()` function that returns state and handlers, plus a template
that binds to them. That's the whole model: **state is signals, the template reads them, and the UI updates
itself.** You'll see the same three files (`app.html`, `app.ts`, and sometimes `app.scss`) on every page, because
that's all a Weave component ever is.

## When it goes wrong

Lifting an example into your own project fails in three predictable ways, and none of them is about the
code you copied.

:::callout trap "It renders, and it looks like nothing"
The examples run inside this site, which already imports every component's stylesheet. Your project does
not. Each component needs **two** lines in two different files — the import in your `.ts` and
`@use 'pkg:@weave-framework/ui/<name>';` in your Sass — plus the theme emitted once from a **global**
stylesheet.

Copy an example and get correct, accessible, completely unstyled markup, and this is always why. See
[UI installation](/ui/installation#when-it-goes-wrong).
:::

**A package you have not installed.** These pages import from `@weave-framework/ui`, `/forms`, `/router`
and `/data`. Importing one you have not installed fails loudly at build with `Could not resolve` — which
is the good case; add it and move on.

**The example is one component and your app is not.** Every page here is a single component on purpose,
so nothing is hidden behind a file you cannot see. Splitting it up is the first thing you will do, and
the moment you do, a value that was a local becomes something to pass down as a prop or lift into a
[store](/learn/store) — which is the real work the examples deliberately skip.

Each app's own page ends with the failures specific to it.

Pick any app above and dive in — [the Todo list](/examples/todo) is the gentlest starting point.
