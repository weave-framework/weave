# Weave — WebStorm plugin

First-class editor support for [Weave](../../..) in WebStorm (and IntelliJ IDEA
Ultimate): template type-checking, go-to-definition between a template and its component
`.ts`, no spurious HTML warnings, autocomplete and hover. Works for both `.weave`
single-file components and the separate `.ts` + `.html` (+ `.scss`) authoring form.

> Requires a **paid** JetBrains IDE (WebStorm / IDEA Ultimate, 2023.2+) — the LSP API it
> uses isn't available in Community editions. **Node.js must be on your PATH** (the plugin
> runs the bundled language server with `node`).

## Install

In WebStorm: **Settings → Plugins → ⚙ (gear) → Install Plugin from Disk…** → pick
`weave-webstorm-0.4.0.zip` from this folder → **Restart**.

## What's inside

- **Language server** (`server/server.cjs`, bundled in the plugin) — the template side:
  type-checks template expressions against the component, powers hover / completion /
  go-to-definition, and (via an HTML inspection suppressor) silences WebStorm's built-in
  HTML noise on Weave `.html` templates.
- The **`.ts`-side fixes** (synthesized default export → no `TS1192`; template-only
  imports counted as used) come from the separate **`@weave/typescript-plugin`** tsserver
  plugin, which WebStorm loads natively — point WebStorm at it under **Settings →
  Languages & Frameworks → TypeScript** if you want the `.ts` red underlines gone too.

The plugin picks up your project's TypeScript (`node_modules/typescript`) automatically.

> Built from the private source in `editor/webstorm/` with Gradle (`buildPlugin`). This
> folder holds only the shippable artifact.
