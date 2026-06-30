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

- **`weave-webstorm-0.13.0.zip`** — current/complete: HTML syntax coloring, go-to-definition,
  hover, and red-squiggle diagnostics, plus the Weave logo. Built on the M10 unified `{{ }}`
  binding syntax. Verified working on WebStorm 261.
- **`weave-webstorm-0.4.0.zip`** — minimal fallback (go-to-definition + hover only, plain text,
  no diagnostics). Use only if 0.13.0 misbehaves.

> Template type errors are flagged on `{{ expr }}` text bindings and `attr={{expr}}` attribute
> bindings (M10 — double braces everywhere; one syntax). A single brace in text content (`{x}`)
> is literal text in Weave, not a binding, so it is correctly not type-checked.

## What's inside

- **Language server** (`server/server.cjs`, bundled) — type-checks template expressions
  against the component and powers hover / go-to-definition, surfaced through **LSP4IJ**.
- A Weave `.html` template (one with a sibling component `.ts`) is switched to a dedicated
  non-XML language so WebStorm stops flagging it as broken HTML; ordinary `.html` files are
  untouched. The plugin picks up your project's TypeScript automatically.
- The **`.ts`-side fixes** (`TS1192`; template-only imports) come from the separate
  **`@weave/typescript-plugin`** tsserver plugin — point WebStorm at it under **Settings →
  Languages & Frameworks → TypeScript** if you want the `.ts` red underlines gone too.

> Built from the private source in `editor/webstorm/` with Gradle. This folder holds only
> the shippable artifacts.
