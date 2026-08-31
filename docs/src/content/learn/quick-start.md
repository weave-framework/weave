# Quick start

Let's get something on screen. By the end of this page you'll have a running app, a component you wrote, and a feel for the loop: edit a file, see it live.

:::callout info "You need a project first"
This page assumes you have one. If you do not, that is one command:

`npm create weave@latest my-app` — or `pnpm create weave my-app`, or `yarn create weave my-app`.

[Installation](/learn/installation) walks through it properly, and also covers adding Weave to a project
you already have.
:::

:::callout see "The code below will not go stale on you"
Weave's public API was frozen at 1.0, and freezing it means a specific thing: **an existing function
cannot change what it takes or what it returns.** New capability may be added beside it, never on top of
it. Anything that would break code you have already written waits for the next major version, and gets
one full release of deprecation warnings before it lands.

So what you copy from this page keeps working. Two majors have shipped since — read what they changed in
[Is Weave safe to bet on?](/enterprise/safe-to-bet-on) if you want the receipts rather than the promise.
:::

## What a project looks like

A Weave app is a handful of plain files plus one config. Here's the smallest useful layout:

~~~
my-app/
  weave.config.ts        ← the single source of truth for the build
  src/
    index.html           ← the HTML shell (one mount point)
    app/
      app.ts             ← root component logic
      app.html           ← root component template
      app.scss           ← root component styles (optional)
~~~

A **component** is a `.ts` file that exports a `setup` function, paired with a sibling `.html` template (and an optional `.scss`). That's the whole convention — no class, no decorator, no registration.

## 1. Configure the build

`weave.config.ts` tells the CLI where your app starts and how to build it. The most important field is `root`: point it at your top component and Weave generates the entry, mounts it, and wires everything up for you.

~~~ts title="weave.config.ts"
import { defineConfig } from '@weave-framework/cli';

export default defineConfig({
  root: 'src/app/app',   // the root component (no extension)
  index: 'src/index.html', // the HTML shell to inject into
  mount: '#app',           // where the root component mounts (default '#app')
  styleLang: 'scss',       // component styles are .scss (default 'css')
  dev: { port: 5173 },
});
~~~

The HTML shell just needs a mount point — Weave injects the script and stylesheet for you:

~~~html title="src/index.html"
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>My Weave app</title>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>
~~~

:::callout tip "No script tag?"
Right — you don't write `<script src=…>` yourself. With `root` set, Weave generates the entry module, registers any custom elements, and mounts the root into `mount`. (Need a hand-written entry instead? Use `entry` rather than `root` — see [Custom elements & bootstrap](/learn/custom-elements).)
:::

## 2. Write your first component

The logic lives in `app.ts`. `setup` runs **once**, when the component is created, and it owns the
component's state. Its local values are what the template can read.

~~~ts title="src/app/app.ts"
import { signal } from '@weave-framework/runtime';

export function setup() {
  const count = signal(0);
  const inc = (): void => {
    count.set((n) => n + 1);
  };
}
~~~

No `return` — the compiler reads the template, sees it uses `count` and `inc`, and writes
`return { count, inc }` for you. Write one yourself when you want to expose something under a different
name or keep a value private; it is then used exactly as written.

The markup lives in `app.html`. Read a signal with `{{ count() }}`; wire an event with `on:click={{ inc }}`. (Every binding in a Weave template uses double braces — more in [Templates](/learn/templates).)

~~~html title="src/app/app.html"
<main class="app">
  <h1>Hello, Weave</h1>
  <button on:click={{ inc }}>
    clicked {{ count() }} times
  </button>
</main>
~~~

And the styles in `app.scss`. They're **scoped to this component** automatically — no `.app` leaking into the rest of the page:

~~~scss title="src/app/app.scss"
.app {
  font-family: system-ui, sans-serif;
  text-align: center;
  padding: 2rem;
}
button {
  font: inherit;
  padding: 0.6em 1.2em;
  cursor: pointer;
}
~~~

That's a complete component. Here's one running live on this very page — the same `signal` + `on:click`, with a reset button added. Click it:

:::demo counter

When you click, only the number text changes. The button isn't re-rendered, and `setup` never runs a second time. That's fine-grained reactivity at work — and it's the subject of the [next page](/learn/signals).

## 3. Run it

Weave ships a CLI. The command you'll live in is `dev`:

~~~bash
weave dev      # start the dev server (watch + live-reload)
weave build    # produce a minified static bundle in dist/
weave check    # type-check your templates and components
weave routes   # generate file-based routes (see the Router page)
~~~

Run `weave dev`, open the printed URL, and edit `app.html` — the page reloads on save. Change
`count.set((n) => n + 1)` to `+ 2` and watch the counter jump by twos.

:::callout see "What a working first run looks like"
The terminal prints a URL (`http://localhost:5173` unless the port was taken — it steps to the next free
one and says so). The page shows your heading and a button. Clicking it counts up. Saving any of the
three files reloads the page within a second, and the terminal stays quiet.

If the terminal is quiet but the page is blank, the next box is almost certainly why.
:::

:::callout trap "The two things that go wrong first"
**A blank page and `weave: mount target "#app" matched no element` in the browser console.** The `mount`
selector in `weave.config.ts` has to match an element that exists in `src/index.html`. If you renamed
`<div id="app">`, rename it in both places — they are two files that have to agree, and nothing checks
that for you until the page runs.

**The button renders as `() => …` instead of a number.** A signal is read by *calling* it:
`{{ count() }}`, not `{{ count }}`. This is the single most common first mistake in Weave and it never
throws — it just prints the function.
:::

:::callout tip "Running the CLI"
With `@weave-framework/cli` installed, the `weave` command is available through your package scripts (`npm run dev`) or `npx weave dev`. The scaffold sets up the `dev`/`build`/`check` scripts for you. See [Installation](/learn/installation) for the full setup.
:::

:::callout info "What you just learned"
A Weave app is `weave.config.ts` plus components. A **component** is a `setup` function (`.ts`) beside a template (`.html`) and optional scoped styles (`.scss`). `root` in the config bootstraps everything; `weave dev` runs it with live reload. Read a signal in a template by calling it — `{{ count() }}` — and wire events with `on:click={{ inc }}`. You do not write `setup`'s `return`; the compiler writes it from what the template uses.
:::

## Where to next

- The one idea everything is built on — [Thinking in signals :icon[arrow-right]](/learn/signals)
- How components talk to each other — [Components :icon[arrow-right]](/learn/components)
- The full template language — [Templates :icon[arrow-right]](/learn/templates)

[Next: Thinking in signals :icon[arrow-right]](/learn/signals)
