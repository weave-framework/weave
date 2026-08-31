# Installation

This page takes you from an **empty computer** to a running Weave app. No prior framework experience needed — we'll name every step.

:::callout info "The names, and what is promised about them"
Everything you import lives under the **`@weave-framework/`** scope — `@weave-framework/runtime`,
`@weave-framework/router`, `@weave-framework/ui`, and so on. The command that creates an app is
different on purpose: `npm create weave@latest` follows npm's `create-` convention and fetches the
package named `create-weave`.

The public API has been frozen since 1.0. A breaking change may only land in a major version, and only
after being deprecated in a release before it — so upgrading within a major is meant to be dull.
:::

:::callout tip "Can't find it via npm search?"
npm's free-text search box doesn't surface **scoped** packages (`@weave-framework/*`), so searching for "weave-framework" won't list them — that's an npm search limitation, not a missing package. To browse or verify them:

- **All packages in one place:** [npmjs.com/org/weave-framework](https://www.npmjs.com/org/weave-framework)
- **A specific package:** `npm view @weave-framework/runtime` (or open `npmjs.com/package/@weave-framework/runtime`)

You don't need to find them by hand anyway — `npm create weave@latest` (below) pulls in everything for you.
:::

## 1. Prerequisites

You need two things on your machine:

| Tool | Why | Check |
|------|-----|-------|
| **Node.js** (current LTS — 20 or 22) | Weave's build tool runs on Node. | `node --version` |
| A **package manager** — npm, pnpm, or yarn | To install Weave. npm ships with Node. | `npm --version` |

If you don't have Node: download the LTS installer from [nodejs.org](https://nodejs.org), or use a version manager (`nvm`, `fnm`). npm, pnpm, and yarn all work — pick whichever you like; every command below is shown for all three.

## 2. Create a new app (fastest)

The quickest start is the scaffolder — it generates a ready-to-run project:

:::tabs
~~~bash title="npm"
npm create weave@latest my-app
~~~
~~~bash title="pnpm"
pnpm create weave my-app
~~~
~~~bash title="yarn"
yarn create weave my-app
~~~
:::

Then install and start the dev server:

:::tabs
~~~bash title="npm"
cd my-app
npm install
npm run dev
~~~
~~~bash title="pnpm"
cd my-app
pnpm install
pnpm dev
~~~
~~~bash title="yarn"
cd my-app
yarn
yarn dev
~~~
:::

Open the printed URL (default <http://localhost:5173>). You have a running Weave app with **live reload** — edit `src/app/app.html` and the page updates on save.

:::callout info "The UI component library is NOT included"
`@weave-framework/ui` — the buttons, inputs, dialogs and tables — is a separate install, and its styles need
three lines of setup that nothing warns you about if you skip them (the component renders, unstyled). Four
steps, once: [UI → Installation](/ui/installation). The scaffold's own `README.md` carries the same recipe.
:::

:::callout tip "What you got"
The scaffold is a tiny, complete project: a `README.md` with the local recipes, a `weave.config.ts`, an HTML shell, one component (`src/app/app.{ts,html,css}`), and **every first-party package wired up** — `@weave-framework/runtime` plus `router`, `store`, `forms`, `i18n`, and `data` (and `@weave-framework/cli` for tooling). They're all installed so a feature is there the moment you reach for it; anything you don't `import` is **tree-shaken out** of the build (zero bundle cost — see [the note below](#3-add-weave-to-an-existing-project-manual)). That's the whole shape of a Weave app — the [Quick start](/learn/quick-start) walks through every line.
:::

## 3. Add Weave to an existing project (manual)

Prefer to wire it up yourself? Install the runtime and the CLI:

:::tabs
~~~bash title="npm"
npm install @weave-framework/runtime
npm install -D @weave-framework/cli
~~~
~~~bash title="pnpm"
pnpm add @weave-framework/runtime
pnpm add -D @weave-framework/cli
~~~
~~~bash title="yarn"
yarn add @weave-framework/runtime
yarn add -D @weave-framework/cli
~~~
:::

:::callout info "pnpm 10+: approve the build scripts"
On **pnpm 10 and newer**, `pnpm install` blocks dependency build scripts by default, so `esbuild` (pulled in by `@weave-framework/cli`) won't finish setting up — you'll see `Ignored build scripts` / `ERR_PNPM_IGNORED_BUILDS`. Run once:

~~~bash
pnpm approve-builds
~~~

and approve `esbuild` (and `@parcel/watcher`). Apps made with `npm create weave` skip this — the scaffold ships a `pnpm-workspace.yaml` that pre-approves them. npm and yarn are unaffected.
:::

Add the packages for the features you use as you go — `@weave-framework/router`, `@weave-framework/store`, `@weave-framework/forms`, `@weave-framework/i18n`, `@weave-framework/data`:

~~~bash
npm install @weave-framework/forms     # and/or router, store, i18n, data
~~~

(`esbuild` and `typescript` come along automatically with `@weave-framework/cli`; add `sass` only if you author `.scss`/`.sass` styles.)

:::callout info "Installing a package costs nothing until you use it"
`npm install` only puts a package on disk in `node_modules` — it doesn't touch your output. The build (esbuild, `bundle: true`) starts from your root component and follows the **`import` graph**, so only code you actually import is compiled into `dist/`. Every Weave package is **zero-dependency** and ships `"sideEffects": false`, so anything unused is **tree-shaken out** — an installed-but-unused package adds zero bytes to your bundle. That's exactly why the scaffold can install all of them up front: you get every feature within reach, and pay only for what you import. (Import a package you *haven't* installed and the build fails loudly with `Could not resolve` — never a silent surprise.)
:::

Then create the four files that make up the smallest useful app:

~~~
my-app/
  weave.config.ts        ← the single source of truth for the build
  src/
    index.html           ← the HTML shell (one mount point)
    app/
      app.ts             ← root component logic
      app.html           ← root component template
~~~

**`weave.config.ts`** — point `root` at your top component and Weave wires up the rest:

~~~ts title="weave.config.ts"
import { defineConfig } from '@weave-framework/cli';

export default defineConfig({
  root: 'src/app/app',     // root component (no extension)
  index: 'src/index.html', // the HTML shell to inject into
  publicDir: 'public',     // static assets folder (create it; see the note)
  dev: { port: 5173 },
});
~~~

:::callout tip "Give `publicDir` its own folder"
Point `publicDir` at a dedicated folder (e.g. `public/`) rather than leaving it unset. Unset, it defaults to the config-file directory — i.e. your whole project — and the build would try to copy that (including `dist/`) into the output. A `public/` folder for favicons and static files keeps the build clean.
:::

**`src/index.html`** — just a mount point; Weave injects the script and styles:

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

**`src/app/app.ts`** and **`app.html`** — your first component (the [Quick start](/learn/quick-start) explains every line):

:::tabs
~~~ts title="src/app/app.ts"
import { signal } from '@weave-framework/runtime';

export function setup() {
  const count = signal(0);
  const inc = () => count.set((n) => n + 1);
  return { count, inc };
}
~~~
~~~html title="src/app/app.html"
<main>
  <h1>Hello, Weave</h1>
  <button on:click={{ inc }}>clicked {{ count() }} times</button>
</main>
~~~
:::

Add these scripts to your `package.json` and you're set:

~~~json title="package.json"
"scripts": {
  "dev": "weave dev",
  "build": "weave build",
  "check": "weave check"
}
~~~

Run `npm run dev` (or `pnpm dev` / `yarn dev`), open the printed URL, and edit `app.html` — it reloads on save. The full CLI (every command and flag) is on the [Tooling & CLI](/learn/tooling) page.

## 4. Using a package from npm

Weave ships with zero third-party dependencies. **That is a rule Weave keeps for itself, not one it
puts on you.** Your `node_modules` is yours: if npm has something you need and Weave does not have it,
install it and import it. There is nothing to register, no plugin to write, and no configuration to
add.

~~~bash
npm install nanoid
~~~

~~~ts title="src/app/ids/ids.ts"
import { signal } from '@weave-framework/runtime';
import { nanoid } from 'nanoid';

export function setup() {
  const ids = signal<string[]>([nanoid()]);
  const add = (): void => {
    ids.set((list) => [...list, nanoid()]);
  };
}
~~~

That is the whole integration. `weave build` runs esbuild with `bundle: true` and no externals for your
code, so it follows your `import` graph into `node_modules` exactly as it follows it into `src/`. A
package from npm is not a special case — it is just another module on the path.

:::callout see "How to confirm it really landed"
Build, then search the output for something only that library could have written:

~~~bash
npm run build
grep -c "useandom" dist/main.js      # nanoid's alphabet → 1
~~~

Search for the *export name* and you may well get `0` and think it failed: minification renames
identifiers. Look for a string literal the library owns instead — those survive.
:::

Which of the three kinds you are dealing with decides how much care it needs.

### A library that is pure logic

Date maths, validation, parsing, formatting, ids, currency. Install, import, call. Nothing else applies
— the example above is the whole story.

### A library that draws into the DOM

Charts, maps, rich-text editors, drag-and-drop. These want a real element to own, and Weave has a
purpose-built place to give them one: a **`use:` action**.

~~~ts title="src/app/lib/chart-action.ts"
import type { ChartLib } from 'some-chart-library';
import { create } from 'some-chart-library';

/** A Weave `use:` action is `(element, argument) => cleanup | { update, destroy }`. */
export function chart(el: HTMLElement, data: number[]) {
  const instance: ChartLib = create(el, { data });
  return {
    update: (next: number[]): void => instance.setData(next),
    destroy: (): void => instance.destroy(),
  };
}
~~~

~~~html title="src/app/dashboard/dashboard.html"
<div class="chart" use:chart={{ points() }}></div>
~~~

Three things are handled for you, and each is a thing people usually write by hand:

- The action runs at **`onMount`** — the element is already in the document, so measuring, focusing and
  library initialization all work on the first try.
- `update(next)` re-runs **whenever the argument changes**, because `{{ points() }}` is a live
  expression. The library gets new data without you wiring a watcher.
- `destroy()` runs when the element is removed, so the library's listeners and timers go with it. This
  is where memory leaks usually come from, and it is the part you do not have to remember.

`use:` actions and the full `{ update, destroy }` contract are covered on
[Templates](/learn/templates#directives-use).

### A library that touches `window` when it is imported

Some packages read `window`, `document` or `navigator` at module scope, the moment they are imported
rather than when you call them.

:::callout trap "This is the one that breaks a static build"
It works in `weave dev` and fails in `weave build --ssg`, which is the worst way to find out. During
static generation your components render on **Node**, inside Weave's own headless DOM, which
deliberately implements the parts a component needs and not the whole browser.

Two ways out, and both are one line. Import it lazily, inside the code that runs only in a browser:

~~~ts
onMount(async () => {
  const { thing } = await import('browser-only-library');
  thing(el);
});
~~~

Or put it behind a `use:` action, which **never runs on the server at all** — that is not a workaround,
it is what the action boundary is for.
:::

### What it costs you

Two honest things to know before you add one.

**Bytes.** The library goes into your bundle. Every Weave package declares `"sideEffects": false`, so
anything you do not import is dropped — but a third-party package makes its own promises about that,
and some make none. Check your bundle after adding something large.

**Types.** If the package ships no TypeScript types, you get this, because the scaffold's
`tsconfig.json` is `strict`:

~~~
src/app/ids/ids.ts:1:28 - error TS7016: Could not find a declaration file for module 'thing'.
  Try `npm i --save-dev @types/thing` if it exists or add a new declaration (.d.ts) file
  containing `declare module 'thing';`
~~~

Take the first option when the community types exist. Otherwise write the declaration yourself —
anywhere under `src`, and `weave check` picks it up along with everything else:

~~~ts title="src/types/thing.d.ts"
declare module 'thing' {
  export function doTheThing(el: HTMLElement): void;
}
~~~

The same file is where a global belongs — `declare const __APP_VERSION__: string;` for something your
host page injects, for instance.

## 5. Build for production

When you're ready to ship:

~~~bash
npm run build      # → weave build
~~~

This writes a clean, minified, self-contained folder to **`dist/`** (override with `outDir` in the config). It's plain `.html`, `.js`, and `.css` — no server runtime.

## 6. Deploy

`dist/` is **static files**. Host it anywhere that serves static content:

- Drag-and-drop hosts (Netlify, Vercel, Cloudflare Pages, GitHub Pages, S3 + CDN, …) — point them at `dist/`.
- A plain web server (`nginx`, Apache) — serve the folder.

:::callout tip "Client-side routing on a static host"
If your app uses the [router](/learn/router) with clean URLs, a deep-link refresh asks the host for a page that does not exist. With `routesDir` configured, `weave build` writes **`404.html`** alongside `index.html` (the same document) — which is exactly what GitHub Pages serves for an unknown path, so the refresh works with nothing to configure. On a host with rewrite rules, point unknown paths at `index.html` instead.
:::

:::callout tip "Serving from a sub-path (a project page, `/docs/`, a reverse proxy)"
A GitHub Pages **project** site lives at `user.github.io/my-app/`, not at the root — and root-absolute asset
URLs (`/main.js`) then resolve to the wrong place and the page comes up blank. Say where the app lives:

~~~ts title="weave.config.ts"
export default defineConfig({
  root: 'src/app/app',
  base: '/my-app/', // matches the repository name for a GitHub Pages project site
});
~~~

Every URL the framework injects picks it up, `weave dev` answers under it (so you develop against the same
shape you deploy), and the router adopts it as its basename — `<Link to="/about">` still reads as `/about`
in your code and resolves to `/my-app/about` in the browser. A **user** site (`user.github.io`) is at the
root and needs no `base`.
:::

:::callout info "Caching"
The injected `<script>` and `<link>` carry a content marker (`/main.js?v=1a2b3c`) derived from the built
file itself, so a host or CDN cannot answer today's HTML with yesterday's bundle. An unchanged rebuild keeps
the same marker, so nothing re-downloads for no reason.
:::

[Next: Quick start :icon[arrow-right]](/learn/quick-start)
