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
Set `styleLang` in `weave.config.ts` to one of three values:

- `'css'` (default) — plain CSS. The file passes through **untouched**, with zero processing cost (the Sass compiler is never even loaded).
- `'scss'` — SCSS syntax: nesting, variables, `@use`, mixins.
- `'sass'` — the **indented** Sass syntax (no braces, significant whitespace).

It decides the sibling extension the compiler looks for (`.css` / `.scss` / `.sass`) and how it's processed. Sass is a lazy dependency — it loads only when an `.scss`/`.sass` source is actually compiled.
:::

## Where a component's styles can live

The sibling file above is the convention, but styles can be declared several ways — mirroring the [template/style declaration forms in Components](/learn/components#how-a-component-declares-its-template-and-styles). The CSS specifics:

| Form | Looks like | Notes |
| --- | --- | --- |
| **Sibling file** (convention) | `app.scss` next to `app.ts` | Extension follows `styleLang`. |
| **Inline string** | `export const styles = '.x { color: red }';` | Compiled with the project's `styleLang` — so in an SCSS project an inline string is parsed as SCSS. |
| **Explicit file** | `export const styles = './theme.scss';` | Compiled by its **own** extension (a `.scss` here is SCSS even if `styleLang` is `css`). Read relative to the `.ts`. |
| **Array** | `export const styles = ['./base.scss', '.x{…}'];` | Each entry classified (file vs inline) independently, compiled, and concatenated **in order** — the array order is the cascade order. |
| **`.weave` `<style>` block** | a `<style>…</style>` inside the SFC | Compiled with `styleLang` and scoped exactly like a sibling file. |

A value is read as a **file** when it has a slash/backslash or ends `.css`/`.scss`/`.sass`; otherwise (it contains `{`, `}`, or a newline) it's **inline CSS**.

:::callout info "One source of styles, or it's an error"
A component may declare `styles` **or** have a sibling style file — never both. Doing both throws at build time ("declares `styles` and also has a sibling .`<styleLang>` — remove one"), and a declared file that doesn't exist also throws. Weave never silently picks a winner.
:::

## How scoping works under the hood

Worth understanding once, because it explains every edge case below. At build time the compiler:

1. Hashes the component to a short, stable id — **FNV-1a, base36, 6 characters**, derived from the filename (or the template if there's no filename).
2. Stamps every element **the template emits** with a `data-w-<hash>` attribute.
3. Rewrites your CSS so each rule matches that attribute.

The key rule of the rewrite: **only the rightmost compound selector is scoped.** In `.a .b`, only `.b` gets the `[data-w-<hash>]` — the ancestor `.a` is left alone (it still has to match an element in *this* component, which already carries the attribute, so scoping the tail is enough and keeps descendant selectors working). The attribute is inserted before the first pseudo in the compound (`.btn:hover` → `.btn[data-w-<hash>]:hover`), or appended if there's none.

This is compile-time, attribute-based scoping: zero runtime cost, SSR-safe, and leak-proof because Weave only marks the DOM **it** generated.

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

Because there's no shadow root, `:host` is rewritten to a **separate** attribute on the root element(s), `data-w-<hash>-h`:

| You write | Compiles to | Meaning |
| --- | --- | --- |
| `:host` | `[data-w-<hash>-h]` | the component's root element(s) |
| `:host(.active)` | `.active[data-w-<hash>-h]` | the root **when** it also matches `.active` |
| `:host .child` | `[data-w-<hash>-h] .child` | a descendant, with `:host` in ancestor position |

The host attribute is **only** stamped on the root when your CSS actually uses `:host` — there's no extra attribute on components that never style their host.

:::callout info "`:host-context(...)` is not supported"
There is no `:host-context(...)`-style selector for styling a component based on an *ancestor* outside it. If you write one it is left untouched by the rewriter rather than implemented, so it won't do what you expect. Style from the ancestor's own component instead, or use a CSS variable / class set higher up the tree.
:::

## Reaching outside the scope: `:global`

Sometimes a selector genuinely must escape scoping — a third-party widget's classes, or an element your component creates in JavaScript. Wrap it in `:global(...)`:

~~~scss
.prose :global(.hljs-keyword) { color: var(--accent); }
~~~

Everything outside the `:global()` stays scoped; only what's inside it is emitted unscoped. This keeps the escape hatch surgical. The specifics:

- `:global(...)` works in **any** position — leading, middle, or rightmost compound.
- You can use **more than one** `:global(...)` in a single selector.
- When the **rightmost** compound is `:global(...)`, that compound carries **no** scope attribute (there's nothing of yours to anchor it to) — which is exactly the foreign-element case below.
- Inside `:global(...)` the parentheses are simply unwrapped: `.prose :global(.x .y)` styles `.x .y` anywhere inside this component's `.prose`.

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

## At-rules and nesting

Most CSS you write needs no special thought — but it helps to know which at-rules the scoper recurses into and which it leaves alone:

| At-rule | What scoping does |
| --- | --- |
| `@media`, `@supports`, `@container`, `@layer` | Recursed into — the selectors **inside** are scoped normally. |
| `@keyframes` | The animation **name is kept** as-is; the frame selectors (`0%`, `from`, `to`) are **not** scoped (they aren't element selectors). |
| `@font-face`, `@page`, `@property`, `@counter-style` | Emitted **unscoped** — they're declaration-only with nothing to scope. |

Native CSS **nesting** is scope-aware: the `&` parent reference and nested rules inherit the right scope, so you can nest exactly as you would in plain CSS or SCSS.

~~~scss
.card {
  padding: 12px;
  /* nested rule — `&` and `.title` are scoped correctly */
  & .title { font-weight: 600; }
  &:hover { border-color: var(--accent); }
}

@media (min-width: 40rem) {
  .card { padding: 16px; } /* .card here is still scoped */
}

@keyframes pulse {           /* name `pulse` kept; 0%/100% not scoped */
  0% { opacity: .6; }
  100% { opacity: 1; }
}
~~~

## App-wide styles

Component styles are for components. For genuinely global things — CSS variables, resets, the base `body` font, design tokens — list one or more entry stylesheets in `weave.config.ts`. The `styles` config is an **ordered array**: its entries are compiled and concatenated in order, **before** any component CSS, so your tokens are available everywhere and component rules can override the resets:

:::tabs
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
:::

A common, tidy split: **tokens and resets** go in the global stylesheet; **everything else** lives scoped next to its component and references the tokens via `var(--…)`.

:::callout info "How styles get to the page: dev vs build"
The scoped output is identical either way — only the **delivery** differs. In **dev**, each component's CSS is injected with a tiny per-component `<style>` (nothing is written to disk; the dev server serves from memory). In a **build**, every component's scoped CSS is collected and emitted as **one** stylesheet. You author the same CSS in both; the compiler just packages it differently.
:::

## Custom elements

A component shipped as a [custom element](/learn/custom-elements) renders into its **light DOM** (no shadow root), so its scoped styles are collected into the same app stylesheet and apply normally. You don't lose scoping by exposing a component as `<my-widget>`.

:::callout info "What you just learned"
Component styles can live in a sibling file, an inline string, an explicit file, a `styles` **array** (cascade = array order), or a `.weave` `<style>` block — declaration **or** sibling, never both. The language is `css` (zero-cost passthrough), `scss`, or `sass` (indented). Scoping is compile-time and attribute-based: a 6-char FNV-1a `data-w-<hash>` stamped on emitted elements, with only the **rightmost compound** scoped. Style the host with `:host`/`:host(...)` (rewritten to `data-w-<hash>-h`, emitted only when used; `:host-context` unsupported), escape surgically with `:global(...)` anywhere. `@media`/`@supports`/`@container`/`@layer` recurse; `@keyframes` keeps its name but not its frames; `@font-face`/`@page`/`@property`/`@counter-style` stay unscoped; native `&` nesting is scope-aware. Elements built in JS (child components, `<Link>`) need the scoped-container + `:global` pattern. The global `styles` config is an ordered array concatenated before component CSS; dev injects per-component, build emits one sheet.
:::

[Next: Lifecycle, context & DI →](/learn/lifecycle-context-di)
