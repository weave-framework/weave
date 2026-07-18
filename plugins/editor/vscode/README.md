# Weave — VS Code extension

First-class editor support for [Weave](../../..) in VS Code: template type-checking,
go-to-definition between a template and its component `.ts`, no spurious HTML warnings,
autocomplete and hover. Works for both `.weave` single-file components and the
separate `.ts` + `.html` (+ `.scss`) authoring form.

## Install

Download the latest `.vsix` from this folder, then:

```sh
code --install-extension weave-language-0.6.0.vsix
```

Or in VS Code: **Extensions** panel → **⋯** menu → **Install from VSIX…** → pick the file.

Reload the window when prompted.

### 0.6.0 — install this one

The previously shipped `0.5.0` bundled a language server built on **30 June**, so it predated
`auto-expose` (a `setup()` may omit its `return`) and typed the template context as `void`. Every
`{{ binding }}` of every such component came up red: on a real application that was **11 false
errors in a single file, 1642 across 41 files**, while `weave check` over the same tree reported
none. Its staged tsserver plugin was also still under the pre-rename `@weave/` scope, which VS Code
resolves by name — so the `.ts` side silently got no plugin at all and kept its `TS1192`.

`0.6.0` carries a server built from the current source (verified: 0 diagnostics across the same 41
files) and the correctly scoped `@weave-framework/typescript-plugin`. `pnpm verify:editor-plugins`
now fails the build if either shipped editor artifact drifts from the language-server source again.

## What's inside

The `.vsix` bundles two halves:

- **Language server** (`dist/server.cjs`) — the template side: type-checks template
  expressions against the component, kills HTML noise, powers hover/completion.
- **TypeScript service plugin** (`node_modules/@weave-framework/typescript-plugin/`) — the `.ts`
  side: synthesizes the component's default export (no `TS1192`) and counts
  template-only imports as used, so component files stop showing red underlines.

Both load automatically once the extension is installed — no settings required.

> Built from the private source in `editor/vscode/` via `npm run package`. This folder
> holds only the shippable artifact.
