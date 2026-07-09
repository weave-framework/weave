# Weave — WebStorm plugin

First-class editor support for [Weave](../../..) in WebStorm: template type-checking,
go-to-definition between a template and its component `.ts`, no spurious HTML warnings,
hover. Works for both `.weave` single-file components and the separate `.ts` + `.html`
(+ `.scss`) authoring form.

> **Requires [LSP4IJ](https://plugins.jetbrains.com/plugin/23257-lsp4ij)** (a free Red Hat
> Marketplace plugin) — install it first if you don't have it. Also: a paid JetBrains IDE
> (WebStorm / IDEA Ultimate, 2023.2+) and **Node.js on your PATH** (the plugin runs the
> bundled language server with `node`).

## Install

In WebStorm: **Settings → Plugins → ⚙ (gear) → Install Plugin from Disk…** → pick the
**latest** `weave-webstorm-*.zip` from this folder → **Restart**.

- **`weave-webstorm-0.16.0.zip`** — current/complete: HTML syntax coloring, go-to-definition,
  hover, and red-squiggle diagnostics, plus the Weave logo. Built on the M10 unified `{{ }}`
  binding syntax. Verified working on WebStorm 261 (2026.1).
  - **0.16.0** — a Weave template now uses a dedicated **non-HTML file type** (was `HtmlFileType`,
    kept only for the icon). Some WebStorm annotators key off the *file type* rather than the
    language — notably the HTML event-handler-attribute JS handling, which flagged `on*={{ … }}`
    bindings with a bogus **"Missing }"** (no language injection, so nothing to un-inject). The
    dedicated file type keeps those file-type-gated HTML features off the template.
  - **0.15.0** — **go-to-definition** on a template binding (`{{ list }}`) now lands on the
    `const list = …` declaration in `setup()`, not the `return { list, … }` shorthand it used to jump
    to. (Language-server change — benefits the VS Code extension too on its next rebuild.)
  - **0.14.0** — registers the template language substitutor `order="first"` so Weave `.html`
    templates are recognized even in a **mixed Nx workspace that also has Angular** — where WebStorm's
    Angular support otherwise substitutes every `.html` to `Angular2Html` first and left Weave templates
    showing native "unknown tag"/namespace errors. Real Angular templates (a `.html` with an
    `@Component` sibling, not `setup`) are untouched.

> Template type errors are flagged on `{{ expr }}` text bindings and `attr={{expr}}` attribute
> bindings (M10 — double braces everywhere; one syntax). A single brace in text content (`{x}`)
> is literal text in Weave, not a binding, so it is correctly not type-checked.

## Required for the `.ts` side (`TS1192` "no default export")

The language server above handles the **template** (`.html`/`.weave`). The component **`.ts`** files
are handled by WebStorm's own TypeScript service, which only loads tsserver plugins declared in your
**`tsconfig.json`**. So to make the synthesized default export work (and silence `TS1192: Module … has
no default export` plus template-only "unused import" warnings), add the plugin there:

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "plugins": [{ "name": "@weave-framework/typescript-plugin" }]
  }
}
```

…and make sure `@weave-framework/typescript-plugin` is installed (a dependency in your project, so it resolves
from `node_modules`). Then **restart the TypeScript service** (or the IDE). Unlike VS Code — which
injects the plugin automatically via the extension — WebStorm requires this tsconfig entry.

## What's inside

- **Language server** (`server/server.cjs`, bundled) — type-checks template expressions
  against the component and powers hover / go-to-definition, surfaced through **LSP4IJ**.
- A Weave `.html` template (one with a sibling component `.ts`) is switched to a dedicated
  non-XML language so WebStorm stops flagging it as broken HTML; ordinary `.html` files are
  untouched. The plugin picks up your project's TypeScript automatically.
- The **`.ts`-side fixes** come from the separate **`@weave-framework/typescript-plugin`** (see the section
  above — it must be wired into `tsconfig.json`).

> Built from the private source in `editor/webstorm/` with Gradle. This folder holds only
> the shippable artifacts.
