# Introduction

Welcome to Weave. This is the gentle path — no prior framework experience is assumed. We build up one idea at a time, and you can try each one before you have to believe it.

:::callout tip "No experience? No problem."
If you can read a line of JavaScript like `let name = "Ada"`, you already know enough to start. Everything else is explained as we go, in the order you need it.
:::

## What is Weave?

Weave is a tool for building user interfaces — the buttons, lists, forms and pages people click through in a web app. You describe what the screen should look like, and Weave keeps it in sync with your data as that data changes. You write plain HTML and plain functions; there is no separate language to learn.

What makes it different is **how** it keeps things in sync, and that part is easier to watch than to read about.

## So watch it

Here is a real Weave component running on this page. Type your name into the box.

:::demo intro-alive

:::callout see "What you just saw"
The greeting changed on every keystroke — no save, no reload, no refresh. And the last line still says
the setup has run **1** time. It will say 1 after a hundred keystrokes, however fast you type.
:::

That second part is the whole point. When you typed, Weave did not re-run your component and it did not rebuild the page to compare it against the old one. It changed the piece of text that depended on your name, and left everything else untouched. That is what **fine-grained reactivity** means, and you have now seen the evidence for it rather than a promise of it.

## The code behind it

Two files. This is the entire thing — nothing is hidden above or below.

:::tabs
~~~html title="greeting.html"
<label>
  Type your name
  <input value={{ name() }} on:input={{ onName }} placeholder="Ada" />
</label>

<p>Hello, {{ name() || 'stranger' }}!</p>
~~~
~~~ts title="greeting.ts"
import { signal } from '@weave-framework/runtime';

export function setup() {
  const name = signal('');

  const onName = (e: Event): void => {
    name.set((e.target as HTMLInputElement).value);
  };
}
~~~
:::

Read it once more, slowly — every line is doing something you can name:

- **`signal('')`** creates a value that announces its own changes. It starts as an empty string.
- **`name()`** reads it. The parentheses matter: *calling* the signal is what tells Weave "this spot depends on this value". That is how the greeting knows to update itself.
- **`name.set(…)`** writes a new value. Everything that read it hears about it immediately.
- **`{{ … }}`** in the template is a live slot. Whatever is inside is re-evaluated when — and only when — a signal it read changes.
- **`on:input={{ … }}`** attaches an event handler. The name after `on:` is any DOM event: `click`, `submit`, `keydown`.
- **`setup()`** runs **once**, when the component is created. Its local values are what the template can see.

You may have noticed what is *not* there: nothing hands `name` and `onName` to the template. You do not
write that. The compiler reads your template, sees that it names `name` and `onName`, and writes
`return { name, onName }` into `setup` for you. Declare a value, use it in the template, done.

:::callout info "What if I want to choose myself?"
Write a `return` and it is used exactly as written — the compiler adds nothing. That is the escape hatch
for exposing something under a different name, or for keeping a value private that the template happens to
mention. One more rule worth knowing: if you annotate the return type (`export function setup(): Foo`),
the compiler steps back and writes nothing, so an annotated `setup` must return by hand. TypeScript
refuses the mistake (`TS2355`), so it cannot slip past you quietly.
:::

The demo above is this file plus two counters, so you could watch the numbers and check the claim for
yourself — and it, too, has no `return`.

:::callout trap "The mistake almost everyone makes first"
`name` is the signal. `name()` is its current value. Forgetting the `()` is the single most common first mistake — you get the function itself rendered instead of the text, or a comparison that is always false. If something on screen looks like `() => …`, a missing pair of parentheses is almost always why.
:::

## The picture worth holding

The screen is a piece of **fabric**. Your data is the **thread**. Reactivity is the loom that ties them together — pull a thread and the cloth shifts exactly where that thread runs, and nowhere else.

Everything in Weave is built from that one small idea, the **signal**. Components, the router, the store, forms, translations — they are all signals, woven together. Learn the signal properly and the rest of the framework stops being a list of things to memorize.

## What a Weave app is made of

Three kinds of file, and you have already seen two of them:

| File | What it holds |
| --- | --- |
| `thing.ts` | The logic — a `setup` function holding the values the template uses |
| `thing.html` | The template — plain HTML with `{{ }}` slots and `on:` handlers |
| `thing.scss` | The styles for that component (optional) |

Three files sharing a name are one **component**. There is no class to extend, no decorator to remember, and nothing to register anywhere — the shared name is enough.

:::callout info "The shared name is the default, not the only way"
It is what these docs use, because it needs no ceremony. But you are not tied to it. A component can name its own template and stylesheets — `export const template = './anything.html'`, `export const styles = ['./a.scss', './b.scss']` — or write the template inline in the `.ts` as a backtick string, or put script, template and styles together in a single `.weave` file. All four are first-class; [Components](/learn/components) shows each one and when it earns its keep.
:::

## How these docs are organized

Four sections, and you can move between them freely:

- :icon[graduation-cap] **Learn** — where you are now. Narrative guides that build one idea at a time, in order.
- :icon[book-open] **Reference** — the exhaustive catalog: every package, function, option and type, with the exact signature.
- :icon[package] **UI** — the component library: buttons, tables, dialogs and the rest, each with live examples.
- :icon[star] **Examples** — complete small apps you can read end to end and lift into your own project.

Every Learn page links out to the matching Reference, and back.

## Your path from here

If you want to understand *why* before *how*, read [Why Weave?](/learn/why-weave) next. If you would rather get something running on your own machine first, go to [Installation](/learn/installation) and then the [Quick start](/learn/quick-start). And if you only have ten minutes and want the idea everything rests on, go straight to [Thinking in signals](/learn/signals).

[Next: Why Weave? →](/learn/why-weave)
