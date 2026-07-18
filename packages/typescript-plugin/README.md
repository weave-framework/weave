# @weave-framework/typescript-plugin

Weave TypeScript Service plugin — gives component `.ts` files their synthesized default export (no TS1192) and counts template-only imports as used, in any editor that loads tsserver plugins (VS Code, WebStorm).

Part of **[Weave](https://weaveframework.dev/)** — a fine-grained reactive, signal-native UI framework: no Virtual DOM, zero third-party runtime dependencies.

```bash
npm install -D @weave-framework/typescript-plugin
```

Then add it to `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "@weave-framework/typescript-plugin" }]
  }
}
```

Restart the TypeScript service afterwards so the editor picks it up.

## Why you want it

A Weave component is a `setup()` plus a sibling template; the default export is synthesized at build time. Without this plugin your editor doesn't know that, so it reports two false errors on perfectly good code:

- **TS1192 — "Module … has no default export"** on every component import.
- **Unused import** on anything referenced only from the template.

The plugin takes over component `.ts` files (and `.weave` SFCs) and fixes both, and it makes a parent's import of a child resolve the child's typed props. It reuses the same virtual-module machinery as `weave check`, so the editor agrees with the build.

VS Code's Weave extension injects the plugin for you. WebStorm only loads tsserver plugins listed in `tsconfig.json`, so the step above is required there.

📚 **Editor setup + docs:** [Tooling guide](https://weaveframework.dev/learn/tooling)

## License

MIT
