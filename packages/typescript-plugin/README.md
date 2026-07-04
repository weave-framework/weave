# @weave-framework/typescript-plugin

Weave TypeScript Service plugin — gives component `.ts` files their synthesized default export (no TS1192) and counts template-only imports as used, in any editor that loads tsserver plugins (VS Code, WebStorm).

Part of **[Weave](https://weaveframework.dev/)** — a fine-grained reactive, signal-native UI framework: no Virtual DOM, zero third-party runtime dependencies.

```bash
npm install -D @weave-framework/typescript-plugin
```

Then add it to `tsconfig.json` under `compilerOptions.plugins`. It also ships inside the Weave editor extensions.

📚 **Editor setup + docs:** [weaveframework.dev](https://weaveframework.dev/)

## License

MIT
