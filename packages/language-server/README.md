# @weave-framework/language-server

Weave language server — Volar-based IDE support (`.weave` files + template type-checking) for VS Code and WebStorm.

Part of **[Weave](https://weaveframework.dev/)** — a fine-grained reactive, signal-native UI framework: no Virtual DOM, zero third-party runtime dependencies.

## You don't install this

This package is not published to npm on its own. It ships **inside the Weave editor extensions** (VS Code / WebStorm) — install the extension for your editor and you already have it.

## What it does

An LSP server built on Volar, bundling the TypeScript and CSS services. It reports template diagnostics on the `.html` side of a component, plus hover and go-to-definition across the template/`setup()` boundary, by reusing the same virtual-module machinery as `weave check` — so your editor and your build agree on what's an error.

It pairs with `@weave-framework/typescript-plugin`, which handles the `.ts` side (the synthesized default export, and template-only imports counting as used).

The `weave-language-server` binary speaks LSP over stdio, for integrating an editor that isn't covered by the shipped extensions.

📚 **Editor setup + docs:** [Tooling guide](https://weaveframework.dev/learn/tooling)

## License

MIT
