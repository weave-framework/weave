# Adopt Weave one piece at a time

You don't have to rewrite an app to try Weave — or even to ship it to production. Weave compiles any component to a **standard custom element**, so a single Weave widget drops into whatever you already run — any framework that can render a DOM element, or plain HTML — with no rewrite and no bridge library.

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

**In a templating framework** — write the tag exactly as you'd write any other element, using whatever binding syntax your host already uses for attributes and properties:

~~~html
<weave-rating value="4"></weave-rating>
~~~

Because it's a standard custom element, no host-specific wrapper or adapter is involved. Some hosts need to be told that an unknown tag is a custom element rather than a typo (a schema, a compiler option, or a tag-name allowlist) — that's the same one-line setup those hosts require for any web component, and your host's own documentation covers it.

**Setting rich data:** get a reference to the element and assign the property directly — `el.value = { … }` — which works identically from any host.

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
- **An embedded widget renders on the client.** If your host server-renders its page, the Weave custom element still builds in the browser — the same as most third-party widgets. Weave's [static generation](/learn/static-generation) prerenders *Weave-owned routes* at build time; it does not reach inside a host application's own server render, and request-time SSR is deliberately not built.

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

### Make a project use Weave — not the framework beside it

In a **mixed workspace** — projects using other tooling sitting next to Weave ones, including a project you're converting to Weave — Nx and your editor decide a project's tooling from that project's own config. A project keeps behaving the way it did until three files say "this is Weave". Set them on the project and both the `nx` CLI and the editor switch over:

1. **`weave.config.{ts,js,json}` at the project root** — this is the marker the inference plugin (and the CLI) key off. Its presence is what makes `nx build`/`serve`/`check` resolve to Weave. Without it, the project isn't a Weave project.

2. **A project-local `tsconfig.json`** — scopes the project as its own TypeScript program, so the editor's TS service treats its `.ts` + `.html` pairs as Weave, not as part of a sibling project's program:

   ~~~jsonc title="apps/my-app/tsconfig.json"
   {
     "compilerOptions": {
       "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
       "lib": ["ES2022", "DOM", "DOM.Iterable"], "strict": true, "noEmit": true, "skipLibCheck": true
     },
     "include": ["src"]
     // add "extends": "../../tsconfig.base.json" if you rely on workspace path mappings
   }
   ~~~

3. **`.prettierrc` routing `*.html` to the `weave` parser** — so templates format instead of getting mangled (`nx g @weave-framework/nx:application` writes all three for you).

**Converting an existing project:** the project's `project.json` still carries its previous `build`/`serve`/`lint` targets, and that's what makes Nx — and the IDE — keep treating it (and its `.html` files) the old way. Drop those targets and let the Weave plugin infer, or declare the Weave executors explicitly. A project-level `project.json` target **always wins** over any inferred one, so this is the reliable override:

~~~jsonc title="apps/my-app/project.json"
{
  "name": "my-app",
  "projectType": "application",
  "sourceRoot": "apps/my-app/src",
  "targets": {
    // remove the project's previous build, serve and lint targets, then:
    "build":  { "executor": "@weave-framework/nx:build",  "options": { "config": "weave.config.ts" },
                "outputs": ["{workspaceRoot}/dist/{projectRoot}"], "cache": true },
    "serve":  { "executor": "@weave-framework/nx:serve",  "options": { "config": "weave.config.ts" } },
    "check":  { "executor": "@weave-framework/nx:check", "cache": true }
  }
}
~~~

If two plugins try to infer the same target name (e.g. both another plugin and Weave want `build`), give the Weave plugin explicit target names in `nx.json` so they coexist — or just rely on the explicit `project.json` targets above, which outrank every inferred target:

~~~jsonc title="nx.json"
{ "plugins": [{ "plugin": "@weave-framework/nx/plugin", "options": { "buildTargetName": "build", "checkTargetName": "check" } }] }
~~~

Run `nx show project my-app --web` to see exactly which plugin each target comes from. Once the project declares Weave (the three files above) and no longer declares its previous targets, its `.html` files are Weave templates — a `.ts` + `.html` pair whose `.ts` exports `setup`, with no decorator metadata pointing at them as a template — so the editor's Weave support (the VS Code extension or the WebStorm plugin) owns them and the previous template checker stops flagging them. If the templates still show unexpected errors after this, the project is still being classified the old way somewhere — re-check its `project.json` targets and that its `.ts` files carry no component decorators.
