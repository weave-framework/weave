# Custom elements & bootstrap

This page covers the two ends of an app's lifecycle: how it **starts** (bootstrap), and how a component can be exposed as a native **custom element** for use outside Weave.

## How an app boots

You start an app one of two ways, chosen in `weave.config.ts`. They are **mutually exclusive** — the config must declare exactly one of `root` or `entry`. Declaring neither, or both, fails the build with a clear message (`config must declare either root … or entry` / `declares both root and entry — pick one`).

### `root` — let Weave bootstrap (recommended)

Point `root` at your top component and Weave generates the entry module for you: it imports the root, registers every custom element it discovers, and mounts the root into the `mount` selector. You write no entry file and no `<script>` tag.

:::tabs
~~~ts title="weave.config.ts"
export default defineConfig({
  root: 'src/app/shell', // the top component
  mount: '#app',         // where it mounts (default '#app')
  index: 'src/index.html',
});
~~~
~~~html title="src/index.html"
<body>
  <div id="app"></div>
  <!-- Weave injects the entry script + stylesheet here at build/dev time -->
</body>
~~~
:::

`mount` is a CSS selector that defaults to `'#app'` when omitted. It applies **only** to the `root` bootstrap.

### `entry` — hand-written bootstrap (escape hatch)

When you need full control — register a service worker, set up a polyfill, mount somewhere unusual, register custom elements yourself — use `entry` instead of `root` and write the entry module by hand with `mountComponent`:

~~~ts title="src/main.ts"
import { mountComponent } from '@weave-framework/runtime/dom';
import App from './app/app';

mountComponent(App, '#app');
~~~

When you use `entry`, the config's `mount` is **ignored** — you choose the mount target yourself in the call to `mountComponent`. Weave will not auto-register custom elements for you in this mode; do that with `defineCustomElement` (see below).

`mount` and `mountComponent` both accept either a CSS selector (`'#app'`, `'.root'`, `'[data-app]'`, `'main'`) or an `Element`. A selector that matches nothing throws a clear error rather than silently doing nothing, and mounting replaces the container's existing contents.

## Exposing a component as a custom element

A Weave component can be published as a native custom element (Web Component), so any page that can render HTML can use `<my-widget>`. Opt in by exporting a `tag` (and the props you want reflected) from the component:

:::tabs
~~~ts title="components/badge/badge.ts"
export const tag = 'weave-badge';       // the custom-element name — MUST contain a hyphen
export const props = ['priority'];      // exposed as attributes + JS properties

export function setup(props: { priority: string }) {
  return { priority: () => props.priority };
}
~~~
~~~html title="components/badge/badge.html"
<span class="badge" data-priority={{ priority() }}>{{ priority() }}</span>
~~~
:::

- `export const tag` is a string literal and **must contain a hyphen** — that is the Custom Elements spec rule for author-defined names. A tag without a hyphen aborts the build (`must contain a hyphen`).
- `export const props` is an array of prop-name string literals. It is optional; omit it (or leave it empty) for a custom element that takes no props. Each name listed here becomes both an observed attribute and a JS property (next section).

With `tag` declared, Weave's `root` bootstrap **auto-registers** the element during the build — there is no manual `defineCustomElement` call to write and nothing to forget. Now it works as a real element anywhere:

~~~html
<weave-badge priority="high"></weave-badge>
~~~

### How auto-registration works

A `<weave-badge>` written in a template is just a string tag, not an import — so the build can't find it by following imports. Instead, the bootstrap **scans the project files** for components that export a `tag`, collects their `props`, and emits a `defineCustomElement(...)` call for each, **before** the root is mounted (so every tag is defined by the first render). The scan skips `node_modules`, `dist`, `.git`, `.weave`, and generated files (`*.d.ts`, `*.gen.ts`).

This discovery is **fail-loud**: declaring the same `tag` in two files aborts the build (`tag "…" declared twice`), as does a tag missing its hyphen. Auto-registration happens only under the `root` bootstrap; with `entry`, register elements yourself.

### Passing props: attributes vs JS properties

Each name in `props` becomes two things, both feeding the **same** reactive signal:

| From | How you pass it | Notes |
|------|-----------------|-------|
| HTML attribute | `<weave-badge priority="high">` | The attribute name is **kebab-cased** (`itemCount` → `item-count`). Values are always strings. Changing the attribute later updates the prop. |
| JS property | `el.priority = 'low'` | Use the original (camelCase) prop name. Can hold any JS value, not just strings. |

Attributes present at mount time seed the prop; later attribute changes (observed attributes) and property sets both update the prop's signal, so the mounted component re-renders on change. The element mounts on connect and disposes on disconnect.

:::callout tip "It renders into light DOM"
A Weave custom element renders into its own light DOM — no shadow root — so its [scoped styles](/learn/styling) are collected into the app stylesheet and apply normally. You keep style scoping *and* get a standard custom element.
:::

### The single-file string form

Small presentational elements like a badge often read nicely as one file. A component module may export its template and styles as **strings** instead of using sibling files:

~~~ts title="badge.ts"
export const tag = 'weave-badge';
export const props = ['priority'];
export const template = `<span class="badge" data-priority={{ priority }}>{{ priority }}</span>`;
export const styles = `
  .badge { padding: 2px 7px; border-radius: 999px; font-size: 10px; }
  .badge[data-priority="high"] { background: #f85149; color: #fff; }
`;
~~~

This inline string form is one of several ways to attach a template and styles to a component — the full set (inline string, separate file path, and sibling-file convention) is documented in [Components](/learn/components).

### Registering one by hand

Outside the `root` bootstrap — when you use `entry`, or publish a widget as a library — call `defineCustomElement` directly:

~~~ts
import { defineCustomElement } from '@weave-framework/runtime/dom';
import Badge from './badge';

defineCustomElement('weave-badge', Badge, { props: ['priority'] });
~~~

Re-defining the same tag is a safe no-op — the second call is ignored, so registering twice never throws at runtime.

## Two ways to use the same component

Once a component exists, you can render it either way, and they interoperate freely:

- As a **compiled component** in a Weave template: `<Badge priority="high" />` — capitalized tag, props as reactive getters, full slot support.
- As a **custom element**: `<weave-badge priority="high">` — a real DOM element usable from anywhere, props via attributes/properties.

Use the compiled form inside Weave (it's lighter and fully typed); reach for the custom element at the boundary with non-Weave code.

:::callout info "What you just learned"
The config declares exactly one of `root` (Weave generates the entry, mounts at `mount`, and auto-registers discovered custom elements) or `entry` (you hand-write the bootstrap with `mountComponent`, and `mount` is ignored). Export `const tag` (a hyphenated name) plus an optional `const props` to expose a component as a custom element that renders into light DOM and keeps scoped styles; each declared prop is a kebab-cased observed attribute **and** a camelCase JS property, both feeding one reactive signal. Auto-registration is fail-loud on duplicate or hyphen-less tags; `defineCustomElement` registers one by hand and is a no-op if the tag already exists. Use `<Badge/>` inside Weave, `<weave-badge>` at the boundary.
:::

[Next: Tooling & CLI →](/learn/tooling) · [Reference: @weave-framework/runtime →](/reference/runtime)
