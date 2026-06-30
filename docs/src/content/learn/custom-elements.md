# Custom elements & bootstrap

This page covers the two ends of an app's lifecycle: how it **starts** (bootstrap), and how a component can be exposed as a native **custom element** for use outside Weave.

## How an app boots

You have two ways to start an app, chosen in `weave.config.ts`.

### `root` — let Weave bootstrap (recommended)

Point `root` at your top component and Weave generates the entry module for you: it imports the root, registers any custom elements it finds, and mounts the root into the `mount` selector. You write no entry file and no `<script>` tag.

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

### `entry` — hand-written bootstrap (escape hatch)

When you need full control — register a service worker, set up a polyfill, mount somewhere unusual — use `entry` instead of `root` and write the entry yourself with `mountComponent`:

~~~ts title="src/main.ts"
import { mountComponent } from '@weave/runtime/dom';
import App from './app/app';

mountComponent(App, '#app');
~~~

`root` and `entry` are mutually exclusive — pick one. `mount`/`mountComponent` both accept a CSS selector (`'#app'`, `'.root'`, `'[data-app]'`) or an `Element`, and a selector that matches nothing throws a clear error rather than silently doing nothing.

## Exposing a component as a custom element

A Weave component can be published as a native custom element (Web Component) so plain HTML — or React, or Angular, or no framework at all — can use `<my-widget>`. Opt in by exporting a `tag` (and the props you want reflected) from the component:

~~~ts title="components/badge/badge.ts"
export const tag = 'weave-badge';       // the custom-element name (must contain a hyphen)
export const props = ['priority'];      // exposed as attributes + JS properties

export function setup(props: { priority: string }) {
  return { priority: () => props.priority };
}
~~~

~~~html title="components/badge/badge.html"
<span class="badge" data-priority={{ priority() }}>{{ priority() }}</span>
~~~

With `tag` declared, Weave's bootstrap **auto-registers** it during the build — no manual `defineCustomElement` call. Now it works as a real element anywhere:

~~~html
<weave-badge priority="high"></weave-badge>
~~~

Each declared prop becomes a **kebab-cased observed attribute** *and* a JS property, both feeding a reactive signal — so the element re-renders when an attribute changes or `el.priority = 'low'` is set. It mounts on connect and disposes on disconnect.

:::callout tip "It renders into light DOM"
A Weave custom element renders into its own light DOM — no shadow root — so its [scoped styles](/learn/styling) are collected into the app stylesheet and apply normally. You keep style scoping *and* get a standard custom element.
:::

### The single-file string form

Small presentational elements like a badge often read nicely as one file. A component module may export its template and styles as strings instead of using sibling files:

~~~ts title="badge.ts"
export const tag = 'weave-badge';
export const props = ['priority'];
export const template = `<span class="badge" data-priority={{ priority }}>{{ priority }}</span>`;
export const styles = `
  .badge { padding: 2px 7px; border-radius: 999px; font-size: 10px; }
  .badge[data-priority="high"] { background: #f85149; color: #fff; }
`;
~~~

### Registering one by hand

Outside the `root` bootstrap (say, publishing a widget as a library), call `defineCustomElement` directly:

~~~ts
import { defineCustomElement } from '@weave/runtime/dom';
import Badge from './badge';

defineCustomElement('weave-badge', Badge, { props: ['priority'] });
~~~

Re-defining the same tag is a safe no-op.

## Two ways to use the same component

Once a component exists, you can render it either way, and they interoperate freely:

- As a **compiled component** in a Weave template: `<Badge priority="high" />` — capitalized tag, props as reactive getters, full slot support.
- As a **custom element**: `<weave-badge priority="high">` — a real DOM element usable from anywhere, props via attributes/properties.

Use the compiled form inside Weave (it's lighter and fully typed); reach for the custom element at the boundary with non-Weave code.

:::callout info "What you just learned"
`root` in the config makes Weave generate the entry and mount for you; `entry` + `mountComponent` is the hand-written escape hatch (`mount` accepts a selector or Element). Export `const tag` (+ `const props`) to expose a component as an auto-registered custom element that renders into light DOM and keeps scoped styles; declared props become observed attributes and reactive JS properties. Use `<Badge/>` inside Weave, `<weave-badge>` at the boundary.
:::

[Next: Tooling & CLI →](/learn/tooling) · [Reference: @weave/runtime →](/reference/runtime)
