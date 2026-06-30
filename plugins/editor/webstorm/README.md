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

- **`weave-webstorm-0.6.0.zip`** — current/complete: HTML syntax coloring, go-to-definition,
  hover, **and** red-squiggle diagnostics (a server fix makes Volar push diagnostics to
  clients like LSP4IJ that advertise but don't answer `workspace/configuration`). *Test this.*
- **`weave-webstorm-0.4.0.zip`** — minimal fallback. go-to-definition + hover only; template
  shows as uncolored plain text, no diagnostics. Use only if 0.6.0 misbehaves.

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
