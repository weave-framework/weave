# Styling

Styles in Weave are **scoped to the component by default**. You write plain CSS (or SCSS) in a sibling file, and it only affects that component's markup — no global bleed, no naming conventions to invent, no CSS-in-JS runtime.

## A component's styles

Pair a `.css` (or `.scss`) file with your component, same base name. The compiler scopes every selector to this component's elements and collects all component styles into one stylesheet for the app:

:::tabs
~~~scss title="task-card.scss"
.card {
  padding: 12px 14px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.title {
  margin: 0;
  font-size: 14px;
}
~~~
~~~html title="task-card.html"
<article class="card">
  <p class="title">{{ task().title }}</p>
</article>
~~~
:::

That `.card` rule won't touch a `.card` in any other component. Scoping is automatic — you just write the selectors you'd write anyway.

:::callout tip "Choosing the language"
Set `styleLang` in `weave.config.ts` to `'css'` (default), `'scss'`, or `'sass'`. It decides the sibling extension the compiler looks for and how it's processed. SCSS gives you nesting, variables, and `@use`.
:::

## Styling the component's own root: `:host`

A component's outermost element is its **host**. Target it with `:host`, and apply conditional host styles with `:host(...)` — exactly like the Shadow DOM convention, but here it works in regular (light) DOM:

~~~scss
:host {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* host in a state */
:host(:hover) { border-color: var(--accent); }

/* a descendant, only when the host is hovered */
:host(:hover) .edit { opacity: 1; }
~~~

`:host` is how you give a component its own box (padding, border, layout) without wrapping it in an extra `<div>`.

## Reaching outside the scope: `:global`

Sometimes a selector genuinely must escape scoping — a third-party widget's classes, or an element your component creates in JavaScript. Wrap it in `:global(...)`:

~~~scss
.prose :global(.hljs-keyword) { color: var(--accent); }
~~~

Everything outside the `:global()` stays scoped; only what's inside it is emitted unscoped. This keeps the escape hatch surgical.

## The one gotcha worth knowing

Scoping works by tagging your component's elements with a scope attribute and rewriting selectors to match it. **Elements that aren't built from this component's template don't carry that attribute** — most notably:

- a child **component**'s root (it has its *own* scope), and
- any element a component creates in JavaScript (e.g. a `<Link>`'s `<a>`, or a node the [markdown renderer](/learn/recipes) builds).

So a plain scoped selector won't reach them. The fix is the **scoped-container + `:global`** pattern: scope a wrapper you *do* own, and reach the foreign element through `:global()`:

~~~scss
/* `.nav-link` is rendered by <Link> in JS, so it has no scope attribute.
   Scope the container we own, then break out to the link inside it. */
.nav :global(.nav-link) {
  color: var(--muted);
  text-decoration: none;
}
.nav :global(.nav-link[aria-current="page"]) {
  color: var(--text);
}
~~~

This still can't leak, because the container (`.nav`) is scoped to your component — only links *inside this component's* `.nav` are affected.

:::callout info "Why this happens"
It's the same reason scoping is leak-proof in the first place: Weave only marks the DOM *it* generated from your template. A `<Link>` builds its own `<a>` in code, so it's invisible to your scope — by design, not by bug. Reach it with `:global()` from a container you own.
:::

## App-wide styles

Component styles are for components. For genuinely global things — CSS variables, resets, the base `body` font, design tokens — list one or more entry stylesheets in `weave.config.ts`. They're compiled and concatenated *before* component CSS, so your tokens are available everywhere:

~~~ts title="weave.config.ts"
export default defineConfig({
  root: 'src/app/app',
  styleLang: 'scss',
  styles: ['src/styles/main.scss'], // global, loaded first
});
~~~

~~~scss title="src/styles/main.scss"
:root {
  --surface: #0f1115;
  --surface-2: #161922;
  --text: #e6e9ef;
  --accent: #6ea8fe;
  --radius: 10px;
}
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; color: var(--text); }
~~~

A common, tidy split: **tokens and resets** go in the global stylesheet; **everything else** lives scoped next to its component and references the tokens via `var(--…)`.

## Custom elements

A component shipped as a [custom element](/learn/custom-elements) renders into its **light DOM** (no shadow root), so its scoped styles are collected into the same app stylesheet and apply normally. You don't lose scoping by exposing a component as `<my-widget>`.

:::callout info "What you just learned"
Component styles live in a sibling `.css`/`.scss` and are **scoped automatically**. Style the component's own box with `:host`/`:host(...)`, escape scoping surgically with `:global(...)`, and remember that elements built in JS (child components, `<Link>`) need the scoped-container + `:global` pattern. Put tokens and resets in the global `styles` entry; keep the rest scoped.
:::

[Next: Lifecycle, context & DI →](/learn/lifecycle-context-di)
