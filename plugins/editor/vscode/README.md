# Weave — VS Code extension

First-class editor support for [Weave](../../..) in VS Code: template type-checking,
go-to-definition between a template and its component `.ts`, no spurious HTML warnings,
autocomplete and hover. Works for both `.weave` single-file components and the
separate `.ts` + `.html` (+ `.scss`) authoring form.

## Install

Download the latest `.vsix` from this folder, then:

```sh
code --install-extension weave-language-0.3.2.vsix
```

Or in VS Code: **Extensions** panel → **⋯** menu → **Install from VSIX…** → pick the file.

Reload the window when prompted.

## What's inside

The `.vsix` bundles two halves:

- **Language server** (`dist/server.cjs`) — the template side: type-checks template
  expressions against the component, kills HTML noise, powers hover/completion.
- **TypeScript service plugin** (`node_modules/@weave/typescript-plugin/`) — the `.ts`
  side: synthesizes the component's default export (no `TS1192`) and counts
  template-only imports as used, so component files stop showing red underlines.

Both load automatically once the extension is installed — no settings required.

> Built from the private source in `editor/vscode/` via `npm run package`. This folder
> holds only the shippable artifact.
