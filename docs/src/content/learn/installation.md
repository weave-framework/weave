# Installation

This page takes you from an **empty computer** to a running Weave app. No prior framework experience needed — we'll name every step.

:::callout info "Pre-1.0"
Weave is pre-1.0. The packages are published on npm under the **`@weave-framework/*`** scope (`@weave-framework/runtime`, `@weave-framework/cli`, …). APIs may still shift between minor versions; pin a version if you need stability.
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

~~~bash
npm create weave@latest my-app
# or: pnpm create weave my-app
# or: yarn create weave my-app
~~~

Then install and start the dev server:

~~~bash
cd my-app
npm install      # or: pnpm install / yarn
npm run dev      # or: pnpm dev / yarn dev
~~~

Open the printed URL (default <http://localhost:5173>). You have a running Weave app with **live reload** — edit `src/app/app.html` and the page updates on save.

:::callout tip "What you got"
The scaffold is a tiny, complete project: a `weave.config.ts`, an HTML shell, one component (`src/app/app.{ts,html,css}`), and the `@weave-framework/runtime` + `@weave-framework/cli` dependencies wired up. That's the whole shape of a Weave app — the [Quick start](/learn/quick-start) walks through every line.
:::

## 3. Add Weave to an existing project (manual)

Prefer to wire it up yourself? Install the runtime and the CLI:

~~~bash
# npm
npm install @weave-framework/runtime
npm install -D @weave-framework/cli

# pnpm
pnpm add @weave-framework/runtime
pnpm add -D @weave-framework/cli

# yarn
yarn add @weave-framework/runtime
yarn add -D @weave-framework/cli
~~~

Add the packages for the features you use as you go — `@weave-framework/router`, `@weave-framework/store`, `@weave-framework/forms`, `@weave-framework/i18n`, `@weave-framework/data`. (`esbuild` and `typescript` come along automatically with `@weave-framework/cli`; add `sass` only if you author `.scss`/`.sass` styles.)

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
  <h1>Hello, Weave 🧵</h1>
  <button on:click={{ inc }}>clicked {{ count() }} times</button>
</main>
~~~

Add these scripts to your `package.json` and you're set:

~~~json title="package.json"
"scripts": {
  "dev": "weave dev",
  "build": "weave build",
  "check": "weave check"
}
~~~

Run `npm run dev` (or `pnpm dev` / `yarn dev`), open the printed URL, and edit `app.html` — it reloads on save. The full CLI (every command and flag) is on the [Tooling & CLI](/learn/tooling) page.

## 4. Build for production

When you're ready to ship:

~~~bash
npm run build      # → weave build
~~~

This writes a clean, minified, self-contained folder to **`dist/`** (override with `outDir` in the config). It's plain `.html`, `.js`, and `.css` — no server runtime.

## 5. Deploy

`dist/` is **static files**. Host it anywhere that serves static content:

- Drag-and-drop hosts (Netlify, Vercel, Cloudflare Pages, GitHub Pages, S3 + CDN, …) — point them at `dist/`.
- A plain web server (`nginx`, Apache) — serve the folder.

:::callout tip "Client-side routing on a static host"
If your app uses the [router](/learn/router) with clean URLs, configure the host to fall back to `index.html` for unknown paths (an SPA rewrite). On GitHub Pages, a copied `404.html` does the same job. Without it, a deep-link refresh returns a 404.
:::

[Next: Quick start →](/learn/quick-start)
