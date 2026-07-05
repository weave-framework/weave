# Adopt Weave one piece at a time

You don't have to rewrite an app to try Weave — or even to ship it to production. Weave compiles any component to a **standard custom element**, so a single Weave widget drops into whatever you already run — React, Angular, Vue, or plain HTML — with no rewrite and no bridge library.

That matters, because the safest way to adopt a framework is at the edges: pick one non-critical screen or widget, build it in Weave, ship it, and see how it feels — before betting anything bigger.

## How it works

Any Weave component becomes a native custom element by exporting a `tag` (and the props you want to pass in):

~~~ts title="rating.ts"
export const tag = 'weave-rating';
export const props = ['value'];
// ...template + styles
~~~

The build registers it for you — now it's a real DOM element, usable from anywhere.

**In plain HTML:**

~~~html
<weave-rating value="4"></weave-rating>
~~~

**In React:**

~~~jsx
function Review({ score }) {
  return <weave-rating value={score} />;
}
~~~

**In Angular** (add `CUSTOM_ELEMENTS_SCHEMA` to the module, as with any web component):

~~~html
<weave-rating [attr.value]="score"></weave-rating>
~~~

Props cross the boundary two ways, both feeding the same reactive signal: as **attributes** (`value="4"` — kebab-cased, string values) or as **JS properties** (`el.value = 4` — any value). Set either, and the component re-renders. Full detail in [Custom elements](/learn/custom-elements).

## Why this is a safe way in

- **No rewrite.** Your existing app, router, and build stay exactly as they are — Weave lives inside one tag.
- **No lock-in at the seam.** A custom element is a web standard, not a Weave-specific bridge; the same `<weave-rating>` works in any host, and removing it later means removing a standard element, nothing exotic.
- **Reversible.** Try it on one widget. If it's not for you, delete one tag — the blast radius is a single element.
- **Zero added dependencies.** True to the rest of Weave: embedding adds no third-party runtime to your host app.

## What to know at the boundary

No surprises — here are the edges:

- **Attributes are strings.** Pass rich data (objects, arrays) via the JS property (`el.value = {...}`) rather than an HTML attribute.
- **Events.** Communicate outward with standard DOM `CustomEvent`s, which every host framework already understands.
- **No SSR yet.** A Weave custom element renders on the client; if your host server-renders, the widget hydrates in the browser — the same as most third-party widgets. Server-side rendering is on the [roadmap](/enterprise/safe-to-bet-on).

## The path

1. Pick one low-risk widget or screen.
2. Build it in Weave; export a `tag`.
3. Drop the element into your existing app and ship it.
4. Like it? Grow from the edges inward, at your own pace.

That's incremental adoption — no big bang, no rewrite, no leap of faith. Just one element at a time.

## Drop into an existing Nx monorepo

Already on [Nx](https://nx.dev)? `@weave-framework/nx` makes a Weave app a first-class project — no target boilerplate.

~~~bash
nx add @weave-framework/nx
~~~

Register the inference plugin in `nx.json` and every project with a `weave.config.{ts,js,json}` gets `build` / `serve` / `check` targets inferred automatically, with correct cache inputs and outputs:

~~~jsonc title="nx.json"
{ "plugins": ["@weave-framework/nx/plugin"] }
~~~

~~~bash
nx build my-weave-app     # cached; output = the config's outDir
nx serve my-weave-app     # weave dev (watch + live-reload)
nx check my-weave-app     # cached type-check
~~~

Under the hood each target runs the existing `weave` CLI with `cwd` set to the project root, so the Weave build itself needs no Nx-specific changes — you get Nx caching, `nx affected`, and the project graph over your Weave apps for free. Generators scaffold projects and components: `nx g @weave-framework/nx:application`, `:library`, `:component`. The plugin depends on `@nx/devkit` (dev-time, correct for an Nx plugin); the Weave runtime stays zero-dependency.
